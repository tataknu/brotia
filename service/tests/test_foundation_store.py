"""store, provenance and registry helpers."""

from __future__ import annotations

from datetime import date

import pytest

from app import provenance as prov
from app import registry, store
from app.models import Series


def test_series_round_trip():
    lk = store.loc_key(-70.8029461, -34.2836932)
    assert lk == "-70.8029,-34.2837"
    n = store.series_put("cr2met_nrt", "tmin", lk, [(date(2026, 11, 1), 3.5), ("2026-11-02", None, {"q": "gap"})])
    assert n == 2
    rows = store.series_get("cr2met_nrt", "tmin", lk, "2026-11-01", "2026-11-30")
    assert rows == [("2026-11-01", 3.5, None), ("2026-11-02", None, {"q": "gap"})]
    assert store.series_latest_date("cr2met_nrt", "tmin", lk) == "2026-11-01"
    store.series_put("cr2met_nrt", "tmin", lk, [("2026-11-01", 4.0)])  # upsert
    assert store.series_get("cr2met_nrt", "tmin", lk)[0][1] == 4.0


def test_assessment_and_audit():
    store.assessment_put("t_kind", "k1", {"a": [1, 2]})
    assert store.assessment_get("t_kind", "k1") == {"a": [1, 2]}
    assert store.assessment_get("t_kind", "missing") is None
    store.audit_put("a-1", {"x": 1})
    assert {"x": 1} in store.audit_list()
    assert len(store.polygon_hash({"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [0, 1], [0, 0]]]})) == 16


def test_provenance_licence_tiers():
    assert prov.build("open_meteo").licence_tier == "demo_only"
    assert prov.build("s2_l2a_pc").licence_tier == "commercial_ok"
    assert prov.build("cr2met_nrt").licence_tier == "unresolved"
    assert prov.build("never-heard-of-it").licence_tier == "unresolved"
    u = prov.unavailable("dga_snowmelt", "no basin")
    assert u.note == "unavailable: no basin" and u.observed_at is None
    d = prov.derived("risk", inputs=[prov.build("s2_l2a_pc", observed_at="2026-11-03"),
                                     prov.build("open_meteo", observed_at="2026-11-05", stale=True)])
    assert d.licence_tier == "demo_only" and d.stale and d.observed_at == "2026-11-05"
    assert prov.data_tier_for("CL") == "enhanced" and prov.data_tier_for("AR") == "standard"


@pytest.fixture()
def clean_registry():
    registry.clear("t_var")
    yield
    registry.clear("t_var")


def _series(source):
    return Series(variable="tmin", unit="°C", points=[], provenance=prov.build(source))


def test_registry_falls_back_and_marks_estimated(clean_registry):
    def primary(farm, **kw):
        raise registry.ProviderUnavailable("HTTP 503")

    def fallback(farm, **kw):
        s = _series("open_meteo")
        return s, s.provenance

    registry.register("t_var", "enhanced", primary, priority=10, source="cr2met_nrt")
    registry.register("t_var", "any", fallback, priority=90, source="open_meteo")
    r = registry.resolve("t_var", farm=None, country="CL")
    assert r.ok and r.source == "open_meteo"
    assert r.provenance.estimated and "cr2met_nrt: HTTP 503" in r.provenance.note
    value, p = r
    assert isinstance(value, Series)


def test_registry_respects_region_tier_and_reports_unavailable(clean_registry):
    registry.register("t_var", "enhanced", lambda farm, **kw: (_series("cr2met_nrt"), prov.build("cr2met_nrt")),
                      priority=10, source="cr2met_nrt")
    r = registry.resolve("t_var", farm=None, country="AR")
    assert not r.ok and r.value is None
    assert "no provider registered" in r.reasons[0]
    assert r.provenance.data_tier == "standard" and r.provenance.note.startswith("unavailable:")
    r2 = registry.resolve("t_var", farm=None, country="CL")
    assert r2.ok and not r2.provenance.estimated


def test_registry_survives_crashing_provider(clean_registry):
    def boom(farm, **kw):
        raise ValueError("parse error")

    registry.register("t_var", "any", boom, priority=1, source="x")
    r = registry.resolve("t_var", farm=None)
    assert not r.ok and "ValueError" in r.reasons[0]
