"""svc-weather golden tests: no network (respx mocks every upstream; unmocked calls fail)."""

from __future__ import annotations

import json
import math
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import numpy as np
import pytest
import respx
from scipy.io import netcdf_file

from app import config, http, registry
from app.models import Farm, Polygon
from app.sources import weather
from app.sources.weather import baseline as bl
from app.sources.weather import cr2met, db, era5, events as ev, ran
from app.sources.weather.netcdf3 import parse_header

TESTDATA = Path(weather.__file__).resolve().parent / "testdata"
REQUINOA = (-70.802946, -34.283693)  # contract fixture farm; CR2MET cell -70.825,-34.275


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("CLM_DB_PATH", str(tmp_path / "weather.duckdb"))
    monkeypatch.setenv("CLM_WEATHER_BACKGROUND", "0")
    monkeypatch.delenv("CLM_OFFLINE", raising=False)
    # never depend on the wall clock: Open-Meteo is embargoed unless a test lifts it
    monkeypatch.setattr(config, "OPEN_METEO_EMBARGO_UNTIL", datetime.now(timezone.utc) + timedelta(days=1))
    http.reset_state()
    http.register_source(ran.SOURCE, max_concurrency=1, min_interval_s=0.0, timeout_s=10, retries=0)
    http.register_source(era5.SOURCE, max_concurrency=1, min_interval_s=0.0, timeout_s=10, retries=0)
    for s in cr2met.SOURCES.values():
        http.register_source(s, max_concurrency=2, min_interval_s=0.0, timeout_s=10, retries=0)
    cr2met._meta_cache.clear()
    weather._bands_cache.clear()
    era5._bands.clear()
    weather.register_providers()
    yield
    http.reset_state()


