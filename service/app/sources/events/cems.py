"""Copernicus EMS Rapid Mapping activations for Chile (ADR-0009 D1): EMSR715 (Feb-2024 Valparaíso
wildfire) and EMSR859 (Jan-2026 Biobío/Ñuble wildfires), plus any newer Chile activation the keyless
dashboard API lists.

- Activation records (live, keyless JSON) → one `narrative` event per activation, geometry null
  (the AOI extents are mapping areas, not burned area, so they are never used as a footprint).
- Observed burnt-area vectors: the DEL products are ~120 MB zips holding a ~230 MB `observedEventA`
  GeoJSON each, too heavy to fetch at request time. They are processed offline into simplified
  footprints under `data/cems_<code>_<aoi>.geojson` (properties carry the product download URL); each
  becomes an `observed_footprint` event `cems:<code>:<aoi>`. When none is present, only the narrative exists.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date
from pathlib import Path
from typing import Any

from shapely.geometry import box

from app import http, provenance as prov
from app.models import ClimateEvent
from app.sources.events import geo

log = logging.getLogger("clm.events.cems")

SOURCE = "cems"
LABEL = "Copernicus EMS Rapid Mapping"
API = "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api"
KNOWN_CHILE = ("EMSR715", "EMSR859")
DATA_DIR = Path(__file__).resolve().parent / "data"
_KIND = {"wildfire": "fire", "flood": "flood"}

http.register_source(SOURCE, max_concurrency=1, min_interval_s=1.0, timeout_s=60, retries=1)


def _results(j: Any) -> list[dict]:
    if isinstance(j, dict) and isinstance(j.get("results"), list):
        return j["results"]
    if isinstance(j, list):
        return j
    if isinstance(j, dict) and j.get("code"):
        return [j]
    return []


def chile_codes() -> list[str]:
    codes = list(KNOWN_CHILE)
    try:
        r = http.get_json(SOURCE, f"{API}/public-activations-info/", params={"limit": 1000}, ttl=http.TTL_DAY)
        for a in _results(r.body):
            if "Chile" in json.dumps(a.get("countries"), ensure_ascii=False) and a.get("code") not in codes:
                codes.append(a["code"])
    except http.FetchError as exc:
        log.info("CEMS activation list unavailable: %s", exc.reason)
    return codes


def activation(code: str) -> tuple[dict, http.FetchResult]:
    r = http.get_json(SOURCE, f"{API}/public-activations/", params={"code": code}, ttl=http.TTL_WEEK,
                      validate=lambda j: bool(_results(j)))
    return _results(r.body)[0], r


def _point(wkt: str | None) -> tuple[float, float] | None:
    m = re.search(r"POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)", wkt or "")
    return (float(m.group(1)), float(m.group(2))) if m else None


def _burnt_ha(a: dict) -> float:
    tot = 0.0
    for aoi in a.get("aois") or []:
        best = 0.0
        for p in aoi.get("products") or []:
            st = (p.get("stats") or {}).get("Burnt area") or {}
            for v in st.values():
                try:
                    best = max(best, float(v.get("affected") or 0))
                except (TypeError, ValueError):
                    pass
        tot += best
    return tot


def _severity(ha: float) -> str:
    return "extreme" if ha >= 5000 else "severe" if ha >= 500 else "moderate"


def narrative_event(a: dict, r: http.FetchResult) -> ClimateEvent | None:
    code = a.get("code")
    start = str(a.get("eventTime") or "")[:10]
    if not code or not start:
        return None
    kind = _KIND.get(str(a.get("category") or "").lower(), "fire")
    c = _point(a.get("centroid"))
    region = geo.region_label(*c) if c else ""
    aois = ", ".join(str(x.get("name")) for x in a.get("aois") or [] if x.get("name"))
    ha = _burnt_ha(a)
    note = (f"Activation record; AOIs: {aois or 'n/a'}" + (f"; burnt area mapped in products ≈ {ha:,.0f} ha" if ha else "")
            + "; footprint in the observed_footprint events when processed")
    p = prov.from_fetch(SOURCE, r, observed_at=start, note=note, resolution="n/a")
    return ClimateEvent(
        id=f"cems:{code}", kind=kind, title=str(a.get("name") or code), region=region, start=start, end=None,  # type: ignore[arg-type]
        severity=_severity(ha) if ha else "severe", source=LABEL, evidence_kind="narrative", geometry=None,  # type: ignore[arg-type]
        affected_farm_ids=[], affected_exposure=0, provenance=p,
    )


def footprints() -> list[dict]:
    """Processed observed-event footprints shipped in data/ (GeoJSON Features)."""
    out = []
    for f in sorted(DATA_DIR.glob("cems_*.geojson")):
        try:
            out.append(json.loads(f.read_text()))
        except Exception as exc:
            log.warning("bad CEMS footprint file %s: %s", f.name, exc)
    return out


def footprint_event(feat: dict) -> ClimateEvent | None:
    pr = feat.get("properties") or {}
    g = geo.to_shape(feat.get("geometry"))
    if g is None or g.is_empty or not pr.get("code"):
        return None
    start = str(pr.get("event_date") or "")[:10]
    pt = g.representative_point()
    ha = geo.area_ha(g)
    p = prov.build(SOURCE, observed_at=pr.get("image_date") or start, fetched_at=pr.get("processed_at"),
                   resolution="polygon (VHR imagery)",
                   note=f"Observed burnt area from {pr.get('product')} ({pr.get('download_path')}), simplified to ~30 m "
                        f"and dissolved offline on {str(pr.get('processed_at'))[:10]}")
    return ClimateEvent(
        id=f"cems:{pr['code']}:{pr.get('aoi')}", kind="fire",
        title=f"{pr.get('name') or pr['code']}: burnt area {pr.get('aoi_name') or pr.get('aoi')} ({ha:,.0f} ha)",
        region=geo.region_label(pt.x, pt.y), start=start, end=pr.get("image_date"), severity=_severity(ha),  # type: ignore[arg-type]
        source=LABEL, evidence_kind="observed_footprint", geometry=geo.simplified_geojson(g, 0.0), affected_farm_ids=[],
        affected_exposure=0, provenance=p,
    )


def _touches(a: dict, b: Any) -> bool:
    """The activation centroid is in the bbox, or one of its AOI extents intersects it."""
    from shapely import wkt as _wkt
    from shapely.geometry import Point

    c = _point(a.get("centroid"))
    if c and b.contains(Point(*c)):
        return True
    for aoi in a.get("aois") or []:
        try:
            if _wkt.loads(aoi.get("extent")).intersects(b):
                return True
        except Exception:
            continue
    return False


def events(bbox: tuple[float, float, float, float], since: date, until: date) -> list[ClimateEvent]:
    """Chile CEMS activations (narrative) and processed footprints intersecting bbox, started in [since, until]."""
    b = box(*bbox)
    s0, s1 = since.isoformat(), until.isoformat()
    out: list[ClimateEvent] = []
    errors: list[str] = []
    for code in chile_codes():
        try:
            a, r = activation(code)
        except http.FetchError as exc:
            errors.append(f"{code}: {exc.reason}")
            continue
        e = narrative_event(a, r)
        if e is None or not (s0 <= e.start <= s1):
            continue
        if _touches(a, b):
            out.append(e)
    for feat in footprints():
        e = footprint_event(feat)
        if e is None or not (s0 <= e.start <= s1):
            continue
        if geo.to_shape(e.geometry) is not None and geo.to_shape(e.geometry).intersects(b):
            out.append(e)
    if errors and not out and not footprints():
        raise http.FetchError(SOURCE, API, "; ".join(errors))
    return out
