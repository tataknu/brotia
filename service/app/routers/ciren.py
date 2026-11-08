"""GET /ciren/orchards?bbox=minLng,minLat,maxLng,maxLat&crop=<Crop>"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.models import CROPS, CirenOrchardCollection
from app.routers import dispatch
from app.routers.common import parse_bbox
from app.routers.errors import invalid_request
from app.routers.respond import respond

router = APIRouter(tags=["ciren"])

MAX_SIDE_DEG = 0.25


@router.get("/ciren/orchards", response_model=CirenOrchardCollection)
def ciren_orchards(bbox: str | None = Query(default=None), crop: str | None = Query(default=None)):
    box = parse_bbox(bbox, MAX_SIDE_DEG)
    if crop is not None and crop not in CROPS:
        raise invalid_request(f"crop '{crop}' is not one of {', '.join(CROPS)}")
    return respond(dispatch.ciren_orchards(box, crop))
