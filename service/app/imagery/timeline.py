"""Per-farm imagery time-lapse (ADR-0013 D8, CONTRACT §E.12).

1. Sentinel-2 scenes over the farm for the 13-month window (+30 days of smoother context), one per
   date, tile cloud < 95 %; 7 bands (B02 B03 B04 B08 B8A B11 SCL) on the farm grid (~10 m,
   EPSG:4326, bbox = polygon bounds + 20 m). Raw DN stacks are cached as npz under
   imagery_dir()/<farmId>/.
2. Per-pixel NDVI, SCL-masked; per-pixel weighted Whittaker (lambda 500, daily) over the usable
   scenes (polygon clear >= 0.5, not haze-spiked).
3. Frames: every observed date (polygon clear >= 0.8) + 5-day grid dates with no observed frame
   within ±2 days, up to 32 days from a clear image. Frame stats (mean/p10/p90) from native pixels
   inside the polygon: observed = clear pixels of that scene; interpolated = smoothed pixels.
4. PNGs: ndvi (all frames), rgb (observed only); ndvi_sr / rgb_sr from app.superres when available,
   DISPLAY ONLY (no statistic ever reads an SR array).
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import numpy as np

from app import config, http, provenance as prov, store
from app.models import Farm, ImageryFrame, ImageryLegend, ImageryTimeline, ImageryUrls, Portfolio

from . import ctx, render, s2, whittaker
from .geo import NATIVE_RES_M, Grid, as_shape, grid_for_polygon, polygon_mask
from .obs import OBSERVED_CLEAR, Obs, indices, mark_spikes, masks, polygon_stats, save as save_obs, split_bands
from .series import CONTEXT_DAYS, MAX_GAP_DAYS, NEAR_OBS_DAYS, grid_dates, window_start

log = logging.getLogger("clm.imagery")

SR_BUDGET_S = 60.0
#: Bump when frame/PNG logic changes: invalidates cached timelines (cache key component).
PIPELINE_VERSION = "4"
TIMELINE_KIND = "imagery_timeline"
TRUST_BASE = "All numbers come from native 10 m Sentinel-2 pixels."
COVERED_TEXT = "This orchard is under covers or nets: NDVI reads the cover, not the trees."
COVER_OFTEN_TEXT = {
    "table_grape": "Table grape orchards are often under overhead plastic or mesh. If this one is covered, NDVI reads the cover, not the vines.",
}
COVER_OFTEN_DEFAULT = "Orchards of this crop are often under covers or nets. If this one is covered, NDVI reads the cover, not the trees."
SEARCH_RADIUS_M = 2 * 3338.0  # farm-centred box that also covers every peer of any zone containing the farm


# ───────────────────────── shared helpers ─────────────────────────


def poly_key(geom: Any, grid: Grid) -> str:
    return f"{store.polygon_hash(geom)}:{grid.key}"


def farm_dir(farm_id: str) -> Path:
    return config.imagery_dir() / farm_id


def search_bbox(center: tuple[float, float], radius_m: float = SEARCH_RADIUS_M) -> tuple[float, float, float, float]:
    from .geo import M_PER_DEG_LAT, m_per_deg_lon

    lng, lat = center
    dx, dy = radius_m / m_per_deg_lon(lat), radius_m / M_PER_DEG_LAT
    # round outward to 0.01° so nearby farms share the cached STAC searches
    return (np.floor((lng - dx) * 100) / 100, np.floor((lat - dy) * 100) / 100,
            np.ceil((lng + dx) * 100) / 100, np.ceil((lat + dy) * 100) / 100)


def covered_warning(portfolio: Portfolio | None, farm: Farm) -> str | None:
    t = ctx.template(portfolio, farm)
    covered = farm.covered if farm.covered is not None else bool(t.covered_default)
    if covered:
        return COVERED_TEXT
    if farm.covered is None and t.cover_likelihood == "often":
        return COVER_OFTEN_TEXT.get(farm.crop, COVER_OFTEN_DEFAULT)
    return None


# ───────────────────────── stack ─────────────────────────


@dataclass
class Stack:
    farm_id: str
    grid: Grid
    poly_mask: np.ndarray
    items: list[s2.Item]
    arrays: dict[str, np.ndarray]  # item id -> uint16 (8, H, W)
    obs: dict[str, Obs]
    fetched_at: Any = None
    stale: bool = False
    failed: int = 0
    errors: list[str] = field(default_factory=list)
    search_errors: list[str] = field(default_factory=list)


def _npz_path(farm_id: str, grid: Grid) -> Path:
    h = hashlib.sha1(grid.key.encode()).hexdigest()[:10]
    return farm_dir(farm_id) / f"stack-{h}.npz"


def _load_npz(path: Path) -> dict[str, np.ndarray]:
    if not path.exists():
        return {}
    try:
        with np.load(path, allow_pickle=False) as z:
            ids = [str(x) for x in z["item_ids"]]
            data = z["data"]
            return {i: data[k] for k, i in enumerate(ids)}
    except Exception as e:
        log.warning("stack cache %s unreadable (%s); rebuilding", path, e)
        return {}


def _save_npz(path: Path, arrays: dict[str, np.ndarray]) -> None:
    if not arrays:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    ids = sorted(arrays)
    tmp = path.with_suffix(".tmp.npz")
    np.savez_compressed(tmp, item_ids=np.array(ids), data=np.stack([arrays[i] for i in ids]))
    tmp.replace(path)


def window_items(farm: Farm, as_of: date) -> tuple[list[s2.Item], s2.SearchResult]:
    start = window_start(as_of) - timedelta(days=CONTEXT_DAYS)
    res = s2.search(search_bbox(tuple(farm.centroid)), start, as_of)
    sel = s2.select_per_date(res.items, as_shape(farm.polygon), s2.WINDOW_MAX_CLOUD)
    return sel, res


def build_stack(farm: Farm, as_of: date) -> Stack:
    grid = grid_for_polygon(farm.polygon)
    pmask = polygon_mask(farm.polygon, grid)
    items, res = window_items(farm, as_of)
    path = _npz_path(farm.id, grid)
    cached = _load_npz(path)
    arrays = {i.id: cached[i.id] for i in items if i.id in cached}
    st = Stack(farm.id, grid, pmask, items, arrays, {}, fetched_at=res.fetched_at, stale=res.stale,
               search_errors=list(res.errors))
    missing = [i for i in items if i.id not in arrays]

    def work(item: s2.Item):
        try:
            arr, r = s2.fetch_bands(item, grid, s2.WINDOW_BANDS)
            return item, arr, r, None
        except http.FetchError as e:
            return item, None, None, e.reason
        except Exception as e:
            return item, None, None, e.__class__.__name__

    if missing:
        with ThreadPoolExecutor(max_workers=http.source_limit(s2.SOURCE), thread_name_prefix="s2win") as ex:
            for item, arr, r, err in ex.map(work, missing):
                if arr is None:
                    st.failed += 1
                    st.errors.append(f"{item.date}: {err}")
                    continue
                arrays[item.id] = arr
                st.stale = st.stale or r.stale
                if r.fetched_at and (st.fetched_at is None or r.fetched_at > st.fetched_at):
                    st.fetched_at = r.fetched_at
        _save_npz(path, arrays)

    key = poly_key(farm.polygon, grid)
    rows = []
    for it in items:
        a = arrays.get(it.id)
        if a is None:
            continue
        bd, valid = split_bands(a, s2.WINDOW_BANDS)
        p = polygon_stats(bd, valid, it.offset, pmask)
        o = Obs(date=it.date, item_id=it.id, clear_frac=round(p["clear_frac"], 4), ndvi=p["ndvi"], ndmi=p["ndmi"],
                data_px=p["data_px"], poly_px=p["poly_px"], fetched_at=st.fetched_at, stale=st.stale)
        st.obs[it.id] = o
        rows.append(o)
    mark_spikes(rows)
    try:
        save_obs(key, rows)
    except Exception as e:
        log.warning("imagery_obs save failed: %s", e)
    return st


# ───────────────────────── frames ─────────────────────────


@dataclass
class FrameData:
    date: date
    kind: str
    days_to_clear: int
    clear_fraction: float | None
    ndvi: np.ndarray  # (H, W) float over the whole bbox, NaN where no value (cloud / never clear)
    visible: np.ndarray  # (H, W) bool: inside the polygon and valid -> drawn in native PNGs
    rgbn: np.ndarray | None = None  # (4, H, W) B04,B03,B02,B08 reflectance, NaN where not clear (observed only)
    stats: tuple[float, float, float] | None = None

    @property
    def rgb_hwc(self) -> np.ndarray | None:
        return None if self.rgbn is None else np.moveaxis(self.rgbn[:3], 0, -1)


def _stats(ndvi: np.ndarray, m: np.ndarray) -> tuple[float, float, float] | None:
    v = ndvi[m & np.isfinite(ndvi)]
    if v.size == 0:
        return None
    return float(v.mean()), float(np.percentile(v, 10)), float(np.percentile(v, 90))


def compute_frames(stack: Stack, as_of: date) -> list[FrameData]:
    """Pure computation on the cached stack (no network). Stats read native polygon pixels only."""
    start = window_start(as_of)
    d0 = start - timedelta(days=CONTEXT_DAYS)
    pm = stack.poly_mask
    usable = [(it, stack.arrays[it.id]) for it in stack.items
              if it.id in stack.arrays and stack.obs.get(it.id) and stack.obs[it.id].usable]
    frames: list[FrameData] = []
    observed_dates: list[date] = []
    n_days = (as_of - d0).days + 1
    hw = pm.shape
    # every bbox pixel is smoothed (context for the display edge); stats use polygon pixels only
    y = np.full((n_days, hw[0] * hw[1]), np.nan)
    w = np.zeros((n_days, hw[0] * hw[1]))
    for it, a in usable:
        bd, valid = split_bands(a, s2.WINDOW_BANDS)
        _data, clear = masks(bd, valid)
        ndvi, _ndmi = indices(bd, it.offset)
        t = (it.date - d0).days
        if not 0 <= t < n_days:
            continue
        ok = (clear & np.isfinite(ndvi)).ravel()
        y[t, ok] = ndvi.ravel()[ok]
        w[t, ok] = 1.0
        o = stack.obs[it.id]
        if o.observed and start <= it.date <= as_of:
            good = clear & np.isfinite(ndvi)
            show = good & pm
            nd = np.where(good, ndvi, np.nan).astype(np.float32)
            rgbn = np.stack([(bd[b].astype(np.float32) - it.offset) / 10000.0 for b in ("B04", "B03", "B02", "B08")])
            rgbn[:, ~good] = np.nan
            fr = FrameData(it.date, "observed", 0, round(o.clear_frac, 3), nd, show, rgbn=rgbn)
            fr.stats = _stats(nd, show)
            if fr.stats:
                frames.append(fr)
                observed_dates.append(it.date)

    obs_ord = np.array([d.toordinal() for d in observed_dates])
    need = []
    for g in grid_dates(start, as_of):
        if obs_ord.size and np.min(np.abs(obs_ord - g.toordinal())) <= NEAR_OBS_DAYS:
            continue
        dist = int(np.min(np.abs(obs_ord - g.toordinal()))) if obs_ord.size else None
        if dist is None or dist > MAX_GAP_DAYS:
            continue
        need.append((g, dist))
    if need:
        sm = whittaker.smooth_stack(y, w)
        used = [it.date for it, _a in usable if 0 <= (it.date - d0).days < n_days]
        first, last = (min(used), max(used)) if used else (d0, as_of)
        for g, dist in need:
            gi = min(max(g, first), last)  # hold the last/first good observation (ADR-0007 D6)
            nd = np.clip(sm[(gi - d0).days], -1, 1).reshape(hw).astype(np.float32)
            show = pm & np.isfinite(nd)
            fr = FrameData(g, "interpolated", dist, None, nd, show)
            fr.stats = _stats(nd, show)
            if fr.stats:
                frames.append(fr)
    frames.sort(key=lambda f: f.date)
    return frames


# ───────────────────────── super-resolution adapter (DISPLAY ONLY) ─────────────────────────


def sr_module():
    try:
        from app import superres

        return superres
    except Exception as e:
        log.warning("app.superres unavailable: %r", e)
        return None


def _norm(res: Any, mod) -> tuple[np.ndarray, str, str | None] | None:
    """Normalise the shapes app.superres may return to (array, srKind, srModel)."""
    if isinstance(res, tuple) and len(res) == 2 and isinstance(res[1], dict):
        meta = res[1]
        kind = "ai" if meta.get("kind") == "ai" else "resampled"
        return np.asarray(res[0], np.float32), kind, (meta.get("model") if kind == "ai" else None)
    if isinstance(res, tuple):
        kind = "ai" if (len(res) > 1 and res[1] == "ai") else "resampled"
        return np.asarray(res[0], np.float32), kind, (res[2] if kind == "ai" and len(res) > 2 else None)
    return None


def sr_observed(mod, rgbn: np.ndarray) -> dict | None:
    """AI SR of an observed frame from its B04,B03,B02,B08 bands -> {'ndvi','rgb' (3,sH,sW),'kind','model'}."""
    if mod is None:
        return None
    try:
        if hasattr(mod, "super_resolve_frame"):
            r = mod.super_resolve_frame(rgbn)
            return {"ndvi": np.asarray(r["ndvi"], np.float32), "rgb": np.asarray(r["rgb"], np.float32),
                    "kind": "ai" if r.get("srKind") == "ai" else "resampled", "model": r.get("srModel")}
        out = _norm(mod.super_resolve(rgbn, scale=4), mod)
        if out is None or out[0].ndim != 3 or out[0].shape[0] != 4:
            return None
        a, k, m = out
        with np.errstate(divide="ignore", invalid="ignore"):
            nd = np.clip((a[3] - a[0]) / (a[3] + a[0]), -1, 1)
        return {"ndvi": nd.astype(np.float32), "rgb": a[:3], "kind": k, "model": m}
    except NotImplementedError:
        return None
    except Exception as e:
        log.warning("superres failed on an observed frame: %r", e)
        return None


def sr_ndvi(mod, nd: np.ndarray) -> dict | None:
    """SR of an NDVI-only (interpolated) frame. app.superres resamples it (no bands -> not AI)."""
    if mod is None:
        return None
    try:
        res = mod.upscale(nd, "ndvi") if hasattr(mod, "upscale") else mod.super_resolve(nd, scale=4)
        out = _norm(res, mod)
        if out is None or out[0].ndim != 2:
            return None
        return {"ndvi": out[0], "rgb": None, "kind": out[1], "model": out[2]}
    except NotImplementedError:
        return None
    except Exception as e:
        log.warning("superres failed on an interpolated frame: %r", e)
        return None


def _scale_of(out: np.ndarray, hw: tuple[int, int]) -> int | None:
    h, w = hw
    sh, sw = out.shape[-2:]
    if sh % h or sw % w or sh // h != sw // w or sh // h < 2:
        return None
    return sh // h


def _arr_hash(*arrs: np.ndarray) -> str:
    h = hashlib.sha1()
    for a in arrs:
        h.update(np.ascontiguousarray(a).tobytes())
    return h.hexdigest()[:16]


# ───────────────────────── timeline ─────────────────────────


def _url(farm_id: str, d: date, layer: str) -> str:
    return f"/files/imagery/{farm_id}/{d.isoformat()}_{layer}.png"


def _path(farm_id: str, d: date, layer: str) -> Path:
    return farm_dir(farm_id) / f"{d.isoformat()}_{layer}.png"


def build_timeline(portfolio: Portfolio | None, farm: Farm, sr: bool, as_of: date) -> ImageryTimeline:
    data_tier = prov.data_tier_for(portfolio.country if portfolio else "CL")
    stack = build_stack(farm, as_of)
    grid = stack.grid
    item_sig = hashlib.sha1(",".join(sorted(stack.arrays)).encode()).hexdigest()[:12]
    cache_key = f"v{PIPELINE_VERSION}:{farm.id}:{poly_key(farm.polygon, grid)}:{as_of}:{int(bool(sr))}:{item_sig}:{data_tier}:{covered_warning(portfolio, farm) or ''}"
    try:
        hit = store.assessment_get(TIMELINE_KIND, cache_key)
    except Exception:
        hit = None
    if hit and all(_exists(u) for f in hit["frames"] for u in f["urls"].values() if u):
        return ImageryTimeline.model_validate(hit)

    frames = compute_frames(stack, as_of)
    srmod = sr_module() if sr else None
    sr_index_path = farm_dir(farm.id) / "sr_index.json"
    try:
        sr_index = json.loads(sr_index_path.read_text()) if sr_index_path.exists() else {}
    except Exception:
        sr_index = {}
    sr_deadline = time.monotonic() + SR_BUDGET_S
    sr_done: dict[date, dict] = {}
    sr_scale = None
    if srmod is not None and frames:
        latest_obs = [f for f in frames if f.kind == "observed"][-1:]
        first_ids = {id(f) for f in latest_obs}
        order = latest_obs + [f for f in reversed(frames) if id(f) not in first_ids]
        for f in order:
            if time.monotonic() > sr_deadline and sr_done:
                break
            res = _sr_frame(srmod, farm, f, grid, sr_index)
            if res is None:
                if not sr_done:
                    break  # SR unavailable: do not try every frame
                continue
            sr_done[f.date] = res
            sr_scale = sr_scale or res["scale"]
        try:
            sr_index_path.parent.mkdir(parents=True, exist_ok=True)
            sr_index_path.write_text(json.dumps(sr_index))
        except Exception:
            pass

    out_frames: list[ImageryFrame] = []
    for f in frames:
        render.ndvi_png(_path(farm.id, f.date, "ndvi"), f.ndvi, f.visible)
        urls = ImageryUrls(ndvi=_url(farm.id, f.date, "ndvi"))
        if f.rgbn is not None:
            render.rgb_png(_path(farm.id, f.date, "rgb"), f.rgb_hwc, f.visible)
            urls.rgb = _url(farm.id, f.date, "rgb")
        srr = sr_done.get(f.date)
        if srr:
            urls.ndvi_sr = _url(farm.id, f.date, "ndvi_sr")
            if srr.get("rgb"):
                urls.rgb_sr = _url(farm.id, f.date, "rgb_sr")
        mean, p10, p90 = f.stats
        out_frames.append(ImageryFrame(
            date=f.date.isoformat(), kind=f.kind, days_to_clear=f.days_to_clear,
            clear_fraction=f.clear_fraction, ndvi_mean=round(mean, 3), ndvi_p10=round(p10, 3), ndvi_p90=round(p90, 3),
            urls=urls, sr_kind=srr["kind"] if srr else None, sr_model=srr["model"] if srr else None))

    kinds = {s["kind"] for s in sr_done.values()}
    if "ai" in kinds:
        trust = TRUST_BASE + (" AI-enhanced images are for display only." if kinds == {"ai"} else
                              " AI-enhanced images (observed dates) and resampled images (interpolated dates, not AI) "
                              "are for display only.")
    elif "resampled" in kinds:
        trust = TRUST_BASE + " Sharper images are resampled, not AI, and are for display only."
    else:
        trust = TRUST_BASE + " No enhanced images in this timeline."

    n_obs = sum(1 for f in out_frames if f.kind == "observed")
    n_int = len(out_frames) - n_obs
    usable = sum(1 for o in stack.obs.values() if o.usable)
    notes = [f"{len(stack.items)} Sentinel-2 scenes in the window (tile cloud < {s2.WINDOW_MAX_CLOUD:.0f} %), {usable} usable "
             f"(polygon clear >= 0.5), {n_obs} observed frames (clear >= {OBSERVED_CLEAR}), {n_int} interpolated "
             f"(per-pixel Whittaker, lambda {whittaker.LAMBDA:.0f}, <= {MAX_GAP_DAYS} days from a clear image). "
             f"NDVI = (B08-B04)/(B08+B04) on native 10 m pixels; enhanced images are display only."]
    if stack.failed:
        notes.append(f"{stack.failed} scene(s) could not be fetched and were skipped")
    notes.extend(stack.search_errors[:3])
    latest_obs = max((f.date for f in out_frames if f.kind == "observed"), default=None)
    if not stack.items and stack.search_errors:
        p = prov.unavailable(s2.SOURCE, "; ".join(stack.search_errors[:2]), data_tier=data_tier)
    else:
        p = prov.build(s2.SOURCE, observed_at=latest_obs, fetched_at=stack.fetched_at, stale=stack.stale,
                       note="; ".join(notes), data_tier=data_tier, resolution="10 m")
    tl = ImageryTimeline(
        farm_id=farm.id, bbox=grid.bbox, crs="EPSG:4326", native_resolution_m=NATIVE_RES_M,
        sr_resolution_m=(round(NATIVE_RES_M / sr_scale, 2) if sr_scale else None),
        frames=out_frames, legend=ImageryLegend(**render.LEGEND),
        covered_warning=covered_warning(portfolio, farm), trust_note=trust, provenance=p)
    try:
        if out_frames:
            store.assessment_put(TIMELINE_KIND, cache_key, tl)
    except Exception as e:
        log.warning("timeline cache write failed: %s", e)
    return tl


def _exists(url: str) -> bool:
    rel = url[len("/files/"):] if url.startswith("/files/") else url
    return (config.files_dir() / rel).exists()


def _sr_frame(srmod, farm: Farm, f: FrameData, grid: Grid, index: dict) -> dict | None:
    """SR for one frame; writes ndvi_sr (and rgb_sr for observed frames). DISPLAY ONLY: the arrays are
    rendered and dropped. Reuses PNGs whose input hash is unchanged. Returns {kind, model, scale, rgb}."""
    src = f.rgbn if f.rgbn is not None else f.ndvi
    h = _arr_hash(src)
    key = f"{f.date}_sr"
    rec = index.get(key)
    p_nd, p_rgb = _path(farm.id, f.date, "ndvi_sr"), _path(farm.id, f.date, "rgb_sr")
    if rec and rec.get("hash") == h and p_nd.exists() and (not rec.get("rgb") or p_rgb.exists()):
        return {k: rec[k] for k in ("kind", "model", "scale", "rgb")}
    r = sr_observed(srmod, f.rgbn) if f.rgbn is not None else sr_ndvi(srmod, f.ndvi)
    if r is None:
        return None
    scale = _scale_of(r["ndvi"], f.ndvi.shape)
    if scale is None:
        log.warning("superres returned shape %s for %s; ignored", r["ndvi"].shape, f.ndvi.shape)
        return None
    pm_s = polygon_mask(farm.polygon, grid, scale)
    render.ndvi_png(p_nd, r["ndvi"], pm_s & np.isfinite(r["ndvi"]), pm_s)
    has_rgb = False
    if r.get("rgb") is not None and _scale_of(r["rgb"], f.ndvi.shape) == scale:
        rgb = np.moveaxis(r["rgb"], 0, -1)
        render.rgb_png(p_rgb, rgb, pm_s & np.all(np.isfinite(rgb), axis=-1), pm_s)
        has_rgb = True
    out = {"kind": r["kind"], "model": r["model"], "scale": scale, "rgb": has_rgb}
    index[key] = {"hash": h, **out}
    return out
