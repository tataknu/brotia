"""svc-superres tests: display-only x4 upscaling, AI path (SEN2SRLite) and labelled Lanczos fallback.
The real-model tests are skipped when sen2sr/torch or the vendored weights are absent; no test uses the network."""

from __future__ import annotations

import importlib.util
import time

import numpy as np
import pytest

import app.superres as sr

HAVE_MODEL = (
    importlib.util.find_spec("sen2sr") is not None
    and importlib.util.find_spec("torch") is not None
    and (sr.weights_dir() / "model.safetensor").is_file()
)
needs_model = pytest.mark.skipif(not HAVE_MODEL, reason="sen2sr/torch or SEN2SR weights not available")


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for k in ("CLM_SR_DISABLE", "CLM_SR_WEIGHTS_DIR"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("CLM_SR_DEVICE", "cpu")  # deterministic and CI-safe; MPS is covered by the eval
    sr.reset_for_tests()
    yield
    sr.reset_for_tests()


def _chip(h=40, w=50, seed=0):
    rng = np.random.default_rng(seed)
    base = np.array([0.06, 0.07, 0.04, 0.30], dtype=np.float32)[:, None, None]
    return (base + 0.02 * rng.standard_normal((4, h, w))).clip(0.001, None).astype(np.float32)


# ───────────────────────────── fallback path ─────────────────────────────


def test_disabled_forces_labelled_lanczos(monkeypatch):
    monkeypatch.setenv("CLM_SR_DISABLE", "1")
    assert sr.status() == ("resampled", None)
    out, meta = sr.upscale(_chip(), "rgbn")
    assert out.shape == (4, 160, 200) and out.dtype == np.float32
    assert meta["kind"] == "resampled" and meta["model"] == "lanczos" and meta["scale"] == 4
    assert meta["display_only"] is True and meta["resolution_m"] == 2.5
    assert "CLM_SR_DISABLE" in meta["reason"]


def test_missing_weights_falls_back(monkeypatch, tmp_path):
    monkeypatch.setenv("CLM_SR_WEIGHTS_DIR", str(tmp_path))
    assert sr.status() == ("resampled", None)
    out, meta = sr.upscale(_chip(), "rgbn")
    assert meta["kind"] == "resampled" and "weights missing" in meta["reason"]
    assert out.shape == (4, 160, 200)


@needs_model
def test_model_load_failure_falls_back_and_health_says_resampled(monkeypatch):
    def boom(device):
        raise RuntimeError("simulated load failure")

    monkeypatch.setattr(sr, "_build", boom)
    out, meta = sr.upscale(_chip(), "rgbn")
    assert meta["kind"] == "resampled" and "model load failed" in meta["reason"]
    assert sr.status() == ("resampled", None)
    assert np.isfinite(out).all()


@needs_model
def test_inference_failure_falls_back(monkeypatch):
    def bad(model, a):
        raise RuntimeError("simulated MPS op failure")

    monkeypatch.setattr(sr, "_model_upscale", bad)
    out, meta = sr.upscale(_chip(), "rgbn")
    assert meta["kind"] == "resampled" and "inference failed" in meta["reason"]
    assert out.shape == (4, 160, 200)


def test_ndvi_and_rgb_kinds_are_resampled_not_ai():
    nd = np.linspace(-0.2, 0.9, 30 * 20, dtype=np.float32).reshape(30, 20)
    out, meta = sr.upscale(nd, "ndvi")
    assert out.shape == (120, 80) and meta["kind"] == "resampled" and "RGBN" in meta["reason"]
    assert np.nanmin(out) >= -1.0 and np.nanmax(out) <= 1.0
    rgb, m2 = sr.upscale(_chip()[:3], "rgb")
    assert rgb.shape == (3, 160, 200) and m2["kind"] == "resampled"


def test_nan_mask_survives_and_input_not_mutated(monkeypatch):
    monkeypatch.setenv("CLM_SR_DISABLE", "1")
    x = _chip()
    x[:, :5, :7] = np.nan  # outside the polygon
    before = x.copy()
    out, _ = sr.upscale(x, "rgbn")
    np.testing.assert_array_equal(np.isnan(x), np.isnan(before))
    np.testing.assert_array_equal(x[np.isfinite(x)], before[np.isfinite(before)])
    assert np.isnan(out[:, :20, :28]).all()
    assert np.isfinite(out[:, 20:, :]).all() and np.isfinite(out[:, :, 28:]).all()


def test_cache_returns_independent_copies(monkeypatch):
    monkeypatch.setenv("CLM_SR_DISABLE", "1")
    x = _chip()
    a, m1 = sr.upscale(x, "rgbn")
    a[:] = -5
    b, m2 = sr.upscale(x, "rgbn")
    assert m1["cached"] is False and m2["cached"] is True
    assert (b > -5).all()


def test_cache_respects_byte_budget(monkeypatch):
    monkeypatch.setenv("CLM_SR_DISABLE", "1")
    monkeypatch.setattr(sr, "_CACHE_MAX_BYTES", 3 * 4 * 160 * 200 * 4)  # room for 3 outputs of a 40x50 chip
    for seed in range(6):
        sr.upscale(_chip(seed=seed), "rgbn")
    assert len(sr._cache) == 3 and sr.cache_bytes() <= sr._CACHE_MAX_BYTES


def test_bad_inputs_raise():
    with pytest.raises(ValueError):
        sr.upscale(_chip(), "ndmi")
    with pytest.raises(ValueError):
        sr.upscale(np.zeros((3, 8, 8), np.float32), "rgbn")
    with pytest.raises(ValueError):
        sr.upscale(np.zeros((4, 8, 8), np.float32), "ndvi")
    with pytest.raises(ValueError):
        sr.super_resolve(np.zeros((8, 8), np.float32), scale=2)


def test_super_resolve_compat_contract(monkeypatch):
    monkeypatch.setenv("CLM_SR_DISABLE", "1")
    out, kind, model = sr.super_resolve(_chip())
    assert out.shape == (4, 160, 200) and kind == "resampled" and model is None  # srModel only when 'ai'
    out, kind, model = sr.super_resolve(np.zeros((10, 12), np.float32))
    assert out.shape == (40, 48) and kind == "resampled"


def test_status_is_cheap_and_never_loads():
    t0 = time.perf_counter()
    for _ in range(50):
        sr.status()
    assert (time.perf_counter() - t0) / 50 < 0.01
    assert sr._state["model"] is None and sr._state["attempted"] is False


# ───────────────────────────── AI path (real model, CPU) ─────────────────────────────


@needs_model
def test_status_reports_ai_without_loading():
    assert sr.status() == ("ai", sr.MODEL_ID)
    assert sr._state["model"] is None


@needs_model
@pytest.mark.parametrize("h,w", [(40, 50), (128, 128), (300, 200)])
def test_ai_upscale_shapes_and_10m_consistency(h, w):
    x = _chip(h, w, seed=h)
    out, meta = sr.upscale(x, "rgbn")
    assert meta["kind"] == "ai" and meta["model"] == sr.MODEL_ID and meta["device"] == "cpu"
    assert out.shape == (4, h * 4, w * 4) and np.isfinite(out).all() and (out >= 0).all()
    down = out.reshape(4, h, 4, w, 4).mean(axis=(2, 4))
    # the hard constraint keeps the 10 m picture: mean abs diff well under 1% reflectance
    assert np.abs(down - x).mean() < 0.01


@needs_model
def test_ai_keeps_nan_mask_and_frame_helper():
    x = _chip(64, 64)
    x[:, -10:, :] = np.nan
    f = sr.super_resolve_frame(x)
    assert f["srKind"] == "ai" and f["srModel"] == sr.MODEL_ID
    assert f["rgb"].shape == (3, 256, 256) and f["ndvi"].shape == (256, 256)
    assert np.isnan(f["ndvi"][-40:, :]).all() and np.isfinite(f["ndvi"][:-40, :]).all()


@needs_model
def test_health_reports_sr_mode(client):
    body = client.get("/health").json()
    assert body["srMode"] == "ai" and body["srModel"] == sr.MODEL_ID
