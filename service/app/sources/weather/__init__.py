"""svc-weather: daily weather series with 1991–2020 bands, and frost / heat / harvest-rain measurements
(ADR-0004, ADR-0005, CONTRACT §E.5–E.6).

Public API (svc-risk and others call these; all are sync and never raise for upstream failures):

    get_series(variable, farm, start, end, country="CL") -> models.Series        (alias: series)
        variable in {'precip','tmin','tmax','eto'}; daily points for every date in [start, end]
        (value null where no observation), p10/p50/p90 from §E.6, provenance on the Series.
        Unavailable -> Series(points=[]) with provenance.note = the reasons.

    frost_events(farm, window, country="CL", thresholds=(0.0, -2.0))        -> events.WeatherEvents
    heat_events(farm, window, country="CL", thresholds=(32.0,))             -> events.WeatherEvents
    harvest_rain(farm, window, country="CL", threshold_mm=None)             -> events.WeatherEvents
        window = (start, end) dates (or ISO strings), inclusive. Prefer the nearest RAN station within
        12 km with data (hourly, local time); else CR2MET daily (estimated=True, "gridded daily, not
        hourly"); else ERA5 daily for frost/heat only (Chile harvest rain never uses Open-Meteo,
        ADR-0005 D5). `.summary` keys:
          frost:        min_c, min_at, hours_at_or_below{thr}, days_at_or_below{thr}
          heat:         max_c, max_at, hours_at_or_above{thr}, degree_hours_above{thr},
                        days_at_or_above{thr} (grid: degree_days_above{thr}, hours None)
          harvest_rain: max_72h_mm, max_72h_end, max_72h_incomplete, total_mm, days_ge_10mm
        (threshold keys are str(float(thr)), e.g. "-2.0"). `.to_dict()` gives JSON.

Registry (app.registry): 'precip', 'tmin', 'tmax', 'eto' ->
    CR2MET (enhanced tier, priority 10, source 'cr2met_nrt')  then  ERA5/Open-Meteo ('any', priority 90).

Data: CR2MET values live in DuckDB tables weather_* (see db.py), filled by the backfill CLI
(`python -m app.sources.weather.backfill all`). A farm in a cell that was never fetched gets
"unavailable" plus a background fetch of its 13-month window (set CLM_WEATHER_BACKGROUND=0 to disable).
"""

from __future__ import annotations

import logging
import os
import queue
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

from app import config, http, registry
from app import provenance as prov
from app.models import Farm, Provenance, Series
from app.registry import ProviderUnavailable
from app.sources.weather import baseline as bl
from app.sources.weather import cr2met, db, era5, events as ev, ran
from app.sources.weather.events import WeatherEvents


def santiago_to_utc_iso(ts) -> str | None:
    """RAN hours are naive America/Santiago local time; the contract wants ISO 8601 UTC with 'Z' (§0)."""
    from datetime import datetime as _dt, timezone as _tz
    from zoneinfo import ZoneInfo

    if ts is None or ts == "":
        return None
    if isinstance(ts, str):
        try:
            ts = _dt.fromisoformat(ts.strip().replace(" ", "T"))
        except ValueError:
            return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=ZoneInfo("America/Santiago"))
    return ts.astimezone(_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

log = logging.getLogger("clm.weather")

VARIABLES = ("precip", "tmin", "tmax", "eto")
NRT_REFRESH_MAX_DAYS = 12  # per (variable, month) inside a request; the CLI catches up beyond that

__all__ = ["get_series", "series", "frost_events", "heat_events", "harvest_rain", "chill_hours", "WeatherEvents"]


def _d(x: Any) -> date:
    if isinstance(x, datetime):
        return x.date()
    if isinstance(x, date):
        return x
    return date.fromisoformat(str(x)[:10])


def _today() -> date:
    return datetime.now(timezone.utc).date()


# ───────────────────────── background fill ─────────────────────────

_jobs: "queue.Queue[tuple[str, tuple]]" = queue.Queue()
_queued: set[str] = set()
_qlock = threading.Lock()
_worker: threading.Thread | None = None


def background_enabled() -> bool:
    """Background CR2MET fill for never-fetched cells. Off in offline mode, with CLM_WEATHER_BACKGROUND=0,
    and under pytest (other packages' tests must never trigger upstream calls or DB work from here)."""
    return (os.environ.get("CLM_WEATHER_BACKGROUND", "1").strip().lower() not in {"0", "false", "no"}
            and not config.offline() and "PYTEST_CURRENT_TEST" not in os.environ)


def _run_jobs() -> None:
    from app.sources.weather import backfill

    while True:
        key, (lng, lat) = _jobs.get()
        try:
            land = backfill.register_points({f"request:{key}": (lng, lat)}, radius=1)
            c = cr2met.cell_of(lng, lat)
            cells = [x for x in land if c and abs(x.iy - c.iy) <= 1 and abs(x.ix - c.ix) <= 1]
            if cells:
                start, end = backfill.window_range()
                cr2met.ensure_window(cells, start, end)
        except Exception as exc:
            log.warning("background CR2MET fill for %s failed: %r", key, exc)
        finally:
            with _qlock:
                _queued.discard(key)


def _queue_fill(cell_key: str, lng: float, lat: float) -> bool:
    global _worker
    if not background_enabled():
        return False
    with _qlock:
        if cell_key in _queued:
            return True
        _queued.add(cell_key)
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run_jobs, name="weather-fill", daemon=True)
            _worker.start()
    _jobs.put((cell_key, (lng, lat)))
    return True


