"""The one cached fetch path for every upstream call (ADR-0012 D1, D3, D5).

SYNC by design: builders port the sync `requests` probe scripts as-is, and FastAPI runs `def`
routes in a threadpool. Async callers can use the `a*` wrappers (asyncio.to_thread).

    from app import http
    http.register_source("cr2met_nrt", max_concurrency=2, min_interval_s=1.0, timeout_s=30)
    r = http.get_json("cr2met_nrt", url, params={...}, ttl=http.TTL_DAY)
    r.body, r.fetched_at, r.stale, r.from_cache, r.source

Behaviour
- Cache: every successful response is stored in DuckDB (http_cache), keyed by source + method + url
  + params/body. Fresh cache (expires_at in the future, or ttl=None = never expires) is served
  without a network call.
- In-flight dedup: concurrent calls for the same key share one upstream request.
- Stale on error: if a refresh fails and an older good copy exists, it is returned with stale=True
  (and `error` set); the next upstream attempt for that key waits STALE_RETRY_S (60 s).
- Empty is not success: an empty body (or JSON None/{}/[]), or `validate(body) is False`, never
  overwrites the cache and counts as a failure. Pass allow_empty=True where "nothing" is a real answer.
- No cached copy and the upstream fails -> raises FetchError(source, url, reason). Callers turn that
  into an unavailable/estimated value with the reason; never invent data.
- Politeness: per-source semaphore (default 2) + min interval between request starts, global pool of
  GLOBAL_MAX_CONCURRENCY (ADR-0023: sized so the largest source, Planetary Computer at 8, is never capped by it;
  a request takes its source slot BEFORE a global slot, so calls queued on a slow 1-slot government source never
  hold global slots), explicit timeouts, retries with backoff on 429/5xx/transport errors
  (Retry-After honoured up to 30 s), honest User-Agent. No header spoofing, no auth bypass.
- Guards: CLM_OFFLINE=1 serves cache only. open-meteo.com is refused before
  config.OPEN_METEO_EMBARGO_UNTIL (quota exhausted; ADR-0011) without touching the network.
"""

from __future__ import annotations

import asyncio
import hashlib
import json as _json
import logging
import threading
import time
from concurrent.futures import Future
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Literal
from urllib.parse import urlparse

import httpx

from app import config, store

log = logging.getLogger("clm.http")

TTL_FOREVER: float | None = None
TTL_HOUR = 3600.0
TTL_6H = 6 * 3600.0
TTL_DAY = 24 * 3600.0
TTL_WEEK = 7 * 24 * 3600.0

DEFAULT_TIMEOUT_S = 20.0
DEFAULT_RETRIES = 2
STALE_RETRY_S = 60.0
#: ADR-0023: >= the sum that can usefully run at once (Planetary Computer 8 + the national sites' 1-2 each).
GLOBAL_MAX_CONCURRENCY = 16
RETRYABLE_STATUS = {429, 500, 502, 503, 504}

Parse = Literal["json", "bytes", "text"]


class FetchError(Exception):
    """Upstream failed and nothing usable is cached."""

    def __init__(self, source: str, url: str, reason: str, status: int | None = None):
        super().__init__(f"{source}: {reason} ({url})")
        self.source = source
        self.url = url
        self.reason = reason
        self.status = status


@dataclass
class FetchResult:
    body: Any
    fetched_at: datetime
    stale: bool
    from_cache: bool
    source: str
    url: str = ""
    status: int | None = None
    content_type: str | None = None
    #: Why the refresh failed when stale=True.
    error: str | None = None

    @property
    def fetched_at_iso(self) -> str:
        return config.iso_utc(self.fetched_at)


@dataclass
class SourceConfig:
    source: str
    max_concurrency: int = 2
    min_interval_s: float = 0.0
    timeout_s: float = DEFAULT_TIMEOUT_S
    retries: int = DEFAULT_RETRIES
    sem: threading.BoundedSemaphore = field(init=False)
    pace_lock: threading.Lock = field(default_factory=threading.Lock)
    last_start: float = 0.0

    def __post_init__(self) -> None:
        self.sem = threading.BoundedSemaphore(max(1, int(self.max_concurrency)))


