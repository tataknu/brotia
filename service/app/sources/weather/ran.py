"""RAN — Red Agroclimática Nacional (agromet.cl) hourly stations (ADR-0004 D2, ADR-0005 D3/D5).

Keyless endpoints used by agromet.cl's own pages (families/chile-agromet, verified live 2026-11-07):
    /ext/aux/getGraphData.php?ema_ia_id=ID&dateFrom=YYYY-MM-DD HH:MM:SS&dateTo=...&portada=false
    -> XML rows 'fecha|<local ts>|1|Tavg|2|PP|3|RH|4|P|5|Rad|6|Vmax|7|Tmin|8|Tmax|9|Dir|11|GD10|12|HF7|'
Etiquette: honest User-Agent (app.http), robots.txt Crawl-delay 10 -> one request at a time, ≥ 10 s apart;
one station-month per request; past months cached forever, the current month for 1 h. The cold 13-month
pull (~14 requests, ~2.5 min per station) runs in the backfill CLI (`ran-warm`), never inside a request.

TLS: agromet.cl does not send its Sectigo "Public Server Authentication CA DV R36" intermediate. We add
that real, public intermediate (pinned file sectigo_dv_r36.pem, sha256 of DER 8c54c334…22e0, from
Sectigo's AIA URL; valid to 2036-03-21) to the shared client's trust store so the chain verifies to the
Sectigo root in certifi. Verification stays on; nothing is bypassed.

Use: RAN feeds frost/heat/harvest-rain measurements only (not the `series` providers): its history starts
2009, so it cannot share a 1991–2020 baseline with the current value (same-stream rule, ADR-0004 D1).
Station timestamps are local time (America/Santiago); days are local days.
"""

from __future__ import annotations

import calendar
import csv
import html
import logging
import math
import re
import threading
import weakref
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from app import http, store
from app.sources.weather.events import Hour

log = logging.getLogger("clm.weather.ran")

SOURCE = "ran_station"
URL = "https://www.agromet.cl/ext/aux/getGraphData.php"
MAX_KM = 12.0
HERE = Path(__file__).resolve().parent
PEM = HERE / "sectigo_dv_r36.pem"

http.register_source(SOURCE, max_concurrency=1, min_interval_s=10.0, timeout_s=60, retries=1)


class RanUnavailable(Exception):
    pass


# ───────────────────────── stations ─────────────────────────

_stations: list[dict] | None = None


def stations() -> list[dict]:
    """442 RAN stations (id, name, region, lat, lon) from the catalogue pulled in discovery
    (getRegionWMS.php per region, 2026-11-07)."""
    global _stations
    if _stations is None:
        with open(HERE / "ran_stations.csv", newline="", encoding="utf-8") as f:
            _stations = [
                {"id": r["id"], "name": html.unescape(r["name"]), "region": r["region"],
                 "lat": float(r["lat"]), "lng": float(r["lon"])}
                for r in csv.DictReader(f)
            ]
    return _stations


