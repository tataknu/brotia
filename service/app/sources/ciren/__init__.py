"""svc-portfolio: CIREN / IDE Minagri ArcGIS REST client (ADR-0010, ADR-0012).

Two keyless MapServer services, both reached only through app.http (cache, ≤ 2 concurrent requests,
timeouts, honest User-Agent):

- Catastro Frutícola, "PRODUCTORES FRUTÍCOLAS" polygons, one layer per region (55–68).
  Fields used: objectid, especie_01, desccomu, comudere, provdere, regidere. `rolpredi` (property tax
  roll) is never requested or returned (privacy, chile-ag-stats-credit notes). The polygons carry no
  variety and no planting year.
- HIDRICO_PUBLICO "ÁREAS DE RIEGO" polygons (Atacama, Coquimbo, Valparaíso, RM, O'Higgins, Maule):
  a binary irrigated mask. South of Maule there is no layer (ADR-0010 D2).

Quirks handled (from the discovery probes): ~4 s per query whatever the payload; a bad query answers
HTTP 200 with {"error": {...}} in the body (treated as a failure, never cached); per-region field
differences (we only request fields present in every orchard layer).

Public functions (signatures kept from the foundation placeholder):
    get_orchards(bbox, crop=None) -> CirenOrchardCollection          GET /ciren/orchards
    find_peers(farm, zone, max_peers=20) -> CirenOrchardCollection   §E.9 peers
    irrigation_check(farm, distance_m=500) -> IrrigationCheck        §E.11 rung 1 (CIREN part)
    nearest_orchard(lng, lat, crop, max_distance_m=5000) -> CirenOrchardFeature | None
    get_orchard(layer_id, object_id) -> CirenOrchardFeature | None
    commune_for_farm(farm) -> CommuneRef | None
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Any, Iterable

from pyproj import Geod
from shapely.geometry import Point, Polygon as ShpPolygon, shape

from app import http
from app import provenance as prov
from app.models import (
    CirenOrchardCollection,
    CirenOrchardFeature,
    CirenOrchardProperties,
    Farm,
    Polygon,
    Provenance,
    Zone,
)

log = logging.getLogger("clm.ciren")

SOURCE_ORCHARDS = "ciren_catastro"
SOURCE_IRRIGATED = "ciren_irrigated"

BASE = "https://esri.ciren.cl/server/rest/services"
CATASTRO_URL = f"{BASE}/IDEMINAGRI/CATASTRO_FRUTICOLA/MapServer"
HIDRICO_URL = f"{BASE}/Emergencias/HIDRICO_PUBLICO/MapServer"

#: Polygons are fixed survey snapshots per region (2022/2024/2025, re-surveyed every ~3 years): the cache
#: never expires, so the demo works offline. Clear the ciren_* rows of http_cache after a new survey.
TTL = http.TTL_FOREVER
#: ~2 m generalisation on the server; keeps payloads small without visibly changing a 2-30 ha block.
MAX_OFFSET_DEG = 0.00002
MAX_FEATURES = 300
PAGE = 2000  # server maxRecordCount
ORCHARD_FIELDS = "objectid,especie_01,desccomu,comudere,provdere,regidere"

# politeness: the server runs ~2 queries at a time (verification probe), so 2 is the ceiling.
http.register_source(SOURCE_ORCHARDS, max_concurrency=2, min_interval_s=0.5, timeout_s=45, retries=1)
http.register_source(SOURCE_IRRIGATED, max_concurrency=2, min_interval_s=0.5, timeout_s=45, retries=1)

_GEOD = Geod(ellps="WGS84")


@dataclass(frozen=True)
class Layer:
    id: int
    region: str
    vintage: int
    #: data extent in EPSG:4326 (minLng, minLat, maxLng, maxLat), read from the layer metadata 2026-11-07.
    bbox: tuple[float, float, float, float]


#: Catastro Frutícola "PRODUCTORES FRUTÍCOLAS" layers (CATASTRO_FRUTICOLA/MapServer/<id>).
ORCHARD_LAYERS: list[Layer] = [
    Layer(55, "Arica y Parinacota", 2022, (-70.333, -18.832, -69.646, -18.340)),
    Layer(56, "Tarapacá", 2022, (-69.392, -20.524, -69.306, -20.474)),
    Layer(57, "Atacama", 2024, (-71.411, -29.213, -69.865, -27.276)),
    Layer(58, "Coquimbo", 2024, (-71.540, -32.170, -70.381, -29.282)),
    Layer(59, "Valparaíso", 2025, (-71.797, -33.953, -70.316, -32.142)),
    Layer(60, "Metropolitana", 2025, (-71.708, -34.087, -70.179, -33.002)),
    Layer(61, "O'Higgins", 2024, (-71.981, -34.868, -70.428, -33.908)),
    Layer(62, "Maule", 2024, (-72.578, -36.364, -70.800, -34.801)),
    Layer(63, "Ñuble", 2024, (-72.788, -37.183, -71.554, -36.074)),
    Layer(64, "Biobío", 2024, (-73.636, -37.998, -71.780, -36.693)),
    Layer(65, "La Araucanía", 2024, (-73.154, -39.465, -71.589, -37.656)),
    Layer(66, "Los Ríos", 2024, (-73.167, -40.481, -71.993, -39.438)),
    Layer(67, "Los Lagos", 2024, (-73.482, -41.322, -72.654, -40.352)),
    Layer(68, "Aysén", 2022, (-72.482, -46.597, -71.671, -45.410)),
]

#: HIDRICO_PUBLICO "ÁREAS DE RIEGO" layers (HIDRICO_PUBLICO/MapServer/<id>).
IRRIGATED_LAYERS: list[Layer] = [
    Layer(1, "Atacama", 2022, (-71.436, -29.336, -69.543, -26.407)),
    Layer(2, "Coquimbo", 2022, (-71.582, -32.187, -70.366, -29.751)),
    Layer(4, "Valparaíso", 2016, (-71.827, -33.938, -70.307, -32.137)),
    Layer(5, "O'Higgins", 2021, (-71.984, -34.892, -70.424, -33.908)),
    Layer(6, "Maule", 2021, (-72.775, -36.406, -70.818, -34.796)),
    Layer(7, "Metropolitana", 2021, (-71.711, -34.088, -70.051, -32.975)),
]

#: Rough extent of continental Chile, used only to word the "outside Chile" note.
CHILE_BBOX = (-76.0, -56.0, -66.0, -17.4)


# ───────────────────────── small geo helpers ─────────────────────────


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in metres between [lng, lat] points (R = 6 371 008.8 m, as app geo.ts)."""
    r = 6371008.8
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp = p2 - p1
    dl = math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def polygon_area_ha(coords: list[list[list[float]]]) -> float:
    """Geodesic area (WGS84) of a GeoJSON polygon (exterior minus holes), hectares."""
    area, _ = _GEOD.geometry_area_perimeter(ShpPolygon(coords[0], coords[1:]))
    return abs(area) / 10_000.0


