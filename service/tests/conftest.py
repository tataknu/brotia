"""Shared pytest setup (service foundation).

Every test session gets its own DuckDB file, files dir and snapshot dir under a tmp folder, so tests
never touch service/data/clm.duckdb or app/public/snapshot, and can run while the server is up.
Upstream calls are never made by foundation tests (respx mocks them).

Fixtures for everyone:
- client            FastAPI TestClient on app.main.app
- fixture_json(name) loads contracts/v1/fixtures/<name>
- sample_portfolio  the contract 2-farm sample portfolio (JSON dict)
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest

# Idempotent: if this module is imported twice (e.g. as `tests.conftest`), reuse the same tmp dir.
if "CLM_TEST_TMP" not in os.environ:
    os.environ["CLM_TEST_TMP"] = tempfile.mkdtemp(prefix="clm-tests-")
_TMP = Path(os.environ["CLM_TEST_TMP"]).resolve()
os.environ["CLM_DB_PATH"] = str(_TMP / "test.duckdb")
os.environ["CLM_FILES_DIR"] = str(_TMP / "files")
os.environ["CLM_SNAPSHOT_DIR"] = str(_TMP / "snapshot")
os.environ.setdefault("CLM_FIXTURE_FALLBACK", "1")

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "v1" / "fixtures"


@pytest.fixture(scope="session")
def tmp_root() -> Path:
    return _TMP


@pytest.fixture(scope="session")
def fixture_json():
    def load(name: str):
        return json.loads((FIXTURES / name).read_text())

    return load


@pytest.fixture()
def sample_portfolio(fixture_json):
    return fixture_json("portfolio-sample.json")


@pytest.fixture()
def offline(monkeypatch):
    """Serve-from-cache mode for tests that reach real builder code through the routers: with the per-session
    tmp DB empty, every upstream source answers 'unavailable' without touching the network. (Not autouse:
    offline short-circuits before the transport, so respx-mocked builder tests must stay online.)"""
    monkeypatch.setenv("CLM_OFFLINE", "1")
    monkeypatch.setenv("CLM_WEATHER_BACKGROUND", "0")
    yield


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