def farm(lng: float, lat: float, fid: str = "f-1") -> Farm:
    d = 0.001
    ring = [[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]
    return Farm(id=fid, name="Test", crop="cherry", polygon=Polygon(coordinates=[ring]), area_ha=1.0,
                centroid=(lng, lat), zone_id="auto-" + fid)


# ───────────────────────── synthetic CR2MET files ─────────────────────────

LATS = np.array([-34.325, -34.275, -34.225])
LONS = np.array([-70.875, -70.825, -70.775])


def make_nc(path: Path, var: str, values: np.ndarray, *, days: list[int], origin: str, two_d: bool = False,
            scale: float = 0.01, offset: float = 0.0, mask: np.ndarray | None = None, lat_first: bool = True) -> bytes:
    """Classic NetCDF-3 like CR2MET: packed int16 with scale/offset/missing_value + int8 cl_mask.
    values: (t, lat, lon) floats, NaN = missing."""
    f = netcdf_file(str(path), "w", version=1)
    if lat_first:
        f.createDimension("lat", len(LATS))
        f.createDimension("lon", len(LONS))
        f.createDimension("time", len(days))
    else:
        f.createDimension("time", len(days))
        f.createDimension("lon", len(LONS))
        f.createDimension("lat", len(LATS))
    t = f.createVariable("time", "d", ("time",))
    t[:] = days
    t.units = f"days since {origin}"
    la = f.createVariable("lat", "d", ("lat",))
    la[:] = LATS
    lo = f.createVariable("lon", "d", ("lon",))
    lo[:] = LONS
    dims = ("lat", "lon") if two_d else ("time", "lat", "lon")
    v = f.createVariable(var, "h", dims)
    packed = np.where(np.isnan(values), -32768, np.round((values - offset) / scale)).astype(np.int16)
    v[:] = packed[0] if two_d else packed
    v.scale_factor = scale
    v.add_offset = offset
    v.missing_value = -32768.0
    m = f.createVariable("cl_mask", "b", ("lat", "lon"))
    m[:] = (mask if mask is not None else np.ones((3, 3))).astype(np.int8)
    m.missing_value = 0.0
    f.close()
    return path.read_bytes()


def mock_file(router: respx.Router, url: str, body: bytes, mtime: str, calls: list | None = None) -> None:
    def serve(request: httpx.Request) -> httpx.Response:
        m = re.fullmatch(r"bytes=(\d+)-(\d+)", request.headers.get("Range", ""))
        assert m, "every CR2MET read must be a single Range request"
        a, b = int(m[1]), int(m[2])
        if calls is not None:
            calls.append((a, b))
        return httpx.Response(206, content=body[a:b + 1], headers={"Content-Type": "application/x-netcdf"})

    router.get(url).mock(side_effect=serve)
    router.get(url.replace(".nc", ".json")).mock(
        return_value=httpx.Response(200, json={"nc_file_mtime_utc": mtime, "end_date": None}))


def register_cells(keys_land: dict[str, bool]) -> None:
    rows = []
    for k, land in keys_land.items():
        c = cr2met.cell_from_key(k)
        rows.append({"cell": k, "iy": c.iy, "ix": c.ix, "lng": c.lng, "lat": c.lat, "land": land, "origin": "test"})
    db.upsert_cells(rows)


# ───────────────────────── netcdf3 + reader ─────────────────────────


def test_netcdf3_header_offsets_decode(tmp_path):
    vals = np.arange(2 * 9, dtype=float).reshape(2, 3, 3) * 1.5 - 4
    raw = make_nc(tmp_path / "a.nc", "tmin", vals, days=[1, 2], origin="1999-12-31", scale=0.5)
    h = parse_header(raw[:4096])
    assert h.dims == {"lat": 3, "lon": 3, "time": 2}
    v = h.vars["tmin"]
    assert v.dims == ["time", "lat", "lon"] and v.attrs["scale_factor"] == 0.5
    for t in range(2):
        for i in range(3):
            for j in range(3):
                o = v.offset((t, i, j))
                assert v.decode(raw[o:o + 2]) == pytest.approx(vals[t, i, j])
    o = h.vars["cl_mask"].offset((0, 0))
    assert h.vars["cl_mask"].decode(raw[o:o + 1]) == 1.0


def test_cell_grid_matches_cr2met():
    c = cr2met.cell_of(*REQUINOA)
    assert c.key == "-70.825,-34.275"
    assert cr2met.cell_of(-80.0, -34.0) is None
    assert len(cr2met.neighbourhood(c, 1)) == 9


@pytest.mark.respx(assert_all_called=False)
def test_month_fetch_band_reads_missing_day_and_series(tmp_path, respx_mock):
    # 3-day file whose time axis skips a day (day 2 missing upstream, like NRT txn 2026-10-31)
    vals = np.array([[[1, 2, 3], [4, 5, 6], [7, 8, 9]], [[11, 12, 13], [14, np.nan, 16], [17, 18, 19]]], dtype=float)
    tmax = vals + 20
    path = tmp_path / "txn.nc"
    f = netcdf_file(str(path), "w", version=1)
    f.createDimension("lon", 3)
    f.createDimension("lat", 3)
    f.createDimension("time", 2)
    t = f.createVariable("time", "d", ("time",))
    t[:] = [1, 3]
    t.units = "days since 1999-12-31"
    f.createVariable("lon", "d", ("lon",))[:] = LONS
    f.createVariable("lat", "d", ("lat",))[:] = LATS
    for name, arr in (("tmin", vals), ("tmax", tmax)):
        v = f.createVariable(name, "h", ("time", "lat", "lon"))
        v[:] = np.where(np.isnan(arr), -32768, np.round(arr / (1 / 600))).astype(np.int16)
        v.scale_factor = 1 / 600
        v.add_offset = 0.0
        v.missing_value = -32768.0
    f.close()
    url = cr2met.file_url("r1", "tmin", 2000, 1)
    calls: list = []
    mock_file(respx_mock, url, path.read_bytes(), "2022-11-12 18:41:35", calls)
    cells = [cr2met.cell_of(-70.825, -34.275), cr2met.cell_of(-70.775, -34.225)]
    register_cells({c.key: True for c in cells})

    res = cr2met.fetch_month("r1", "tmin", 2000, 1, cells)
    assert res["status"] == "ok" and res["n_days"] == 2 and res["last_date"] == date(2000, 1, 3)
    band_reads = [c for c in calls if c[0] > 0]  # (0, …) is the header read
    assert len(band_reads) == 2  # one range request per day, covering both cells
    got = {d: v for d, v, _ in db.get_daily("-70.825,-34.275", "tmin")}
    assert got[date(2000, 1, 1)] == pytest.approx(5.0, abs=0.01)
    assert got[date(2000, 1, 3)] is None  # packed missing_value -> null, never 0
    assert date(2000, 1, 2) not in got
    other = {d: v for d, v, _ in db.get_daily("-70.775,-34.225", "tmin")}
    assert other[date(2000, 1, 3)] == pytest.approx(19.0, abs=0.01)
    # tmax shares the file: the same URL, a different variable offset
    cr2met.fetch_month("r1", "tmax", 2000, 1, cells)
    tx = {d: v for d, v, _ in db.get_daily("-70.825,-34.275", "tmax")}
    assert tx[date(2000, 1, 1)] == pytest.approx(25.0, abs=0.01)
    # done bookkeeping -> a second call reads nothing
    n = len(calls)
    cr2met.ensure_window(cells, date(2000, 1, 1), date(2000, 1, 31), variables=["tmin"])
    assert len(calls) == n

    s, pv = weather.cr2met_series("tmin", *REQUINOA, date(2000, 1, 1), date(2000, 1, 4), refresh=False)
    assert [p.value for p in s.points] == [pytest.approx(5.0, abs=0.01), None, None, None]
    assert s.unit == "°C" and pv.source == "cr2met_r1" and pv.observed_at == "2000-01-01"
    assert all(p.p50 is None for p in s.points) and "no 1991–2020 baseline" in pv.note


@pytest.mark.respx(assert_all_called=False)
def test_two_d_single_day_nrt_file(tmp_path, respx_mock):
    vals = np.full((1, 3, 3), 2.5)
    raw = make_nc(tmp_path / "pr.nc", "pr", vals, days=[1], origin="2026-10-31", two_d=True, offset=300.0)
    url = cr2met.file_url("nrt", "precip", 2026, 11)
    mock_file(respx_mock, url, raw, "2026-11-07 06:31:21")
    c = cr2met.cell_of(*REQUINOA)
    register_cells({c.key: True})
    res = cr2met.fetch_month("nrt", "precip", 2026, 11, [c])
    assert res["last_date"] == date(2026, 11, 1)
    assert db.get_daily(c.key, "precip") == [(date(2026, 11, 1), 2.5, "nrt")]


@pytest.mark.respx(assert_all_called=False)
def test_land_mask_and_nearest_land_cell(tmp_path, respx_mock):
    mask = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]])
    raw = make_nc(tmp_path / "m.nc", "pr", np.zeros((1, 3, 3)), days=[1], origin="1999-12-31", mask=mask, offset=300.0)
    mock_file(respx_mock, cr2met.file_url("r1", "precip", 2000, 1), raw, "x")
    centre = cr2met.cell_of(*REQUINOA)
    cells = cr2met.neighbourhood(centre, 1)
    m = cr2met.land_mask(cells)
    assert m[centre.key] is False and sum(m.values()) == 8
    db.upsert_cells([{"cell": c.key, "iy": c.iy, "ix": c.ix, "lng": c.lng, "lat": c.lat, "land": m[c.key], "origin": "t"} for c in cells])
    used, note = weather.resolve_cell(*REQUINOA)
    assert used.key != centre.key and "nearest land cell" in note


