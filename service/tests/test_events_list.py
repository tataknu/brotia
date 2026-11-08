"""list_events and GET /events: providers merged in parallel, contract shape, partial failure (no network)."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
import respx

from app import config, http
from app.models import ClimateEventList, dump
from app.sources import events
from app.sources.events import cems
from app.sources.water import testing

#: Coquimbo to Biobío (decrees in Limarí/Elqui/Choapa; GWIS sample near Chillán; FIRMS Chile sample)
BBOX = (-73.0, -38.1, -70.0, -29.5)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(config, "utcnow", lambda: datetime(2026, 11, 7, 18, 0, tzinfo=timezone.utc))
    monkeypatch.setattr(http.time, "sleep", lambda s: None)
    testing.clear()
    yield
    testing.clear()


def test_all_providers_merged_newest_first_and_contract_valid():
    with respx.mock(assert_all_called=False) as m:
        testing.install(m)
        evs = events.list_events(BBOX, date(2025, 10, 7))
    assert events.last_errors == {}
    srcs = {e.provenance.source for e in evs}
    assert {"gwis_ba", "firms", "dga_decrees", "cems"} <= srcs
    starts = [e.start for e in evs]
    assert starts == sorted(starts, reverse=True)
    assert all(e.affected_farm_ids == [] and e.affected_exposure == 0 for e in evs)
    ids = {e.id for e in evs}
    assert "dga_decree:177-2026" in ids and "gwis:14977694" in ids
    assert len(ids) == len(evs)
    ClimateEventList.validate_python(dump(evs))  # round-trips through the contract model

    d177 = next(e for e in evs if e.id == "dga_decree:177-2026")
    assert d177.kind == "declared_emergency" and d177.evidence_kind == "official_declaration"
    assert (d177.start, d177.end, d177.severity) == ("2026-07-09", "2027-07-10", "severe")
    assert d177.title == "Water-scarcity decree No. 177 (Limarí province)"
    assert d177.region == "Coquimbo · Limarí" and d177.geometry["type"] in ("Polygon", "MultiPolygon")

    fp = next(e for e in evs if e.id == "cems:EMSR859:AOI02")
    assert fp.evidence_kind == "observed_footprint" and fp.geometry and "DEL_MONIT03" in fp.provenance.note
    nar = next(e for e in evs if e.id == "cems:EMSR859")
    assert nar.evidence_kind == "narrative" and nar.geometry is None


def test_window_filters_old_events():
    with respx.mock(assert_all_called=False) as m:
        testing.install(m)
        evs = events.list_events(BBOX, date(2026, 8, 1))
    assert all(e.start >= "2026-08-01" or (e.end or "9999") >= "2026-08-01" for e in evs)
    assert not any(e.id.startswith("cems:EMSR859") for e in evs)  # January 2026


def test_one_provider_down_never_empties_the_panel():
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, gwis=503, cems=503)
        evs = events.list_events(BBOX, date(2025, 10, 7))
    assert "gwis_ba" in events.last_errors
    srcs = {e.provenance.source for e in evs}
    assert "dga_decrees" in srcs and "firms" in srcs and "gwis_ba" not in srcs
    # CEMS details down: processed footprints still served from the shipped files
    assert any(e.id == "cems:EMSR859:AOI02" for e in evs)


def test_outside_chile_only_global_providers():
    with respx.mock(assert_all_called=False) as m:
        testing.install(m, gwis_body={"type": "FeatureCollection", "features": []})
        evs = events.list_events((-64.0, -18.5, -62.5, -17.0), date(2025, 10, 7))
    assert all(e.provenance.source in ("gwis_ba", "firms") for e in evs)


def test_events_endpoint_serves_real_data_not_fixture(client):
    with respx.mock(assert_all_called=False) as m:
        testing.install(m)
        r = client.get("/events", params={"bbox": ",".join(map(str, BBOX)), "since": "2026-07-01"})
    assert r.status_code == 200, r.text
    assert r.headers.get("X-CLM-Fixture") is None
    body = r.json()
    assert any(e["id"] == "dga_decree:177-2026" for e in body)
    e = body[0]
    assert {"id", "kind", "title", "region", "start", "end", "severity", "source", "evidenceKind", "geometry",
            "affectedFarmIds", "affectedExposure", "provenance"} <= set(e)
    assert {"source", "sourceLabel", "observedAt", "fetchedAt", "resolution", "licenceTier", "dataTier", "stale",
            "estimated"} <= set(e["provenance"])


def test_cems_footprints_shipped():
    fps = cems.footprints()
    codes = {(f["properties"]["code"], f["properties"]["aoi"]) for f in fps}
    assert codes == {("EMSR715", "AOI01"), ("EMSR859", "AOI02")}
    for f in fps:
        e = cems.footprint_event(f)
        assert e.evidence_kind == "observed_footprint" and e.provenance.source == "cems"
        assert f["properties"]["download_path"].startswith("https://rapidmapping.emergency.copernicus.eu/")
