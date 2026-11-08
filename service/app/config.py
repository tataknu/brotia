"""Service configuration. Paths and flags are read from the environment on every call (cheap), so
tests can redirect them with monkeypatch/env before or after import.

Environment variables (all optional):
- CLM_DB_PATH        DuckDB file (default service/data/clm.duckdb)
- CLM_FILES_DIR      static files root served at /files (default service/data/files)
- CLM_SNAPSHOT_DIR   offline snapshot target (default app/public/snapshot)
- CLM_OFFLINE=1      never call upstream; serve cache only (stale-marked when expired)
- ANTHROPIC_API_KEY  agent key (read from env or the gitignored service/.env; never logged)
- ANTHROPIC_MODEL    agent model id (default DEFAULT_AGENT_MODEL)
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

SERVICE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVICE_DIR.parent
FIXTURES_DIR = REPO_ROOT / "contracts" / "v1" / "fixtures"
DATA_DIR = SERVICE_DIR / "data"

SERVICE_VERSION = "0.1.0"
CONTRACT_VERSION = 1
USER_AGENT = "climate-loan-monitor/0.1 (hackathon prototype)"
CORS_ORIGINS = ["http://localhost:5190", "http://127.0.0.1:5190"]
DEFAULT_AGENT_MODEL = "claude-opus-5-5"

#: Open-Meteo free quota from this IP is exhausted until this instant (ADR-0011). http.py refuses
#: any open-meteo.com request before it, without touching the network.
OPEN_METEO_EMBARGO_UNTIL = datetime(2026, 11, 8, 0, 0, tzinfo=timezone.utc)

# Load service/.env once, never overriding real environment variables. Nothing here prints values.
load_dotenv(SERVICE_DIR / ".env", override=False)


def _path(env: str, default: Path) -> Path:
    v = os.environ.get(env)
    return Path(v).expanduser().resolve() if v else default


def db_path() -> Path:
    return _path("CLM_DB_PATH", DATA_DIR / "clm.duckdb")


def files_dir() -> Path:
    return _path("CLM_FILES_DIR", DATA_DIR / "files")


def imagery_dir() -> Path:
    """PNG cache: <files_dir>/imagery/<farmId>/<YYYY-MM-DD>_<layer>.png, served at /files/imagery/..."""
    return files_dir() / "imagery"


def snapshot_dir() -> Path:
    return _path("CLM_SNAPSHOT_DIR", REPO_ROOT / "app" / "public" / "snapshot")


def offline() -> bool:
    return os.environ.get("CLM_OFFLINE", "").strip().lower() in {"1", "true", "yes"}


def agent_available() -> bool:
    """True when an Anthropic key is configured. Never exposes the key itself."""
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def anthropic_api_key() -> str | None:
    """For app.agent only. Do not log, print, return in a response or persist the value."""
    v = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    return v or None


def agent_model() -> str:
    return os.environ.get("ANTHROPIC_MODEL", "").strip() or DEFAULT_AGENT_MODEL


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(dt: datetime | None = None) -> str:
    """ISO 8601 UTC with 'Z', second precision (contract §0)."""
    dt = (dt or utcnow()).astimezone(timezone.utc)
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fixture_fallback() -> bool:
    """While a builder function raises NotImplementedError, routers serve the contract fixture
    (header X-CLM-Fixture: 1, warning added). Set CLM_FIXTURE_FALLBACK=0 to turn that into a 500
    (use before the demo to prove no fixture data leaks)."""
    return os.environ.get("CLM_FIXTURE_FALLBACK", "1").strip().lower() not in {"0", "false", "no"}
