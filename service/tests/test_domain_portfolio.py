"""Sample portfolio, crop templates and countries (GET /portfolios/sample, /crops, /countries). No network."""

from __future__ import annotations

import json
from collections import Counter
from datetime import date

from app.domain import (
    effective_template,
    get_countries,
    get_crop_templates,
    get_sample_portfolio,
    next_installment,
    outstanding_at,
)
from app.domain.portfolio import GEOJSON_FILE, sample_features
from app.domain.schedule import installments_total
from app.domain.zones import assign_zone_id, haversine_m
from app.models import CROPS, CountryList, CropTemplateList, Portfolio
from app.sources.ciren import polygon_area_ha, polygon_centroid

AS_OF = date(2026, 11, 7)


def test_templates_keep_fixture_keys_and_shapes(fixture_json):
    fx = {t["crop"]: t for t in fixture_json("crops.json")}
    ours = get_crop_templates()
    assert [t.crop for t in ours] == CROPS
    for t in ours:
        f = fx[t.crop]
        assert [s.key for s in t.stages] == [s["key"] for s in f["stages"]]
        assert set(t.rules.stages) == set(f["rules"]["stages"])
        assert t.weights.model_dump() == {"a": 0.65, "b": 0.35, "c": 0.3}
        assert t.approximate and t.sources and not t.covered_default
        assert [r.id for r in t.credit_rules] == ["cr-risk-high-before-installment", "cr-abandonment",
                                                  "cr-decree-low-snowmelt", "cr-burned-area"]
        for s in t.stages:
            assert len(s.sensitivity) == 10 and all(0 <= v <= 1 for v in s.sensitivity.values())
            th = t.rules.stages[s.key]
            assert th.frost_severe_c < th.frost_critical_c and th.kc > 0 and th.harvest_rain_mm72h > 0
    assert get_crop_templates()[4].ciren_especie[0] == "AVELLANO"  # confirmed live 2026-11-07
    assert [t.evergreen for t in ours] == [False, False, True, False, False, False]


def test_countries():
    cs = get_countries()
    assert len(cs) == 13 and {c.code for c in cs if c.data_tier == "enhanced"} == {"CL"}
    assert [c.code for c in cs if c.coming_later] == ["GLOBAL"]


def test_sample_portfolio_shape():
    p = get_sample_portfolio()
    Portfolio.model_validate(p.model_dump(by_alias=True))
    assert p.id == "sample-cl" and p.name == "Chile Specialty Fruit Credit I" and p.code == "CLSF1" and p.country == "CL" and p.currency == "USD"
    assert len(p.farms) == 12
    assert Counter(f.crop for f in p.farms) == {c: 2 for c in CROPS}
    assert len({f.id for f in p.farms}) == 12
    stypes = Counter(f.loan.schedule_type for f in p.farms)
    assert stypes["at_harvest"] >= 2 and stypes["custom"] >= 2 and len(stypes) >= 4
    for f in p.farms:
        assert f.loan.currency == "USD" and 50_000 <= f.loan.amount <= 900_000
        assert f.loan.origination_date < f.loan.maturity_date
        if f.loan.installments:
            assert installments_total(f.loan.installments) == f.loan.amount
            assert all(f.loan.origination_date < i.due_date <= f.loan.maturity_date for i in f.loan.installments)
        assert f.ciren is not None and f.ciren.variedad is None and f.planting_year is None
        assert 2 <= f.area_ha <= 30
        ring = f.polygon.coordinates[0]
        assert ring[0] == ring[-1] and len(ring) >= 4
        assert f.zone_id == assign_zone_id(f.id, f.centroid, p.zones)
    # at least one multi-year establishment loan
    assert any(int(f.loan.maturity_date[:4]) - int(f.loan.origination_date[:4]) >= 5 for f in p.farms)