def polygon_centroid(coords: list[list[list[float]]]) -> tuple[float, float]:
    c = ShpPolygon(coords[0], coords[1:]).centroid
    return (c.x, c.y)


def _bbox_intersects(a: tuple[float, float, float, float], b: tuple[float, float, float, float], pad: float = 0.02) -> bool:
    return not (a[2] < b[0] - pad or a[0] > b[2] + pad or a[3] < b[1] - pad or a[1] > b[3] + pad)


def layers_for_bbox(bbox: tuple[float, float, float, float], layers: Iterable[Layer] = ORCHARD_LAYERS) -> list[Layer]:
    return [l for l in layers if _bbox_intersects(bbox, l.bbox)]


def layers_for_point(lng: float, lat: float, radius_m: float = 0.0, layers: Iterable[Layer] = ORCHARD_LAYERS) -> list[Layer]:
    dlat = radius_m / 111_320.0
    dlng = radius_m / (111_320.0 * max(0.1, math.cos(math.radians(lat))))
    return layers_for_bbox((lng - dlng, lat - dlat, lng + dlng, lat + dlat), layers)


def _rings_of(geom: dict) -> list[list[list[float]]] | None:
    """GeoJSON Polygon / MultiPolygon -> one polygon's rings (the largest part of a multipolygon)."""
    if not geom:
        return None
    t = geom.get("type")
    if t == "Polygon":
        return geom.get("coordinates") or None
    if t == "MultiPolygon":
        parts = [p for p in geom.get("coordinates") or [] if p]
        if not parts:
            return None
        return max(parts, key=lambda p: polygon_area_ha(p))
    return None


