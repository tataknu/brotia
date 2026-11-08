"""GET /health, /countries, /crops, /portfolios/sample[?id=], /portfolios/samples (v1.1)."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.models import Country, CropTemplate, Health, Portfolio, SamplePortfolioSummary
from app.routers import dispatch
from app.routers.respond import respond

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=Health)
def health():
    return respond(dispatch.health())


@router.get("/countries", response_model=list[Country])
def countries():
    return respond(dispatch.countries())


@router.get("/crops", response_model=list[CropTemplate])
def crops():
    return respond(dispatch.crops())


@router.get("/portfolios/sample", response_model=Portfolio)
def sample_portfolio(id: str | None = Query(default=None, description="Sample id from /portfolios/samples; default 'sample-cl'")):
    return respond(dispatch.sample_portfolio(id))


@router.get("/portfolios/samples", response_model=list[SamplePortfolioSummary])
def sample_portfolios():
    return respond(dispatch.sample_portfolios())