# ───────────────────────── CR2MET provider ─────────────────────────


def resolve_cell(lng: float, lat: float) -> tuple[cr2met.Cell, str | None]:
    """The registered land cell for a point (ADR-0004 D6): its own cell, else the nearest land cell in
    its 3×3 neighbourhood. Raises ProviderUnavailable when the cell was never registered."""
    c = cr2met.cell_of(lng, lat)
    if c is None:
        raise ProviderUnavailable("outside the CR2MET grid (continental Chile only)")
    rec = db.cell(c.key)
    if rec and rec["land"]:
        return c, None
    if rec and rec["land"] is False:
        best = None
        for n in cr2met.neighbourhood(c, 1):
            r = db.cell(n.key)
            if r and r["land"]:
                dist = (n.lat - lat) ** 2 + (n.lng - lng) ** 2
                if best is None or dist < best[0]:
                    best = (dist, n)
        if best:
            return best[1], f"farm cell {c.key} is outside CR2MET's Chile mask; nearest land cell used"
        raise ProviderUnavailable(f"cell {c.key} is outside CR2MET's Chile mask")
    queued = _queue_fill(c.key, lng, lat)
    raise ProviderUnavailable(
        f"CR2MET not fetched yet for 0.05° cell {c.key}"
        + ("; background fetch of the 13-month window started (a few minutes)" if queued else "")
    )


_refresh_locks: dict[tuple, threading.Lock] = {}
_refresh_guard = threading.Lock()


def _refresh_nrt(variable: str, cell: cr2met.Cell, end: date) -> list[str]:
    """Best effort: bring the NRT months touching the last ~45 days up to date. Returns problems."""
    problems: list[str] = []
    today = _today()
    if end < today - timedelta(days=45) or config.offline():
        return problems
    for y, m in cr2met.months_between(max(end, today) - timedelta(days=40), today):
        if (y, m) < cr2met.NRT_FIRST_MONTH:
            continue
        k = (variable, y, m)
        with _refresh_guard:
            lock = _refresh_locks.setdefault(k, threading.Lock())
        if not lock.acquire(blocking=False):
            continue  # another request is refreshing this month; serve what is stored
        try:
            if cr2met.r1_complete(cell.key, variable, y, m):
                continue
            done = db.done_map("nrt", variable, y, m)
            peers = [cr2met.cell_from_key(k2) for k2 in done if k2 != cell.key]
            cells = [cell] + peers
            try:
                cr2met.refresh_nrt_month(variable, y, m, cells, max_days=NRT_REFRESH_MAX_DAYS)
            except (http.FetchError, cr2met.Cr2metError) as exc:
                problems.append(f"NRT {y}-{m:02d} refresh failed: {getattr(exc, 'reason', exc)}")
            except Exception as exc:
                problems.append(f"NRT {y}-{m:02d} refresh failed: {exc.__class__.__name__}")
        finally:
            lock.release()
    return problems


_bands_cache: dict[tuple, bl.Bands] = {}
_bands_lock = threading.Lock()


def cr2met_bands(cell_key: str, variable: str) -> bl.Bands:
    years = cr2met.baseline_years_done(cell_key, variable)
    k = (cell_key, variable, tuple(years))
    with _bands_lock:
        if k in _bands_cache:
            return _bands_cache[k]
    if not years:
        b = bl.Bands(variable, None, 0, [], "no CR2MET R1 baseline years fetched for this cell yet")
    else:
        rows = db.get_daily(cell_key, variable, date(1990, 12, 1), date(2020, 12, 31), version="r1")
        b = bl.compute_bands({d: v for d, v, _ in rows}, variable, years=[y for y in years])
    with _bands_lock:
        _bands_cache[k] = b
    return b