def test_unregistered_cell_is_unavailable_not_invented():
    s = weather.get_series("tmin", farm(-71.5, -33.0), date(2026, 10, 1), date(2026, 10, 7))
    assert s.points == []
    assert "CR2MET not fetched yet" in s.provenance.note
    assert "quota window" in s.provenance.note  # ERA5 fallback refused before the embargo ends


# ───────────────────────── baseline bands ─────────────────────────


def test_noleap_doy_and_spread_years():
    assert bl.noleap_doy(date(2020, 2, 29)) == bl.noleap_doy(date(2021, 2, 28))
    assert bl.noleap_doy(date(2020, 12, 31)) == 364
    ys = cr2met.spread_years()
    assert sorted(ys) == list(range(1991, 2021)) and ys[:3] == [1991, 2020, 2005]
    first15 = ys[:15]
    assert max(first15) - min(first15) == 29  # any prefix spans the period


def _synthetic_years(fn, years=range(1991, 2021)) -> dict[date, float]:
    out = {}
    for y in years:
        d = date(y, 1, 1)
        while d.year == y:
            out[d] = fn(y, d)
            d += timedelta(days=1)
    return out


def test_bands_golden_quantiles():
    vals = _synthetic_years(lambda y, d: float(y - 1991))  # each year a constant 0..29
    b = bl.compute_bands(vals, "tmin")
    assert b.n_years == 30
    p10, p50, p90 = b.at(date(2026, 7, 1))
    exp = np.percentile(np.repeat(np.arange(30.0), 15), [10, 50, 90])
    assert (p10, p50, p90) == pytest.approx(tuple(exp), abs=1e-3)
    # precip: 30-day running totals as a daily rate -> constant 3 mm/day gives 3.0 everywhere
    pb = bl.compute_bands(_synthetic_years(lambda y, d: 3.0), "precip")
    assert pb.at(date(2026, 1, 1)) == pytest.approx((3.0, 3.0, 3.0))
    assert pb.n_years == 30  # 1991 has 336 valid 30-day rates (from 30 Jan), above the 300-day floor
    # too few years -> no bands, honest reason
    few = bl.compute_bands(_synthetic_years(lambda y, d: 1.0, range(1991, 1994)), "tmax")
    assert few.table is None and few.at(date(2026, 1, 1)) == (None, None, None) and "only 3" in few.reason


