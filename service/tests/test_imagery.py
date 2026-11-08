"""svc-imagery tests: Whittaker, DN offset, dedup, one cached real scene, a synthetic stack through
frames/PNGs/SR, series/baseline/z, peers reading, abandonment and the router. No network: the
Sentinel-2 search and pixel fetches are monkeypatched with synthetic data."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app import config
from app.imagery import ctx, obs as obs_mod, render, s2, series as ser, signals, timeline as tl, whittaker
from app.imagery.geo import grid_for_bbox, grid_for_polygon, polygon_mask
from app.models import Farm, ImageryTimeline, Portfolio

TESTDATA = Path(__file__).resolve().parents[1] / "app" / "imagery" / "testdata"
AS_OF = date(2026, 11, 7)


# ───────────────────────── helpers ─────────────────────────


@pytest.fixture()
def portfolio(sample_portfolio) -> Portfolio:
    return Portfolio.model_validate(sample_portfolio)


@pytest.fixture()
def farm(portfolio) -> Farm:
    return portfolio.farm("cl-requinoa-cherry")


def synth_arrays(ndvi: np.ndarray, clear: np.ndarray, offset: int = 1000, ndmi: float = 0.2,
                 bands: tuple[str, ...] = s2.WINDOW_BANDS) -> np.ndarray:
    """uint16 (len(bands)+1, H, W) whose NDVI (B08/B04) equals `ndvi` and NDMI (B8A/B11) = ndmi."""
    red = np.full(ndvi.shape, 0.05)
    nir = red * (1 + ndvi) / (1 - ndvi)
    swir = nir * (1 - ndmi) / (1 + ndmi)
    vals = {"B02": np.full(ndvi.shape, 0.04), "B03": np.full(ndvi.shape, 0.07), "B04": red, "B08": nir, "B8A": nir, "B11": swir}
    out = []
    for b in bands:
        if b == "SCL":
            out.append(np.where(clear, 4, 9).astype(np.uint16))
        else:
            out.append(np.round(vals[b] * 10000 + offset).astype(np.uint16))
    out.append(np.full(ndvi.shape, 255, np.uint16))
    return np.stack(out)


class FakeResult:
    def __init__(self):
        self.stale = False
        self.fetched_at = datetime(2026, 11, 7, 16, 0, tzinfo=timezone.utc)
        self.error = None


def make_items(dates: list[date], baseline: str = "05.13") -> list[s2.Item]:
    return [s2.Item(id=f"S2X_{d:%Y%m%d}", date=d, cloud=20.0, baseline=baseline, tile="19HCC", generation="2026") for d in dates]


def season(d: date) -> float:
    """Synthetic orchard NDVI: low in winter (Jul), high in summer (Jan)."""
    doy = d.timetuple().tm_yday
    return 0.55 + 0.25 * np.cos(2 * np.pi * (doy - 15) / 365.25)


@pytest.fixture()
def fake_s2(monkeypatch, farm):
    """Synthetic Sentinel-2: a scene every 5 days since 2020, NDVI = season(date) everywhere, every
    7th scene cloudy over the farm, one partly cloudy scene (60 % clear)."""
    grid = grid_for_polygon(farm.polygon)
    dates = [date(2020, 6, 1) + timedelta(days=5 * k) for k in range(((AS_OF - date(2020, 6, 1)).days // 5) + 1)]
    items = make_items(dates)
    cloudy = {it.id for k, it in enumerate(items) if k % 7 == 3}
    partial = {items[-9].id}
    calls = {"n": 0}

    def search(bbox, start, end, today=None):
        return s2.SearchResult(items=[i for i in items if start <= i.date <= end],
                               fetched_at=FakeResult().fetched_at)

    def fetch_bands(item, g, bands):
        calls["n"] += 1
        v = np.full((g.height, g.width), season(item.date))
        clear = np.ones((g.height, g.width), bool)
        if item.id in cloudy:
            clear[:] = False
        if item.id in partial:
            clear[: int(g.height * 0.4), :] = False
        return synth_arrays(v, clear, item.offset, bands=bands), FakeResult()

    monkeypatch.setattr(s2, "search", search)
    monkeypatch.setattr(s2, "fetch_bands", fetch_bands)
    monkeypatch.setattr(ctx, "find_peers", lambda farm, zone, max_peers=20: ([], "test: no peers"))
    signals.clear_memo()
    yield {"grid": grid, "items": items, "cloudy": cloudy, "calls": calls}
    signals.clear_memo()


# ───────────────────────── unit: whittaker, offset, dedup ─────────────────────────


def test_whittaker_recovers_smooth_curve_and_gaps():
    t = np.arange(200)
    truth = 0.5 + 0.3 * np.sin(2 * np.pi * t / 200)
    rng = np.random.default_rng(0)
    y = np.full(200, np.nan)
    w = np.zeros(200)
    obs = rng.choice(200, 40, replace=False)
    y[obs] = truth[obs] + rng.normal(0, 0.02, 40)
    w[obs] = 1
    z = whittaker.smooth(y, w)
    assert np.all(np.isfinite(z))
    assert np.abs(z - truth)[10:-10].max() < 0.06
    # fewer than 3 weighted observations -> nothing invented
    w2 = np.zeros(200)
    w2[[5, 50]] = 1
    assert np.all(np.isnan(whittaker.smooth(y, w2)))
    # stacked version equals the single version
    st = whittaker.smooth_stack(np.stack([y, y], 1), np.stack([w, w], 1))
    np.testing.assert_allclose(st[:, 0], z)


@pytest.mark.parametrize("pb,off", [("05.13", 1000), ("04.00", 1000), ("03.00", 0), ("02.12", 0), (None, 0), ("x", 0)])
def test_dn_offset_keyed_on_processing_baseline(pb, off):
    assert s2.dn_offset(pb) == off


def test_select_per_date_dedups_and_filters():
    d = date(2026, 1, 10)
    a = s2.Item("old", d, 10.0, "02.12", "19HCC", "2019")
    b = s2.Item("new", d, 10.0, "05.10", "19HCC", "2023")
    c = s2.Item("cloudy", d + timedelta(days=5), 99.0, "05.10", "19HCC", "2023")
    from shapely.geometry import box

    sel = s2.select_per_date([a, b, c], box(0, 0, 1, 1), max_cloud=95)
    assert [i.id for i in sel] == ["new"]


# ───────────────────────── one cached real scene ─────────────────────────


def test_real_scene_polygon_stats_match_planetary_computer():
    z = np.load(TESTDATA / "scene_requinoa_20261014.npz")
    info = json.loads(str(z["info"]))
    arr = z["data"]
    names = tuple(info["bands"])
    assert arr.shape == (len(names) + 1, info["height"], info["width"])
    grid = grid_for_bbox(tuple(info["bbox"]))
    grid = type(grid)(tuple(info["bbox"]), info["width"], info["height"])
    pm = polygon_mask(info["polygon"], grid)
    bd, valid = obs_mod.split_bands(arr, names)
    assert valid.all() and set(np.unique(bd["SCL"])) <= set(range(12))
    off = s2.dn_offset(info["processing_baseline"])
    assert off == 1000
    st = obs_mod.polygon_stats(bd, valid, off, pm)
    ref = info["pc_statistics_reference"]
    assert st["clear_frac"] == pytest.approx(ref["clear_frac"], abs=0.02)
    # PC's server-side statistics include every touched edge pixel; with the same masking our pixel
    # maths reproduces it. Our centre-in mask (used everywhere) drops mixed edge pixels (roads,
    # borders), so it reads slightly greener on a 2 ha orchard.
    from rasterio import features

    touched = features.rasterize([(info["polygon"], 1)], out_shape=pm.shape, transform=grid.transform,
                                 all_touched=True).astype(bool)
    st_t = obs_mod.polygon_stats(bd, valid, off, touched)
    assert st_t["ndvi"] == pytest.approx(ref["ndvi_b08"], abs=0.005)
    assert st_t["ndmi"] == pytest.approx(ref["ndmi_b8a_b11"], abs=0.005)
    assert 0 <= st["ndvi"] - ref["ndvi_b08"] < 0.03
    assert st["ndmi"] == pytest.approx(ref["ndmi_b8a_b11"], abs=0.01)
    # ignoring the baseline-04.00 offset biases NDVI low (ADR-0007 D3: ~0.15)
    wrong = obs_mod.polygon_stats(bd, valid, 0, pm)
    assert wrong["ndvi"] < st["ndvi"] - 0.08


# ───────────────────────── series, baseline, z ─────────────────────────


def _obs_series(dates, values, clear=1.0):
    return [obs_mod.Obs(date=d, item_id=f"i{k}", clear_frac=clear, ndvi=v, ndmi=v - 0.4, data_px=100, poly_px=100)
            for k, (d, v) in enumerate(zip(dates, values))]


def test_series_baseline_band_and_z():
    dates = [date(2019, 1, 1) + timedelta(days=5 * k) for k in range(((AS_OF - date(2019, 1, 1)).days // 5) + 1)]
    vals = [season(d) for d in dates]
    # last 60 days of the window: the orchard drops by 0.3 (abandonment-like)
    vals = [v - 0.3 if (AS_OF - d).days <= 60 else v for d, v in zip(dates, vals)]
    rng = np.random.default_rng(1)
    vals = [v + rng.normal(0, 0.01) for v in vals]
    obs = _obs_series(dates, vals)
    pts = ser.compute(obs, "ndvi", ser.window_start(AS_OF), AS_OF, 5, 0.05)
    assert pts[-1].date == AS_OF and all((b.date - a.date).days == 5 for a, b in zip(pts, pts[1:]))
    assert all(p.p50 is not None for p in pts)
    early = [p.z for p in pts if (AS_OF - p.date).days > 120 and p.z is not None]
    assert abs(float(np.median(early))) < 1.0
    pz = ser.persistent_z(pts, AS_OF)
    assert pz is not None and pz < -2.0


def test_series_nulls_far_from_observations_and_estimated_flags():
    dates = [date(2025, 9, 1) + timedelta(days=5 * k) for k in range(90)]
    keep = [d for d in dates if not (date(2026, 5, 1) <= d <= date(2026, 7, 31))]  # a 3-month gap
    obs = _obs_series(keep, [season(d) for d in keep])
    pts = ser.compute(obs, "ndvi", ser.window_start(AS_OF), AS_OF, 5, 0.05)
    mid_gap = [p for p in pts if date(2026, 6, 5) <= p.date <= date(2026, 6, 25)]
    assert mid_gap and all(p.value is None for p in mid_gap)
    near = [p for p in pts if p.days_to_obs is not None and p.days_to_obs <= 2 and p.value is not None]
    assert near and all(not p.estimated for p in near)
    assert all(p.estimated for p in pts if p.days_to_obs is not None and p.days_to_obs > 2)
    # no baseline years -> band null, value still shown
    assert all(p.p50 is None for p in pts)


def test_spike_check_rejects_haze_drop():
    dates = [date(2026, 1, 1) + timedelta(days=5 * k) for k in range(6)]
    obs = _obs_series(dates, [0.8, 0.8, 0.45, 0.8, 0.8, 0.8])
    obs_mod.mark_spikes(obs)
    assert [o.spike for o in obs] == [False, False, True, False, False, False]
    assert not obs[2].usable


def test_peer_reading_rules():
    assert signals.reading(2, -3, -3) == "insufficient_peers"
    assert signals.reading(5, -1.5, -1.2) == "zone_wide"
    assert signals.reading(5, -2.0, -0.5) == "farm_specific"
    assert signals.reading(5, -0.9, 0.5) == "normal"
    assert signals.reading(5, -1.2, -0.5) == "normal"  # gap only 0.7


def test_dry_season_and_runs():
    assert signals.dry_season(date(2026, 11, 7), date(2025, 10, 7)) == (date(2025, 12, 1), date(2026, 4, 30))
    assert signals.dry_season(date(2026, 12, 20), date(2025, 11, 20)) == (date(2026, 12, 1), date(2026, 12, 20))
    P = ser.Point
    pts = [P(date(2026, 1, 1) + timedelta(days=5 * k), 0.5, False, 0, z=z) for k, z in enumerate([-2.5, -2.1, None, -2.2, -2.3, -2.0, -1.0])]
    runs = signals._runs(pts)
    assert len(runs) == 1 and [p.z for p in runs[0]] == [-2.2, -2.3, -2.0]


# ───────────────────────── synthetic stack end to end ─────────────────────────


def test_timeline_frames_pngs_and_trust_rule(portfolio, farm, fake_s2, monkeypatch):
    t = tl.build_timeline(portfolio, farm, False, AS_OF)
    assert isinstance(t, ImageryTimeline)
    d = t.model_dump(by_alias=True, mode="json")
    ImageryTimeline.model_validate(d)
    assert d["crs"] == "EPSG:4326" and d["nativeResolutionM"] == 10 and d["srResolutionM"] is None
    assert d["bbox"] == list(fake_s2["grid"].bbox)
    frames = t.frames
    assert frames and [f.date for f in frames] == sorted(f.date for f in frames)
    assert frames[0].date >= ser.window_start(AS_OF).isoformat() and frames[-1].date <= AS_OF.isoformat()
    obs_dates = {date.fromisoformat(f.date) for f in frames if f.kind == "observed"}
    assert obs_dates
    for f in frames:
        fd = date.fromisoformat(f.date)
        if f.kind == "observed":
            assert f.days_to_clear == 0 and f.clear_fraction >= 0.8 and f.urls.rgb
            assert f.date not in {it.date.isoformat() for it in fake_s2["items"] if it.id in fake_s2["cloudy"]}
        else:
            nearest = min(abs((fd - o).days) for o in obs_dates)
            assert f.days_to_clear == nearest and nearest > 2 and f.urls.rgb is None and f.clear_fraction is None
        assert f.urls.ndvi == f"/files/imagery/{farm.id}/{f.date}_ndvi.png"
        assert f.sr_kind is None and f.urls.ndvi_sr is None
        # the synthetic NDVI is uniform: frame stats reproduce it (observed exactly, interpolated closely)
        assert f.ndvi_mean == pytest.approx(season(fd), abs=0.01 if f.kind == "observed" else 0.04)
        assert f.ndvi_p10 <= f.ndvi_mean <= f.ndvi_p90
    # the 60 %-clear scene is usable for the series but is not an observed frame
    partial_day = fake_s2["items"][-9].date.isoformat()
    assert partial_day not in {f.date for f in frames if f.kind == "observed"}
    # PNG: RGBA, grid size, transparent outside the polygon
    g = fake_s2["grid"]
    pm = polygon_mask(farm.polygon, g)
    png = config.files_dir() / f.urls.ndvi[len("/files/"):]
    im = np.asarray(Image.open(png))
    assert im.shape == (g.height, g.width, 4)
    assert (im[..., 3][~pm] == 0).all() and (im[..., 3][pm] == 255).all()
    assert t.trust_note.startswith("All numbers come from native 10 m Sentinel-2 pixels")
    assert t.provenance.source == "s2_l2a_pc" and t.provenance.data_tier == "enhanced"


def test_sr_is_display_only_and_labelled(portfolio, farm, fake_s2, monkeypatch):
    base = tl.build_timeline(portfolio, farm, False, AS_OF)

    class FakeSR:
        """Returns garbage pixels: if any statistic read them, frame stats would change."""

        @staticmethod
        def super_resolve_frame(rgbn):
            c, h, w = rgbn.shape
            return {"rgb": np.zeros((3, 4 * h, 4 * w), np.float32), "ndvi": np.full((4 * h, 4 * w), -1.0, np.float32),
                    "srKind": "ai", "srModel": "test-sr-x4"}

        @staticmethod
        def upscale(arr, kind):
            h, w = arr.shape
            return np.full((4 * h, 4 * w), -1.0, np.float32), {"kind": "resampled", "model": "lanczos"}

    monkeypatch.setattr(tl, "sr_module", lambda: FakeSR)
    t = tl.build_timeline(portfolio, farm, True, AS_OF)
    assert t.sr_resolution_m == 2.5
    for a, b in zip(base.frames, t.frames):
        assert (a.date, a.ndvi_mean, a.ndvi_p10, a.ndvi_p90) == (b.date, b.ndvi_mean, b.ndvi_p10, b.ndvi_p90)
    obs_f = [f for f in t.frames if f.kind == "observed"]
    int_f = [f for f in t.frames if f.kind == "interpolated"]
    assert obs_f[-1].sr_kind == "ai" and obs_f[-1].sr_model == "test-sr-x4" and obs_f[-1].urls.rgb_sr
    assert all(f.sr_kind == "resampled" and f.sr_model is None and f.urls.rgb_sr is None for f in int_f if f.sr_kind)
    sr_png = config.files_dir() / obs_f[-1].urls.ndvi_sr[len("/files/"):]
    g = fake_s2["grid"]
    assert np.asarray(Image.open(sr_png)).shape == (4 * g.height, 4 * g.width, 4)
    assert "display only" in t.trust_note


def test_timeline_cached_second_call_is_fast(portfolio, farm, fake_s2):
    tl.build_timeline(portfolio, farm, False, AS_OF)
    n = fake_s2["calls"]["n"]
    tl.build_timeline(portfolio, farm, False, AS_OF)
    assert fake_s2["calls"]["n"] == n  # npz + DuckDB caches: no new fetches


def test_covered_warning(portfolio):
    grape = portfolio.farm("cl-ovalle-table-grape")
    assert "often under overhead plastic" in tl.covered_warning(portfolio, grape)
    grape2 = grape.model_copy(update={"covered": True})
    assert tl.covered_warning(portfolio, grape2) == tl.COVERED_TEXT
    grape3 = grape.model_copy(update={"covered": False})
    assert tl.covered_warning(portfolio, grape3) is None


def test_vegetation_series_and_signals_without_peers(portfolio, farm, fake_s2, monkeypatch):
    monkeypatch.setattr(s2, "zone_ndvi_histogram", lambda item, geom, bins=40: (
        np.array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 30, 30, 10, 5, 5, 5, 5, 0, 0], float), np.linspace(-1, 1, 21), FakeResult()))
    s = signals.vegetation_series(farm, "ndvi", ser.window_start(AS_OF), AS_OF, 5)
    d = s.model_dump(by_alias=True, mode="json")
    assert d["variable"] == "ndvi" and d["unit"] == "index" and d["points"]
    assert d["points"][-1]["date"] == AS_OF.isoformat()
    vals = [p for p in d["points"] if p["value"] is not None]
    assert len(vals) == len(d["points"])
    assert all(p["p50"] is not None for p in d["points"])
    v = signals.vigour_signals(portfolio, farm, AS_OF)
    pc = v["peers"]
    assert pc.reading == "insufficient_peers" and pc.n_peers == 0 and "no peers" in pc.provenance.note
    assert v["ndviZ"] is not None and abs(v["ndviZ"]) < 1.5  # same season every year -> near normal
    ab = v["abandonment"]
    assert ab.flag is False and ab.confidence == "medium"  # valid dry season, peers insufficient
    irr = v["irrigatedEvidence"]
    assert irr["value"] == "yes" and irr["zoneP25Ndvi"] < 0.35 and irr["farmDryNdvi"] > 0.7


def test_standard_tier_peers(portfolio, farm):
    pf = portfolio.model_copy(update={"country": "PE"})
    pc = signals.peers(pf, farm, AS_OF)
    assert pc.reading == "insufficient_peers" and pc.provenance.data_tier == "standard"


def test_router_serves_real_builder(client, sample_portfolio, fake_s2):
    r = client.post("/imagery/farm", json={"portfolio": sample_portfolio, "farmId": "cl-requinoa-cherry",
                                           "sr": False, "asOf": AS_OF.isoformat()})
    assert r.status_code == 200, r.text
    assert r.headers.get("X-CLM-Fixture") is None
    body = r.json()
    assert body["farmId"] == "cl-requinoa-cherry" and body["frames"]
    png = client.get(body["frames"][-1]["urls"]["ndvi"])
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"


def test_collapse_guard_copiapo_vs_ovalle():
    """§E.10 v1.1: Copiapó-like run (green canopy, since recovered) is not confirmed; Ovalle-like (bare soil,
    still low) is."""
    from datetime import date as _d

    def pt(day, v, p50, z, est=False):
        return ser.Point(date=day, value=v, estimated=est, days_to_obs=0, p50=p50, z=z)

    run_green = [pt(_d(2026, 1, 1 + 5 * i), 0.45, 0.65, -4.0) for i in range(4)]
    g = signals.collapse_guard(run_green, -0.7, run_green + [pt(_d(2026, 10, 29), 0.64, 0.75, -0.7)], _d(2026, 11, 7))
    assert not g["confirmed"] and "stayed green" in g["why"] and "recovered" in g["why"]
    assert "0.64" in g["nowTxt"]
    run_bare = [pt(_d(2026, 1, 1 + 5 * i), 0.19, 0.55, -5.0) for i in range(4)]
    g = signals.collapse_guard(run_bare, -1.6, run_bare, _d(2026, 11, 7))
    assert g["confirmed"] and abs(g["runNdvi"] - 0.19) < 1e-9
    g = signals.collapse_guard(run_bare, -0.5, run_bare, _d(2026, 11, 7))  # replanted / resumed
    assert not g["confirmed"]
