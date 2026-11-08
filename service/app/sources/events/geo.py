"""Small geometry helpers for the event providers (zone circles, simplification, labels)."""

from __future__ import annotations

from typing import Any

from pyproj import Geod
from shapely.geometry import Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry

_GEOD = Geod(ellps="WGS84")
ZONE_RADIUS_M = 3338.0


def circle(center: tuple[float, float] | list[float], radius_m: float = ZONE_RADIUS_M, n: int = 72) -> Polygon:
    """Geodesic circle (lon/lat polygon) around center = (lng, lat)."""
    lng, lat = float(center[0]), float(center[1])
    az = [i * 360.0 / n for i in range(n)]
    lons, lats, _ = _GEOD.fwd([lng] * n, [lat] * n, az, [radius_m] * n)
    return Polygon(list(zip(lons, lats)))


def bounds_with_margin(g: BaseGeometry, margin_deg: float = 0.0) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = g.bounds
    return (x0 - margin_deg, y0 - margin_deg, x1 + margin_deg, y1 + margin_deg)


def to_shape(geojson: Any) -> BaseGeometry | None:
    if not geojson:
        return None
    try:
        g = shape(geojson)
        return g if g.is_valid else g.buffer(0)
    except Exception:
        return None


def _round(coords: Any, nd: int) -> Any:
    if isinstance(coords, (list, tuple)):
        if coords and isinstance(coords[0], (int, float)):
            return [round(float(c), nd) for c in coords]
        return [_round(c, nd) for c in coords]
    return coords


def simplified_geojson(g: BaseGeometry, tolerance_deg: float = 0.0003, nd: int = 5) -> dict[str, Any]:
    """GeoJSON for display/intersection, simplified (~30 m default) and rounded."""
    s = g.simplify(tolerance_deg, preserve_topology=True) if tolerance_deg > 0 else g
    if s.is_empty:
        s = g
    m = mapping(s)
    return {"type": m["type"], "coordinates": _round(m["coordinates"], nd)}


def area_ha(g: BaseGeometry) -> float:
    a, _ = _GEOD.geometry_area_perimeter(g)
    return abs(a) / 10_000.0


def region_label(lng: float, lat: float) -> str:
    """'Ñuble · Diguillín' from the commune layer; '' outside Chile or when unavailable."""
    try:
        from app.sources.water import admin

        c = admin.locate(lng, lat)
    except Exception:
        return ""
    if c is None:
        return ""
    return f"{c.region_label} · {c.province_label}"


def commune_name(lng: float, lat: float) -> str | None:
    try:
        from app.sources.water import admin

        c = admin.locate(lng, lat)
    except Exception:
        return None
    return c.display_name if c else None
