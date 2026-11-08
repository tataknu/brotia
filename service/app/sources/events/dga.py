"""DGA water-scarcity decrees as ClimateEvents (`declared_emergency`, `official_declaration`; ADR-0009 D1).

Footprint = the communes whose commune, province, basin or region the decree text names (the same
matcher the farm join uses), unioned and simplified. Decrees whose territory cannot be resolved to
communes (e.g. "Sector Hidrogeológico ... Lluta Bajo") are placed by region with geometry null.
"""

from __future__ import annotations

import threading
from datetime import date

from shapely.ops import unary_union

from app import http
from app.models import ClimateEvent
from app.sources.events import geo
from app.sources.water import admin, decrees as dec

LABEL = "DGA"


def _short_territory(d: dec.Decree, matched: list[tuple[admin.Commune, str]]) -> str:
    levels = {lvl for _, lvl in matched}
    provs = sorted({c.province_label for c, _ in matched})
    if levels == {"province"} and len(provs) == 1:
        return f"{provs[0]} province"
    if levels == {"commune"} and len(matched) <= 3:
        return ", ".join(sorted(c.display_name for c, _ in matched))
    t = " ".join(d.territory.split())
    return t if len(t) <= 70 else t[:67].rstrip() + "…"


_lock = threading.Lock()
_footprints: dict[tuple[int, int, str, str], list[tuple[admin.Commune, str]]] = {}


def _matched_communes(d: dec.Decree, ds: dec.DecreeSet, idx: admin.CommuneIndex) -> list[tuple[admin.Commune, str]]:
    """Communes the decree text covers, memoised per (decree set, commune index, decree)."""
    key = (id(ds), id(idx), d.key, d.source)
    with _lock:
        hit = _footprints.get(key)
    if hit is not None:
        return hit
    provs = dec._province_names()
    matched = [(c, lvl) for c in idx.communes if (lvl := dec.match_level(d, c, provs))]
    with _lock:
        if len(_footprints) > 5000:
            _footprints.clear()
        _footprints[key] = matched
    return matched


def reset_memo() -> None:
    with _lock:
        _footprints.clear()


def events(bbox: tuple[float, float, float, float], since: date, until: date) -> list[ClimateEvent]:
    """Decrees in force at any time in [since, until] whose footprint touches bbox. Chile only."""
    idx = admin.communes()
    in_bbox = idx.in_bbox(bbox)
    if not in_bbox:
        return []
    ds = dec.load_decrees()
    if not ds.xls_ok and not ds.page_ok:
        raise http.FetchError(dec.SOURCE, dec.PAGE_URL, ds.provenance.note or "decree sources unavailable")
    bbox_codes = {c.code for c in in_bbox}
    bbox_regions = {c.region_key for c in in_bbox}
    out: list[ClimateEvent] = []
    for d in ds.decrees:
        if d.start > until or d.end < since:
            continue
        matched = _matched_communes(d, ds, idx)
        geometry = None
        if matched:
            if not any(c.code in bbox_codes for c, _ in matched):
                continue
            g = unary_union([c.geom for c, _ in matched])
            geometry = geo.simplified_geojson(g, tolerance_deg=0.003, nd=4)
            regions = sorted({c.region_label for c, _ in matched})
            provinces = sorted({c.province_label for c, _ in matched})
            region = " · ".join(regions + (provinces if len(provinces) <= 3 else []))
            best = max((lvl for _, lvl in matched), key=["region", "basin", "province", "commune"].index)
            footprint_note = ("footprint = communes named (or covered) by the decree text, joined to CONAF communes "
                              "(approximate; basin decrees are drawn as the provinces mapped to that basin)")
        else:
            if not (d.region_keys & bbox_regions):
                continue
            region = " · ".join(sorted(admin.region_label(k) for k in d.region_keys))
            best = "region"
            footprint_note = "territory could not be resolved to communes; placed by region, no geometry"
        note = "; ".join(x for x in [ds.provenance.note, footprint_note,
                                     f"source row: {d.source}" + (f" ({d.url})" if d.url else "")] if x)
        p = ds.provenance.model_copy(update={"observed_at": d.start.isoformat(), "note": note,
                                             "resolution": {"commune": "commune", "province": "province",
                                                            "basin": "basin", "region": "region"}[best]})
        out.append(ClimateEvent(
            id=f"dga_decree:{d.key}", kind="declared_emergency",
            title=f"Water-scarcity decree No. {d.number} ({_short_territory(d, matched)})",
            region=region, start=d.start.isoformat(), end=d.end.isoformat(), severity="severe", source=LABEL,
            evidence_kind="official_declaration", geometry=geometry, affected_farm_ids=[], affected_exposure=0,
            provenance=p,
        ))
    return out
