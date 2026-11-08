"""DGA snowmelt forecast parser: golden values from the 2026–27 PDF (Cuadro 4) and link discovery."""

from __future__ import annotations

import csv
from datetime import date

import pytest

from app.sources.water import admin, snowmelt, testing


@pytest.fixture(scope="module")
def rows():
    return snowmelt.parse_forecast(testing.forecast_text())


def test_parses_all_19_gauges(rows):
    assert len(rows) == 19
    assert rows[0].station == "Copiapó en Pastillo" and rows[-1].station == "Ñuble en San Fabián"
    assert all(r.region for r in rows)


@pytest.mark.parametrize("station,vol,mean,pct", [
    ("Aconcagua en Chacabuquito", 914, 893, 102),
    ("Ñuble en San Fabián", 2264, 1664, 136),
    ("Grande en Las Ramadas", 150, 110, 136),
    ("Hurtado en San Agustín", 156, 71, 220),
    ("Cachapoal en Puente Termas", 2247, 2556, 88),
    ("Tinguiririca en Bajo Briones", 1001, 1227, 82),
    ("Maipo en el Manzano", 2602, 2914, 89),
    ("Teno después de junta con Claro", 1103, 1200, 92),
    ("Maule en Armerillo", 4901, 4598, 107),
])
def test_golden_values(rows, station, vol, mean, pct):
    r = next(x for x in rows if x.station == station)
    assert (r.vol_forecast_hm3, r.vol_mean_hm3, r.pct_of_normal) == (vol, mean, pct)


def test_seed_csv_matches_parser(rows):
    with snowmelt.SEED_PATH.open() as f:
        seed = list(csv.DictReader(f))
    assert len(seed) == 19
    for s, r in zip(seed, rows):
        assert s["station"] == r.station and int(s["anomaly_pct"]) == r.anomaly_pct
        assert s["pdf_url"].endswith("Pronostico-DGA-Deshielos-2026-2027.pdf")


def test_every_mapped_basin_gauge_exists_in_the_forecast(rows):
    names = [admin.norm(r.station) for r in rows]
    for prov_name, basin in admin.PROVINCE_BASIN.items():
        for g in basin.gauges:
            assert any(n.startswith(g) for n in names), (prov_name, g)


def test_season_links_and_season_choice():
    links = snowmelt.season_links(testing.sample_text("boletines_anchors_2026-11-07.html"))
    assert links[2026].endswith("Pronostico-DGA-Deshielos-2026-2027.pdf")
    assert {2017, 2020, 2024, 2025} <= set(links)
    assert snowmelt.season_for(date(2026, 11, 7)) == 2026
    assert snowmelt.season_for(date(2026, 9, 20)) == 2025  # published in October
    assert snowmelt.season_for(date(2027, 2, 1)) == 2026


def test_garbled_row_is_rejected():
    text = "Aconcagua en Chacabuquito             Valparaíso       25,6      40,5      71,3      82,4      65,2     39,5      23,4      914            893             40\n"
    assert snowmelt.parse_forecast(text) == []  # anomaly disagrees with the volume ratio
