"""water_supply / decree_history / snowmelt with every upstream mocked from saved samples (no network)."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
import respx

from app import config, http
from app.models import Farm, Portfolio
from app.sources import water
from app.sources.water import snowmelt, testing

AS_OF = date(2026, 11, 7)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(config, "utcnow", lambda: datetime(2026, 11, 7, 18, 0, tzinfo=timezone.utc))
    monkeypatch.setattr(http.time, "sleep", lambda s: None)  # no real backoff/pacing waits against mocks
    testing.clear()
    yield
    testing.clear()


@pytest.fixture()
def parsed_pdf(monkeypatch):
    monkeypatch.setattr(snowmelt, "pdf_to_text", lambda content: testing.forecast_text())


@pytest.fixture()
def pf(sample_portfolio) -> Portfolio:
    return Portfolio.model_validate(sample_portfolio)


def farm(pf: Portfolio, fid: str) -> Farm:
    return next(f for f in pf.farms if f.id == fid)


def test_ovalle_decree_active_and_snowmelt_above_normal(pf, parsed_pdf):
    with respx.mock(assert_all_called=False) as m:
        testing.install(m)
        ws = water.water_supply(pf, farm(pf, "cl-ovalle-table-grape"), AS_OF)
    assert ws.decree_active is True
    assert ws.decree_id == "DGA decree No. 177 of 9 Jul 2026"
    assert ws.decree_until == "2027-07-10"
    # Grande en Las Ramadas 150/110 + Hurtado en San Agustín 156/71, volume-weighted
    assert ws.snowmelt_pct_of_normal == pytest.approx(169.1, abs=0.05)
    assert ws.basin == "Limarí"
    p = ws.provenance
    assert p.source == "dga_decrees" and not p.stale and not p.estimated
    assert "decrees lag hydrology" in p.note
    assert p.licence_tier == "unresolved" and p.data_tier == "enhanced"


def test_requinoa_no_decree_snowmelt_cachapoal(pf, parsed_pdf):
    with respx.mock(assert_all_called=False) as m:
        testing.install(m)
        ws = water.water_supply(pf, farm(pf, "cl-requinoa-cherry"), AS_OF)
    assert ws.decree_active is False and ws.decree_id is None and ws.decree_until is None
    assert ws.snowmelt_pct_of_normal == 88.0
    assert ws.basin == "Rapel (Cachapoal)"
    assert "No DGA scarcity decree in force" in ws.provenance.note


def test_decree_history_years_uses_arcgis_then_text(pf, parsed_pdf):
    with respx.mock(assert_all_called=False) as m:
        testing.install(m)
        n_ov, p_ov = water.decree_history_years(farm(pf, "cl-ovalle-table-grape"), 2008, AS_OF)
        n_rq, _ = water.decree_history_years(farm(pf, "cl-requinoa-cherry"), 2008, AS_OF)
        hist = water.decree_history(farm(pf, "cl-ovalle-table-grape"), AS_OF)
    assert n_ov == 13  # 2014–2023 from ArcGIS polygons (in force), 2024–2026 from the XLS
    assert "2014" in p_ov.note and "2026" in p_ov.note and not p_ov.estimated
    assert n_rq == 5  # 2011, 2019–2022
    ids = [h["id"] for h in hist]
    assert "dga_decree:177-2026" in ids and "dga_decree:139-2014" in ids
    assert {h["source"] for h in hist} >= {"arcgis", "page"}
    assert [h for h in hist if h["activeOnAsOf"]][0]["id"] == "dga_decree:177-2026"


def test_standard_tier_portfolio_is_null_not_error(pf):
    other = pf.model_copy(update={"country": "PE"})
    ws = water.water_supply(other, farm(pf, "cl-ovalle-table-grape"), AS_OF)
    assert ws.decree_active is False and ws.snowmelt_pct_of_normal is None and ws.basin is None
    assert ws.provenance.data_tier == "standard" and "Chile-only" in ws.provenance.note


def test_decree_page_down_still_finds_decree_in_xls(pf, parsed_pdf):
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, page=503)
        ws = water.water_supply(pf, farm(pf, "cl-ovalle-table-grape"), AS_OF)
    assert ws.decree_active is True and ws.decree_until == "2027-07-10"
    assert "decree page unavailable" in ws.provenance.note


def test_all_decree_sources_down_reports_unknown_not_false_certainty(pf, parsed_pdf):
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, page=503, xls=503, arcgis=503)
        ws = water.water_supply(pf, farm(pf, "cl-ovalle-table-grape"), AS_OF)
    assert ws.decree_active is False
    assert ws.provenance.estimated is True
    assert "Decree status unknown" in ws.provenance.note
    assert ws.provenance.note.startswith("unavailable")  # app.risk reads this as "could not be checked"
    assert ws.snowmelt_pct_of_normal == pytest.approx(169.1, abs=0.05)  # the other input still answers


def test_stale_cache_served_when_refresh_fails(pf, parsed_pdf, monkeypatch):
    with respx.mock(assert_all_called=False) as m:
        testing.install(m)
        water.water_supply(pf, farm(pf, "cl-ovalle-table-grape"), AS_OF)
    # a day later every cache entry with a TTL has expired and the decree sources are down
    monkeypatch.setattr(config, "utcnow", lambda: datetime(2026, 11, 15, 18, 0, tzinfo=timezone.utc))
    from app.sources.water import decrees

    decrees.reset_memo()
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, page=503, xls=503, arcgis=503)
        ws = water.water_supply(pf, farm(pf, "cl-ovalle-table-grape"), AS_OF)
    assert ws.decree_active is True
    assert ws.provenance.stale is True


def test_snowmelt_pdf_unreadable_falls_back_to_labelled_seed(pf):
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, pdf=503)
        ws = water.water_supply(pf, farm(pf, "cl-requinoa-cherry"), AS_OF)
    assert ws.snowmelt_pct_of_normal == 88.0
    assert ws.provenance.estimated is True
    assert "seed" in ws.provenance.note


def test_farm_south_of_nuble_has_no_snowmelt_basin(pf, parsed_pdf):
    south = farm(pf, "cl-requinoa-cherry").model_copy(update={"id": "cl-los-angeles", "centroid": (-72.35, -37.47)})
    with respx.mock(assert_all_called=False) as m:
        testing.install(m)
        ws = water.water_supply(pf, south, AS_OF)
        adm = water.farm_admin(south)
    assert ws.snowmelt_pct_of_normal is None and ws.basin is None and ws.decree_active is False
    assert "no DGA snowmelt forecast gauge" in ws.provenance.note
    assert adm["commune"] == "Los Ángeles" and adm["basin"] is None


def test_arcgis_down_history_from_text_marked_estimated(pf, parsed_pdf):
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, arcgis=503)
        n, p = water.decree_history_years(farm(pf, "cl-ovalle-table-grape"), 2008, AS_OF)
    assert n >= 10
    assert p.estimated is True and "ArcGIS decree polygons unavailable" in p.note


def test_communes_layer_down_uses_saved_copy(pf, parsed_pdf):
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, communes=503)
        ws = water.water_supply(pf, farm(pf, "cl-ovalle-table-grape"), AS_OF)
    assert ws.decree_active is True
    assert ws.provenance.estimated is True