def _round_rings(rings: list[list[list[float]]], nd: int = 6) -> list[list[list[float]]]:
    out = []
    for ring in rings:
        r = [[round(float(x), nd), round(float(y), nd)] for x, y, *_ in ring]
        if r and r[0] != r[-1]:
            r.append(list(r[0]))
        out.append(r)
    return out


# ───────────────────────── crop mapping ─────────────────────────


def _especie_map() -> dict[str, str]:
    """CIREN especie_01 -> v1 crop, from the crop templates (cirenEspecie)."""
    from app.domain.templates import get_crop_templates  # local import: domain may import this module

    out: dict[str, str] = {}
    for t in get_crop_templates():
        for e in t.ciren_especie:
            out[e.strip().upper()] = t.crop
    return out


def especies_for_crop(crop: str) -> list[str]:
    return [e for e, c in _especie_map().items() if c == crop]


def crop_for_especie(especie: str | None) -> str | None:
    if not especie:
        return None
    return _especie_map().get(especie.strip().upper())


def _where_for(crop: str | None) -> str:
    if crop is None:
        return "1=1"
    vals = ",".join("'" + e.replace("'", "''") + "'" for e in especies_for_crop(crop))
    return f"especie_01 IN ({vals})" if vals else "1=0"


# ───────────────────────── fetching ─────────────────────────


def _valid(body: Any) -> bool:
    """ArcGIS answers HTTP 200 with {"error": {...}} for bad queries: never cache that."""
    return isinstance(body, dict) and "error" not in body and isinstance(body.get("features", []), list)


def _query(source: str, url: str, params: dict[str, Any], *, post: bool = False) -> http.FetchResult:
    base = {"f": "geojson", "outSR": 4326, "inSR": 4326, "returnGeometry": "true"}
    base.update(params)
    if post:
        return http.fetch("POST", source, url, data=base, ttl=TTL, validate=_valid, allow_empty=True)
    return http.fetch("GET", source, url, params=base, ttl=TTL, validate=_valid, allow_empty=True)


def _orchard_query(layer: Layer, geometry_params: dict[str, Any], where: str) -> tuple[list[dict], http.FetchResult]:
    params = {
        "where": where,
        "outFields": ORCHARD_FIELDS,
        "spatialRel": "esriSpatialRelIntersects",
        "maxAllowableOffset": MAX_OFFSET_DEG,
        "resultRecordCount": PAGE,
        **geometry_params,
    }
    r = _query(SOURCE_ORCHARDS, f"{CATASTRO_URL}/{layer.id}/query", params)
    feats = [f for f in (r.body or {}).get("features", []) if f.get("geometry")]
    for f in feats:
        f["_layer"] = layer.id
        f["_exceeded"] = bool((r.body or {}).get("exceededTransferLimit") or (r.body or {}).get("properties", {}).get("exceededTransferLimit"))
    return feats, r


def _to_feature(raw: dict) -> CirenOrchardFeature | None:
    rings = _rings_of(raw.get("geometry") or {})
    if not rings:
        return None
    rings = _round_rings(rings)
    props = raw.get("properties") or {}
    oid = props.get("objectid", raw.get("id"))
    if oid is None:
        return None
    especie = (props.get("especie_01") or "").strip()
    comuna = (props.get("desccomu") or "").strip() or None
    try:
        area = round(polygon_area_ha(rings), 2)
    except Exception:
        area = None
    return CirenOrchardFeature(
        id=int(oid),
        geometry=Polygon(coordinates=rings),
        properties=CirenOrchardProperties(
            object_id=int(oid),
            especie=especie,
            crop=crop_for_especie(especie),
            area_ha=area,
            comuna=comuna,
            source_layer=f"CATASTRO_FRUTICOLA/{raw.get('_layer')}",
        ),
    )


