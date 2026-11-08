"""Zones (CONTRACT §E.4): 35 km² circles; a farm uses the nearest shared zone that contains its centroid
(tie -> smallest id), else its own auto zone 'auto-<farmId>' (synthesised when missing). Port of the
zone part of app/src/domain/rules.ts.
"""

from __future__ import annotations

import math

from app.models import Farm, Portfolio, Zone

#: √(35 000 000 / π) = 3337.8 m, rounded as in the contract.
ZONE_RADIUS_M = 3338
ZONE_AREA_KM2 = 35


def auto_zone_id(farm_id: str) -> str:
    return f"auto-{farm_id}"


def haversine_m(a: tuple[float, float] | list[float], b: tuple[float, float] | list[float]) -> float:
    """Great-circle distance in metres between [lng, lat] points (R = 6 371 008.8 m)."""
    r = 6371008.8
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp = p2 - p1
    dl = math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def assign_zone_id(farm_id: str, centroid: tuple[float, float] | list[float], zones: list[Zone]) -> str:
    best: tuple[float, str] | None = None
    for z in zones:
        if z.auto:
            continue
        d = haversine_m(centroid, z.center)
        if d > z.radius_m:
            continue
        if best is None or d < best[0] or (d == best[0] and z.id < best[1]):
            best = (d, z.id)
    return best[1] if best else auto_zone_id(farm_id)


def make_auto_zone(farm: Farm) -> Zone:
    return Zone(
        id=auto_zone_id(farm.id),
        name=f"{farm.name} (own zone)",
        center=(float(farm.centroid[0]), float(farm.centroid[1])),
        radius_m=ZONE_RADIUS_M,
        auto=True,
        overrides={},
        color=None,
    )


def make_shared_zone(id: str, name: str, center: tuple[float, float], color: str | None = None) -> Zone:
    return Zone(id=id, name=name, center=(float(center[0]), float(center[1])), radius_m=ZONE_RADIUS_M,
                auto=False, overrides={}, color=color)


def effective_zone(portfolio: Portfolio, farm: Farm) -> tuple[Zone, list[str]]:
    """The farm's effective zone and warnings. Auto zones missing from portfolio.zones are synthesised
    (centre = centroid, radius 3338, no overrides) with a warning."""
    warnings: list[str] = []
    zid = assign_zone_id(farm.id, farm.centroid, portfolio.zones)
    zone = portfolio.zone(zid)
    if zone is None:
        zone = make_auto_zone(farm)
        warnings.append(f"Zone {zid} was missing from the portfolio; synthesised a 35 km² circle on the farm centroid.")
    if farm.zone_id and farm.zone_id != zid:
        warnings.append(f"Farm {farm.id} declares zone {farm.zone_id}; the zone rule assigns {zid} (used).")
    return zone, warnings


def sync_zones(portfolio: Portfolio) -> Portfolio:
    """Port of syncZones: every farm has an auto zone centred on its centroid (created or re-centred, overrides
    kept); auto zones of removed farms are dropped; every Farm.zone_id is the effective zone. Returns a new
    Portfolio (the input is not modified)."""
    p = portfolio.model_copy(deep=True)
    farm_by_id = {f.id: f for f in p.farms}
    zones: list[Zone] = []
    for z in p.zones:
        if z.auto:
            fid = z.id[5:] if z.id.startswith("auto-") else ""
            f = farm_by_id.get(fid)
            if f is None:
                continue
            if tuple(z.center) != tuple(f.centroid):
                z = z.model_copy(update={"center": (float(f.centroid[0]), float(f.centroid[1]))})
        zones.append(z)
    for f in p.farms:
        if not any(z.id == auto_zone_id(f.id) for z in zones):
            zones.append(make_auto_zone(f))
    p.zones = zones
    for f in p.farms:
        f.zone_id = assign_zone_id(f.id, f.centroid, zones)
    return p


def farms_in_zone(portfolio: Portfolio, zone_id: str) -> list[Farm]:
    return [f for f in portfolio.farms if assign_zone_id(f.id, f.centroid, portfolio.zones) == zone_id]
