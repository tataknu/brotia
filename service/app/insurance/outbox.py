"""Insurance request outbox (ADR-0025): store and list requests in DuckDB. No outbound calls.

Table insurance_requests(id PK, created_at, portfolio_id, farm_id, payload JSON, status), created lazily with
CREATE TABLE IF NOT EXISTS (store.py: builders own their tables). 'queued' means stored here, nothing more.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone

from app import config, store
from app.insurance.models import CreateInsuranceRequest, InsuranceRequest, InsuranceRequestPayload

TABLE = "insurance_requests"
MAX_LIST = 500

_DDL = f"""CREATE TABLE IF NOT EXISTS {TABLE} (
    id VARCHAR PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL,
    portfolio_id VARCHAR NOT NULL,
    farm_id VARCHAR NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR NOT NULL
)"""

_ready: set[str] = set()
_ready_lock = threading.Lock()


def _ensure() -> None:
    path = str(config.db_path())
    if path in _ready:
        return
    with _ready_lock:
        if path in _ready:
            return
        store.execute(_DDL)
        _ready.add(path)


def _iso(ts: datetime) -> str:
    if ts.tzinfo is None:  # the store's sessions run in UTC
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def new_id() -> str:
    return f"ins-{uuid.uuid4().hex[:12]}"


def create(req: CreateInsuranceRequest) -> InsuranceRequest:
    """Queue one request. Returns it as stored (status 'queued')."""
    _ensure()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    rid = new_id()
    payload = req.payload.model_dump(by_alias=True, mode="json")
    store.execute(
        f"INSERT INTO {TABLE} (id, created_at, portfolio_id, farm_id, payload, status) VALUES (?, ?, ?, ?, ?, ?)",
        [rid, now, req.portfolio_id, req.farm_id, json.dumps(payload, ensure_ascii=False), "queued"],
    )
    return InsuranceRequest(
        id=rid,
        created_at=_iso(now),
        portfolio_id=req.portfolio_id,
        farm_id=req.farm_id,
        status="queued",
        payload=req.payload,
    )


def list_for(portfolio_id: str) -> list[InsuranceRequest]:
    """A portfolio's requests, newest first (ties by id, for a stable order)."""
    _ensure()
    rows = store.query(
        f"SELECT id, created_at, portfolio_id, farm_id, payload, status FROM {TABLE} "
        f"WHERE portfolio_id = ? ORDER BY created_at DESC, id DESC LIMIT {MAX_LIST}",
        [portfolio_id],
    )
    out: list[InsuranceRequest] = []
    for rid, created, pid, fid, payload, status in rows:
        out.append(
            InsuranceRequest(
                id=rid,
                created_at=_iso(created),
                portfolio_id=pid,
                farm_id=fid,
                status=status,
                payload=InsuranceRequestPayload.model_validate(json.loads(payload) if isinstance(payload, str) else payload),
            )
        )
    return out