def _merge_prov(source: str, results: list[http.FetchResult], errors: list[str], layers: list[Layer],
                extra_note: str | None = None) -> Provenance:
    vint = "; ".join(f"{l.region} survey {l.vintage}" for l in layers)
    notes = [f"CIREN vintage: {vint}" if vint else None, extra_note]
    if errors:
        notes.append("failed: " + "; ".join(errors))
    if results:
        newest = max(results, key=lambda r: r.fetched_at)
        p = prov.from_fetch(source, newest, note="; ".join(n for n in notes if n) or None)
        if any(r.stale for r in results) and not p.stale:
            p = p.model_copy(update={"stale": True})
        return p
    return prov.unavailable(source, "; ".join(n for n in notes if n) or "no CIREN layer answered")


def _empty(source: str, note: str) -> CirenOrchardCollection:
    return CirenOrchardCollection(features=[], truncated=False, provenance=prov.build(source, note=note))


# ───────────────────────── public API ─────────────────────────


def get_orchards(bbox: tuple[float, float, float, float], crop: str | None = None) -> CirenOrchardCollection:
    """GET /ciren/orchards. bbox already validated (<= 0.25° per side) by the router. Max 300 features,
    nearest to the bbox centre first, truncated=True when capped. Outside Chile -> empty + note.
    Upstream down and nothing cached -> empty features + provenance.note (never raises for that)."""
    layers = layers_for_bbox(bbox)
    if not layers:
        where = "outside Chile" if not _bbox_intersects(bbox, CHILE_BBOX, 0) else "outside the CIREN fruit-cadastre coverage"
        return _empty(SOURCE_ORCHARDS, f"No CIREN orchard layer covers this box ({where}); CIREN is Chile only.")
    geom = {
        "geometry": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}",
        "geometryType": "esriGeometryEnvelope",
    }
    where = _where_for(crop)
    raw: list[dict] = []
    results: list[http.FetchResult] = []
    errors: list[str] = []
    for layer in layers:
        try:
            feats, r = _orchard_query(layer, geom, where)
            raw.extend(feats)
            results.append(r)
        except http.FetchError as exc:
            errors.append(f"layer {layer.id} ({layer.region}): {exc.reason}")
    if not results:
        return CirenOrchardCollection(features=[], truncated=False,
                                      provenance=_merge_prov(SOURCE_ORCHARDS, [], errors, layers))
    exceeded = any(f.get("_exceeded") for f in raw)
    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    seen: set[tuple[int, int]] = set()
    feats: list[tuple[float, CirenOrchardFeature]] = []
    for f in raw:
        feat = _to_feature(f)
        if feat is None:
            continue
        k = (f["_layer"], feat.id)
        if k in seen:
            continue
        seen.add(k)
        c = polygon_centroid(feat.geometry.coordinates)
        feats.append((haversine_m((cx, cy), c), feat))
    feats.sort(key=lambda t: t[0])
    truncated = exceeded or len(feats) > MAX_FEATURES
    note = None
    if exceeded:
        note = f"the server capped a layer at {PAGE} polygons; the nearest {MAX_FEATURES} of those returned are shown"
    return CirenOrchardCollection(
        features=[f for _, f in feats[:MAX_FEATURES]],
        truncated=truncated,
        provenance=_merge_prov(SOURCE_ORCHARDS, results, errors, layers, note),
    )


def orchards_near(lng: float, lat: float, radius_m: float, crop: str | None) -> tuple[list[CirenOrchardFeature], Provenance]:
    """Orchards (of `crop`, or all) intersecting a circle; nearest centroid first. Never raises for
    upstream failures (empty list + provenance note)."""
    layers = layers_for_point(lng, lat, radius_m)
    if not layers:
        return [], prov.build(SOURCE_ORCHARDS, note="No CIREN orchard layer covers this point (CIREN is Chile only).")
    geom = {
        "geometry": f"{lng},{lat}",
        "geometryType": "esriGeometryPoint",
        "distance": int(round(radius_m)),
        "units": "esriSRUnit_Meter",
    }
    where = _where_for(crop)
    out: list[tuple[float, CirenOrchardFeature]] = []
    results: list[http.FetchResult] = []
    errors: list[str] = []
    for layer in layers:
        try:
            feats, r = _orchard_query(layer, geom, where)
            results.append(r)
        except http.FetchError as exc:
            errors.append(f"layer {layer.id} ({layer.region}): {exc.reason}")
            continue
        for f in feats:
            feat = _to_feature(f)
            if feat is not None:
                out.append((haversine_m((lng, lat), polygon_centroid(feat.geometry.coordinates)), feat))
    out.sort(key=lambda t: t[0])
    return [f for _, f in out], _merge_prov(SOURCE_ORCHARDS, results, errors, layers)


