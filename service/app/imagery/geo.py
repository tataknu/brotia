"""Geometry helpers for the imagery pipeline: padded bboxes, ~10 m EPSG:4326 grids, polygon masks.

Every PNG and every pixel stack of a farm lives on ONE grid: EPSG:4326, north-up, exactly covering
`bbox` = polygon bounds + 20 m padding (CONTRACT §E.12), with ~10 m pixels. The Planetary Computer
data API resamples the Sentinel-2 UTM pixels onto that grid with nearest neighbour, so every grid
value is one native Sentinel-2 pixel value (verified 2026-11-07: CRS EPSG:4326, bounds == bbox).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
from rasterio import features
from rasterio.transform import from_bounds
from shapely.geometry import box, shape

M_PER_DEG_LAT = 110_574.0
PAD_M = 20.0
NATIVE_RES_M = 10.0


def m_per_deg_lon(lat: float) -> float:
    return 111_320.0 * math.cos(math.radians(lat))


def as_geojson(geom: Any) -> dict:
    """Polygon model / dict -> plain GeoJSON dict."""
    if hasattr(geom, "model_dump"):
        geom = geom.model_dump(by_alias=True, mode="json")
    return {"type": geom["type"], "coordinates": geom["coordinates"]}


def as_shape(geom: Any):
    return shape(as_geojson(geom))


@dataclass(frozen=True)
class Grid:
    """EPSG:4326 grid exactly covering bbox with W x H pixels (north-up)."""

    bbox: tuple[float, float, float, float]
    width: int
    height: int

    @property
    def transform(self):
        return from_bounds(*self.bbox, self.width, self.height)

    @property
    def key(self) -> str:
        return ",".join(f"{v:.6f}" for v in self.bbox) + f":{self.width}x{self.height}"

    def pixel_size_m(self) -> tuple[float, float]:
        lat = (self.bbox[1] + self.bbox[3]) / 2
        return (
            (self.bbox[2] - self.bbox[0]) * m_per_deg_lon(lat) / self.width,
            (self.bbox[3] - self.bbox[1]) * M_PER_DEG_LAT / self.height,
        )


def padded_bbox(bounds: tuple[float, float, float, float], pad_m: float = PAD_M) -> tuple[float, float, float, float]:
    minx, miny, maxx, maxy = bounds
    lat = (miny + maxy) / 2
    dx = pad_m / m_per_deg_lon(lat)
    dy = pad_m / M_PER_DEG_LAT
    return (round(minx - dx, 6), round(miny - dy, 6), round(maxx + dx, 6), round(maxy + dy, 6))


def grid_for_bbox(bbox: tuple[float, float, float, float], res_m: float = NATIVE_RES_M, min_px: int = 3) -> Grid:
    lat = (bbox[1] + bbox[3]) / 2
    w_m = (bbox[2] - bbox[0]) * m_per_deg_lon(lat)
    h_m = (bbox[3] - bbox[1]) * M_PER_DEG_LAT
    return Grid(tuple(bbox), max(min_px, int(round(w_m / res_m))), max(min_px, int(round(h_m / res_m))))


def grid_for_polygon(geom: Any, pad_m: float = PAD_M) -> Grid:
    return grid_for_bbox(padded_bbox(as_shape(geom).bounds, pad_m))


def polygon_mask(geom: Any, grid: Grid, scale: int = 1) -> np.ndarray:
    """Boolean mask of pixels whose centre is inside the polygon (all_touched fallback for slivers).
    scale > 1 rasterises on a finer grid with the same bbox (for SR display images)."""
    g = as_geojson(geom)
    shp = (grid.height * scale, grid.width * scale)
    tr = from_bounds(*grid.bbox, shp[1], shp[0])
    m = features.rasterize([(g, 1)], out_shape=shp, transform=tr, fill=0, dtype="uint8").astype(bool)
    if not m.any():
        m = features.rasterize([(g, 1)], out_shape=shp, transform=tr, fill=0, dtype="uint8", all_touched=True).astype(bool)
    return m


def outline_mask(mask: np.ndarray) -> np.ndarray:
    """Inner edge pixels of a boolean mask (pixels inside with a 4-neighbour outside)."""
    p = np.pad(mask, 1, constant_values=False)
    inner = p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    return mask & ~inner


def circle_polygon(center: tuple[float, float], radius_m: float, n: int = 48) -> dict:
    lng, lat = center
    ring = []
    for k in range(n + 1):
        a = 2 * math.pi * (k % n) / n
        ring.append([round(lng + radius_m * math.cos(a) / m_per_deg_lon(lat), 6),
                     round(lat + radius_m * math.sin(a) / M_PER_DEG_LAT, 6)])
    return {"type": "Polygon", "coordinates": [ring]}


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lng1, lat1, lng2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6_371_008.8 * math.asin(math.sqrt(h))


def bbox_of(geoms: list[Any]) -> tuple[float, float, float, float]:
    bs = [as_shape(g).bounds for g in geoms]
    return (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))


def bbox_polygon(bbox: tuple[float, float, float, float]) -> dict:
    return as_geojson(box(*bbox).__geo_interface__)