def test_bands_short_baseline_is_labelled():
    b = bl.compute_bands(_synthetic_years(lambda y, d: 1.0, range(1991, 2001)), "tmax")
    assert b.n_years == 10 and "indicative only" in b.describe()


def test_series_with_bands_end_to_end():
    c = cr2met.cell_of(*REQUINOA)
    register_cells({c.key: True})
    base = _synthetic_years(lambda y, d: 10.0 + (y - 1991) * 0.1)
    rows = [(c.key, d, v) for d, v in base.items()]
    db.put_daily("r1", "tmax", rows)
    for y in range(1991, 2021):
        for m in range(1, 13):
            db.mark_done("r1", "tmax", [c.key], y, m, "x", cr2met.days_in_month(y, m), None)
    db.put_daily("nrt", "tmax", [(c.key, date(2023, 1, 1), 99.0), (c.key, date(2023, 1, 2), 13.0)])
    db.put_daily("r1", "tmax", [(c.key, date(2023, 1, 1), 12.0)])
    s, pv = weather.cr2met_series("tmax", *REQUINOA, date(2023, 1, 1), date(2023, 1, 2), refresh=False)
    assert [p.value for p in s.points] == [12.0, 13.0]  # R1 wins where it exists, NRT fills the rest
    assert s.points[0].p50 == pytest.approx(np.percentile(10.0 + np.repeat(np.arange(30) * 0.1, 15), 50), abs=1e-3)
    assert pv.source == "cr2met_nrt" and "n_years=30" in pv.note and "R1 (to 2023-01-01), NRT for the days R1 lacks" in pv.note
    # through the public API + registry
    s2 = weather.get_series("tmax", farm(*REQUINOA), "2023-01-01", "2023-01-02")
    assert [p.value for p in s2.points] == [12.0, 13.0] and s2.provenance.data_tier == "enhanced"


# ───────────────────────── events ─────────────────────────


def test_ran_parse_and_golden_summaries():
    hs = ran.parse((TESTDATA / "ran_32_2026-11-05.xml").read_text())
    assert len(hs) == 48 and hs[0].ts == datetime(2026, 11, 5, 0, 0) and hs[0].tmin == 10.4
    f = ev.frost_hourly(hs, date(2026, 11, 5), date(2026, 11, 6), [10.0, 9.0])
    assert f["summary"]["min_c"] == 7.7 and f["summary"]["min_at"] == "2026-11-06 23:00:00"
    assert f["summary"]["hours_at_or_below"] == {"10.0": 9, "9.0": 5}
    assert f["events"][0] == {"start": "2026-11-05 01:00:00", "end": "2026-11-05 07:00:00", "hours": 7, "min_c": 8.2}
    h = ev.heat_hourly(hs, date(2026, 11, 5), date(2026, 11, 6), [20.0])
    assert h["summary"]["max_c"] == 26.3 and h["summary"]["hours_at_or_above"] == {"20.0": 17}
    assert h["summary"]["degree_hours_above"] == {"20.0": 54.8}