_sources: dict[str, SourceConfig] = {}
_sources_lock = threading.Lock()
_global_sem = threading.BoundedSemaphore(GLOBAL_MAX_CONCURRENCY)
_inflight: dict[str, Future] = {}
_inflight_lock = threading.Lock()
_stale_until: dict[str, float] = {}
_client: httpx.Client | None = None
_client_lock = threading.Lock()


def register_source(
    source: str,
    max_concurrency: int = 2,
    min_interval_s: float = 0.0,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    retries: int = DEFAULT_RETRIES,
) -> SourceConfig:
    """Declare a source's politeness limits (call at import time in your package). Idempotent:
    re-registering replaces the limits."""
    with _sources_lock:
        cfg = SourceConfig(source, max_concurrency, min_interval_s, timeout_s, retries)
        _sources[source] = cfg
        return cfg


def source_limit(source: str) -> int:
    """The source's max concurrent requests (callers size their worker pools with this, ADR-0023)."""
    return max(1, int(_source_cfg(source).max_concurrency))


def _source_cfg(source: str) -> SourceConfig:
    with _sources_lock:
        cfg = _sources.get(source)
        if cfg is None:
            cfg = SourceConfig(source)
            _sources[source] = cfg
        return cfg


def _get_client() -> httpx.Client:
    global _client
    with _client_lock:
        if _client is None:
            _client = httpx.Client(
                headers={"User-Agent": config.USER_AGENT},
                follow_redirects=True,
                timeout=DEFAULT_TIMEOUT_S,
            )
        return _client


def reset_state() -> None:
    """Testing aid: forget in-memory backoffs, in-flight calls and the shared client."""
    global _client
    with _inflight_lock:
        _inflight.clear()
    _stale_until.clear()
    with _client_lock:
        if _client is not None:
            _client.close()
        _client = None


# ───────────────────────── helpers ─────────────────────────


def _hash_request(method: str, url: str, params: Any, json_body: Any, data: Any, key_extra: Any) -> str:
    blob = _json.dumps(
        {"m": method, "p": params, "j": json_body, "d": data, "x": key_extra},
        sort_keys=True,
        default=str,
        separators=(",", ":"),
    )
    return hashlib.sha256(blob.encode()).hexdigest()[:32]


def cache_key(source: str, method: str, url: str, params_hash: str) -> str:
    return f"{source}:{hashlib.sha256(f'{method} {url} {params_hash}'.encode()).hexdigest()[:40]}"


def _parse(raw: bytes, parse: Parse) -> Any:
    if parse == "json":
        return _json.loads(raw.decode("utf-8-sig"))
    if parse == "text":
        return raw.decode("utf-8", errors="replace")
    return raw


def _is_empty(raw: bytes, parsed: Any, parse: Parse) -> bool:
    if not raw or not raw.strip():
        return True
    if parse == "json" and parsed in (None, {}, []):
        return True
    return False


def _blocked_reason(url: str) -> str | None:
    host = (urlparse(url).hostname or "").lower()
    if host.endswith("open-meteo.com") and config.utcnow() < config.OPEN_METEO_EMBARGO_UNTIL:
        return (
            "Open-Meteo free quota for this IP is exhausted until "
            f"{config.iso_utc(config.OPEN_METEO_EMBARGO_UNTIL)}; not called"
        )
    if config.offline():
        return "offline mode (CLM_OFFLINE=1): upstream not called"
    return None


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _from_row(row: dict, parse: Parse, source: str, stale: bool, error: str | None) -> FetchResult:
    return FetchResult(
        body=_parse(row["body"] or b"", parse),
        fetched_at=_as_utc(row["fetched_at"]),
        stale=stale,
        from_cache=True,
        source=source,
        url=row["url"],
        status=row["status"],
        content_type=row["content_type"],
        error=error,
    )