def cr2met_series(variable: str, lng: float, lat: float, start: date, end: date,
                  refresh: bool = True) -> tuple[Series, Provenance]:
    cell, cell_note = resolve_cell(lng, lat)
    problems = _refresh_nrt(variable, cell, end) if refresh else []
    rows = db.get_daily(cell.key, variable, start, end)
    vals: dict[date, float | None] = {}
    ver: dict[date, str] = {}
    # R1 wins over NRT for the same day (homogeneous with the R1 baseline); a null never hides a value
    for want in ("nrt", "r1"):
        for d, v, version in rows:
            if version == want and (v is not None or d not in vals):
                vals[d], ver[d] = v, version
    last = bl.latest_date(vals)
    if last is None:
        if not any(db.done_for_cell(cell.key, variable)):
            _queue_fill(cell.key, lng, lat)
        raise ProviderUnavailable(
            f"no CR2MET {variable} values for {start}..{end} in cell {cell.key}"
            + (f" ({'; '.join(problems)})" if problems else "")
        )
    bands = cr2met_bands(cell.key, variable)
    used = {ver[d] for d, v in vals.items() if v is not None}
    r1_days = [d for d, v in vals.items() if v is not None and ver[d] == "r1"]
    parts = ["CR2MET v2.5 " + (
        f"R1 (to {max(r1_days)}), NRT for the days R1 lacks" if used == {"r1", "nrt"} else ("NRT" if used == {"nrt"} else "R1"))]
    parts.append(f"0.05° cell {cell.key}" + (f" ({cell_note})" if cell_note else ""))
    band_desc = bands.describe() + (" of v2.5_R1, same day ±7 d" if bands.table is not None else "")
    if variable == "precip" and bands.table is not None:
        band_desc += "; bands are 30-day totals as a daily rate"
    parts.append(band_desc)
    if variable == "eto":
        parts.append("ETo (Hargreaves-Samani), not FAO-56")
    if last < end:
        parts.append(f"latest value {last} (CR2MET lag)")
    parts += problems
    done = [r for r in db.done_for_cell(cell.key, variable) if (r["year"], r["month"]) >= (start.year, start.month)
            and (r["year"], r["month"]) <= (end.year, end.month)]
    fetched = max((r["fetched_at"] for r in done if r["fetched_at"]), default=None)
    pv = prov.build(
        "cr2met_nrt" if "nrt" in used else "cr2met_r1",
        observed_at=last,
        fetched_at=fetched,
        stale=bool(problems),
        note="; ".join(parts),
        data_tier="enhanced",
    )
    return bl.build_series(variable, vals, bands, start, end, pv), pv


def _make_cr2met_provider(variable: str):
    def provider(farm: Farm, *, start: Any, end: Any, **_: Any):
        lng, lat = farm.centroid
        return cr2met_series(variable, lng, lat, _d(start), _d(end))

    provider.__name__ = f"cr2met_{variable}"
    return provider


def _make_era5_provider(variable: str):
    def provider(farm: Farm, *, start: Any, end: Any, data_tier: str = "standard", **_: Any):
        lng, lat = farm.centroid
        return era5.series(variable, lng, lat, _d(start), _d(end), data_tier=data_tier)

    provider.__name__ = f"era5_{variable}"
    return provider


_CR2MET_PROVIDERS = {v: _make_cr2met_provider(v) for v in VARIABLES}
_ERA5_PROVIDERS = {v: _make_era5_provider(v) for v in VARIABLES}


def register_providers() -> None:
    """Idempotent registry wiring (runs at import; tests may call it again after registry.clear())."""
    for v in VARIABLES:
        registry.register(v, "enhanced", _CR2MET_PROVIDERS[v], priority=10, source="cr2met_nrt")
        registry.register(v, "any", _ERA5_PROVIDERS[v], priority=90, source="open_meteo")


register_providers()


# ───────────────────────── public: series ─────────────────────────


def _resolve(variable: str, farm: Farm, start: date, end: date, country: str | None) -> registry.Resolution:
    tier = prov.data_tier_for(country)
    return registry.resolve(variable, farm, country=country, start=start, end=end, data_tier=tier)