def test_hourly_frost_rain_synthetic():
    t0 = datetime(2026, 9, 10, 0, 0)
    temps = [3, 1, -0.5, -2.5, -3.1, -2.0, 0.5, 4]
    hs = [ev.Hour(ts=t0 + timedelta(hours=i), tmin=t, tmax=t + 1, precip=0.0) for i, t in enumerate(temps)]
    f = ev.frost_hourly(hs, date(2026, 9, 10), date(2026, 9, 10), [0.0, -2.0])
    assert f["summary"]["hours_at_or_below"] == {"0.0": 4, "-2.0": 3}
    assert f["events"] == [{"start": "2026-09-10 02:00:00", "end": "2026-09-10 05:00:00", "hours": 4, "min_c": -3.1}]
    assert f["days"][0]["complete"] is False  # 8 of 24 hours -> incomplete, not frost-free
    # 72 h rain: 10 mm two days before the window still counts for the first window day
    rain = [ev.Hour(ts=datetime(2026, 12, 1, 6), precip=10.0), ev.Hour(ts=datetime(2026, 12, 3, 5), precip=4.0),
            ev.Hour(ts=datetime(2026, 12, 5, 0), precip=1.0)]
    r = ev.rain_hourly(rain, date(2026, 12, 3), date(2026, 12, 5), threshold_mm=12)
    assert r["summary"]["max_72h_mm"] == 14.0 and r["summary"]["max_72h_end"] == "2026-12-03 05:00:00"
    assert r["summary"]["total_mm"] == 5.0 and r["summary"]["max_72h_incomplete"] is True
    assert r["events"][0]["max_72h_mm"] == 14.0


def test_daily_fallbacks():
    tmin = {date(2026, 9, 1): 1.0, date(2026, 9, 2): -1.0, date(2026, 9, 3): -2.5, date(2026, 9, 4): None}
    f = ev.frost_daily(tmin, date(2026, 9, 1), date(2026, 9, 4), [0.0, -2.0])
    assert f["summary"]["min_c"] == -2.5 and f["summary"]["days_at_or_below"] == {"0.0": 2, "-2.0": 1}
    assert f["summary"]["hours_at_or_below"] is None and f["events"][0]["days"] == 2
    pr = {date(2026, 12, 1): 5.0, date(2026, 12, 2): 6.0, date(2026, 12, 3): 7.0, date(2026, 12, 4): 0.0}
    r = ev.rain_daily(pr, date(2026, 12, 3), date(2026, 12, 4), threshold_mm=15)
    assert r["summary"]["max_72h_mm"] == 18.0 and r["summary"]["max_72h_end"] == "2026-12-03"
    h = ev.heat_daily({date(2027, 1, 5): 33.0, date(2027, 1, 6): 35.5}, date(2027, 1, 5), date(2027, 1, 6), [32.0])
    assert h["summary"]["degree_days_above"] == {"32.0": 4.5} and h["summary"]["days_at_or_above"] == {"32.0": 2}


def _ran_xml(rows: list[tuple[str, float, float, float]]) -> str:
    """rows: (ts, precip, tmin, tmax) -> agromet.cl getGraphData XML."""
    datos = "".join(f"<dato>fecha|{ts}|1|{(tn + tx) / 2:.3f}|2|{pp:.3f}|3|80.0|4|1013.0|5|0|6|0|7|{tn:.3f}|8|{tx:.3f}|9|0|11||12|</dato>"
                    for ts, pp, tn, tx in rows)
    return f"<?xml version='1.0' encoding='UTF-8'?><estacion id='82'>{datos}</estacion>"


