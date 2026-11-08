"""Time-boxed evaluation of SEN2SRLite RGBN x4 on real Chilean orchard chips (ADR-0013 D8).

Usage (from service/):
    .venv/bin/python -m app.superres.eval_superres <chip.npz> [<chip.npz> ...]

Each chip .npz holds `rgbn` (4,256,256) B04,B03,B02,B08 reflectance (NaN = nodata), `item`, `crs`,
`transform` (affine, 6 numbers) and `polygon` (GeoJSON geometry, EPSG:4326) or `lonlat`. The chips were
fetched from Sentinel-2 L2A on Planetary Computer (signed COGs, honest User-Agent, one item per chip).

Writes to service/data/files/superres_eval/:
    <site>_rgb_compare.png   native (nearest x4) | Lanczos x4 | SEN2SR x4, full chip + zoom on the orchard
    <site>_ndvi_compare.png  same for NDVI (rdylgn legend from the contract)
    <site>_<variant>.png     individual images
    metrics.json             timings (MPS/CPU), 10 m consistency, sharpness, NDVI-in-polygon native vs SR
Everything here is display evaluation; the NDVI comparison shows why SR pixels never feed metrics.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from app import config
import app.superres as sr

STOPS = [(0.0, "#a50026"), (0.2, "#f46d43"), (0.4, "#fee08b"), (0.6, "#a6d96a"), (0.8, "#1a9850"), (1.0, "#006837")]


def out_dir() -> Path:
    d = config.files_dir() / "superres_eval"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _hex(c: str) -> np.ndarray:
    return np.array([int(c[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)


def ndvi_rgba(v: np.ndarray) -> np.ndarray:
    xs = np.array([s[0] for s in STOPS]); cols = np.stack([_hex(s[1]) for s in STOPS])
    x = np.clip(np.nan_to_num(v, nan=0.0), 0, 1)
    rgb = np.stack([np.interp(x, xs, cols[:, k]) for k in range(3)], axis=-1)
    a = np.where(np.isfinite(v), 255, 0)
    return np.dstack([rgb, a]).astype(np.uint8)


def rgb_rgba(rgb: np.ndarray, gain: float = 3.5) -> np.ndarray:
    x = np.clip(np.nan_to_num(rgb.transpose(1, 2, 0), nan=0.0) * gain, 0, 1) ** (1 / 1.4)
    a = np.where(np.isfinite(rgb).all(axis=0), 255, 0)
    return np.dstack([(x * 255).astype(np.uint8), a]).astype(np.uint8)


def nearest(a: np.ndarray, s: int = sr.SCALE) -> np.ndarray:
    return np.repeat(np.repeat(a, s, axis=-2), s, axis=-1)


def grad_energy(a: np.ndarray) -> float:
    gy, gx = np.gradient(np.nan_to_num(a))
    return float(np.mean(np.hypot(gx, gy)))


def polygon_mask(d, shape) -> np.ndarray | None:
    if "polygon" not in d.files:
        return None
    from affine import Affine
    from pyproj import Transformer
    from rasterio.features import geometry_mask
    from shapely.geometry import mapping, shape as shp
    from shapely.ops import transform as stx

    g = shp(json.loads(str(d["polygon"])))
    tr = Transformer.from_crs("EPSG:4326", str(d["crs"]), always_xy=True).transform
    t = Affine(*[float(v) for v in d["transform"]])
    return ~geometry_mask([mapping(stx(tr, g))], out_shape=shape, transform=t)


def time_device(x: np.ndarray, device: str, runs: int = 3) -> dict:
    os.environ["CLM_SR_DEVICE"] = device
    sr.reset_for_tests()
    t0 = time.perf_counter(); sr.warm(); load = time.perf_counter() - t0
    ts = []
    out = None
    for _ in range(runs):
        with sr._cache_lock:
            sr._cache.clear()
        out, meta = sr.upscale(x, "rgbn")
        ts.append(meta["seconds"])
    return {"device": sr._state["device"], "kind": meta["kind"], "load_s": round(load, 2),
            "first_s": ts[0], "warm_s": round(min(ts[1:]), 3), "out": out}


def compose(panels: list[tuple[str, np.ndarray]], path: Path) -> None:
    h = max(p.shape[0] for _, p in panels); w = sum(p.shape[1] for _, p in panels) + 8 * (len(panels) - 1)
    canvas = Image.new("RGBA", (w, h + 22), (255, 255, 255, 255))
    dr = ImageDraw.Draw(canvas); x = 0
    for title, p in panels:
        canvas.paste(Image.fromarray(p, "RGBA"), (x, 22))
        dr.text((x + 4, 5), title, fill=(30, 30, 30, 255))
        x += p.shape[1] + 8
    canvas.save(path)


def evaluate(chip: Path) -> dict:
    d = np.load(chip, allow_pickle=False)
    x = d["rgbn"].astype(np.float32)
    site = chip.stem.replace("chip_", "")
    od = out_dir()

    timing = {dev: {k: v for k, v in time_device(x, dev).items() if k != "out"} for dev in ("cpu", "mps")}
    os.environ["CLM_SR_DEVICE"] = "auto"; sr.reset_for_tests()
    ai, meta = sr.upscale(x, "rgbn")
    os.environ["CLM_SR_DISABLE"] = "1"
    lz, lmeta = sr.upscale(x, "rgbn")
    os.environ.pop("CLM_SR_DISABLE")
    assert meta["kind"] == "ai" and lmeta["kind"] == "resampled"

    nd_native = sr.ndvi_from_rgbn(x)
    nd_ai = sr.ndvi_from_rgbn(ai)
    nd_lz = sr.ndvi_from_rgbn(lz)

    def down(a):  # area-average 2.5 m -> 10 m
        c = a.shape[0]
        return a.reshape(c, a.shape[1] // 4, 4, a.shape[2] // 4, 4).mean(axis=(2, 4))

    m = {"site": site, "item": str(d["item"]), "shape_in": list(x.shape), "shape_out": list(ai.shape), "timing": timing,
         "consistency_10m_mae": {"ai": [round(float(v), 5) for v in np.nanmean(np.abs(down(ai) - x), axis=(1, 2))],
                                 "lanczos": [round(float(v), 5) for v in np.nanmean(np.abs(down(lz) - x), axis=(1, 2))]},
         "mean_reflectance_lr": [round(float(v), 4) for v in np.nanmean(x, axis=(1, 2))],
         "sharpness_nir_grad": {"native_nearest": round(grad_energy(nearest(x[3])), 5),
                                "lanczos": round(grad_energy(lz[3]), 5), "ai": round(grad_energy(ai[3]), 5)},
         "mps_vs_cpu_max_abs": None}
    pm = polygon_mask(d, x.shape[1:])
    if pm is not None and pm.any():
        pm_up = nearest(pm.astype(np.uint8)).astype(bool)
        m["ndvi_in_polygon"] = {
            "pixels_native": int(pm.sum()),
            "native_mean": round(float(np.nanmean(nd_native[pm])), 4),
            "ai_mean": round(float(np.nanmean(nd_ai[pm_up])), 4),
            "lanczos_mean": round(float(np.nanmean(nd_lz[pm_up])), 4),
            "native_p10_p90": [round(float(v), 4) for v in np.nanpercentile(nd_native[pm], [10, 90])],
            "ai_p10_p90": [round(float(v), 4) for v in np.nanpercentile(nd_ai[pm_up], [10, 90])],
        }
    # MPS vs CPU numerical agreement
    os.environ["CLM_SR_DEVICE"] = "cpu"; sr.reset_for_tests(); a_cpu, _ = sr.upscale(x, "rgbn")
    os.environ["CLM_SR_DEVICE"] = "mps"; sr.reset_for_tests(); a_mps, mm = sr.upscale(x, "rgbn")
    if mm["device"] == "mps":
        m["mps_vs_cpu_max_abs"] = float(np.nanmax(np.abs(a_cpu - a_mps)))
    os.environ["CLM_SR_DEVICE"] = "auto"; sr.reset_for_tests()

    # images: full chip and a 64 px (640 m) zoom centred on the polygon (or the chip centre)
    if pm is not None and pm.any():
        rr, cc = np.nonzero(pm); cy, cx = int(rr.mean()), int(cc.mean())
    else:
        cy, cx = x.shape[1] // 2, x.shape[2] // 2
    z = 32
    y0, x0 = max(0, min(cy - z, x.shape[1] - 2 * z)), max(0, min(cx - z, x.shape[2] - 2 * z))
    zs = (slice(y0 * 4, (y0 + 2 * z) * 4), slice(x0 * 4, (x0 + 2 * z) * 4))

    variants = {"native": (nearest(x[:3]), nearest(nd_native)), "lanczos": (lz[:3], nd_lz), "sen2sr": (ai[:3], nd_ai)}
    for name, (rgb, nd) in variants.items():
        Image.fromarray(rgb_rgba(rgb), "RGBA").save(od / f"{site}_rgb_{name}.png")
        Image.fromarray(ndvi_rgba(nd), "RGBA").save(od / f"{site}_ndvi_{name}.png")
    labels = {"native": "Native 10 m (pixelated)", "lanczos": "Resampled, not AI (Lanczos x4)", "sen2sr": "AI-enhanced (SEN2SRLite x4)"}
    for layer, idx, fn in (("rgb", 0, rgb_rgba), ("ndvi", 1, ndvi_rgba)):
        full = [(labels[k] + " - 2.56 km", np.asarray(Image.fromarray(fn(v[idx]), "RGBA").resize((512, 512), Image.Resampling.BOX)))
                for k, v in variants.items()]
        zoom = [(labels[k] + " - zoom 640 m", fn(v[idx][..., zs[0], zs[1]])) for k, v in variants.items()]
        compose(full, od / f"{site}_{layer}_compare_full.png")
        compose(zoom, od / f"{site}_{layer}_compare_zoom.png")
    return m


def main(argv: list[str]) -> None:
    results = [evaluate(Path(p)) for p in argv]
    (out_dir() / "metrics.json").write_text(json.dumps(results, indent=1))
    print(json.dumps(results, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
