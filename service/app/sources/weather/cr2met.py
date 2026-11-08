"""CR2MET v2.5 (CR2, Universidad de Chile) daily pr / tmin / tmax / et0 at 0.05° (ADR-0004 D2, ADR-0005 D3).

Access (verified live 2026-11-07): keyless monthly NetCDF-3 files on ftp.cr2.cl, HTTP Range supported but
only ONE range per request (multi-range answers 404). A pixel's month is 30–31 values 352 kB apart, so we
read, per (file, day), one small contiguous byte span that covers every cell we keep (one "band"),
decode the cells from it, and store the decoded values in `weather_cr2met_daily`. Raw band bodies are
dropped from http_cache right after decoding (they are re-derivable and would bloat the DB).

Versions (homogeneity rule, families/chile-national-met):
- baseline: v2.5_R1 only, 1991–2020 (never v2.5_best, never the obs-adjusted v2.5 final);
- the 13-month window: R1 where it exists (to P−3 months, currently 2026-07), NRT after (lag ~10 d pr,
  ~6 d txn). NRT files are rewritten daily; their `.json` sidecar mtime keys the cache.
- File layouts differ (dimension order, `days since` origin, 2-D single-day files, missing days such as
  2026-10-31 in NRT txn), so every file's header and `time` variable are read; nothing is assumed.
- `cl_mask` is applied: cells outside continental Chile are never used; a farm whose cell is masked uses
  the nearest land cell in its 3×3 neighbourhood (ADR-0004 D6).
- ETo is CR2MET `et0hsm` = modified Hargreaves-Samani, labelled as such (not FAO-56).
"""

from __future__ import annotations

import logging
import math
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

import httpx
import numpy as np

from app import config, http, store
from app.sources.weather import db
from app.sources.weather.netcdf3 import HeaderTruncated, Header, parse_header

log = logging.getLogger("clm.weather.cr2met")

BASE = "https://ftp.cr2.cl/download/cr2met"
SOURCES = {"r1": "cr2met_r1", "nrt": "cr2met_nrt"}
VERSION_DIR = {"r1": "v2.5_R1", "nrt": "v2.5_NRT"}
#: variable -> (directory, filename stem, NetCDF variable)
VARS: dict[str, tuple[str, str, str]] = {
    "precip": ("pr", "pr", "pr"),
    "tmin": ("txn", "tmin_tmax", "tmin"),
    "tmax": ("txn", "tmin_tmax", "tmax"),
    "eto": ("et0", "et0hsm", "et0"),
}
VARIABLES = list(VARS)
NRT_FIRST_MONTH = (2022, 11)

LAT0, LON0, STEP, NLAT, NLON = -56.975, -76.975, 0.05, 800, 220
HEADER_BYTES = 16384

for _src in SOURCES.values():
    http.register_source(_src, max_concurrency=2, min_interval_s=0.0, timeout_s=60, retries=2)


class Cr2metError(Exception):
    pass


# ───────────────────────── grid ─────────────────────────


@dataclass(frozen=True)
class Cell:
    iy: int
    ix: int

    @property
    def lat(self) -> float:
        return round(LAT0 + self.iy * STEP, 3)

    @property
    def lng(self) -> float:
        return round(LON0 + self.ix * STEP, 3)

    @property
    def key(self) -> str:
        return f"{self.lng:.3f},{self.lat:.3f}"


def cell_of(lng: float, lat: float) -> Cell | None:
    iy = int(round((lat - LAT0) / STEP))
    ix = int(round((lng - LON0) / STEP))
    if 0 <= iy < NLAT and 0 <= ix < NLON:
        return Cell(iy, ix)
    return None


def neighbourhood(c: Cell, radius: int = 1) -> list[Cell]:
    out = []
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            iy, ix = c.iy + dy, c.ix + dx
            if 0 <= iy < NLAT and 0 <= ix < NLON:
                out.append(Cell(iy, ix))
    return out


def cell_from_key(key: str) -> Cell:
    lng, lat = (float(x) for x in key.split(","))
    c = cell_of(lng, lat)
    if c is None:
        raise ValueError(key)
    return c


