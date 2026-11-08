"""DuckDB cache store (ADR-0012 D1). The service persists caches only (CONTRACT §0).

Database: config.db_path() (default service/data/clm.duckdb; tests point CLM_DB_PATH at a tmp file).

Concurrency model: every helper opens a short-lived connection under a process-wide lock and closes
it. That keeps the file lock free between calls, so a builder script or a second process can use the
same file while the server runs (DuckDB allows one writer process at a time; we retry for up to
~10 s when another process holds it). Scripts and notebooks MUST close their connections promptly
(use store helpers or `with store.connect()`), or point CLM_DB_PATH at a separate file: a long-lived
connection elsewhere stalls the server's cache reads.

Tables
- http_cache(key PK, source, url, params_hash, status, body BLOB, content_type, fetched_at,
             expires_at NULL = never, ok)                          — raw upstream responses (http.py)
- series(source, variable, loc_key, date, value, meta JSON)        — parsed daily/5-day values
         PK (source, variable, loc_key, date)
- assessments(kind, key, json, created_at)  PK (kind, key)         — computed results / derived caches
- audit(id PK, json)                                               — service-side audit records
- source_status(source PK, last_attempt_at, last_ok_at, ok, stale, last_error) — /health

Helpers for builders (all thread-safe):
- series_put(source, variable, loc_key, rows)       rows: iterable of (date, value[, meta dict])
- series_get(source, variable, loc_key, start=None, end=None) -> list[(date_str, value, meta)]
- series_latest_date(source, variable, loc_key) -> 'YYYY-MM-DD' | None
- assessment_put(kind, key, obj) / assessment_get(kind, key) -> obj | None (JSON round trip)
  e.g. kind='imagery_timeline', key=f'{farm_id}:{polygon_hash}:{as_of}'
- audit_put(id, obj) / audit_list()
- loc_key(lng, lat, ndigits=4) -> 'lng,lat' rounded; polygon_hash(geojson) -> short sha1
- execute(sql, params) / query(sql, params) -> list[tuple] for anything else (use your own table
  names prefixed with your package, e.g. 'ciren_orchards'; create them with CREATE TABLE IF NOT EXISTS)
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from contextlib import contextmanager
from datetime import date, datetime, timezone
from typing import Any, Iterable, Iterator

import duckdb

from app import config

_LOCK = threading.RLock()
_INITIALISED: set[str] = set()

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS http_cache (
        key VARCHAR PRIMARY KEY,
        source VARCHAR NOT NULL,
        url VARCHAR NOT NULL,
        params_hash VARCHAR,
        status INTEGER,
        body BLOB,
        content_type VARCHAR,
        fetched_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ,
        ok BOOLEAN NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS series (
        source VARCHAR NOT NULL,
        variable VARCHAR NOT NULL,
        loc_key VARCHAR NOT NULL,
        date DATE NOT NULL,
        value DOUBLE,
        meta JSON,
        PRIMARY KEY (source, variable, loc_key, date)
    )""",
    """CREATE TABLE IF NOT EXISTS assessments (
        kind VARCHAR NOT NULL,
        key VARCHAR NOT NULL,
        json JSON NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (kind, key)
    )""",
    """CREATE TABLE IF NOT EXISTS audit (
        id VARCHAR PRIMARY KEY,
        json JSON NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS source_status (
        source VARCHAR PRIMARY KEY,
        last_attempt_at TIMESTAMPTZ,
        last_ok_at TIMESTAMPTZ,
        ok BOOLEAN,
        stale BOOLEAN,
        last_error VARCHAR
    )""",
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _connect_with_retry(path: str, timeout_s: float = 10.0) -> duckdb.DuckDBPyConnection:
    deadline = time.monotonic() + timeout_s
    delay = 0.05
    while True:
        try:
            return duckdb.connect(path)
        except duckdb.IOException as exc:  # another process holds the write lock
            if time.monotonic() > deadline or "lock" not in str(exc).lower():
                raise
            time.sleep(delay)
            delay = min(delay * 2, 0.5)


@contextmanager
def connect(timeout_s: float = 10.0) -> Iterator[duckdb.DuckDBPyConnection]:
    """Short-lived connection under the process lock. Prefer the helpers below. timeout_s bounds the
    wait for another process's file lock (and for this process's lock)."""
    path = config.db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not _LOCK.acquire(timeout=timeout_s):
        raise TimeoutError("DuckDB store busy in this process")
    try:
        con = _connect_with_retry(str(path), timeout_s)
        try:
            con.execute("SET TimeZone='UTC'")
            if str(path) not in _INITIALISED:
                for stmt in SCHEMA:
                    con.execute(stmt)
                _INITIALISED.add(str(path))
            yield con
        finally:
            con.close()
    finally:
        _LOCK.release()


def init() -> None:
    """Create tables if missing (idempotent)."""
    _INITIALISED.discard(str(config.db_path()))
    with connect():
        pass


def execute(sql: str, params: Iterable[Any] | None = None) -> None:
    with connect() as con:
        con.execute(sql, list(params) if params is not None else None)


def query(sql: str, params: Iterable[Any] | None = None, timeout_s: float = 10.0) -> list[tuple]:
    with connect(timeout_s) as con:
        return con.execute(sql, list(params) if params is not None else None).fetchall()


# ───────────────────────── keys ─────────────────────────


def loc_key(lng: float, lat: float, ndigits: int = 4) -> str:
    return f"{round(float(lng), ndigits)},{round(float(lat), ndigits)}"


