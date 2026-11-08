"""POST /imagery/farm (PNGs are served by the /files static mount in main.py)."""

from __future__ import annotations

from fastapi import APIRouter

from app.models import ImageryRequest, ImageryTimeline
from app.routers import dispatch
from app.routers.common import require_farm, resolve_as_of
from app.routers.respond import respond

router = APIRouter(tags=["imagery"])


@router.post("/imagery/farm", response_model=ImageryTimeline)
def imagery_farm(req: ImageryRequest):
    require_farm(req.portfolio, req.farm_id)
    sr = True if req.sr is None else bool(req.sr)
    return respond(dispatch.imagery(req.portfolio, req.farm_id, sr, resolve_as_of(req.as_of)))
