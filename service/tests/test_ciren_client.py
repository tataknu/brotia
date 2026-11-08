"""CIREN client (app.sources.ciren) with app.http.fetch mocked: no network."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app import http
from app.models import Farm, Polygon, Zone
from app.sources import ciren


def _sq(lng: float, lat: float, d: float = 0.001):
    return [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]]


def _feat(oid: int, lng: float, lat: float, especie: str = "NOGAL", d: float = 0.002):
    return {"type": "Feature", "id": oid, "geometry": {"type": "Polygon", "coordinates": _sq(lng, lat, d)},
            "properties": {"objectid": oid, "especie_01": especie, "desccomu": "REQUINOA", "comudere": "06116",
                           "provdere": "061", "regidere": "06"}}


def _result(body, stale=False):
    return http.FetchResult(body=body, fetched_at=datetime(2026, 11, 7, 16, 0, tzinfo=timezone.utc), stale=stale,
                            from_cache=False, source="ciren_catastro", error="HTTP 503" if stale else None)


@pytest.fixture()
def calls(monkeypatch):
    class Log(list):
        state: dict

    log = Log()
    state = {"handler": None}

    def fake_fetch(method, source, url, **kw):
        log.append({"method": method, "source": source, "url": url, **kw})
        return state["handler"](method, source, url, kw)

    monkeypatch.setattr(http, "fetch", fake_fetch)
    log.state = state  # type: ignore[attr-defined]
    return log


def test_layer_routing():
    assert [l.id for l in ciren.layers_for_bbox((-70.82, -34.30, -70.78, -34.27))] == [61]
    assert ciren.layers_for_bbox((-64.3, -17.9, -64.1, -17.7)) == []
    assert [l.id for l in ciren.layers_for_point(-72.27, -37.46, 0, ciren.IRRIGATED_LAYERS)] == []


def test_get_orchards_sorted_capped_and_mapped(calls):
    feats = [_feat(i, -70.80 + 0.0001 * i, -34.28) for i in range(1, 6)]
    feats.append(_feat(99, -70.799, -34.281, "MANZANO ROJO"))
    calls.state["handler"] = lambda m, s, u, kw: _result({"type": "FeatureCollection", "features": feats})
    fc = ciren.get_orchards((-70.82, -34.30, -70.78, -34.27), None)
    assert len(fc.features) == 6 and not fc.truncated
    assert fc.provenance.source == "ciren_catastro" and "O'Higgins survey 2024" in fc.provenance.note
    by_id = {f.id: f for f in fc.features}
    assert by_id[1].properties.crop == "walnut" and by_id[99].properties.crop is None
    assert by_id[1].properties.comuna == "REQUINOA" and by_id[1].properties.source_layer == "CATASTRO_FRUTICOLA/61"
    assert 3.5 < by_id[1].properties.area_ha < 5.0  # 0.002° square at 34° S ≈ 4.1 ha
    assert "rolpredi" not in calls[0]["params"]["outFields"]
    assert calls[0]["params"]["where"] == "1=1"
    # crop filter goes to the server as especie_01 IN (...)
    ciren.get_orchards((-70.82, -34.30, -70.78, -34.27), "hazelnut")
    assert calls[-1]["params"]["where"] == "especie_01 IN ('AVELLANO','AVELLANO EUROPEO')"


def test_get_orchards_cap_300_nearest_first(calls):
    feats = [_feat(i, -70.80 + 0.0002 * (i % 40), -34.28 + 0.0002 * (i // 40)) for i in range(1, 351)]
    calls.state["handler"] = lambda m, s, u, kw: _result({"type": "FeatureCollection", "features": feats})
    box = (-70.82, -34.30, -70.78, -34.27)
    fc = ciren.get_orchards(box, "walnut")
    assert len(fc.features) == 300 and fc.truncated
    c = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
    d = [ciren.haversine_m(c, ciren.polygon_centroid(f.geometry.coordinates)) for f in fc.features]
    assert d == sorted(d)


def test_get_orchards_upstream_down_is_empty_with_note(calls):
    def boom(m, s, u, kw):
        raise http.FetchError("ciren_catastro", u, "HTTP 503")

    calls.state["handler"] = boom
    fc = ciren.get_orchards((-70.82, -34.30, -70.78, -34.27), "cherry")
    assert fc.features == [] and "HTTP 503" in fc.provenance.note and fc.provenance.observed_at is None


def test_get_orchards_stale_cache_is_marked(calls):
    calls.state["handler"] = lambda m, s, u, kw: _result({"features": [_feat(1, -70.8, -34.28)]}, stale=True)
    fc = ciren.get_orchards((-70.82, -34.30, -70.78, -34.27), None)
    assert len(fc.features) == 1 and fc.provenance.stale


def test_outside_chile_never_calls_upstream(calls):
    fc = ciren.get_orchards((-64.3, -17.9, -64.1, -17.7), None)
    assert fc.features == [] and "Chile" in fc.provenance.note and calls == []


def test_error_body_is_rejected_by_validator():
    assert not ciren._valid({"error": {"code": 400, "message": "Failed to execute query."}})
    assert ciren._valid({"type": "FeatureCollection", "features": []})


def test_multipolygon_keeps_largest_part():
    small, big = _sq(-70.8, -34.28, 0.0005), _sq(-70.79, -34.28, 0.002)
    raw = {"id": 7, "_layer": 61, "geometry": {"type": "MultiPolygon", "coordinates": [small, big]},
           "properties": {"objectid": 7, "especie_01": "CEREZO", "desccomu": "X"}}
    f = ciren._to_feature(raw)
    assert f.geometry.coordinates[0][1][0] == pytest.approx(-70.788) and f.properties.crop == "cherry"


def _farm(lng=-70.80, lat=-34.28, oid=1, layer="CATASTRO_FRUTICOLA/61", crop="walnut"):
    rings = _sq(lng, lat, 0.002)
    return Farm(id="f1", name="F", crop=crop, polygon=Polygon(coordinates=rings), area_ha=4.0,
                centroid=ciren.polygon_centroid(rings), zone_id="auto-f1",
                ciren={"especie": "NOGAL", "sourceLayer": layer, "objectId": oid})


def test_find_peers_excludes_own_and_outside_circle(calls):
    farm = _farm()
    zone = Zone(id="auto-f1", name="z", center=farm.centroid, radius_m=3338, auto=True)
    feats = [_feat(1, -70.80, -34.28),  # own objectId
             _feat(2, -70.81, -34.28),  # peer
             _feat(3, -70.80 + 0.0005, -34.28 + 0.0005, d=0.0005),  # contains no centroid of farm? (inside farm area)
             _feat(4, -70.60, -34.28)]  # 18 km away: outside the circle
    feats[2]["geometry"]["coordinates"] = _sq(-70.8005, -34.2805, 0.003)  # contains the farm centroid -> excluded
    calls.state["handler"] = lambda m, s, u, kw: _result({"features": feats})
    fc = ciren.find_peers(farm, zone)
    assert [f.id for f in fc.features] == [2]
    assert calls[0]["params"]["distance"] == 3338 and calls[0]["params"]["where"] == "especie_01 IN ('NOGAL')"


def test_irrigation_check_covered_region(calls):
    calls.state["handler"] = lambda m, s, u, kw: _result({"count": 3})
    r = ciren.irrigation_check(_farm())
    assert r.value == "yes" and r.covered and r.n_polygons == 3 and not r.estimated
    assert calls[0]["method"] == "POST" and calls[0]["data"]["distance"] == 500
    assert calls[0]["data"]["geometryType"] == "esriGeometryPolygon"
    calls.state["handler"] = lambda m, s, u, kw: _result({"count": 0})
    r = ciren.irrigation_check(_farm())
    assert r.value == "unknown" and "No CIREN irrigated-area polygon" in r.evidence


def test_irrigation_check_south_of_maule_is_estimated_yes(calls):
    r = ciren.irrigation_check(_farm(-72.27, -37.46, layer="CATASTRO_FRUTICOLA/64", crop="blueberry"))
    assert r.value == "yes" and r.estimated and not r.covered and r.provenance.estimated and calls == []


def test_irrigation_check_upstream_down(calls):
    def boom(m, s, u, kw):
        raise http.FetchError("ciren_irrigated", u, "timeout")

    calls.state["handler"] = boom
    r = ciren.irrigation_check(_farm())
    assert r.value == "unknown" and r.evidence == "CIREN irrigation map unavailable right now."  # plain (RT-6)
    assert "timeout" in r.provenance.note and r.provenance.note.startswith("unavailable")


def test_commune_for_sample_farm_uses_cache_without_network(calls):
    from app.domain import get_sample_portfolio

    f = get_sample_portfolio().farm("cl-cabildo-avocado")
    c = ciren.commune_for_farm(f)
    assert c.name == "CABILDO" and c.code and calls == []
