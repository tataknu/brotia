"""v1.1 second sample portfolio (ADR-0026): GET /portfolios/samples, GET /portfolios/sample?id=, the sur book's
shape, and the multi-portfolio snapshot layout. No network."""

from __future__ import annotations

import json
from collections import Counter

from app.domain import get_sample_portfolio, get_sample_portfolios, list_sample_portfolios
from app.domain.portfolio import sample_commune, sample_features
from app.domain.schedule import installments_total
from app.domain.zones import haversine_m
from app.models import Portfolio, SnapshotManifest
from app.routers import dispatch
from app.sources.ciren import polygon_area_ha

SUR = "sample-cl-sur"


def test_samples_endpoint_lists_both(client):
    r = client.get("/portfolios/samples")
    assert r.status_code == 200 and "X-CLM-Fixture" not in r.headers
    rows = r.json()
    assert [x["id"] for x in rows] == ["sample-cl", SUR]
    by = {x["id"]: x for x in rows}
    assert by["sample-cl"]["farmCount"] == 12 and by[SUR]["farmCount"] == 9
    assert all(x["currency"] == "USD" and x["country"] == "CL" and x["description"] for x in rows)
    assert by[SUR]["name"] == "Southern Orchards Credit II" and by[SUR]["code"] == "CLSO2" and by[SUR]["lender"] == "Cooperativa Agrícola del Sur"
    assert by[SUR]["crops"] == ["cherry", "blueberry", "walnut", "hazelnut"]


def test_default_sample_unchanged(client):
    plain = client.get("/portfolios/sample")
    by_id = client.get("/portfolios/sample", params={"id": "sample-cl"})
    assert plain.status_code == by_id.status_code == 200
    assert plain.json() == by_id.json() == get_sample_portfolio().model_dump(by_alias=True, mode="json")
    assert plain.json()["id"] == "sample-cl" and len(plain.json()["farms"]) == 12


def test_sur_sample_by_id(client):
    r = client.get("/portfolios/sample", params={"id": SUR})
    assert r.status_code == 200
    p = Portfolio.model_validate(r.json())
    assert p.id == SUR and p.currency == "USD" and p.country == "CL" and len(p.farms) == 9
    assert all(f.id.startswith("sur-") for f in p.farms)
    assert Counter(f.crop for f in p.farms) == {"cherry": 2, "blueberry": 2, "walnut": 2, "hazelnut": 3}


def test_unknown_sample_is_404(client):
    r = client.get("/portfolios/sample", params={"id": "nope"})
    assert r.status_code == 404 and r.json()["error"] == "not_found"


def test_farm_ids_unique_across_samples():
    ids = [f.id for p in get_sample_portfolios() for f in p.farms]
    assert len(ids) == len(set(ids)) == 21
    assert [p.id for p in get_sample_portfolios()] == ["sample-cl", SUR]
    assert [s.id for s in list_sample_portfolios()] == ["sample-cl", SUR]


def test_sur_loans_and_zones():
    p = get_sample_portfolio(SUR)
    for f in p.farms:
        assert f.loan.currency == "USD"
        assert abs(installments_total(f.loan.installments) - f.loan.amount) < 0.01, f.id
    # annual post-harvest repayments: every installment falls in March–May
    months = Counter(int(i.due_date[5:7]) for f in p.farms for i in f.loan.installments)
    assert set(months) <= {3, 4, 5} and months[3] + months[4] >= 15
    shared = {z.id: z for z in p.zones if not z.auto}
    assert set(shared) == {"zone-sur-san-nicolas", "zone-sur-los-angeles"}
    for z in shared.values():
        members = [f for f in p.farms if f.zone_id == z.id]
        assert len(members) == 2
        for f in members:
            assert haversine_m(z.center, f.centroid) <= z.radius_m
    assert sum(1 for f in p.farms if f.zone_id.startswith("auto-")) == 5
    assert p.audit == [] and p.credit_rules == []


def test_sur_geojson_is_real_ciren_data():
    feats = sample_features(SUR)
    assert len(feats) == 9
    for fid, f in feats.items():
        pr = f["properties"]
        assert pr["sourceLayer"].startswith("CATASTRO_FRUTICOLA/6") and pr["region"] in {"Maule", "Ñuble", "Biobío"}
        assert 2 <= pr["areaHa"] <= 30
        assert abs(polygon_area_ha(f["geometry"]["coordinates"]) - pr["areaHa"]) < 0.05
        assert "rolpredi" not in pr
    # the commune lookup now covers both samples
    farm = next(f for f in get_sample_portfolio(SUR).farms if f.id == "sur-talca-cherry")
    assert sample_commune(farm).name == "MAULE"


class _StubSource:
    """Minimal export source: no risk, imagery or event code runs."""

    def __init__(self):
        self.calls: list[str] = []

    def crops(self):
        return dispatch.Served([])

    def countries(self):
        return dispatch.Served([])

    def all_sample_portfolios(self):
        return get_sample_portfolios()

    def assess_portfolio(self, p, as_of):
        self.calls.append(f"pf:{p.id}")
        return dispatch.Served({"portfolioId": p.id})

    def assess_farm(self, p, fid, as_of):
        return dispatch.Served({"farmId": fid})

    def imagery(self, p, fid, sr, as_of):
        return dispatch.Served({"farmId": fid, "frames": []})

    def events(self, box, since):
        return dispatch.Served([])


def test_snapshot_exports_every_sample_by_default(tmp_root):
    from app import snapshot

    src = _StubSource()
    out = tmp_root / "snap"
    m = snapshot.export(None, "2026-11-07", True, out, source=src)
    assert src.calls == ["pf:sample-cl", f"pf:{SUR}"]
    # back-compatible top level: the primary portfolio with the v1 names
    assert m.portfolio_id == "sample-cl" and len(m.farm_ids) == 12
    for rel in ("portfolio.json", "assessment-portfolio.json", "events.json"):
        assert rel in m.files
    assert [e.portfolio_id for e in m.portfolios] == ["sample-cl", SUR]
    sur = m.portfolios[1]
    assert (sur.portfolio_file, sur.assessment_file, sur.events_file) == (
        f"portfolio-{SUR}.json", f"assessment-portfolio-{SUR}.json", f"events-{SUR}.json")
    assert len(sur.farm_ids) == 9
    for f in m.files:
        assert (out / f).is_file(), f
    for fid in sur.farm_ids:
        assert f"assessment-farm-{fid}.json" in m.files and f"imagery-{fid}.json" in m.files
    assert json.loads((out / sur.portfolio_file).read_text())["id"] == SUR
    on_disk = SnapshotManifest.model_validate_json((out / "manifest.json").read_text())
    assert on_disk.portfolios == m.portfolios and not m.warnings


def test_snapshot_skips_duplicate_farm_ids(tmp_root):
    from app import snapshot

    cl = get_sample_portfolio()
    clone = cl.model_copy(deep=True, update={"id": "copy", "name": "Copy"})
    m = snapshot.export(None, "2026-11-07", True, tmp_root / "snap2", portfolios=[cl, clone], source=_StubSource())
    assert m.portfolios[1].farm_ids == [] and any("already in another exported portfolio" in w for w in m.warnings)


def test_old_manifest_still_validates():
    old = {"contractVersion": 1, "generatedAt": "2026-11-07T22:13:18Z", "asOf": "2026-11-07", "portfolioId": "sample-cl",
           "portfolioName": "x", "farmIds": [], "files": [], "imageryFrames": 0, "warnings": []}
    assert SnapshotManifest.model_validate(old).portfolios is None