# ───────────────────────── files ─────────────────────────


def file_url(version: str, variable: str, year: int, month: int) -> str:
    d, stem, _ = VARS[variable]
    vd = VERSION_DIR[version]
    return f"{BASE}/{vd}/{d}/{vd}_day/CR2MET_{stem}_{vd}_day_{year:04d}_{month:02d}_005deg.nc"


def read_range(source: str, url: str, a: int, b: int, tag: str | None, persist: bool, exact: bool = True) -> bytes:
    """One HTTP Range read. exact=False accepts a shorter body (a header read past a small file's end)."""
    kx = {"range": f"{a}-{b}", "file": tag}
    n = b - a + 1
    if not persist:
        return _read_range_transient(source, url, a, b)
    r = http.fetch(
        "GET", source, url, headers={"Range": f"bytes={a}-{b}"}, ttl=http.TTL_FOREVER, parse="bytes",
        key_extra=kx, validate=(lambda body: len(body) == n) if exact else (lambda body: 0 < len(body) <= n),
        timeout=60,
    )
    return r.body


def _read_range_transient(source: str, url: str, a: int, b: int) -> bytes:
    """A band read whose raw body is not cached: the decoded values are the durable cache
    (weather_cr2met_daily), so writing ~90 kB to http_cache and deleting it again is pure overhead.
    Etiquette is unchanged: app.http's shared client (honest User-Agent), the per-source semaphore (2),
    pacing, timeouts and retries on 429/5xx (http._do_request). Offline mode is honoured."""
    if config.offline():
        raise http.FetchError(source, url, "offline mode (CLM_OFFLINE=1): upstream not called")
    cfg = http._source_cfg(source)  # noqa: SLF001 — see needs_from_others: http.fetch(persist=False)
    try:
        resp = http._do_request(cfg, "GET", url, None, None, None, {"Range": f"bytes={a}-{b}"}, 60)  # noqa: SLF001
    except httpx.TimeoutException as exc:
        raise http.FetchError(source, url, f"timeout ({exc.__class__.__name__})") from exc
    except httpx.TransportError as exc:
        raise http.FetchError(source, url, f"network error ({exc.__class__.__name__})") from exc
    if resp.status_code != 206 or len(resp.content) != b - a + 1:
        raise http.FetchError(source, url, f"HTTP {resp.status_code} ({len(resp.content)} bytes for range {a}-{b})",
                              resp.status_code)
    return resp.content


def sidecar(version: str, variable: str, year: int, month: int) -> dict | None:
    """The file's .json sidecar (None when the month file does not exist)."""
    url = file_url(version, variable, year, month).replace(".nc", ".json")
    ttl = http.TTL_FOREVER if version == "r1" and _month_is_old(year, month) else http.TTL_HOUR
    try:
        r = http.get_json(SOURCES[version], url, ttl=ttl, timeout=30)
    except http.FetchError as exc:
        if exc.status == 404:
            return None
        raise
    return r.body if isinstance(r.body, dict) else None


def _month_is_old(year: int, month: int) -> bool:
    today = datetime.now(timezone.utc).date()
    return (today.year - year) * 12 + (today.month - month) > 6


_TIME_UNITS = re.compile(r"(days|hours)\s+since\s+(\d{4})-(\d{1,2})-(\d{1,2})")


@dataclass
class FileMeta:
    version: str
    variable: str
    year: int
    month: int
    url: str
    mtime: str | None
    header: Header
    times: list[date]
    lat: np.ndarray
    lon: np.ndarray


def _coord(header: Header, body: bytes, name: str, source: str, url: str, tag: str | None) -> np.ndarray:
    v = header.vars[name]
    n = int(np.prod(v.shape)) if v.shape else 1
    a, b = v.begin, v.begin + n * v.itemsize - 1
    raw = body[a:b + 1] if b < len(body) else read_range(source, url, a, b, tag, persist=True)
    dt = {1: ">i1", 3: ">i2", 4: ">i4", 5: ">f4", 6: ">f8"}[v.nc_type]
    return np.frombuffer(raw, dtype=dt).astype(float)