def get_series(variable: str, farm: Farm, start: Any, end: Any, country: str = "CL") -> Series:
    """Daily series with p10/p50/p90 baseline (§E.6) for 'precip' | 'tmin' | 'tmax' | 'eto'.
    Unavailable -> Series(points=[]) with provenance.note (never raises for upstream failures)."""
    if variable not in VARIABLES:
        raise ValueError(f"svc-weather serves {VARIABLES}, not {variable!r}")
    s, e = _d(start), _d(end)
    r = _resolve(variable, farm, s, e, country)
    if r.ok and isinstance(r.value, Series):
        return r.value.model_copy(update={"provenance": r.provenance})
    return Series(variable=variable, unit=bl.UNITS[variable], points=[], provenance=r.provenance)


series = get_series


# ───────────────────────── public: events ─────────────────────────


def _station_events(kind: str, farm: Farm, start: date, end: date, build,
                    lead_days: int = 0) -> tuple[WeatherEvents | None, list[str]]:
    lng, lat = farm.centroid
    reasons: list[str] = []
    cands = ran.nearest_stations(lng, lat)
    if not cands:
        return None, [f"no RAN station within {ran.MAX_KM:.0f} km"]
    for st, dist in cands[:2]:
        got = ran.hours_for(st["id"], start - timedelta(days=lead_days), end)
        hours = got["hours"]
        in_win = [h for h in hours if start <= h.ts.date() <= end]
        if not in_win:
            why = "; ".join(got["errors"]) or (f"cache cold for {', '.join(got['cold_months'])}" if got["cold_months"] else "no hourly data in window")
            reasons.append(f"RAN {st['name']} ({dist:.1f} km): {why}")
            continue
        out = build(hours)
        results = got["results"]
        stale = any(r.stale for r in results)
        fetched = max((r.fetched_at for r in results), default=None)
        warnings = []
        if got["cold_months"]:
            what = "rain before the window start (72 h sums at the start may be low)" if lead_days else "part of the window"
            warnings.append(f"RAN months not cached and not fetched in-request ({what}): {', '.join(got['cold_months'])}")
        if got["errors"]:
            warnings.append("RAN errors: " + "; ".join(got["errors"]))
        incomplete = [d["date"] for d in out["days"] if not d.get("complete", True)]
        if incomplete:
            warnings.append(f"{len(incomplete)} day(s) with < {ev.COMPLETE_HOURS} valid hours (missing ≠ zero)")
        notes = [f"hourly station data, local time (America/Santiago); station {st['name']} (RAN id {st['id']}) {dist:.1f} km from the farm"]
        if stale:
            notes.append("served from cache: " + "; ".join(r.error or "" for r in results if r.stale))
        pv = prov.build(
            ran.SOURCE, observed_at=santiago_to_utc_iso(out["data_as_of"]), fetched_at=fetched, stale=stale,
            source_label=f"RAN station {st['name']} (agromet.cl), {dist:.1f} km",
            resolution="station, hourly", note="; ".join(notes), data_tier="enhanced",
        )
        station = {"id": st["id"], "name": st["name"], "distance_km": round(dist, 1), "lng": st["lng"], "lat": st["lat"]}
        return WeatherEvents(kind, farm.id, start, end, "station_hourly", station, [], out["summary"], out["days"],
                             out["events"], pv, out["data_as_of"], warnings + reasons), reasons
    return None, reasons


def _grid_events(kind: str, farm: Farm, start: date, end: date, variable: str, country: str | None, build,
                 reasons: list[str], allow_open_meteo: bool) -> WeatherEvents:
    r = _resolve(variable, farm, start - timedelta(days=3), end, country)
    tier = prov.data_tier_for(country)
    if r.ok and r.source == "open_meteo" and not allow_open_meteo:
        reasons = reasons + ["Open-Meteo/ERA5 is not used for Chilean harvest rain (ADR-0005 D5)"]
    elif r.ok:
        pts = {date.fromisoformat(p.date): p.value for p in r.value.points}
        out = build(pts)
        pv = r.provenance
        note = "; ".join(x for x in [pv.note, "gridded daily, not hourly"] + reasons if x)
        pv = pv.model_copy(update={"estimated": True, "note": note})
        return WeatherEvents(kind, farm.id, start, end, "grid_daily", None, [], out["summary"], out["days"],
                             out["events"], pv, out["data_as_of"], list(reasons))
    else:
        reasons = reasons + r.reasons
    pv = prov.unavailable("unavailable", "; ".join(reasons) or "no source", data_tier=tier)
    return WeatherEvents(kind, farm.id, start, end, "unavailable", None, [], {}, [], [], pv, None, list(reasons))


def _window(window: Any) -> tuple[date, date]:
    s, e = window
    return _d(s), _d(e)