@pytest.mark.respx(assert_all_called=False)
def test_frost_events_station_end_to_end(respx_mock, monkeypatch):
    monkeypatch.setattr(ran, "ensure_tls", lambda: None)
    rows = []
    for h in range(24 * 3):
        ts = datetime(2026, 9, 1) + timedelta(hours=h)
        tn = -3.0 if ts.day == 2 and 3 <= ts.hour <= 6 else 5.0
        rows.append((ts.strftime("%Y-%m-%d %H:%M:%S"), 0.0, tn, tn + 1))
    route = respx_mock.get(ran.URL).mock(return_value=httpx.Response(200, text=_ran_xml(rows)))
    fr = weather.frost_events(farm(*REQUINOA), (date(2026, 9, 1), date(2026, 9, 3)))
    assert fr.source_kind == "station_hourly" and fr.station["name"] == "Requinoa"
    assert fr.summary["hours_at_or_below"] == {"0.0": 4, "-2.0": 4} and fr.summary["min_c"] == -3.0
    assert fr.provenance.source == "ran_station" and "km" in fr.provenance.source_label
    assert route.called and route.calls[0].request.headers["User-Agent"] == config.USER_AGENT
    assert dict(route.calls[0].request.url.params)["dateFrom"] == "2026-09-01 00:00:00"
    json.dumps(fr.to_dict())  # JSON-safe


def test_events_fall_back_to_grid_then_unavailable(monkeypatch):
    monkeypatch.setattr(ran, "nearest_stations", lambda *a, **k: [])
    c = cr2met.cell_of(*REQUINOA)
    register_cells({c.key: True})
    db.put_daily("r1", "tmin", [(c.key, date(2020, 9, 1) + timedelta(days=i), v) for i, v in enumerate([2.0, -1.5, 0.5])])
    db.mark_done("r1", "tmin", [c.key], 2020, 9, "x", 30, date(2020, 9, 30))
    fr = weather.frost_events(farm(*REQUINOA), ("2020-09-01", "2020-09-03"))
    assert fr.source_kind == "grid_daily" and fr.summary["min_c"] == -1.5
    assert fr.provenance.estimated is True and "gridded daily, not hourly" in fr.provenance.note
    hr = weather.harvest_rain(farm(*REQUINOA), ("2020-09-01", "2020-09-03"))
    assert hr.source_kind == "unavailable" and hr.summary == {} and "unavailable" in hr.provenance.note


# ───────────────────────── ERA5 / Open-Meteo ─────────────────────────


@pytest.mark.respx(assert_all_called=False)
def test_open_meteo_embargo_makes_no_call(respx_mock, monkeypatch):
    monkeypatch.setattr(config, "OPEN_METEO_EMBARGO_UNTIL", datetime.now(timezone.utc) + timedelta(hours=1))
    route = respx_mock.get(era5.URL).mock(return_value=httpx.Response(500))
    s = weather.get_series("precip", farm(-77.0, -12.0), date(2026, 10, 1), date(2026, 10, 7), country="PE")
    assert s.points == [] and "quota window" in s.provenance.note and s.provenance.data_tier == "standard"
    assert not route.called


def _om_body(start: date, end: date, fn) -> dict:
    ts, d = [], start
    while d <= end:
        ts.append(d)
        d += timedelta(days=1)
    return {"daily": {"time": [t.isoformat() for t in ts],
                      **{k: [fn(var, t) for t in ts] for var, k in era5.DAILY.items()}}}