def polygon_hash(geojson: Any) -> str:
    if hasattr(geojson, "model_dump"):
        geojson = geojson.model_dump(by_alias=True, mode="json")
    blob = json.dumps(geojson, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha1(blob).hexdigest()[:16]


def _iso_date(d: Any) -> str:
    if isinstance(d, datetime):
        return d.date().isoformat()
    if isinstance(d, date):
        return d.isoformat()
    return str(d)[:10]


# ───────────────────────── http_cache (used by http.py) ─────────────────────────


def cache_get(key: str) -> dict[str, Any] | None:
    """Latest cached row for key (ok or not), or None."""
    with connect() as con:
        row = con.execute(
            "SELECT key, source, url, params_hash, status, body, content_type, fetched_at, expires_at, ok "
            "FROM http_cache WHERE key = ?",
            [key],
        ).fetchone()
    if row is None:
        return None
    cols = ["key", "source", "url", "params_hash", "status", "body", "content_type", "fetched_at", "expires_at", "ok"]
    out = dict(zip(cols, row))
    if out["body"] is not None:
        out["body"] = bytes(out["body"])
    return out


def cache_put(
    key: str,
    source: str,
    url: str,
    params_hash: str,
    status: int,
    body: bytes,
    content_type: str | None,
    fetched_at: datetime,
    expires_at: datetime | None,
    ok: bool = True,
) -> None:
    with connect() as con:
        con.execute(
            "INSERT OR REPLACE INTO http_cache VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [key, source, url, params_hash, status, body, content_type, fetched_at, expires_at, ok],
        )


# ───────────────────────── source_status (health) ─────────────────────────


def source_status_update(source: str, ok: bool, stale: bool = False, error: str | None = None) -> None:
    now = _now()
    with connect() as con:
        prev = con.execute("SELECT last_ok_at FROM source_status WHERE source = ?", [source]).fetchone()
        last_ok = now if ok else (prev[0] if prev else None)
        con.execute(
            "INSERT OR REPLACE INTO source_status VALUES (?, ?, ?, ?, ?, ?)",
            [source, now, last_ok, ok, stale, (error or None) and str(error)[:500]],
        )


def source_status_list(timeout_s: float = 10.0) -> list[dict[str, Any]]:
    rows = query(
        "SELECT source, last_attempt_at, last_ok_at, ok, stale, last_error FROM source_status ORDER BY source",
        timeout_s=timeout_s,
    )
    return [
        dict(zip(["source", "last_attempt_at", "last_ok_at", "ok", "stale", "last_error"], r)) for r in rows
    ]


# ───────────────────────── series ─────────────────────────


def series_put(source: str, variable: str, loc_key_: str, rows: Iterable[tuple]) -> int:
    """Upsert rows of (date, value) or (date, value, meta_dict). Returns the row count written."""
    payload = []
    for r in rows:
        d, v = r[0], r[1]
        meta = r[2] if len(r) > 2 else None
        payload.append(
            [source, variable, loc_key_, _iso_date(d), None if v is None else float(v), json.dumps(meta) if meta is not None else None]
        )
    if not payload:
        return 0
    with connect() as con:
        con.executemany("INSERT OR REPLACE INTO series VALUES (?, ?, ?, ?, ?, ?)", payload)
    return len(payload)


def series_get(
    source: str, variable: str, loc_key_: str, start: Any = None, end: Any = None
) -> list[tuple[str, float | None, dict | None]]:
    sql = "SELECT date, value, meta FROM series WHERE source = ? AND variable = ? AND loc_key = ?"
    params: list[Any] = [source, variable, loc_key_]
    if start is not None:
        sql += " AND date >= ?"
        params.append(_iso_date(start))
    if end is not None:
        sql += " AND date <= ?"
        params.append(_iso_date(end))
    sql += " ORDER BY date"
    out = []
    for d, v, m in query(sql, params):
        out.append((_iso_date(d), v, json.loads(m) if isinstance(m, str) else m))
    return out


def series_latest_date(source: str, variable: str, loc_key_: str) -> str | None:
    rows = query(
        "SELECT max(date) FROM series WHERE source = ? AND variable = ? AND loc_key = ? AND value IS NOT NULL",
        [source, variable, loc_key_],
    )
    return _iso_date(rows[0][0]) if rows and rows[0][0] is not None else None


# ───────────────────────── assessments / audit ─────────────────────────


def _to_jsonable(obj: Any) -> Any:
    if hasattr(obj, "model_dump"):
        return obj.model_dump(by_alias=True, mode="json")
    if isinstance(obj, list):
        return [_to_jsonable(x) for x in obj]
    return obj


def assessment_put(kind: str, key: str, obj: Any) -> None:
    with connect() as con:
        con.execute(
            "INSERT OR REPLACE INTO assessments VALUES (?, ?, ?, ?)",
            [kind, key, json.dumps(_to_jsonable(obj)), _now()],
        )


def assessment_get(kind: str, key: str, max_age_s: float | None = None) -> Any | None:
    rows = query("SELECT json, created_at FROM assessments WHERE kind = ? AND key = ?", [kind, key])
    if not rows:
        return None
    blob, created = rows[0]
    if max_age_s is not None and created is not None:
        if (_now() - created).total_seconds() > max_age_s:
            return None
    return json.loads(blob) if isinstance(blob, str) else blob


def audit_put(id_: str, obj: Any) -> None:
    execute("INSERT OR REPLACE INTO audit VALUES (?, ?)", [id_, json.dumps(_to_jsonable(obj))])


def audit_list() -> list[Any]:
    return [json.loads(j) for (j,) in query("SELECT json FROM audit ORDER BY id")]
