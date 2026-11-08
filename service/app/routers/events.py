"""GET /events?bbox=minLng,minLat,maxLng,maxLat&since=YYYY-MM-DD"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.models import ClimateEvent
from app.routers import dispatch
from app.routers.common import parse_bbox, resolve_as_of, today_utc, window_start
from app.routers.respond import respond

router = APIRouter(tags=["events"])

MAX_SIDE_DEG = 25.0


@router.get("/events", response_model=list[ClimateEvent])
def events(bbox: str | None = Query(default=None), since: str | None = Query(default=None)):
    box = parse_bbox(bbox, MAX_SIDE_DEG)
    since_d = resolve_as_of(since) if since else window_start(today_utc())
    return respond(dispatch.events(box, since_d))
