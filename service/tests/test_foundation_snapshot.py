"""Snapshot export writes the §C layout and a consistent manifest."""

from __future__ import annotations

import json

from app.models import SnapshotManifest


def test_snapshot_export(offline, client, tmp_root, sample_portfolio, fixture_json, monkeypatch):
    import app.imagery

    # force the imagery fixture and cache one of its PNGs so the copy path is exercised
    monkeypatch.setattr(app.imagery, "farm_imagery", lambda *a, **k: (_ for _ in ()).throw(NotImplementedError()))
    png_url = fixture_json("imagery-cl-ovalle-table-grape.json")["frames"][0]["urls"]["ndvi"]
    png = tmp_root / "files" / png_url[len("/files/"):]
    png.parent.mkdir(parents=True, exist_ok=True)
    png.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    fid = sample_portfolio["farms"][1]["id"]
    r = client.post("/snapshot/export", json={"portfolio": sample_portfolio, "asOf": "2026-11-07"})
    assert r.status_code == 200, r.text
    m = SnapshotManifest.model_validate(r.json())
    snap = tmp_root / "snapshot"
    assert m.portfolio_id == sample_portfolio["id"] and m.as_of == "2026-11-07"
    assert set(m.farm_ids) == {f["id"] for f in sample_portfolio["farms"]}
    for f in m.files:
        assert (snap / f).is_file(), f
    for required in ["manifest.json", "portfolio.json", "crops.json", "countries.json",
                     "assessment-portfolio.json", "events.json", f"assessment-farm-{fid}.json", f"imagery-{fid}.json"]:
        assert required in m.files
    assert png_url[len("/files/"):] in m.files and m.imagery_frames > 0
    assert any("not real values" in w for w in m.warnings)
    on_disk = json.loads((snap / "manifest.json").read_text())
    assert on_disk["files"] == m.files

    # second export replaces the first (no leftovers, no temp dirs)
    r2 = client.post("/snapshot/export", json={"portfolio": sample_portfolio, "asOf": "2026-11-07", "sr": False})
    assert r2.status_code == 200
    assert not [p for p in tmp_root.iterdir() if p.name.startswith(".snapshot")]
