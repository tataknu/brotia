"""POST /assess/portfolio, POST /assess/farm"""

from __future__ import annotations

from fastapi import APIRouter

from app.models import AssessFarmRequest, AssessPortfolioRequest, FarmAssessment, PortfolioAssessment
from app.routers import dispatch
from app.routers.common import require_farm, resolve_as_of
from app.routers.respond import respond

router = APIRouter(tags=["assess"])


@router.post("/assess/portfolio", response_model=PortfolioAssessment)
def assess_portfolio(req: AssessPortfolioRequest):
    return respond(dispatch.assess_portfolio(req.portfolio, resolve_as_of(req.as_of)))


@router.post("/assess/farm", response_model=FarmAssessment)
def assess_farm(req: AssessFarmRequest):
    require_farm(req.portfolio, req.farm_id)
    return respond(dispatch.assess_farm(req.portfolio, req.farm_id, resolve_as_of(req.as_of)))
