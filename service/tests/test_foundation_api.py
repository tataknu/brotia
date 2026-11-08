"""Router behaviour: contract shapes, errors, CORS, fixture fallback, static files.

These tests hold whether a builder is a placeholder or done: they validate shapes, not values.
Fallback behaviour is tested by forcing NotImplementedError with monkeypatch.
"""

from __future__ import annotations

import pytest

import app.agent
import app.risk
from app.models import (
    AgentRecommendation,
    ApiError,
    CirenOrchardCollection,
    ClimateEventList,
    CountryList,
    CropTemplateList,
    FarmAssessment,
    Health,
    ImageryTimeline,
    Portfolio,
    PortfolioAssessment,
)


def _not_impl(*a, **k):
    raise NotImplementedError


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    h = Health.model_validate(r.json())
    assert h.contract_version == 1 and h.status == "ok" and h.sr_mode in ("ai", "resampled")
    assert set(r.json()) >= {"status", "contractVersion", "serviceVersion", "time", "agentAvailable", "srMode", "srModel", "sources"}


def test_static_lists(client):
    c = client.get("/countries")
    assert c.status_code == 200 and len(CountryList.validate_python(c.json())) == 13
    r = client.get("/crops")
    crops = CropTemplateList.validate_python(r.json())
    assert [t.crop for t in crops] == ["cherry", "blueberry", "avocado", "walnut", "hazelnut", "table_grape"]
    s = client.get("/portfolios/sample")
    assert s.status_code == 200
    Portfolio.model_validate(s.json())


