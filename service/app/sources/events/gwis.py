"""GWIS/EFFIS near-real-time burned-area polygons, WFS layer `ms:nrt.ba.poly` (ADR-0009 D1).

Keyless, CC BY 4.0, 2012 → ~1 day latency, smallest polygon ~100 ha. It is *burned area*, not
"wildfire": it includes agricultural burning (autumn stubble peak in April–May). Newest polygons
(finaldate within ~3 weeks) may still grow: labelled provisional.

Axis-order trap (ADR-0009): with WFS 1.1.0 + EPSG:4326 the `<Envelope>` inside the OGC FILTER is
**lat,lon**; the output GeoJSON is lon,lat. (The KVP `bbox=` parameter would be lon,lat; we do not use it.)
The BBOX filter tests the polygon *envelope*; exact intersection is done locally with shapely.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from shapely.geometry.base import BaseGeometry

from app import http, provenance as prov
from app.models import ClimateEvent, Provenance
from app.sources.events import geo

log = logging.getLogger("clm.events.gwis")

SOURCE = "gwis_ba"
URL = "https://maps.effis.emergency.copernicus.eu/gwis"
LABEL = "GWIS (Copernicus)"
HISTORY_START = date(2012, 1, 1)
PROVISIONAL_DAYS = 21
#: Zone/farm-sized queries ask for the whole history 2012 → open end (one stable cache key per area).
SMALL_BBOX_DEG = 0.5
OPEN_END = date(2100, 1, 1)

http.register_source(SOURCE, max_concurrency=2, min_interval_s=0.5, timeout_s=90, retries=1)


def _filter(bbox: tuple[float, float, float, float], d0: date, d1: date) -> str:
    minx, miny, maxx, maxy = bbox
    return (
        "<Filter><And>"
        f"<PropertyIsGreaterThanOrEqualTo><PropertyName>initialdate</PropertyName><Literal>{d0.isoformat()}</Literal></PropertyIsGreaterThanOrEqualTo>"
        f"<PropertyIsLessThanOrEqualTo><PropertyName>initialdate</PropertyName><Literal>{d1.isoformat()} 23:59:59</Literal></PropertyIsLessThanOrEqualTo>"
        # lat,lon axis order inside the filter envelope (ADR-0009)
        f"<BBOX><PropertyName>msGeometry</PropertyName><Envelope srsName='EPSG:4326'><lowerCorner>{miny:.5f} {minx:.5f}</lowerCorner>"
        f"<upperCorner>{maxy:.5f} {maxx:.5f}</upperCorner></Envelope></BBOX>"
        "</And></Filter>"
    )


def params(bbox: tuple[float, float, float, float], d0: date, d1: date) -> dict[str, str]:
    return {"service": "WFS", "version": "1.1.0", "request": "GetFeature", "typename": "ms:nrt.ba.poly",
            "outputformat": "geojson", "FILTER": _filter(bbox, d0, d1), "srsName": "EPSG:4326"}


def _valid(j: Any) -> bool:
    return isinstance(j, dict) and isinstance(j.get("features"), list)


def fetch(bbox: tuple[float, float, float, float], d0: date, d1: date, today: date | None = None) -> tuple[list[dict], http.FetchResult]:
    """Raw GWIS features whose envelope intersects bbox with initialdate in [d0, d1]. Raises http.FetchError."""
    from app import config

    today = today or config.utcnow().date()
    # Stable server-side bounds so the cache key does not change with the as-of date: stale-on-error and
    # CLM_OFFLINE can then serve yesterday's copy (ADR-0012). The local filter below is the truth.
    small = (bbox[2] - bbox[0]) <= SMALL_BBOX_DEG and (bbox[3] - bbox[1]) <= SMALL_BBOX_DEG
    q0 = HISTORY_START if small else max(HISTORY_START, d0.replace(day=1))
    ttl = http.TTL_WEEK if d1 < today - timedelta(days=60) else http.TTL_6H
    r = http.get_json(SOURCE, URL, params=params(bbox, q0, OPEN_END), ttl=ttl, allow_empty=True, validate=_valid)
    s0, s1 = d0.isoformat(), d1.isoformat()
    feats = [f for f in (r.body.get("features") or [])
             if s0 <= str((f.get("properties") or {}).get("initialdate") or "")[:10] <= s1]
    return feats, r


def feature_shape(f: dict) -> BaseGeometry | None:
    return geo.to_shape(f.get("geometry"))


def _d(s: Any) -> date | None:
    try:
        return date.fromisoformat(str(s)[:10])
    except Exception:
        return None


def severity(area_ha: float) -> str:
    """Expert thresholds (documented in the provenance note): < 500 ha moderate, < 5,000 ha severe, else extreme."""
    if area_ha >= 5000:
        return "extreme"
    if area_ha >= 500:
        return "severe"
    return "moderate"


def to_event(f: dict, r: http.FetchResult, today: date, data_tier: str = "enhanced") -> ClimateEvent | None:
    g = feature_shape(f)
    if g is None or g.is_empty:
        return None
    pr = f.get("properties") or {}
    fid = str(pr.get("id") or pr.get("fire_id") or "")
    start = _d(pr.get("initialdate"))
    end = _d(pr.get("finaldate")) or start
    if not fid or start is None:
        return None
    try:
        ha = float(pr.get("area") or 0)
    except ValueError:
        ha = 0.0
    if ha <= 0:
        ha = geo.area_ha(g)
    pt = g.representative_point()
    near = geo.commune_name(pt.x, pt.y)
    region = geo.region_label(pt.x, pt.y)
    notes = ["Burned area mapped from MODIS/VIIRS (includes agricultural burning; fires under ~100 ha are not mapped)",
             "severity by burned area: < 500 ha moderate, < 5,000 ha severe, ≥ 5,000 ha extreme",
             "geometry simplified to ~30 m for display"]
    if end and (today - end).days <= PROVISIONAL_DAYS:
        notes.append("provisional: recent polygon, may still grow")
    p: Provenance = prov.from_fetch(SOURCE, r, observed_at=(end or start).isoformat(), note="; ".join(notes),
                                    resolution="polygon (≥ ~100 ha)", data_tier=data_tier)  # type: ignore[arg-type]
    title = f"Burned area near {near} ({ha:,.0f} ha)" if near else f"Burned area ({ha:,.0f} ha)"
    return ClimateEvent(
        id=f"gwis:{fid}", kind="fire", title=title, region=region or "", start=start.isoformat(),
        end=end.isoformat() if end else None, severity=severity(ha), source=LABEL,  # type: ignore[arg-type]
        evidence_kind="observed_footprint", geometry=geo.simplified_geojson(g), affected_farm_ids=[],
        affected_exposure=0, provenance=p,
    )


def events(bbox: tuple[float, float, float, float], since: date, until: date, today: date,
           data_tier: str = "enhanced") -> list[ClimateEvent]:
    feats, r = fetch(bbox, since, until, today)
    out = []
    for f in feats:
        e = to_event(f, r, today, data_tier)
        if e is not None:
            out.append(e)
    return out