def frost_events(farm: Farm, window: Any, country: str = "CL", thresholds: Iterable[float] = (0.0, -2.0)) -> WeatherEvents:
    """Frost hours/nights in the window (inclusive). See module docstring."""
    start, end = _window(window)
    thr = [float(t) for t in thresholds]
    reasons: list[str] = []
    if (country or "").upper() == "CL":
        res, reasons = _station_events("frost", farm, start, end, lambda hs: ev.frost_hourly(hs, start, end, thr))
        if res:
            res.thresholds = thr
            return res
    out = _grid_events("frost", farm, start, end, "tmin", country, lambda v: ev.frost_daily(v, start, end, thr),
                       reasons, allow_open_meteo=True)
    out.thresholds = thr
    return out


def heat_events(farm: Farm, window: Any, country: str = "CL", thresholds: Iterable[float] = (32.0,)) -> WeatherEvents:
    """Hot hours / degree-hours in the window (inclusive). See module docstring."""
    start, end = _window(window)
    thr = [float(t) for t in thresholds]
    reasons: list[str] = []
    if (country or "").upper() == "CL":
        res, reasons = _station_events("heat", farm, start, end, lambda hs: ev.heat_hourly(hs, start, end, thr))
        if res:
            res.thresholds = thr
            return res
    out = _grid_events("heat", farm, start, end, "tmax", country, lambda v: ev.heat_daily(v, start, end, thr),
                       reasons, allow_open_meteo=True)
    out.thresholds = thr
    return out


def harvest_rain(farm: Farm, window: Any, country: str = "CL", threshold_mm: float | None = None) -> WeatherEvents:
    """72 h rain sums for windows ending in the window (inclusive). See module docstring."""
    start, end = _window(window)
    reasons: list[str] = []
    cl = (country or "").upper() == "CL"
    if cl:
        res, reasons = _station_events("harvest_rain", farm, start, end,
                                       lambda hs: ev.rain_hourly(hs, start, end, threshold_mm), lead_days=3)
        if res:
            res.thresholds = [float(threshold_mm)] if threshold_mm is not None else []
            return res
    out = _grid_events("harvest_rain", farm, start, end, "precip", country,
                       lambda v: ev.rain_daily(v, start, end, threshold_mm), reasons, allow_open_meteo=not cl)
    out.thresholds = [float(threshold_mm)] if threshold_mm is not None else []
    return out


# ───────────────────────── public: chill ─────────────────────────

CHILL_BASE_C = 7.2


def chill_hours(farm: Farm, start: Any, end: Any, country: str = "CL") -> tuple[float, Provenance] | None:
    """Hours with hourly mean air temperature < 7.2 °C in [start, end] (CONTRACT §E.5 chill input), from the
    nearest RAN station within 12 km. Uses cached station-months only (the chill window is long past by
    harvest; `backfill ran-warm` fills it) and never fetches inside a request. Returns None when no station
    data covers at least half of the window, so svc-risk estimates from daily data instead."""
    if (country or "").upper() != "CL":
        return None
    s, e = _d(start), _d(end)
    if e < s:
        return None
    lng, lat = farm.centroid
    expected = 24 * ((e - s).days + 1)
    for st, dist in ran.nearest_stations(lng, lat)[:2]:
        got = ran.hours_for(st["id"], s, e, max_cold_fetches=0)
        hs = [h for h in got["hours"] if s <= h.ts.date() <= e and h.tavg is not None]
        if len(hs) < 0.5 * expected:
            continue
        n = sum(1 for h in hs if h.tavg < CHILL_BASE_C)
        cover = len(hs) / expected
        notes = [f"hours with hourly mean < {CHILL_BASE_C} °C, {s}..{e}; station {st['name']} (RAN id {st['id']}) "
                 f"{dist:.1f} km; {len(hs)} of {expected} hours observed"]
        if cover < 0.95:
            notes.append("missing hours not counted: a lower bound")
        if got["cold_months"]:
            notes.append(f"months not cached: {', '.join(got['cold_months'])}")
        results = got["results"]
        pv = prov.build(
            ran.SOURCE, observed_at=santiago_to_utc_iso(max(h.ts for h in hs)),  # CONTRACT §0: UTC with Z
            fetched_at=max((r.fetched_at for r in results), default=None),
            stale=any(r.stale for r in results), estimated=cover < 0.95,
            source_label=f"RAN station {st['name']} (agromet.cl), {dist:.1f} km", resolution="station, hourly",
            note="; ".join(notes), data_tier="enhanced",
        )
        return float(n), pv
    return None