def test_cors_preflight(client):
    r = client.options(
        "/assess/farm",
        headers={"Origin": "http://localhost:5190", "Access-Control-Request-Method": "POST",
                 "Access-Control-Request-Headers": "Content-Type"},
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5190"
    r2 = client.get("/health", headers={"Origin": "http://127.0.0.1:5190"})
    assert r2.headers["access-control-allow-origin"] == "http://127.0.0.1:5190"


def test_validation_error_is_400_invalid_request(client):
    r = client.post("/assess/farm", json={"farmId": "x"})
    assert r.status_code == 400
    body = ApiError.model_validate(r.json())
    assert body.error == "invalid_request" and "portfolio" in body.detail


def test_unknown_farm_is_404(client, sample_portfolio):
    r = client.post("/assess/farm", json={"portfolio": sample_portfolio, "farmId": "cl-nope"})
    assert r.status_code == 404
    assert r.json() == {"error": "not_found", "detail": "farmId 'cl-nope' is not in portfolio 'sample-cl'"}
    r = client.post("/imagery/farm", json={"portfolio": sample_portfolio, "farmId": "cl-nope"})
    assert r.status_code == 404 and r.json()["error"] == "not_found"


def test_assess_farm_fixture_fallback(client, sample_portfolio, monkeypatch):
    monkeypatch.setattr(app.risk, "assess_farm", _not_impl)
    fid = sample_portfolio["farms"][0]["id"]
    r = client.post("/assess/farm", json={"portfolio": sample_portfolio, "farmId": fid, "asOf": "2026-11-07"})
    assert r.status_code == 200 and r.headers.get("x-clm-fixture") == "1"
    fa = FarmAssessment.model_validate(r.json())
    assert fa.farm_id == fid and "not real values" in fa.warnings[0]


def test_fixture_fallback_can_be_disabled(client, sample_portfolio, monkeypatch):
    monkeypatch.setattr(app.risk, "assess_portfolio", _not_impl)
    monkeypatch.setenv("CLM_FIXTURE_FALLBACK", "0")
    r = client.post("/assess/portfolio", json={"portfolio": sample_portfolio})
    assert r.status_code == 500 and r.json()["error"] == "internal_error"


def test_assess_portfolio_and_imagery_shapes(offline, client, sample_portfolio):
    r = client.post("/assess/portfolio", json={"portfolio": sample_portfolio})
    assert r.status_code == 200
    PortfolioAssessment.model_validate(r.json())
    fid = sample_portfolio["farms"][1]["id"]
    r = client.post("/imagery/farm", json={"portfolio": sample_portfolio, "farmId": fid})
    assert r.status_code == 200
    assert ImageryTimeline.model_validate(r.json()).farm_id == fid


def test_builder_bug_is_500_not_fixture(client, sample_portfolio, monkeypatch):
    def broken(*a, **k):
        raise KeyError("oops")

    monkeypatch.setattr(app.risk, "assess_portfolio", broken)
    r = client.post("/assess/portfolio", json={"portfolio": sample_portfolio})
    assert r.status_code == 500 and r.json()["error"] == "internal_error"


def test_builder_output_is_validated(client, sample_portfolio, monkeypatch):
    monkeypatch.setattr(app.risk, "assess_portfolio", lambda p, d: {"portfolioId": "x"})
    r = client.post("/assess/portfolio", json={"portfolio": sample_portfolio})
    assert r.status_code == 500 and "does not match the contract" in r.json()["detail"]


def test_ciren_bbox_rules(offline, client):
    r = client.get("/ciren/orchards", params={"bbox": "-71.5,-31.0,-70.7,-30.5"})
    assert r.status_code == 400 and r.json()["error"] == "bbox_too_large"
    assert r.json()["detail"] == "bbox spans 0.80° × 0.50°; maximum is 0.25° per side"
    r = client.get("/ciren/orchards", params={"bbox": "-71.3,-30.65,-71.2,-30.55", "crop": "banana"})
    assert r.status_code == 400 and r.json()["error"] == "invalid_request"
    r = client.get("/ciren/orchards", params={"bbox": "-71.3,-30.65,-71.2,-30.55", "crop": "table_grape"})
    assert r.status_code == 200
    CirenOrchardCollection.model_validate(r.json())
    r = client.get("/ciren/orchards", params={"bbox": "a,b,c,d"})
    assert r.status_code == 400


def test_events(offline, client):
    r = client.get("/events", params={"bbox": "-72,-35,-70,-30", "since": "2025-10-07"})
    assert r.status_code == 200
    evs = ClimateEventList.validate_python(r.json())
    assert all(e.affected_farm_ids == [] and e.affected_exposure == 0 for e in evs)
    r = client.get("/events", params={"bbox": "-100,-60,-60,0"})
    assert r.status_code == 400 and r.json()["error"] == "bbox_too_large"


def test_agent_rules(client, sample_portfolio, monkeypatch):
    body = {"portfolio": sample_portfolio, "question": "Should I relax the harvest rain threshold?"}
    r = client.post("/agent/recommend", json={**body, "zoneId": "auto-cl-ovalle-table-grape", "farmId": "cl-ovalle-table-grape"})
    assert r.status_code == 400
    r = client.post("/agent/recommend", json={**body, "zoneId": "zone-nope"})
    assert r.status_code == 404
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post("/agent/recommend", json=body)
    assert r.status_code == 503 and r.json()["error"] == "no_api_key"
    assert client.get("/health").json()["agentAvailable"] is False
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-not-a-real-key")
    monkeypatch.setattr(app.agent, "recommend", _not_impl)
    r = client.post("/agent/recommend", json={**body, "zoneId": "auto-cl-ovalle-table-grape"})
    assert r.status_code == 200 and r.headers.get("x-clm-fixture") == "1"
    rec = AgentRecommendation.model_validate(r.json())
    assert rec.question == body["question"] and rec.zone_id == "auto-cl-ovalle-table-grape"


def test_static_files(client, tmp_root):
    d = tmp_root / "files" / "imagery" / "farm-a"
    d.mkdir(parents=True, exist_ok=True)
    (d / "2026-11-03_ndvi.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    r = client.get("/files/imagery/farm-a/2026-11-03_ndvi.png")
    assert r.status_code == 200 and r.content.startswith(b"\x89PNG")
    r = client.get("/files/imagery/farm-a/missing.png")
    assert r.status_code == 404 and r.json()["error"] == "not_found"


def test_unknown_route_is_api_error(client):
    r = client.get("/nope")
    assert r.status_code == 404 and set(r.json()) == {"error", "detail"}


def test_health_is_fast_when_db_is_locked_by_another_process(client, tmp_root):
    import subprocess
    import sys
    import time

    from app import config

    holder = subprocess.Popen(
        [sys.executable, "-c",
         "import duckdb, sys, time; c = duckdb.connect(sys.argv[1]); c.execute('SELECT 1'); print('held', flush=True); time.sleep(8)",
         str(config.db_path())],
        stdout=subprocess.PIPE, text=True,
    )
    try:
        assert holder.stdout.readline().strip() == "held"
        t0 = time.monotonic()
        r = client.get("/health")
        elapsed = time.monotonic() - t0
        assert r.status_code == 200 and elapsed < 2.0, elapsed
        assert r.json()["sources"] == []
    finally:
        holder.kill()
        holder.wait()
