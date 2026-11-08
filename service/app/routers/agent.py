"""POST /agent/recommend"""

from __future__ import annotations

from fastapi import APIRouter

from app import config
from app.models import AgentRecommendation, AgentRequest
from app.routers import dispatch
from app.routers.common import require_farm, require_zone
from app.routers.errors import invalid_request, no_api_key
from app.routers.respond import respond

router = APIRouter(tags=["agent"])


@router.post("/agent/recommend", response_model=AgentRecommendation)
def recommend(req: AgentRequest):
    if req.zone_id and req.farm_id:
        raise invalid_request("set at most one of zoneId and farmId")
    if not req.question.strip():
        raise invalid_request("question is empty")
    if req.farm_id:
        require_farm(req.portfolio, req.farm_id)
    if req.zone_id:
        require_zone(req.portfolio, req.zone_id)
    if not config.agent_available():
        raise no_api_key()
    return respond(dispatch.agent(req))