def _safe_status(source: str, ok: bool, stale: bool = False, error: str | None = None) -> None:
    try:
        store.source_status_update(source, ok, stale, error)
    except Exception as exc:  # health bookkeeping must never break a fetch
        log.warning("source_status update failed for %s: %s", source, exc)


def _do_request(
    cfg: SourceConfig,
    method: str,
    url: str,
    params: Any,
    json_body: Any,
    data: Any,
    headers: dict | None,
    timeout: float | None,
) -> httpx.Response:
    client = _get_client()
    attempts = cfg.retries + 1
    last_exc: Exception | None = None
    for attempt in range(attempts):
        # source slot first, then a global slot (ADR-0023): never hold a global slot while queued on a source
        with cfg.sem, _global_sem:
            if cfg.min_interval_s > 0:
                with cfg.pace_lock:
                    wait = cfg.last_start + cfg.min_interval_s - time.monotonic()
                    if wait > 0:
                        time.sleep(wait)
                    cfg.last_start = time.monotonic()
            try:
                resp = client.request(
                    method,
                    url,
                    params=params,
                    json=json_body,
                    data=data,
                    headers=headers,
                    timeout=timeout or cfg.timeout_s,
                )
            except httpx.TransportError as exc:
                last_exc = exc
                resp = None
        if resp is not None:
            if resp.status_code not in RETRYABLE_STATUS or attempt == attempts - 1:
                return resp
            retry_after = resp.headers.get("Retry-After", "")
            delay = float(retry_after) if retry_after.isdigit() else 2.0**attempt
        else:
            if attempt == attempts - 1:
                raise last_exc  # type: ignore[misc]
            delay = 2.0**attempt
        time.sleep(min(delay, 30.0))
    raise RuntimeError("unreachable")


# ───────────────────────── core ─────────────────────────


def fetch(
    method: str,
    source: str,
    url: str,
    *,
    params: dict | list | None = None,
    json_body: Any = None,
    data: Any = None,
    headers: dict | None = None,
    ttl: float | None = TTL_6H,
    timeout: float | None = None,
    parse: Parse = "json",
    validate: Callable[[Any], bool] | None = None,
    allow_empty: bool = False,
    key_extra: Any = None,
    force_refresh: bool = False,
) -> FetchResult:
    """Cached, deduplicated, polite fetch. See module docstring. `headers` must never carry spoofed
    identity; the User-Agent is set by the client."""
    method = method.upper()
    params_hash = _hash_request(method, url, params, json_body, data, key_extra)
    key = cache_key(source, method, url, params_hash)

    cached: dict | None = None
    try:
        cached = store.cache_get(key)
    except Exception as exc:
        log.warning("cache read failed for %s: %s", source, exc)
    good = cached if cached and cached.get("ok") else None

    now = config.utcnow()
    if good and not force_refresh:
        exp = _as_utc(good["expires_at"])
        if exp is None or exp > now:
            return _from_row(good, parse, source, stale=False, error=None)

    blocked = _blocked_reason(url)
    if blocked:
        if good:
            return _from_row(good, parse, source, stale=True, error=blocked)
        raise FetchError(source, url, blocked)

    if good and _stale_until.get(key, 0) > time.monotonic():
        return _from_row(good, parse, source, stale=True, error="upstream failed recently; retrying after backoff")

    # in-flight dedup
    with _inflight_lock:
        fut = _inflight.get(key)
        owner = fut is None
        if owner:
            fut = Future()
            _inflight[key] = fut
    if not owner:
        return fut.result()

    try:
        result = _refresh(
            source, url, method, key, params_hash, params, json_body, data, headers, ttl, timeout,
            parse, validate, allow_empty, good,
        )
        fut.set_result(result)
        return result
    except BaseException as exc:
        fut.set_exception(exc)
        raise
    finally:
        with _inflight_lock:
            _inflight.pop(key, None)