@pytest.mark.respx(assert_all_called=False)
def test_open_meteo_after_embargo_series_and_chile_harvest_rule(respx_mock, monkeypatch):
    monkeypatch.setattr(config, "OPEN_METEO_EMBARGO_UNTIL", datetime(2020, 1, 1, tzinfo=timezone.utc))

    def serve(request: httpx.Request) -> httpx.Response:
        q = dict(request.url.params)
        assert q["models"] == "era5" and q["timezone"] == "UTC"
        s, e = date.fromisoformat(q["start_date"]), date.fromisoformat(q["end_date"])
        return httpx.Response(200, json=_om_body(s, e, lambda var, t: float(t.year % 10) if t.year <= 2020 else 50.0))

    route = respx_mock.get(era5.URL).mock(side_effect=serve)
    today = datetime.now(timezone.utc).date()
    f = farm(-77.01, -12.02)
    s = weather.get_series("tmax", f, today - timedelta(days=10), today - timedelta(days=8), country="PE")
    assert [p.value for p in s.points] == [50.0, 50.0, 50.0]
    assert s.points[0].p50 is not None and s.provenance.source == "open_meteo"
    assert s.provenance.licence_tier == "demo_only" and "same stream" in s.provenance.note
    q = dict(route.calls[0].request.url.params)
    assert (q["latitude"], q["longitude"]) == ("-12.00", "-77.00")  # snapped to the 0.25° cell
    n = route.call_count
    weather.get_series("tmin", farm(-76.98, -11.99, "f-2"), today - timedelta(days=10), today - timedelta(days=8), country="PE")
    assert route.call_count == n  # same 0.25° cell -> served from cache, no new call

    # Chile: ERA5 is a fallback for series (estimated) but never for harvest rain
    monkeypatch.setattr(ran, "nearest_stations", lambda *a, **k: [])
    cl = farm(-71.5, -33.0, "f-cl")
    sc = weather.get_series("precip", cl, today - timedelta(days=10), today - timedelta(days=8), country="CL")
    assert sc.provenance.source == "open_meteo" and sc.provenance.estimated is True
    hr = weather.harvest_rain(cl, (today - timedelta(days=10), today - timedelta(days=8)), country="CL")
    assert hr.source_kind == "unavailable" and "ADR-0005 D5" in hr.provenance.note


@pytest.mark.respx(assert_all_called=False)
def test_chill_hours_from_cached_station_months_only(respx_mock, monkeypatch):
    monkeypatch.setattr(ran, "ensure_tls", lambda: None)
    rows = []
    for h in range(24 * 30):  # June 2026: 6 cold hours (tavg = tmin/tmax mean) every night
        ts = datetime(2026, 6, 1) + timedelta(hours=h)
        t = 3.0 if ts.hour < 6 else 12.0
        rows.append((ts.strftime("%Y-%m-%d %H:%M:%S"), 0.0, t, t))
    route = respx_mock.get(ran.URL).mock(return_value=httpx.Response(200, text=_ran_xml(rows)))
    f = farm(*REQUINOA)
    assert weather.chill_hours(f, "2026-06-01", "2026-06-30") is None  # cold cache: no fetch in-request
    assert not route.called
    ran.fetch_month("82", 2026, 6)  # what `backfill ran-warm` does
    hours, pv = weather.chill_hours(f, "2026-06-01", "2026-06-30")
    assert hours == 6 * 30 and pv.source == "ran_station" and pv.estimated is False
    assert weather.chill_hours(f, "2026-06-01", "2026-06-30", country="PE") is None
    assert weather.background_enabled() is False  # never under pytest


def test_merge_private_build_into_service_cache(tmp_path, monkeypatch):
    from app.sources.weather import backfill

    c = cr2met.cell_of(*REQUINOA)
    src = tmp_path / "build.duckdb"
    main = tmp_path / "main.duckdb"
    monkeypatch.setenv("CLM_DB_PATH", str(main))  # main already has 2020-01 (old NRT file) for the cell
    register_cells({c.key: True})
    db.put_daily("nrt", "tmin", [(c.key, date(2026, 10, 1), 1.0)])
    db.mark_done("nrt", "tmin", [c.key], 2026, 10, "old", 1, date(2026, 10, 1))
    monkeypatch.setenv("CLM_DB_PATH", str(src))  # the private pass read more
    register_cells({c.key: True})
    db.put_daily("r1", "tmin", [(c.key, date(1995, 1, d), float(d)) for d in range(1, 32)])
    db.mark_done("r1", "tmin", [c.key], 1995, 1, "m", 31, date(1995, 1, 31))
    db.put_daily("nrt", "tmin", [(c.key, date(2026, 10, d), 2.0) for d in (1, 2)])
    db.mark_done("nrt", "tmin", [c.key], 2026, 10, "new", 2, date(2026, 10, 2))
    monkeypatch.setenv("CLM_DB_PATH", str(main))
    out = backfill.merge(str(src))
    assert out["months"] == 2 and out["rows"] == 33
    got = {d: (v, ver) for d, v, ver in db.get_daily(c.key, "tmin")}
    assert got[date(1995, 1, 31)] == (31.0, "r1") and got[date(2026, 10, 1)] == (2.0, "nrt")
    assert backfill.merge(str(src))["months"] == 0  # idempotent
