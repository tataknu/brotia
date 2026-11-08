"""Copernicus DEM GLO-30 via Planetary Computer (keyless): frost-pocket input (CONTRACT §E.5 geography).

relElev = mean elevation of a 60 m disc on the farm centroid − mean elevation of the zone circle.
Two server-side calls per tile (TiTiler /item/statistics, the same pattern as
docs/data-discovery/families/chile-satellite-fit/probe_s2_chile.py), all through app.http (cached
forever: the DEM does not change). A zone circle crossing a tile edge is combined from per-tile
sum/count. Verified live 2026-11-07: collection 'cop-dem-glo-30', asset 'data'.
"""

from __future__ import annotations

from dataclasses import dataclass

from app import http
from app import provenance as prov
from app.models import Provenance
from app.risk import geo

SOURCE = "copernicus_dem"
STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
STATS = "https://planetarycomputer.microsoft.com/api/data/v1/item/statistics"
COLLECTION = "cop-dem-glo-30"
FARM_DISC_M = 60.0

http.register_source(SOURCE, max_concurrency=8, min_interval_s=0.2, timeout_s=60, retries=2)  # Planetary Computer (ADR-0023)


@dataclass
class Elevation:
    farm_m: float
    zone_mean_m: float
    rel_m: float
    provenance: Provenance


def _items(geom: dict) -> tuple[list[str], str | None, http.FetchResult]:
    r = http.post_json(SOURCE, STAC_SEARCH, {"collections": [COLLECTION], "intersects": geom, "limit": 10},
                       ttl=http.TTL_FOREVER,
                       validate=lambda b: isinstance(b, dict) and isinstance(b.get("features"), list) and b["features"])
    feats = r.body["features"]
    dates = [str((f.get("properties") or {}).get("datetime") or "")[:10] for f in feats]
    return [f["id"] for f in feats], max((x for x in dates if x), default=None), r


def _sum_count(item: str, geom: dict) -> tuple[float, float, http.FetchResult]:
    r = http.post_json(SOURCE, STATS, {"type": "Feature", "properties": {}, "geometry": geom},
                       params={"collection": COLLECTION, "item": item, "assets": "data"},
                       ttl=http.TTL_FOREVER,
                       validate=lambda b: isinstance(b, dict) and "properties" in b)
    stats = r.body["properties"]["statistics"]
    band = next(iter(stats.values()))
    count = float(band.get("valid_pixels", band.get("count", 0)) or 0)
    total = float(band.get("sum", 0.0) or 0.0)
    if count and "sum" not in band:
        total = float(band["mean"]) * count
    return total, count, r


def _mean(geom: dict) -> tuple[float, str | None, list[http.FetchResult]]:
    ids, obs, r0 = _items(geom)
    tot, cnt, rs = 0.0, 0.0, [r0]
    for item in ids:
        s, c, r = _sum_count(item, geom)
        tot += s
        cnt += c
        rs.append(r)
    if cnt <= 0:
        raise http.FetchError(SOURCE, STATS, "no valid DEM pixels")
    return tot / cnt, obs, rs


def relative_elevation(centroid: tuple[float, float], zone_center: tuple[float, float], zone_radius_m: float,
                       data_tier: str = "enhanced") -> Elevation:
    """Raises http.FetchError (or any exception) when the DEM is unavailable; callers handle it."""
    zone_geom = geo.circle_geojson(zone_center, zone_radius_m, n=32)
    farm_geom = geo.circle_geojson(centroid, FARM_DISC_M, n=16)
    zone_mean, obs, r1 = _mean(zone_geom)
    farm_mean, _, r2 = _mean(farm_geom)
    rs = r1 + r2
    newest = max(rs, key=lambda r: r.fetched_at)
    p = prov.from_fetch(SOURCE, newest, observed_at=obs, data_tier=data_tier,
                        note=(f"Farm = mean of a {int(FARM_DISC_M)} m disc on the centroid; zone = mean of the zone circle. "
                              "GLO-30 is a surface model: tree canopy can raise the farm value by a few metres."))
    p.stale = any(r.stale for r in rs)
    return Elevation(round(farm_mean, 1), round(zone_mean, 1), round(farm_mean - zone_mean, 1), p)
