"""PNG rendering (CONTRACT §E.12): RGBA, north-up, EPSG:4326 grid exactly covering the bbox, pixels
outside the polygon (and non-clear pixels of observed frames) transparent.

- NDVI: fixed colormap = LEGEND stops (rdylgn, 0 -> #a50026 ... 1 -> #006837), linear between stops,
  values below 0 / above 1 clamp to the end colours.
- True colour: B04/B03/B02 surface reflectance with ONE fixed stretch for every frame (so the
  time-lapse does not flicker): v = clip(refl / 0.20, 0, 1) ** (1 / 1.5).
- Native PNGs carry no outline (an outline pixel would sit on data or outside the polygon, which
  must be transparent); SR PNGs get a thin 1-px outline on the polygon's inner edge, which at 4x is
  ~2.5 m and covers no native pixel.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from .geo import outline_mask

LEGEND_STOPS: list[tuple[float, str]] = [
    (0.0, "#a50026"), (0.2, "#f46d43"), (0.4, "#fee08b"), (0.6, "#a6d96a"), (0.8, "#1a9850"), (1.0, "#006837"),
]
LEGEND = {"min": 0.0, "max": 1.0, "colormap": "rdylgn", "stops": [[v, c] for v, c in LEGEND_STOPS]}
RGB_MAX_REFL = 0.20
RGB_GAMMA = 1.5
OUTLINE_RGBA = (255, 255, 255, 230)


def _hex(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


_XS = np.array([s[0] for s in LEGEND_STOPS])
_CS = np.array([_hex(s[1]) for s in LEGEND_STOPS], dtype=float)


def ndvi_colors(ndvi: np.ndarray) -> np.ndarray:
    """(H, W) float -> (H, W, 3) uint8 via the legend stops (linear between stops)."""
    v = np.clip(np.nan_to_num(ndvi, nan=0.0), 0.0, 1.0)
    out = np.empty(v.shape + (3,), dtype=float)
    for k in range(3):
        out[..., k] = np.interp(v, _XS, _CS[:, k])
    return np.round(out).astype(np.uint8)


def rgb_colors(refl_rgb: np.ndarray) -> np.ndarray:
    """(H, W, 3) reflectance -> uint8 with the fixed stretch."""
    v = np.clip(np.nan_to_num(refl_rgb, nan=0.0) / RGB_MAX_REFL, 0.0, 1.0) ** (1.0 / RGB_GAMMA)
    return np.round(v * 255).astype(np.uint8)


def rgba(colors: np.ndarray, visible: np.ndarray, outline: np.ndarray | None = None) -> np.ndarray:
    h, w = visible.shape
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., :3] = colors
    out[..., 3] = np.where(visible, 255, 0).astype(np.uint8)
    if outline is not None:
        out[outline] = OUTLINE_RGBA
    return out


def write_png(path: Path, rgba_arr: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.png")
    Image.fromarray(rgba_arr, "RGBA").save(tmp, optimize=False)
    tmp.replace(path)


def ndvi_png(path: Path, ndvi: np.ndarray, visible: np.ndarray, poly_mask_for_outline: np.ndarray | None = None) -> None:
    outline = outline_mask(poly_mask_for_outline) if poly_mask_for_outline is not None else None
    write_png(path, rgba(ndvi_colors(ndvi), visible & np.isfinite(ndvi), outline))


def rgb_png(path: Path, refl_rgb: np.ndarray, visible: np.ndarray, poly_mask_for_outline: np.ndarray | None = None) -> None:
    outline = outline_mask(poly_mask_for_outline) if poly_mask_for_outline is not None else None
    write_png(path, rgba(rgb_colors(refl_rgb), visible & np.all(np.isfinite(refl_rgb), axis=-1), outline))