def nearest_orchard(lng: float, lat: float, crop: str, max_distance_m: float = 5000) -> CirenOrchardFeature | None:
    """Nearest orchard of `crop` (by centroid) to a point, searching 1 km, 3 km then max_distance_m."""
    for r in (1000, 3000, max_distance_m):
        if r > max_distance_m:
            break
        feats, _ = orchards_near(lng, lat, r, crop)
        if feats:
            return feats[0]
    return None


def get_orchard(layer_id: int, object_id: int) -> CirenOrchardFeature | None:
    """One orchard polygon by layer and objectid (raises http.FetchError when CIREN is down and uncached)."""
    layer = next((l for l in ORCHARD_LAYERS if l.id == layer_id), None)
    if layer is None:
        return None
    feats, _ = _orchard_query(layer, {}, f"objectid = {int(object_id)}")
    for f in feats:
        feat = _to_feature(f)
        if feat is not None:
            return feat
    return None


def find_peers(farm: Farm, zone: Zone, max_peers: int = 20) -> CirenOrchardCollection:
    """§E.9: same-crop CIREN orchards with centroid inside the zone circle, excluding the farm's own
    orchard (its CIREN objectId, or any polygon containing the farm centroid), nearest to the farm
    first, at most max_peers."""
    center = (float(zone.center[0]), float(zone.center[1]))
    radius = float(zone.radius_m)
    feats, p = orchards_near(center[0], center[1], radius, farm.crop)
    own_oid = farm.ciren.object_id if farm.ciren else None
    own_layer = farm.ciren.source_layer if farm.ciren else None
    farm_pt = Point(float(farm.centroid[0]), float(farm.centroid[1]))
    peers: list[tuple[float, CirenOrchardFeature]] = []
    for f in feats:
        if own_oid is not None and f.id == own_oid and (own_layer is None or f.properties.source_layer == own_layer):
            continue
        rings = f.geometry.coordinates
        c = polygon_centroid(rings)
        if haversine_m(center, c) > radius:
            continue
        try:
            if ShpPolygon(rings[0], rings[1:]).contains(farm_pt):
                continue
        except Exception:
            pass
        peers.append((haversine_m((farm_pt.x, farm_pt.y), c), f))
    peers.sort(key=lambda t: t[0])
    chosen = [f for _, f in peers[:max_peers]]
    note = "; ".join(x for x in [p.note, f"{len(chosen)} same-crop peers in zone {zone.id} (of {len(peers)} found)"] if x)
    return CirenOrchardCollection(features=chosen, truncated=len(peers) > max_peers,
                                  provenance=p.model_copy(update={"note": note}))


@dataclass
class IrrigationCheck:
    """CIREN part of water-ladder rung 1 (§E.11, ADR-0010 D2)."""

    #: 'yes' = irrigated-area polygon within distance; 'unknown' = covered region but no polygon near
    #: (or CIREN unavailable); south of Maule (no layer) 'yes' with estimated=True for fruit (ADR-0010 D2).
    value: str
    #: True when a HIDRICO_PUBLICO layer covers the farm's region.
    covered: bool
    n_polygons: int
    estimated: bool
    evidence: str
    provenance: Provenance