def km(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lng2 - lng1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


def nearest_stations(lng: float, lat: float, max_km: float = MAX_KM, limit: int = 3) -> list[tuple[dict, float]]:
    ds = sorted(((s, km(lng, lat, s["lng"], s["lat"])) for s in stations()), key=lambda x: x[1])
    return [(s, d) for s, d in ds if d <= max_km][:limit]


# ───────────────────────── TLS chain ─────────────────────────

_patched: "weakref.WeakSet" = weakref.WeakSet()
_patch_lock = threading.Lock()


def ensure_tls() -> None:
    """Add the pinned Sectigo DV R36 intermediate to the shared httpx client's SSL context (idempotent;
    re-applied after http.reset_state() recreates the client)."""
    client = http._get_client()  # noqa: SLF001 — see needs_from_others: per-source extra CA in app.http
    try:
        ctx = client._transport._pool._ssl_context  # noqa: SLF001
    except AttributeError as exc:
        raise RanUnavailable(f"TLS chain: cannot reach the client's SSL context ({exc})") from exc
    with _patch_lock:
        if ctx in _patched:
            return
        ctx.load_verify_locations(cadata=PEM.read_text())
        _patched.add(ctx)


# ───────────────────────── fetch / parse ─────────────────────────


def _month_params(station_id: str, y: int, m: int) -> dict:
    last = calendar.monthrange(y, m)[1]
    return {"ema_ia_id": str(station_id), "dateFrom": f"{y:04d}-{m:02d}-01 00:00:00",
            "dateTo": f"{y:04d}-{m:02d}-{last:02d} 23:59:59", "portada": "false"}


def _month_closed(y: int, m: int, today: date | None = None) -> bool:
    today = today or datetime.now(timezone.utc).date()
    last = date(y, m, calendar.monthrange(y, m)[1])
    return today - last > timedelta(days=3)


def is_cached(station_id: str, y: int, m: int) -> bool:
    params = _month_params(station_id, y, m)
    try:
        ph = http._hash_request("GET", URL, params, None, None, None)  # noqa: SLF001
        row = store.cache_get(http.cache_key(SOURCE, "GET", URL, ph))
        return bool(row and row.get("ok"))
    except Exception:
        return False


_ROW = re.compile(r"<dato>([^<]*)</dato>")


def parse(xml: str) -> list[Hour]:
    out: list[Hour] = []
    for dato in _ROW.findall(xml):
        f = dato.split("|")
        if len(f) < 2 or f[0] != "fecha":
            continue
        try:
            ts = datetime.strptime(f[1], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        vals: dict[str, float | None] = {}
        for k, v in zip(f[2::2], f[3::2]):
            try:
                vals[k] = float(v) if v not in ("", None) else None
            except ValueError:
                vals[k] = None
        out.append(Hour(ts=ts, tavg=vals.get("1"), precip=vals.get("2"), tmin=vals.get("7"), tmax=vals.get("8")))
    return out


def fetch_month(station_id: str, y: int, m: int) -> tuple[list[Hour], http.FetchResult]:
    ensure_tls()
    ttl = http.TTL_FOREVER if _month_closed(y, m) else http.TTL_HOUR
    r = http.get_text(SOURCE, URL, params=_month_params(station_id, y, m), ttl=ttl, timeout=60,
                      validate=lambda body: "<estacion" in body)
    return parse(r.body), r


def months(start: date, end: date) -> list[tuple[int, int]]:
    out, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def hours_for(station_id: str, start: date, end: date, max_cold_fetches: int = 1) -> dict:
    """Hourly rows for [start, end] (local days). Months not in the cache are fetched only for the latest
    `max_cold_fetches` months (each costs ≥ 10 s); older cold months are reported in `cold_months`.
    Returns {hours, results (FetchResult list), cold_months, errors}."""
    hours: list[Hour] = []
    results: list[http.FetchResult] = []
    cold: list[str] = []
    errors: list[str] = []
    ms = months(start, end)
    allowed_cold = set(ms[-max_cold_fetches:]) if max_cold_fetches > 0 else set()
    for y, m in ms:
        if not is_cached(station_id, y, m) and (y, m) not in allowed_cold:
            cold.append(f"{y}-{m:02d}")
            continue
        try:
            hs, r = fetch_month(station_id, y, m)
        except (http.FetchError, RanUnavailable) as exc:
            errors.append(f"{y}-{m:02d}: {getattr(exc, 'reason', exc)}")
            continue
        except Exception as exc:  # TLS or transport surprises
            errors.append(f"{y}-{m:02d}: {exc.__class__.__name__}: {exc}")
            continue
        results.append(r)
        hours += [h for h in hs if start - timedelta(days=3) <= h.ts.date() <= end]
    return {"hours": hours, "results": results, "cold_months": cold, "errors": errors}


def warm(station_id: str, start: date, end: date, log_fn=None) -> int:
    """Backfill CLI: fetch every station-month of [start, end] (≥ 10 s apart)."""
    n = 0
    for y, m in months(start, end):
        if is_cached(station_id, y, m) and _month_closed(y, m):
            continue
        try:
            hs, r = fetch_month(station_id, y, m)
            n += 1
            if log_fn:
                log_fn(f"  RAN {station_id} {y}-{m:02d}: {len(hs)} hours{' (stale)' if r.stale else ''}")
        except Exception as exc:
            if log_fn:
                log_fn(f"  RAN {station_id} {y}-{m:02d}: failed {exc}")
    return n