def test_sample_zones():
    p = get_sample_portfolio()
    shared = [z for z in p.zones if not z.auto]
    assert 2 <= len(shared) <= 3
    for z in shared:
        members = [f for f in p.farms if f.zone_id == z.id]
        assert len(members) >= 2
        assert all(haversine_m(f.centroid, z.center) <= z.radius_m for f in members)
    for f in p.farms:  # every farm keeps its own auto zone (as the app's syncZones does)
        az = p.zone(f"auto-{f.id}")
        assert az is not None and az.auto and az.radius_m == 3338 and tuple(az.center) == tuple(f.centroid)
    assert p.zone("auto-cl-ovalle-table-grape").overrides["table_grape"].model_dump(by_alias=True) == {
        "rules": {"stages": {"harvest": {"harvestRainMm72h": 5}}}}


def test_sample_is_a_superset_of_the_contract_fixture(fixture_json):
    fx = fixture_json("portfolio-sample.json")
    p = get_sample_portfolio()
    for ff in fx["farms"]:
        f = p.farm(ff["id"])
        assert f is not None and f.crop == ff["crop"]
        assert f.ciren.object_id == ff["ciren"]["objectId"] and f.ciren.source_layer == ff["ciren"]["sourceLayer"]
        assert f.loan.model_dump(by_alias=True) == ff["loan"]
        assert f.overrides.model_dump(by_alias=True) == ff["overrides"]
        assert haversine_m(f.centroid, ff["centroid"]) < 50
    assert [c.model_dump(by_alias=True) for c in p.audit] == fx["audit"]
    assert [r.model_dump(by_alias=True) for r in p.credit_rules] == fx["creditRules"]


def test_geojson_is_real_ciren_data():
    raw = json.loads(GEOJSON_FILE.read_text(encoding="utf-8"))
    assert raw["type"] == "FeatureCollection" and len(raw["features"]) == 12
    especie = {"cherry": "CEREZO", "blueberry": "ARANDANO AMERICANO", "avocado": "PALTO", "walnut": "NOGAL",
               "hazelnut": "AVELLANO", "table_grape": "VID DE MESA"}
    for fid, f in sample_features().items():
        pr = f["properties"]
        assert pr["especie"] == especie[pr["crop"]] and pr["sourceLayer"].startswith("CATASTRO_FRUTICOLA/")
        assert pr["comuna"] and "rolpredi" not in pr
        assert abs(polygon_area_ha(f["geometry"]["coordinates"]) - pr["areaHa"]) < 0.01
        c = polygon_centroid(f["geometry"]["coordinates"])
        assert haversine_m(c, pr["centroid"]) < 1
        assert pr["irrigated"]["value"] in ("yes", "unknown")


def test_exposure_and_next_installment_on_sample():
    p = get_sample_portfolio()
    total = sum(outstanding_at(f.loan, AS_OF) for f in p.farms)
    assert 1_000_000 < total < 5_000_000
    ovalle = p.farm("cl-ovalle-table-grape")
    assert outstanding_at(ovalle.loan, AS_OF) == 120000 and next_installment(ovalle.loan, AS_OF).due_date == "2026-11-30"


def test_effective_templates_for_every_sample_farm():
    p = get_sample_portfolio()
    for f in p.farms:
        t, warnings = effective_template(p, f)
        assert t.crop == f.crop and not any("overlap" in w or "uncovered" in w for w in warnings)


def test_endpoints_serve_real_data_not_fixtures(client):
    for path in ("/crops", "/countries", "/portfolios/sample"):
        r = client.get(path)
        assert r.status_code == 200 and r.headers.get("x-clm-fixture") is None, path
    CropTemplateList.validate_python(client.get("/crops").json())
    CountryList.validate_python(client.get("/countries").json())
    p = client.get("/portfolios/sample").json()
    assert len(p["farms"]) == 12 and p["farms"][0]["ciren"]["objectId"] == 22722
    assert "overrides" in p["farms"][0] and p["farms"][1]["overrides"] == {}