def _refresh(
    source, url, method, key, params_hash, params, json_body, data, headers, ttl, timeout,
    parse, validate, allow_empty, good,
) -> FetchResult:
    cfg = _source_cfg(source)
    reason: str | None = None
    status: int | None = None
    try:
        resp = _do_request(cfg, method, url, params, json_body, data, headers, timeout)
        status = resp.status_code
        raw = resp.content
        if resp.status_code >= 400:
            reason = f"HTTP {resp.status_code}"
        else:
            try:
                parsed = _parse(raw, parse)
            except Exception as exc:
                reason = f"unparseable {parse} response: {exc.__class__.__name__}"
            else:
                if not allow_empty and _is_empty(raw, parsed, parse):
                    reason = "empty response (not treated as success)"
                elif validate is not None and not validate(parsed):
                    reason = "response failed validation"
                else:
                    fetched_at = config.utcnow()
                    expires_at = None if ttl is None else fetched_at + timedelta(seconds=ttl)
                    try:
                        store.cache_put(
                            key, source, str(resp.request.url) if resp.request else url, params_hash,
                            resp.status_code, raw, resp.headers.get("content-type"), fetched_at, expires_at, True,
                        )
                    except Exception as exc:
                        log.warning("cache write failed for %s: %s", source, exc)
                    _stale_until.pop(key, None)
                    _safe_status(source, ok=True)
                    return FetchResult(
                        body=parsed, fetched_at=fetched_at, stale=False, from_cache=False, source=source,
                        url=url, status=resp.status_code, content_type=resp.headers.get("content-type"),
                    )
    except httpx.TimeoutException as exc:
        reason = f"timeout ({exc.__class__.__name__})"
    except httpx.TransportError as exc:
        reason = f"network error ({exc.__class__.__name__})"

    log.info("fetch failed source=%s reason=%s", source, reason)
    if good:
        _stale_until[key] = time.monotonic() + STALE_RETRY_S
        _safe_status(source, ok=False, stale=True, error=reason)
        return _from_row(good, parse, source, stale=True, error=reason)
    _safe_status(source, ok=False, stale=False, error=reason)
    raise FetchError(source, url, reason or "unknown error", status)


# ───────────────────────── convenience wrappers ─────────────────────────


def get_json(source: str, url: str, params: dict | list | None = None, ttl: float | None = TTL_6H,
             timeout: float | None = None, **kw: Any) -> FetchResult:
    return fetch("GET", source, url, params=params, ttl=ttl, timeout=timeout, parse="json", **kw)


def get_bytes(source: str, url: str, params: dict | list | None = None, ttl: float | None = TTL_6H,
              timeout: float | None = None, **kw: Any) -> FetchResult:
    return fetch("GET", source, url, params=params, ttl=ttl, timeout=timeout, parse="bytes", **kw)


def get_text(source: str, url: str, params: dict | list | None = None, ttl: float | None = TTL_6H,
             timeout: float | None = None, **kw: Any) -> FetchResult:
    return fetch("GET", source, url, params=params, ttl=ttl, timeout=timeout, parse="text", **kw)


def post_json(source: str, url: str, json_body: Any = None, params: dict | None = None,
              ttl: float | None = TTL_6H, timeout: float | None = None, data: Any = None,
              **kw: Any) -> FetchResult:
    """POST with a JSON body (or form `data=`), parse the JSON response."""
    return fetch("POST", source, url, params=params, json_body=json_body, data=data, ttl=ttl,
                 timeout=timeout, parse="json", **kw)


async def aget_json(*a: Any, **kw: Any) -> FetchResult:
    return await asyncio.to_thread(get_json, *a, **kw)


async def aget_bytes(*a: Any, **kw: Any) -> FetchResult:
    return await asyncio.to_thread(get_bytes, *a, **kw)


async def apost_json(*a: Any, **kw: Any) -> FetchResult:
    return await asyncio.to_thread(post_json, *a, **kw)
