"""POST /insurance/requests, GET /insurance/requests?portfolioId= (v1.1, ADR-0025). Outbox only: no outbound calls."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.insurance import outbox
from app.insurance.models import CreateInsuranceRequest, InsuranceRequest
from app.routers.errors import invalid_request

router = APIRouter(tags=["insurance"])


@router.post("/insurance/requests", response_model=InsuranceRequest)
def create_request(req: CreateInsuranceRequest) -> InsuranceRequest:
    return outbox.create(req)


@router.get("/insurance/requests", response_model=list[InsuranceRequest])
def list_requests(portfolio_id: str | None = Query(default=None, alias="portfolioId")) -> list[InsuranceRequest]:
    if not portfolio_id or not portfolio_id.strip():
        raise invalid_request("portfolioId is required")
    return outbox.list_for(portfolio_id)