_meta_cache: dict[tuple, FileMeta] = {}
_meta_lock = threading.Lock()


def file_meta(version: str, variable: str, year: int, month: int) -> FileMeta | None:
    """Header + coordinates of one monthly file, or None when the file does not exist."""
    sc = sidecar(version, variable, year, month)
    if sc is None:
        return None
    mtime = sc.get("nc_file_mtime_utc")
    ck = (version, VARS[variable][1], year, month, mtime)
    with _meta_lock:
        if ck in _meta_cache:
            m = _meta_cache[ck]
            return FileMeta(version, variable, year, month, m.url, mtime, m.header, m.times, m.lat, m.lon)
    source, url = SOURCES[version], file_url(version, variable, year, month)
    size = HEADER_BYTES
    while True:
        body = read_range(source, url, 0, size - 1, mtime, persist=True, exact=False)
        try:
            h = parse_header(body)
            break
        except HeaderTruncated:
            if size >= 1 << 20:
                raise
            size *= 4
    tv = _coord(h, body, "time", source, url, mtime)
    units = h.vars["time"].attrs.get("units", "")
    m = _TIME_UNITS.search(units if isinstance(units, str) else "")
    if not m:
        raise Cr2metError(f"unknown time units {units!r} in {url}")
    origin = date(int(m[2]), int(m[3]), int(m[4]))
    scale = 1.0 if m[1] == "days" else 1 / 24.0
    times = [origin + timedelta(days=int(math.floor(t * scale + 1e-6))) for t in np.atleast_1d(tv)]
    meta = FileMeta(version, variable, year, month, url, mtime, h, times,
                    _coord(h, body, "lat", source, url, mtime), _coord(h, body, "lon", source, url, mtime))
    with _meta_lock:
        _meta_cache[ck] = meta
    return meta


def _file_index(meta: FileMeta, c: Cell) -> tuple[int, int]:
    iy = int(np.argmin(np.abs(meta.lat - c.lat)))
    ix = int(np.argmin(np.abs(meta.lon - c.lng)))
    if abs(meta.lat[iy] - c.lat) > 0.01 or abs(meta.lon[ix] - c.lng) > 0.01:
        raise Cr2metError(f"cell {c.key} not on the grid of {meta.url}")
    return iy, ix


def _element_index(dims: list[str], t: int, iy: int, ix: int) -> tuple[int, ...]:
    out = []
    for d in dims:
        if d == "time":
            out.append(t)
        elif d == "lat":
            out.append(iy)
        elif d == "lon":
            out.append(ix)
        else:
            out.append(0)
    if "time" not in dims and t != 0:
        raise Cr2metError("2-D file has a single time step")
    return tuple(out)


def read_band(meta: FileMeta, ncvar: str, t: int, cells: list[Cell], persist: bool = False) -> dict[str, float | None]:
    """Decode one day (time index t) of `ncvar` for every cell, with one range request."""
    v = meta.header.vars[ncvar]
    offs = {}
    for c in cells:
        iy, ix = _file_index(meta, c)
        offs[c.key] = v.offset(_element_index(v.dims, t, iy, ix))
    a, b = min(offs.values()), max(offs.values()) + v.itemsize - 1
    body = read_range(SOURCES[meta.version], meta.url, a, b, meta.mtime, persist=persist)
    return {k: v.decode(body[o - a:o - a + v.itemsize]) for k, o in offs.items()}


def land_mask(cells: list[Cell]) -> dict[str, bool]:
    """cl_mask for each cell (True = continental Chile), from one R1 file (static field)."""
    meta = file_meta("r1", "precip", 2000, 1)
    if meta is None:
        raise Cr2metError("reference R1 file for cl_mask not found")
    vals = read_band(meta, "cl_mask", 0, cells)
    return {k: (v is not None and v > 0) for k, v in vals.items()}


