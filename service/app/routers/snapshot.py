"""POST /snapshot/export"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app import snapshot
from app.models import SnapshotExportRequest, SnapshotManifest

router = APIRouter(tags=["snapshot"])


@router.post("/snapshot/export", response_model=SnapshotManifest)
def export(req: SnapshotExportRequest | None = None):
    req = req or SnapshotExportRequest()
    manifest = snapshot.export(req.portfolio, req.as_of, True if req.sr is None else bool(req.sr),
                               portfolios=req.portfolios or None)
    return JSONResponse(manifest.model_dump(by_alias=True, mode="json"))
