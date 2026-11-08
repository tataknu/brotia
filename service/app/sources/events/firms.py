"""NASA FIRMS VIIRS active-fire detections, keyless 7-day South America CSVs (ADR-0009 D1 "active fire now").

NOAA-20 (J1) and NOAA-21 (J2) VIIRS 375 m, ~4 h latency, last 7 days only (no key → no history).
Detections are grouped into ~5 km grid cells (0.05°) over the 7 days; each cell is one
`own_signal` ClimateEvent ("fire detected nearby", CONTRACT §E.5 counts it for the 0.6 zone rule).
Points mix wildfires with agricultural and stubble burning; low-confidence detections are dropped.
Either satellite file failing never drops the other.
"""

from __future__ import annotations

import csv
import io
import logging
import threading
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from shapely.geometry import MultiPoint

from app import http, provenance as prov
from app.models import ClimateEvent
from app.sources.events import geo

log = logging.getLogger("clm.events.firms")

SOURCE = "firms"
LABEL = "NASA FIRMS (VIIRS NOAA-20/21)"
URLS = {
    "N20": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_7d.csv",
    "N21": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_South_America_7d.csv",
}
CELL_DEG = 0.05
MAX_POINTS = 100
TTL = 3 * 3600.0

http.register_source(SOURCE, max_concurrency=2, min_interval_s=1.0, timeout_s=120, retries=1)


@dataclass(frozen=True)
class Detection:
    lat: float
    lon: float
    acq_date: str
    acq_time: str
    frp: float
    confidence: str
    satellite: str


_lock = threading.Lock()
_memo: dict[str, list[Detection]] = {}


def parse_csv(text: str) -> list[Detection]:
    out: list[Detection] = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            conf = (row.get("confidence") or "").strip().lower()
            if conf in ("l", "low"):
                continue
            out.append(Detection(float(row["latitude"]), float(row["longitude"]), row["acq_date"][:10],
                                 (row.get("acq_time") or "").zfill(4), float(row.get("frp") or 0), conf,
                                 row.get("satellite") or ""))
        except (KeyError, ValueError):
            continue
    return out


def _valid(text: Any) -> bool:
    return isinstance(text, str) and text.startswith("latitude,longitude")


def detections() -> tuple[list[Detection], list[http.FetchResult], list[str]]:
    dets: list[Detection] = []
    results: list[http.FetchResult] = []
    notes: list[str] = []
    for sat, url in URLS.items():
        try:
            r = http.get_text(SOURCE, url, ttl=TTL, validate=_valid)
        except http.FetchError as exc:
            notes.append(f"{sat} 7-day file unavailable ({exc.reason})")
            continue
        key = f"{url}|{r.fetched_at_iso}"
        with _lock:
            parsed = _memo.get(key)
        if parsed is None:
            parsed = parse_csv(r.body)
            with _lock:
                for k in [k for k in _memo if k.startswith(url)]:
                    _memo.pop(k, None)
                _memo[key] = parsed
        dets.extend(parsed)
        results.append(r)
    return dets, results, notes


def severity(n: int) -> str:
    return "extreme" if n >= 50 else "severe" if n >= 10 else "moderate"


def events(bbox: tuple[float, float, float, float], since: date, until: date, data_tier: str = "enhanced") -> list[ClimateEvent]:
    """Clustered detections inside bbox with acq_date in [since, until]. Raises http.FetchError when
    both files fail and nothing is cached."""
    dets, results, notes = detections()
    if not results:
        raise http.FetchError(SOURCE, URLS["N20"], "; ".join(notes) or "no FIRMS file available")
    minx, miny, maxx, maxy = bbox
    s0, s1 = since.isoformat(), until.isoformat()
    cells: dict[tuple[int, int], list[Detection]] = {}
    for d in dets:
        if not (minx <= d.lon <= maxx and miny <= d.lat <= maxy and s0 <= d.acq_date <= s1):
            continue
        cells.setdefault((int(d.lat // CELL_DEG), int(d.lon // CELL_DEG)), []).append(d)
    stale = any(r.stale for r in results)
    fetched = min(r.fetched_at for r in results)
    out: list[ClimateEvent] = []
    for (gy, gx), pts in cells.items():
        pts.sort(key=lambda d: (d.acq_date, d.acq_time))
        start, end = pts[0].acq_date, pts[-1].acq_date
        mp = MultiPoint([(d.lon, d.lat) for d in pts[:MAX_POINTS]])
        c = mp.centroid
        near = geo.commune_name(c.x, c.y)
        sats = sorted({d.satellite for d in pts})
        n = len(pts)
        max_frp = max((d.frp for d in pts), default=0.0)
        frp_txt = f", max FRP {max_frp:.1f} MW" if max_frp > 0 else ""
        note = ("VIIRS 375 m active-fire detections (NRT, last 7 days), grouped into ~5 km cells; may be agricultural "
                "or stubble burning; not a burned-area footprint; low-confidence detections dropped")
        if notes:
            note += "; " + "; ".join(notes)
        p = prov.build(SOURCE, observed_at=end, fetched_at=fetched, stale=stale, note=note, resolution="375 m",
                       data_tier=data_tier)  # type: ignore[arg-type]
        out.append(ClimateEvent(
            id=f"firms:{gy}_{gx}_{start}", kind="fire",
            title=(f"Active fire detected near {near} ({n} VIIRS detection{'s' if n != 1 else ''}{frp_txt})" if near
                   else f"Active fire detected ({n} VIIRS detection{'s' if n != 1 else ''}{frp_txt})"),
            region=geo.region_label(c.x, c.y), start=start, end=end, severity=severity(n),  # type: ignore[arg-type]
            source=LABEL + (f" [{', '.join(sats)}]" if sats else ""), evidence_kind="own_signal",
            geometry={"type": "MultiPoint", "coordinates": [[round(d.lon, 5), round(d.lat, 5)] for d in pts[:MAX_POINTS]]},
            affected_farm_ids=[], affected_exposure=0, provenance=p,
        ))
    return out


def covers(since: date, until: date, today: date) -> bool:
    """The 7-day files only overlap windows that reach into the last 8 days."""
    return until >= today - timedelta(days=8) and since <= today


def reset_memo() -> None:
    with _lock:
        _memo.clear()