def _clean(variable: str, v: float | None) -> float | None:
    if v is None or not math.isfinite(v):
        return None
    if variable == "precip":
        return round(max(0.0, v), 2)  # packing noise can give -0.00x mm; rain is never negative
    if variable == "eto":
        return round(max(0.0, v), 3)
    return round(v, 2)


# ───────────────────────── month fetch ─────────────────────────


def fetch_month(version: str, variable: str, year: int, month: int, cells: list[Cell], *,
                after: date | None = None, max_days: int | None = None, workers: int = 2,
                persist: bool = False) -> dict:
    """Read one monthly file for `cells` and store the decoded values. Days on or before `after` are skipped
    (incremental NRT refresh). Returns {status, n_days, last_date, mtime, read}. status 'missing' when the
    file does not exist, 'capped' when max_days stopped it early (progress recorded with mtime None, so
    the next refresh continues after the last day read)."""
    meta = file_meta(version, variable, year, month)
    if meta is None:
        return {"status": "missing", "n_days": 0, "last_date": None, "mtime": None, "read": 0}
    ncvar = VARS[variable][2]
    todo = [(t, d) for t, d in enumerate(meta.times) if after is None or d > after]
    capped = max_days is not None and len(todo) > max_days
    if capped:
        todo = todo[:max_days]
    rows: list[tuple[str, date, float | None]] = []
    if todo:
        with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
            results = list(ex.map(lambda td: (td[1], read_band(meta, ncvar, td[0], cells, persist)), todo))
        for d, vals in results:
            for k, v in vals.items():
                rows.append((k, d, _clean(variable, v)))
        db.put_daily(version, variable, rows)
    last = max(meta.times) if meta.times else None
    if capped:
        # record progress without the file mtime, so the next refresh continues after the last day read
        db.mark_done(version, variable, [c.key for c in cells], year, month, None, len(meta.times), todo[-1][1])
    else:
        db.mark_done(version, variable, [c.key for c in cells], year, month, meta.mtime, len(meta.times), last)
    return {"status": "capped" if capped else "ok", "n_days": len(meta.times), "last_date": last,
            "mtime": meta.mtime, "read": len(todo)}


def months_between(start: date, end: date) -> list[tuple[int, int]]:
    out, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def window_version(year: int, month: int) -> list[str]:
    """Versions to try for a month of the current window, in order."""
    if (year, month) < NRT_FIRST_MONTH:
        return ["r1"]
    return ["r1", "nrt"]


def ensure_window(cells: list[Cell], start: date, end: date, variables: Iterable[str] = VARIABLES,
                  log_fn=None) -> dict:
    """Fetch every month of [start, end] for `cells` that is not done yet: R1 when the month exists in R1,
    else NRT (NRT months are re-read incrementally when their sidecar mtime changes)."""
    keys = [c.key for c in cells]
    stats = {"months": 0, "reads": 0}
    for variable in variables:
        for y, m in months_between(start, end):
            r1_done = db.done_map("r1", variable, y, m)
            missing_file = False
            todo = [c for c in cells if c.key not in r1_done]
            if todo:
                try:
                    res = fetch_month("r1", variable, y, m, todo)
                except Exception as exc:  # one bad month must not stop an unattended pass
                    stats.setdefault("errors", []).append(f"r1 {variable} {y}-{m:02d}: {exc}")
                    if log_fn:
                        log_fn(f"r1 {variable} {y}-{m:02d}: FAILED {exc} (retried on the next run)")
                    continue
                missing_file = res["status"] == "missing"
                if not missing_file:
                    stats["months"] += 1
                    stats["reads"] += res["read"]
                    if log_fn:
                        log_fn(f"r1 {variable} {y}-{m:02d}: {res['read']} days")
                r1_done = db.done_map("r1", variable, y, m)
            if (y, m) < NRT_FIRST_MONTH:
                continue
            # R1 file missing, or shorter than the month (e.g. R1 txn 2026-05 holds 1 day): fill from NRT;
            # the reader prefers R1 day by day, so NRT only covers the days R1 lacks.
            short = [c for c in cells if c.key in r1_done and (r1_done[c.key]["n_days"] or 0) < days_in_month(y, m)]
            need = cells if missing_file else short
            if need:
                try:
                    stats["reads"] += refresh_nrt_month(variable, y, m, need, log_fn=log_fn)
                    stats["months"] += 1
                except Exception as exc:
                    stats.setdefault("errors", []).append(f"nrt {variable} {y}-{m:02d}: {exc}")
                    if log_fn:
                        log_fn(f"nrt {variable} {y}-{m:02d}: FAILED {exc} (retried on the next run)")
    return stats


