"""svc-superres: AI super-resolution of Sentinel-2 imagery, DISPLAY ONLY (ADR-0013 D8, CONTRACT §E.12).

TRUST RULE — read this before calling anything here
----------------------------------------------------
Every metric in this service (NDVI/NDMI values and scores, anomalies, z, peers, risk, water status, frame
ndviMean/P10/P90) is computed from NATIVE 10 m Sentinel-2 pixels. Arrays returned by this module are
pictures: they exist only to be rendered into the *Sr PNGs (``ndviSr``, ``rgbSr``) and must never be read
back by any computation, aggregated, cached as a metric, or written to a metric table. They are labelled:
``meta['kind'] == 'ai'`` -> UI label "AI-enhanced"; ``'resampled'`` -> "Resampled, not AI".
``meta['display_only']`` is always True.

Model (chosen by the time-boxed eval, see service/data/files/superres_eval/eval.md)
----------------------------------------------------------------------------------
SEN2SRLite ``NonReference_RGBN_x4`` (ESA OpenSR / IPL-UV, Aybar et al.): a 472 k-parameter CNN (SPAN) trained
on SEN2NAIPv2, 10 m -> 2.5 m on the four 10 m bands, followed by a low-pass "hard constraint" that keeps the
super-resolved image consistent with the original at 10 m. Code ``sen2sr`` 0.8.5 (LICENSE file: CC0-1.0;
PyPI badge says MIT), weights ``tacofoundation/sen2sr`` on Hugging Face (model card: ``license: cc0-1.0``).
Weights are vendored next to this file (``weights/SEN2SRLite_NonReference_RGBN_x4``, ~3.4 MB) so the demo
needs no network. The model is built directly from the ``sen2sr`` classes; the downloaded ``load.py`` is
never executed.

Inputs (kind describes the array you pass in)
---------------------------------------------
- ``'rgbn'``: float array (4, H, W), bands in order **B04, B03, B02, B08**, surface reflectance in 0..~1
  (L2A DN minus the 1000 offset when processing baseline >= 04.00, then / 10000). NaN = no data.
  -> AI path (4, 4H, 4W) reflectance, or Lanczos fallback.
- ``'ndvi'``: float array (H, W). The model needs bands, so this is always Lanczos ``'resampled'``
  (e.g. interpolated frames, which only have NDVI). For an AI NDVI picture of an observed frame, upscale
  its ``'rgbn'`` bands and use :func:`ndvi_from_rgbn` on the result.
- ``'rgb'``: float array (3, H, W) (B04, B03, B02). No NIR -> always Lanczos ``'resampled'``.

NaN pixels stay NaN in the output (mask upsampled by nearest neighbour), so polygon clipping / transparency
survives. Inputs are never mutated. Results are cached in memory (LRU, keyed by array bytes + kind; at most 64 entries and 256 MB).

Environment knobs: ``CLM_SR_DISABLE=1`` forces the fallback; ``CLM_SR_DEVICE`` = ``auto`` (default: MPS when it
works, else CPU) | ``mps`` | ``cpu``; ``CLM_SR_WEIGHTS_DIR`` overrides the weights folder.
"""

from __future__ import annotations

import hashlib
import importlib.util
import logging
import os
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

SCALE = 4
NATIVE_RESOLUTION_M = 10.0
SR_RESOLUTION_M = NATIVE_RESOLUTION_M / SCALE  # 2.5 -> ImageryTimeline.srResolutionM
MODEL_NAME = "SEN2SRLite_NonReference_RGBN_x4"
#: Value for ImageryFrame.srModel / Health.srModel when the AI path is active.
MODEL_ID = f"sen2sr/{MODEL_NAME}"
MODEL_LICENCE = "CC0-1.0 (weights: Hugging Face tacofoundation/sen2sr; code: sen2sr 0.8.5)"
RESAMPLED_LABEL = "lanczos"
TILE = 128  # the hard-constraint mask is fixed at 512x512 output -> 128x128 input
OVERLAP = 32
KINDS = ("rgbn", "ndvi", "rgb")
_CACHE_MAX = 64
_CACHE_MAX_BYTES = 256 * 1024 * 1024  # a 256² RGBN chip at x4 is ~17 MB

_lock = threading.Lock()
_state: dict[str, Any] = {"model": None, "device": None, "error": None, "attempted": False, "load_s": None}
_cache: OrderedDict[str, tuple[np.ndarray, dict[str, Any]]] = OrderedDict()
_cache_lock = threading.Lock()
_infer_lock = threading.Lock()  # one inference at a time (FastAPI threadpool + a shared MPS model)


