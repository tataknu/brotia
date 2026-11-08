"""ERA5 daily via the Open-Meteo archive API — standard-tier primary and Chile fallback (ADR-0004 D2/D3,
ADR-0005 D2, ADR-0011 D2).

- `models=era5` only (never `best_match`, never `era5_land` precipitation); same-stream rule: the current
  value is compared with ERA5's own 1991–2020 baseline.
- Calls are minimal and deduplicated by 0.25° grid cell: one baseline call per cell (cached forever) and
  one window call per cell per UTC day (cached 6 h). app.http also dedups identical in-flight calls.
- Quota: the free quota from this IP is exhausted until config.OPEN_METEO_EMBARGO_UNTIL (2026-11-08 00:00
  UTC). Before then the provider says "unavailable: quota window" without calling (app.http would refuse too).
- Licence: Open-Meteo free API is non-commercial -> licence tier demo_only (ADR-0011).
"""

from __future__ import annotations

import threading
from datetime import date, datetime, timedelta, timezone

from app import config, http
from app import provenance as prov
from app.registry import ProviderUnavailable
from app.sources.weather.baseline import Bands, build_series, compute_bands, latest_date

SOURCE = "open_meteo"
URL = "https://archive-api.open-meteo.com/v1/archive"
DAILY = {
    "tmax": "temperature_2m_max",
    "tmin": "temperature_2m_min",
    "precip": "precipitation_sum",
    "eto": "et0_fao_evapotranspiration",
}
WINDOW_DAYS = 430

http.register_source(SOURCE, max_concurrency=1, min_interval_s=1.0, timeout_s=90, retries=1)


def embargoed(now: datetime | None = None) -> bool:
    return (now or config.utcnow()) < config.OPEN_METEO_EMBARGO_UNTIL


def snap(lng: float, lat: float) -> tuple[float, float]:
    return round(lng * 4) / 4, round(lat * 4) / 4


def _call(lng: float, lat: float, start: date, end: date, ttl: float | None) -> http.FetchResult:
    params = {
        "latitude": f"{lat:.2f}", "longitude": f"{lng:.2f}",
        "start_date": start.isoformat(), "end_date": end.isoformat(),
        "daily": ",".join(DAILY.values()), "models": "era5", "timezone": "UTC",
    }
    return http.get_json(SOURCE, URL, params=params, ttl=ttl, timeout=90,
                         validate=lambda b: isinstance(b, dict) and isinstance(b.get("daily"), dict))


def _parse(body: dict) -> dict[str, dict[date, float | None]]:
    d = body["daily"]
    ts = [date.fromisoformat(t[:10]) for t in d.get("time", [])]
    out: dict[str, dict[date, float | None]] = {}
    for var, key in DAILY.items():
        vals = d.get(key) or [None] * len(ts)
        out[var] = {t: (None if v is None else float(v)) for t, v in zip(ts, vals)}
    return out


_bands: dict[tuple, Bands] = {}
_lock = threading.Lock()


def series(variable: str, lng: float, lat: float, start: date, end: date, data_tier: str = "standard"):
    """(Series, Provenance) or raises ProviderUnavailable."""
    if embargoed():
        raise ProviderUnavailable(
            "unavailable: quota window (Open-Meteo free quota for this IP exhausted until "
            f"{config.iso_utc(config.OPEN_METEO_EMBARGO_UNTIL)}; not called)"
        )
    clng, clat = snap(lng, lat)
    today = datetime.now(timezone.utc).date()
    try:
        base_r = _call(clng, clat, date(1991, 1, 1), date(2020, 12, 31), ttl=http.TTL_FOREVER)
        w0 = today - timedelta(days=WINDOW_DAYS)
        if start >= w0:
            win_r = _call(clng, clat, w0, today, ttl=http.TTL_6H)
        else:
            win_r = _call(clng, clat, start, min(end, today), ttl=http.TTL_FOREVER if end < today - timedelta(days=30) else http.TTL_6H)
    except http.FetchError as exc:
        raise ProviderUnavailable(f"open_meteo: {exc.reason}") from exc
    key = (clng, clat, variable)
    with _lock:
        bands = _bands.get(key)
    if bands is None:
        bands = compute_bands(_parse(base_r.body)[variable], variable)
        with _lock:
            _bands[key] = bands
    values = {d: v for d, v in _parse(win_r.body)[variable].items() if start <= d <= end}
    last = latest_date(values)
    if last is None:
        raise ProviderUnavailable(f"open_meteo: no ERA5 values for {start}..{end}")
    note = (f"ERA5 0.25° cell ({clng:.2f}, {clat:.2f}) via Open-Meteo archive (models=era5); "
            f"{bands.describe()} from ERA5 itself (same stream)")
    if variable == "precip" and data_tier == "enhanced":
        note += "; ERA5 rain runs ~53–68 % wetter than Chilean gauges (ADR-0004): read percentiles, not mm"
    pv = prov.from_fetch(SOURCE, win_r, observed_at=last, note=note, data_tier=data_tier)  # type: ignore[arg-type]
    return build_series(variable, values, bands, start, end, pv), pv