def irrigation_check(farm: Farm, distance_m: float = 500) -> IrrigationCheck:
    """Is a CIREN irrigated-area polygon within `distance_m` of the farm polygon? Polygon intersect
    with a buffer, never a single point (ADR-0010 D2). Never raises for upstream failures."""
    rings = farm.polygon.coordinates
    lng, lat = float(farm.centroid[0]), float(farm.centroid[1])
    layers = layers_for_point(lng, lat, distance_m, IRRIGATED_LAYERS)
    in_orchard_area = bool(layers_for_point(lng, lat, 0, ORCHARD_LAYERS))
    if not layers:
        if in_orchard_area and lat < -35.0:
            ev = ("No CIREN irrigated-area layer south of Maule; fruit orchards there are assumed irrigated "
                  "(ADR-0010 D2).")
            return IrrigationCheck("yes", False, 0, True, ev,
                                   prov.build(SOURCE_IRRIGATED, estimated=True, note=ev, resolution="n/a"))
        ev = "No CIREN irrigated-area layer covers this location."
        return IrrigationCheck("unknown", False, 0, False, ev, prov.unavailable(SOURCE_IRRIGATED, ev))
    esri_poly = {"rings": rings, "spatialReference": {"wkid": 4326}}
    import json as _json

    params = {
        "where": "1=1",
        "geometry": _json.dumps(esri_poly, separators=(",", ":")),
        "geometryType": "esriGeometryPolygon",
        "spatialRel": "esriSpatialRelIntersects",
        "distance": int(round(distance_m)),
        "units": "esriSRUnit_Meter",
        "returnCountOnly": "true",
        "f": "json",
    }
    total = 0
    results: list[http.FetchResult] = []
    errors: list[str] = []
    for layer in layers:
        try:
            r = http.fetch("POST", SOURCE_IRRIGATED, f"{HIDRICO_URL}/{layer.id}/query",
                           data={"inSR": 4326, **params}, ttl=TTL,
                           validate=lambda b: isinstance(b, dict) and "error" not in b and "count" in b,
                           allow_empty=True)
            results.append(r)
            total += int(r.body.get("count", 0))
        except http.FetchError as exc:
            errors.append(f"layer {layer.id} ({layer.region}): {exc.reason}")
    vint = ", ".join(f"{l.region} {l.vintage}" for l in layers)
    if not results:
        # plain sentence for the lender; the technical reason stays in provenance.note (RT-6)
        ev = "CIREN irrigation map unavailable right now."
        return IrrigationCheck("unknown", True, 0, False, ev,
                               prov.unavailable(SOURCE_IRRIGATED, "CIREN irrigated-area service unavailable: " + "; ".join(errors)))
    if total > 0:
        ev = f"{total} CIREN irrigated-area polygon(s) within {int(distance_m)} m of the orchard (layer: {vint})."
        value = "yes"
    else:
        ev = f"No CIREN irrigated-area polygon within {int(distance_m)} m of the orchard (layer: {vint})."
        value = "unknown"
    newest = max(results, key=lambda r: r.fetched_at)
    p = prov.from_fetch(SOURCE_IRRIGATED, newest, note=ev + (" Partial: " + "; ".join(errors) if errors else ""))
    return IrrigationCheck(value, True, total, False, ev, p)


@dataclass
class CommuneRef:
    name: str
    code: str | None
    province_code: str | None
    region_code: str | None
    source_layer: str


def commune_for_farm(farm: Farm) -> CommuneRef | None:
    """Commune of a farm from CIREN orchard attributes: the farm's own CIREN polygon when it has one,
    else the orchard polygon nearest its centroid (any species, within 3 km). None when unknown."""
    from app.domain.portfolio import sample_commune  # cached attributes of the sample farms (no network)

    hit = sample_commune(farm)
    if hit is not None:
        return hit
    lng, lat = float(farm.centroid[0]), float(farm.centroid[1])
    for layer in layers_for_point(lng, lat, 3000):
        try:
            where = f"objectid = {int(farm.ciren.object_id)}" if farm.ciren and farm.ciren.source_layer.endswith(f"/{layer.id}") else "1=1"
            geom = {} if where != "1=1" else {"geometry": f"{lng},{lat}", "geometryType": "esriGeometryPoint",
                                               "distance": 3000, "units": "esriSRUnit_Meter"}
            feats, _ = _orchard_query(layer, geom, where)
        except http.FetchError:
            continue
        best = None
        for f in feats:
            rings = _rings_of(f.get("geometry") or {})
            if not rings:
                continue
            d = haversine_m((lng, lat), polygon_centroid(rings))
            if best is None or d < best[0]:
                best = (d, f)
        if best is not None:
            p = best[1].get("properties") or {}
            return CommuneRef(
                name=(p.get("desccomu") or "").strip(),
                code=(p.get("comudere") or None),
                province_code=(p.get("provdere") or None),
                region_code=(p.get("regidere") or None),
                source_layer=f"CATASTRO_FRUTICOLA/{layer.id}",
            )
    return None