# ───────────────────────────── availability / status ─────────────────────────────


def weights_dir() -> Path:
    v = os.environ.get("CLM_SR_WEIGHTS_DIR")
    return Path(v).expanduser() if v else Path(__file__).resolve().parent / "weights" / MODEL_NAME


def _disabled() -> bool:
    return os.environ.get("CLM_SR_DISABLE", "").strip().lower() in ("1", "true", "yes")


def _unavailable_reason() -> str | None:
    """Cheap check (no torch import, no network): why the AI path cannot run, or None if it should."""
    if _disabled():
        return "disabled by CLM_SR_DISABLE"
    if _state["error"]:
        return _state["error"]
    if importlib.util.find_spec("sen2sr") is None or importlib.util.find_spec("torch") is None:
        return "sen2sr/torch not installed"
    w = weights_dir()
    if not (w / "model.safetensor").is_file() or not (w / "hard_constraint.safetensor").is_file():
        return f"weights missing in {w.name}"
    return None


def status() -> tuple[str, str | None]:
    """(srMode, srModel) for GET /health. Cheap: never loads the model, never touches the network.
    Reports 'ai' when the model is loaded or loadable (package + weights on disk, no earlier load failure)."""
    if _unavailable_reason() is None:
        return ("ai", MODEL_ID)
    return ("resampled", None)


def info() -> dict[str, Any]:
    """Diagnostics (no load): mode, model, licence, device, load time, reason for fallback."""
    mode, model = status()
    return {"mode": mode, "model": model, "licence": MODEL_LICENCE if model else None, "scale": SCALE,
            "srResolutionM": SR_RESOLUTION_M, "device": _state["device"], "loaded": _state["model"] is not None,
            "loadSeconds": _state["load_s"], "reason": _unavailable_reason()}


# ───────────────────────────── model loading ─────────────────────────────


def _pick_devices() -> list[str]:
    want = os.environ.get("CLM_SR_DEVICE", "auto").strip().lower()
    if want == "cpu":
        return ["cpu"]
    import torch

    mps = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    if want == "mps":
        return ["mps", "cpu"] if mps else ["cpu"]
    return ["mps", "cpu"] if mps else ["cpu"]


def _build(device: str):
    import safetensors.torch
    import torch
    from sen2sr.models.opensr_baseline.cnn import CNNSR
    from sen2sr.models.tricks import HardConstraint
    from sen2sr.nonreference import srmodel

    w = weights_dir()
    net = CNNSR(4, 4, 24, 4, True, False, 6)  # same constructor as the published load.py for this variant
    net.load_state_dict(safetensors.torch.load_file(str(w / "model.safetensor")))
    net = net.eval().to(device)
    for p in net.parameters():
        p.requires_grad = False
    hc_w = safetensors.torch.load_file(str(w / "hard_constraint.safetensor"))["weights"].to(device)
    model = srmodel(net, HardConstraint(low_pass_mask=hc_w, device=device), device).eval()
    # Smoke test on this device (MPS can fail on an unsupported op only at run time).
    with torch.inference_mode():
        out = model(torch.full((1, 4, TILE, TILE), 0.1, dtype=torch.float32, device=device))
    if tuple(out.shape) != (1, 4, TILE * SCALE, TILE * SCALE) or not torch.isfinite(out).all():
        raise RuntimeError(f"smoke test failed on {device}: shape {tuple(out.shape)}")
    return model


def _load_model():
    """Lazy, thread-safe, at most one attempt per process (reset_for_tests() clears it)."""
    if _disabled():
        return None
    if _state["model"] is not None:
        return _state["model"]
    with _lock:
        if _state["model"] is not None:
            return _state["model"]
        if _state["attempted"] and _state["error"]:
            return None
        reason = _unavailable_reason()
        if reason:
            return None
        _state["attempted"] = True
        t0 = time.perf_counter()
        errors = []
        try:
            devices = _pick_devices()
        except Exception as exc:  # torch import failure
            devices, errors = [], [f"torch: {exc!r}"[:200]]
        for dev in devices:
            try:
                _state["model"] = _build(dev)
                _state["device"] = dev
                _state["load_s"] = round(time.perf_counter() - t0, 2)
                log.info("superres: %s loaded on %s in %.2fs", MODEL_ID, dev, _state["load_s"])
                return _state["model"]
            except Exception as exc:
                errors.append(f"{dev}: {exc!r}"[:200])
        _state["error"] = "model load failed (" + "; ".join(errors) + ")"
        log.warning("superres: %s; using Lanczos resampling", _state["error"])
        return None


