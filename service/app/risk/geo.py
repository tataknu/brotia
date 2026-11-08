"""Small geometry helpers (shapely, WGS84). Zone circles are drawn as 64-gons with a local metric
approximation, accurate to well under 1 % at 3.3 km."""

from __future__ import annotations

import math
from typing import Any

from shapely.geometry import Polygon as ShpPolygon
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

M_PER_DEG_LAT = 110_574.0


def m_per_deg_lng(lat: float) -> float:
    return 111_320.0 * math.cos(math.radians(lat))


def circle(center: tuple[float, float] | list[float], radius_m: float, n: int = 64) -> ShpPolygon:
    lng, lat = float(center[0]), float(center[1])
    dx, dy = radius_m / m_per_deg_lng(lat), radius_m / M_PER_DEG_LAT
    ring = [(lng + dx * math.cos(2 * math.pi * i / n), lat + dy * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return ShpPolygon(ring)


def circle_geojson(center: tuple[float, float] | list[float], radius_m: float, n: int = 32) -> dict:
    poly = circle(center, radius_m, n)
    coords = [list(map(float, c)) for c in poly.exterior.coords]
    return {"type": "Polygon", "coordinates": [coords]}


def farm_shape(farm: Any) -> BaseGeometry | None:
    try:
        g = farm.polygon.model_dump(by_alias=True, mode="json") if hasattr(farm.polygon, "model_dump") else farm.polygon
        s = shape(g)
        return s if s.is_valid else s.buffer(0)
    except Exception:
        return None


def event_shape(geometry: Any) -> BaseGeometry | None:
    if not geometry:
        return None
    try:
        s = shape(geometry)
        if s.is_empty:
            return None
        return s if s.is_valid else s.buffer(0)
    except Exception:
        return None


def intersects(a: BaseGeometry | None, b: BaseGeometry | None) -> bool:
    if a is None or b is None:
        return False
    try:
        return bool(a.intersects(b))
    except Exception:
        return False


def pad_bbox(bbox: tuple[float, float, float, float], pad_m: float) -> tuple[float, float, float, float]:
    minx, miny, maxx, maxy = bbox
    lat = (miny + maxy) / 2
    dx, dy = pad_m / m_per_deg_lng(lat), pad_m / M_PER_DEG_LAT
    return (round(minx - dx, 5), round(miny - dy, 5), round(maxx + dx, 5), round(maxy + dy, 5))


def union_bbox(shapes: list[BaseGeometry]) -> tuple[float, float, float, float] | None:
    shapes = [s for s in shapes if s is not None]
    if not shapes:
        return None
    b = [s.bounds for s in shapes]
    return (min(x[0] for x in b), min(x[1] for x in b), max(x[2] for x in b), max(x[3] for x in b))