def days_in_month(y: int, m: int) -> int:
    import calendar

    return calendar.monthrange(y, m)[1]


def r1_complete(cell_key: str, variable: str, y: int, m: int) -> bool:
    r = db.done_map("r1", variable, y, m).get(cell_key)
    return bool(r and (r["n_days"] or 0) >= days_in_month(y, m))


def refresh_nrt_month(variable: str, y: int, m: int, cells: list[Cell], max_days: int | None = None,
                      log_fn=None) -> int:
    """Bring NRT (variable, month) up to date for `cells`: cells with no data read the whole month; cells
    already read from an older file version read only the new days. Returns range reads made."""
    sc = sidecar("nrt", variable, y, m)
    if sc is None:
        return 0
    mtime = sc.get("nc_file_mtime_utc")
    done = db.done_map("nrt", variable, y, m)
    fresh = [c for c in cells if c.key not in done]
    stale = [c for c in cells if c.key in done and done[c.key]["mtime"] != mtime]
    reads = 0
    if fresh:
        res = fetch_month("nrt", variable, y, m, fresh, max_days=max_days)
        reads += res["read"]
        if log_fn:
            log_fn(f"nrt {variable} {y}-{m:02d}: {res['read']} days (new cells)")
    if stale:
        after = min((done[c.key]["last_date"] for c in stale if done[c.key]["last_date"]), default=None)
        res = fetch_month("nrt", variable, y, m, stale, after=after, max_days=max_days)
        reads += res["read"]
        if log_fn:
            log_fn(f"nrt {variable} {y}-{m:02d}: {res['read']} new days")
    return reads


def ensure_baseline_year(cells: list[Cell], year: int, variables: Iterable[str] = VARIABLES, log_fn=None) -> int:
    reads = 0
    keys = [c.key for c in cells]
    for variable in variables:
        # precip bands use 30-day running totals: January needs the December before
        months = ([(year - 1, 12)] if variable == "precip" else []) + [(year, m) for m in range(1, 13)]
        for yy, m in months:
            done = db.done_map("r1", variable, yy, m)
            todo = [c for c in cells if c.key not in done]
            if not todo:
                continue
            try:
                res = fetch_month("r1", variable, yy, m, todo)
            except Exception as exc:  # keep going; the month stays "not done" and is retried next run
                if log_fn:
                    log_fn(f"baseline {yy}-{m:02d} {variable}: FAILED {exc}")
                continue
            reads += res["read"]
        if log_fn:
            log_fn(f"baseline {year} {variable}: done ({len(keys)} cells)")
    return reads


def baseline_years_done(cell_key: str, variable: str) -> list[int]:
    rows = db.run(
        "SELECT year, count(*) FROM weather_cr2met_done WHERE version='r1' AND variable=? AND cell=? "
        "AND year BETWEEN 1991 AND 2020 GROUP BY year HAVING count(*) = 12 ORDER BY year",
        [variable, cell_key],
    )
    return [r[0] for r in rows]


def spread_years(first: int = 1991, last: int = 2020) -> list[int]:
    """Years ordered so that any prefix is spread across the period (bisection order)."""
    years = list(range(first, last + 1))
    out: list[int] = []
    segs = [(0, len(years) - 1)]
    out += [years[0], years[-1]]
    while segs:
        nxt = []
        for a, b in segs:
            if b - a < 2:
                continue
            mid = (a + b) // 2
            out.append(years[mid])
            nxt += [(a, mid), (mid, b)]
        segs = nxt
    for y in years:
        if y not in out:
            out.append(y)
    return out
