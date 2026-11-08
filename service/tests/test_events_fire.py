"""GWIS burned area, FIRMS hotspots and the §E.5 fire signals (saved samples; no network)."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone

import pytest
import respx

from app import config, http
from app.models import Farm, Zone
from app.sources import events
from app.sources.events import firms, geo, gwis
from app.sources.water import testing

AS_OF = date(2026, 11, 7)
FIRMS_HEADER = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight\n"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(config, "utcnow", lambda: datetime(2026, 11, 7, 18, 0, tzinfo=timezone.utc))
    monkeypatch.setattr(http.time, "sleep", lambda s: None)
    testing.clear()
    yield
    testing.clear()


def square_farm(fid: str, lng: float, lat: float, half: float = 0.0005) -> Farm:
    ring = [[lng - half, lat - half], [lng + half, lat - half], [lng + half, lat + half], [lng - half, lat + half],
            [lng - half, lat - half]]
    return Farm.model_validate({
        "id": fid, "name": fid, "crop": "blueberry", "polygon": {"type": "Polygon", "coordinates": [ring]},
        "areaHa": 1.0, "centroid": [lng, lat], "zoneId": f"auto-{fid}",
    })


def test_gwis_filter_uses_lat_lon_axis_order_inside_the_envelope():
    f = gwis.params((-72.2, -36.7, -72.0, -36.5), date(2012, 1, 1), AS_OF)["FILTER"]
    assert "<lowerCorner>-36.70000 -72.20000</lowerCorner>" in f
    assert "<upperCorner>-36.50000 -72.00000</upperCorner>" in f
    assert "<Literal>2026-11-07 23:59:59</Literal>" in f


def test_circle_is_35_km2():
    c = geo.circle((-71.24, -30.58))
    assert geo.area_ha(c) / 100 == pytest.approx(35.0, rel=0.01)


def test_fire_recurrence_counts_years_in_zone_circle():
    with respx.mock(assert_all_called=False) as m:
        testing.install(m)
        n, p = events.fire_recurrence((-72.10, -36.60), 3338, 2012, AS_OF)
        years, _ = events.fire_recurrence_years((-72.10, -36.60), 3338, 2012, AS_OF)
    assert n == len(years) and n >= 1
    assert 2026 in years  # 2026-04 polygon 15189615 at -72.05,-36.60 touches the circle
    assert p.source == "gwis_ba" and "calendar year" in p.note and "agricultural burning" in p.note


def test_footprint_on_the_farm_scores_1(monkeypatch):
    on_fire = square_farm("cl-on-fire", -72.11500, -36.66733)  # inside GWIS 14977694 (2026-01-30, 185 ha)
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, firms_csv=FIRMS_HEADER)
        fs = events.fire_signals(on_fire, None, AS_OF)
        hits = events.burned_area_intersections(on_fire, date(2025, 10, 7))
    assert fs.severity == 1.0 and fs.footprint_intersects_farm
    assert any(e.id == "gwis:14977694" for e in fs.farm_events)
    assert [e.id for e in hits] == ["gwis:14977694"]
    e = hits[0]
    assert e.evidence_kind == "observed_footprint" and e.kind == "fire" and e.geometry["type"] in ("Polygon", "MultiPolygon")
    assert e.title.startswith("Burned area near ") and e.region.startswith("Ñuble")
    assert "agricultural burning" in e.provenance.note


def test_footprint_in_zone_but_not_on_farm_scores_04():
    near = square_farm("cl-near", -72.110, -36.645)  # ~1.5 km north of 14977694; nothing on the farm
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, firms_csv=FIRMS_HEADER)
        fs = events.fire_signals(near, None, AS_OF)
    assert fs.severity == 0.4
    assert fs.footprint_intersects_zone and not fs.footprint_intersects_farm and not fs.recent_fire_in_zone
    assert "not on the farm" in fs.text


def test_recent_firms_hotspot_in_zone_scores_06():
    f = square_farm("cl-hotspot", -70.80, -34.28)
    csv_text = FIRMS_HEADER + "-34.29000,-70.79000,330.1,0.4,0.4,2026-11-05,1812,N20,nominal,2.0NRT,295.0,4.1,D\n" \
                              "-34.29010,-70.79010,331.0,0.4,0.4,2026-11-05,1812,N20,low,2.0NRT,295.0,1.0,D\n"
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, gwis_body={"type": "FeatureCollection", "features": []}, firms_csv=csv_text, firms_n21=503)
        fs = events.fire_signals(f, Zone(id="auto-cl-hotspot", name="z", center=(-70.80, -34.28), auto=True), AS_OF)
    assert fs.severity == 0.6 and fs.recent_fire_in_zone
    e = fs.recent_zone_events[0]
    assert e.evidence_kind == "own_signal" and e.id.startswith("firms:")
    assert "(1 VIIRS detection, max FRP" in e.title  # the low-confidence duplicate is dropped
    assert "N21 7-day file unavailable" in e.provenance.note


def test_no_fire_scores_0():
    f = square_farm("cl-quiet", -70.80, -34.28)
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, gwis_body={"type": "FeatureCollection", "features": []}, firms_csv=FIRMS_HEADER)
        fs = events.fire_signals(f, None, AS_OF)
    assert fs.severity == 0.0 and not (fs.footprint_intersects_farm or fs.recent_fire_in_zone or fs.footprint_intersects_zone)
    assert fs.provenance is not None and fs.as_dict()["severity"] == 0.0


def test_gwis_down_is_unavailable_not_zero():
    f = square_farm("cl-x", -72.11, -36.645)
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, gwis=503)
        fs = events.fire_signals(f, None, AS_OF)
        n, p = events.fire_recurrence(f.centroid, 3338, 2012, AS_OF)
        with pytest.raises(events.FireDataUnavailable):
            events.burned_area_intersections(f, date(2025, 10, 7))
    assert fs.severity is None and fs.provenance.note.startswith("unavailable")
    assert n is None and "GWIS burned area unavailable" in p.note


def test_gwis_severity_thresholds():
    assert (gwis.severity(185), gwis.severity(686), gwis.severity(9479)) == ("moderate", "severe", "extreme")


def test_firms_parse_drops_low_confidence():
    dets = firms.parse_csv((testing.S_E / "firms_j1_7d_chile.csv").read_text())
    assert dets and all(d.confidence not in ("l", "low") for d in dets)
    assert {d.acq_date for d in dets} <= {f"2026-{x}" for x in ("10-31", "11-01", "11-02", "11-03", "11-04", "11-05", "11-06", "11-07")}


def test_gwis_cache_key_is_stable_across_as_of_dates_so_stale_copy_serves(monkeypatch):
    on_fire = square_farm("cl-on-fire", -72.11500, -36.66733)
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, firms_csv=FIRMS_HEADER)
        assert events.fire_signals(on_fire, None, AS_OF).severity == 1.0
    # next day: TTL expired, GWIS down; the as-of date moved but the same cached query answers (stale)
    monkeypatch.setattr(config, "utcnow", lambda: datetime(2026, 11, 8, 18, 0, tzinfo=timezone.utc))
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, gwis=503, firms_csv=FIRMS_HEADER)
        fs = events.fire_signals(on_fire, None, date(2026, 11, 8))
    assert fs.severity == 1.0
    assert fs.farm_events[0].provenance.stale is True