def warm() -> dict[str, Any]:
    """Load the model now (call from service startup in a background thread). Never raises."""
    try:
        _load_model()
    except Exception as exc:  # pragma: no cover - defensive
        _state["error"] = f"warm failed: {exc!r}"[:200]
    return info()


def reset_for_tests() -> None:
    with _lock:
        _state.update(model=None, device=None, error=None, attempted=False, load_s=None)
    with _cache_lock:
        _cache.clear()


# ───────────────────────────── array helpers ─────────────────────────────


def _as_chw(array: Any, kind: str) -> np.ndarray:
    a = np.asarray(array, dtype=np.float32)
    if kind == "ndvi":
        if a.ndim != 2:
            raise ValueError(f"kind 'ndvi' needs a 2-D (H, W) array, got shape {a.shape}")
        return a[None]
    want = 4 if kind == "rgbn" else 3
    if a.ndim != 3 or a.shape[0] != want:
        raise ValueError(f"kind '{kind}' needs a ({want}, H, W) array, got shape {a.shape}")
    return a


def _fill_nan(a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return (filled copy, nodata mask (H, W)). NaN/inf -> per-band mean of valid pixels (0 if none)."""
    bad = ~np.isfinite(a)
    mask = bad.any(axis=0)
    out = a.copy()
    if bad.any():
        for i in range(out.shape[0]):
            v = out[i][~bad[i]]
            out[i][bad[i]] = float(v.mean()) if v.size else 0.0
    return out, mask


def _apply_mask(out: np.ndarray, mask: np.ndarray) -> np.ndarray:
    if mask.any():
        up = np.repeat(np.repeat(mask, SCALE, axis=0), SCALE, axis=1)
        out[:, up] = np.nan
    return out


def _lanczos(a: np.ndarray) -> np.ndarray:
    from PIL import Image

    c, h, w = a.shape
    out = np.empty((c, h * SCALE, w * SCALE), dtype=np.float32)
    for i in range(c):
        im = Image.fromarray(np.ascontiguousarray(a[i]), mode="F")
        out[i] = np.asarray(im.resize((w * SCALE, h * SCALE), Image.Resampling.LANCZOS), dtype=np.float32)
    return out


def _tile_starts(n: int) -> list[int]:
    if n <= TILE:
        return [0]
    stride = TILE - OVERLAP
    starts = list(range(0, n - TILE, stride))
    starts.append(n - TILE)
    return sorted(set(starts))


def _model_upscale(model, a: np.ndarray) -> np.ndarray:
    """a: (4, H, W) finite reflectance. Tiles of 128 with 32 px overlap, feathered blend, batched."""
    import torch

    _, h, w = a.shape
    ph, pw = max(h, TILE), max(w, TILE)
    if (ph, pw) != (h, w):  # small farm chip: pad (edge) to one tile, crop after
        a = np.pad(a, ((0, 0), (0, ph - h), (0, pw - w)), mode="edge")
    ys, xs = _tile_starts(ph), _tile_starts(pw)
    coords = [(y, x) for y in ys for x in xs]
    tiles = np.stack([a[:, y:y + TILE, x:x + TILE] for y, x in coords])
    S, T = SCALE, TILE * SCALE
    ramp = np.minimum(np.arange(T) + 1, T - np.arange(T)).astype(np.float32)
    ramp = np.minimum(ramp / (OVERLAP * S / 2), 1.0)
    wt = np.outer(ramp, ramp)
    acc = np.zeros((4, ph * S, pw * S), dtype=np.float32)
    norm = np.zeros((ph * S, pw * S), dtype=np.float32)
    device = _state["device"] or "cpu"
    with _infer_lock, torch.inference_mode():
        for b in range(0, len(tiles), 8):
            x = torch.from_numpy(np.ascontiguousarray(tiles[b:b + 8])).to(device)
            y = model(x).float().cpu().numpy()
            for k, (ty, tx) in enumerate(coords[b:b + 8]):
                acc[:, ty * S:ty * S + T, tx * S:tx * S + T] += y[k] * wt
                norm[ty * S:ty * S + T, tx * S:tx * S + T] += wt
    out = acc / np.maximum(norm, 1e-6)
    return np.ascontiguousarray(out[:, :h * S, :w * S])


def cache_bytes() -> int:
    return sum(v[0].nbytes for v in _cache.values())


def ndvi_from_rgbn(rgbn: np.ndarray) -> np.ndarray:
    """NDVI picture from a (4, H, W) B04,B03,B02,B08 reflectance array (e.g. an upscale() result).
    DISPLAY ONLY when applied to SR output: never use it as a metric."""
    r, n = rgbn[0].astype(np.float32), rgbn[3].astype(np.float32)
    with np.errstate(divide="ignore", invalid="ignore"):
        v = (n - r) / (n + r)
    v[~np.isfinite(v)] = np.nan
    return np.clip(v, -1.0, 1.0)


# ───────────────────────────── public API ─────────────────────────────


def upscale(array: Any, kind: str) -> tuple[np.ndarray, dict[str, Any]]:
    """Upscale a native 10 m array x4 (to ~2.5 m) FOR DISPLAY ONLY.

    Returns (array, meta). meta = {model, scale, kind 'ai'|'resampled', input_kind, resolution_m,
    display_only=True, device, reason (why resampled, else None), seconds, cached}.
    Output shape: same leading dims as the input kind ((4|3, 4H, 4W) or (4H, 4W) for 'ndvi'), float32.
    Never raises because the model is missing or fails: it falls back to Lanczos and says why.
    """
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}, got {kind!r}")
    a = _as_chw(array, kind)
    key = hashlib.sha1(a.tobytes() + f"|{kind}|{a.shape}|{_disabled()}".encode()).hexdigest()
    with _cache_lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
            return hit[0].copy(), {**hit[1], "cached": True}

    t0 = time.perf_counter()
    filled, mask = _fill_nan(a)
    out = None
    reason = None
    if kind == "rgbn":
        model = _load_model()
        if model is None:
            reason = _unavailable_reason() or "model unavailable"
        else:
            try:
                out = _model_upscale(model, filled)
                if not np.isfinite(out).all():
                    raise RuntimeError("non-finite model output")
                # the Fourier hard constraint can ring slightly below 0 next to sharp edges; reflectance >= 0
                np.maximum(out, 0.0, out=out)
            except Exception as exc:
                reason = f"model inference failed: {exc!r}"[:200]
                log.warning("superres: %s; using Lanczos for this array", reason)
                out = None
    else:
        reason = "model needs RGBN bands; this input is resampled"

    if out is None:
        out = _lanczos(filled)
        meta = {"model": RESAMPLED_LABEL, "kind": "resampled", "device": None, "reason": reason}
    else:
        meta = {"model": MODEL_ID, "kind": "ai", "device": _state["device"], "reason": None}
    out = _apply_mask(out, mask)
    if kind == "ndvi":
        out = np.clip(out[0], -1.0, 1.0)
    meta.update(scale=SCALE, input_kind=kind, resolution_m=SR_RESOLUTION_M, display_only=True,
                seconds=round(time.perf_counter() - t0, 3), cached=False)
    with _cache_lock:
        _cache[key] = (out, meta)
        while len(_cache) > 1 and (len(_cache) > _CACHE_MAX or cache_bytes() > _CACHE_MAX_BYTES):
            _cache.popitem(last=False)
    return out.copy(), dict(meta)


def super_resolve(image: Any, scale: int = 4) -> tuple[np.ndarray, str, str | None]:
    """Foundation-placeholder signature, kept for callers: (array, srKind 'ai'|'resampled', srModel).
    Kind is inferred from the shape: (4,H,W) -> 'rgbn', (3,H,W) -> 'rgb', (H,W) -> 'ndvi'.
    srModel is the model id for 'ai' and None for 'resampled' (contract: srModel only when srKind='ai')."""
    if scale != SCALE:
        raise ValueError(f"only scale={SCALE} is supported")
    a = np.asarray(image)
    kind = "ndvi" if a.ndim == 2 else {4: "rgbn", 3: "rgb"}.get(a.shape[0] if a.ndim == 3 else -1)
    if kind is None:
        raise ValueError(f"cannot infer kind from shape {a.shape}")
    out, meta = upscale(a, kind)
    return out, meta["kind"], (meta["model"] if meta["kind"] == "ai" else None)


def super_resolve_frame(rgbn: Any) -> dict[str, Any]:
    """Convenience for an observed frame: upscale the RGBN bands once and derive both display pictures.
    Returns {'rgb': (3,4H,4W) reflectance, 'ndvi': (4H,4W), 'srKind', 'srModel', 'meta'}. DISPLAY ONLY."""
    out, meta = upscale(rgbn, "rgbn")
    return {"rgb": out[:3], "ndvi": ndvi_from_rgbn(out), "srKind": meta["kind"],
            "srModel": meta["model"] if meta["kind"] == "ai" else None, "meta": meta}
