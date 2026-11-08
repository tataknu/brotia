"""DGA decree parsing and the decree-text → commune matcher (ADR-0006 D4). Offline, saved samples."""

from __future__ import annotations

import json
from datetime import date

import pytest

from app.sources.water import admin, decrees as D
from app.sources.water.testing import S_W


@pytest.fixture(scope="module")
def xls_decrees():
    return D.parse_xls((S_W / "Decretos_zonas_escasez_historico_04-09-2026.xls").read_bytes())


@pytest.fixture(scope="module")
def index():
    fc = json.loads(admin.SEED_PATH.read_text())
    from app import provenance as prov

    return admin._build(fc, prov.build("conaf_comunas"))


@pytest.mark.parametrize("text,expected", [
    ("29 de julio de 2008", date(2008, 7, 29)),
    ("N°402, 24\xa0 nov de 2010", date(2010, 11, 24)),
    ("18 de nov 2011", date(2011, 11, 18)),
    ("13 de octubrede 2019", date(2019, 10, 13)),
    ("13  abril de 2011", date(2011, 4, 13)),
    ("13-07-2027", date(2027, 7, 13)),
    ("2027-07-10 00:00:00", date(2027, 7, 10)),
    ("sin fecha", None),
])
def test_parse_es_date(text, expected):
    assert D.parse_es_date(text) == expected


def test_parse_xls_skips_headers_and_reads_both_date_formats(xls_decrees):
    ds = xls_decrees
    assert 240 <= len(ds) <= 260  # 251 decrees; a few rows lack a parseable number
    assert all(d.expiry is not None for d in ds)  # text dates (with typos) and Excel serials
    by = {d.key: d for d in ds}
    limari = by["177-2026"]
    assert limari.expiry == date(2027, 7, 10)  # Excel serial 46578
    assert limari.decree_date == date(2026, 7, 9)
    assert limari.territory == "Provincia de Limarí"
    assert limari.region_keys == {"coquimbo"}
    first = by["125-2008"]
    assert first.expiry == date(2008, 7, 29)
    assert first.region_keys == {"coquimbo", "valparaiso", "metropolitana", "ohiggins", "biobio"}
    # year carried forward from the first row of each year; header rows not parsed as decrees
    assert by["134-2008"].year == 2008
    assert not any("Año" in d.territory for d in ds)


def test_parse_page_finds_xls_link_and_current_decrees():
    url, vig = D.parse_page((S_W / "decretos_page_2026-11-07.html").read_text())
    assert url.endswith("Decretos_zonas_escasez_historico_04-09-2026.xls")
    by = {d.key: d for d in vig}
    assert set(by) == {"177-2026", "179-2026", "184-2026", "185-2026", "93-2026"}
    assert by["179-2026"].expiry == date(2027, 7, 13)  # page is fresher than the XLS (2027-07-10)
    assert by["177-2026"].territory == "Provincia de Limarí"
    assert by["93-2026"].region_keys == {"los_lagos"}
    assert by["184-2026"].region_keys == {"arica"}
    assert all(d.url and d.url.endswith(".pdf") for d in vig)


# ArcGIS decree-polygon years per farm, 2008–2022 (docs/data-discovery/families/chile-water/sample_dga_decretos_by_farm.json)
ARCGIS_YEARS = {
    (-71.25, -32.88): [2008, 2010, 2011, 2012, 2013, 2014, 2015, 2017, 2018, 2019, 2020, 2021, 2022],  # Quillota
    (-71.20, -30.60): [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022],  # Ovalle
    (-71.24, -34.98): [2008, 2011, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022],  # Curicó
    (-71.66, -35.43): [2014, 2015, 2016, 2017, 2019, 2020, 2021, 2022],  # Talca
    (-72.35, -37.47): [],  # Los Ángeles
    (-72.60, -38.74): [],  # Temuco
}


@pytest.mark.parametrize("lnglat", list(ARCGIS_YEARS))
def test_text_matching_agrees_with_arcgis_polygons(xls_decrees, index, lnglat, monkeypatch):
    c = index.at(*lnglat)
    assert c is not None
    monkeypatch.setattr(admin, "communes", lambda: index)
    provs = D._province_names()
    years = sorted({d.year for d in xls_decrees if d.year <= 2022 and D.match_level(d, c, provs)})
    assert years == ARCGIS_YEARS[lnglat]


def test_locational_qualifiers_do_not_make_a_decree_province_wide(xls_decrees, index, monkeypatch):
    monkeypatch.setattr(admin, "communes", lambda: index)
    provs = D._province_names()
    by = {d.key: d for d in xls_decrees}
    ovalle = index.at(-71.20, -30.60)
    chillan = index.at(-72.10, -36.60)
    # "Cuenca de los ríos Cogotí ... ubicados en la provincia de Limarí" is a sub-basin, not Ovalle
    assert D.match_level(by["125-2008"], ovalle, provs) is None
    # "la cuenca del río Renegado en la provincia de Ñuble": historic province name, not the Ñuble basin
    assert D.match_level(by["153-2008"], chillan, provs) is None
    assert D.match_level(by["177-2026"], ovalle, provs) == "province"


def test_commune_lookup_and_basin(index):
    ovalle = index.at(-71.241711, -30.582887)
    assert (ovalle.display_name, ovalle.province_label, ovalle.region_label) == ("Ovalle", "Limarí", "Coquimbo")
    assert ovalle.basin.label == "Limarí"
    req = index.at(-70.802946, -34.283693)
    assert req.display_name == "Requínoa" and req.basin.gauges == ("cachapoal en puente termas",)
    assert index.at(-72.35, -37.47).basin is None  # south of Ñuble: no snowmelt forecast basin
    assert index.at(-63.18, -17.78) is None  # Santa Cruz, Bolivia


def test_years_in_force_counts_calendar_years_capped_at_as_of():
    d1 = D.Decree(1, 2016, date(2016, 11, 1), date(2017, 5, 1), "Coquimbo", "Provincia de Limarí", "xls")
    d2 = D.Decree(2, 2026, date(2026, 7, 9), date(2027, 7, 10), "Coquimbo", "Provincia de Limarí", "xls")
    assert D.years_in_force([d1, d2], 2008, date(2026, 11, 7)) == [2016, 2017, 2026]
    assert D.years_in_force([d1, d2], 2017, date(2026, 1, 1)) == [2017]
    assert d2.active_on(date(2026, 11, 7)) and not d2.active_on(date(2027, 7, 11))
    assert d2.label() == "DGA decree No. 2 of 9 Jul 2026"
