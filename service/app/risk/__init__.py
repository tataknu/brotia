"""svc-risk: farm and portfolio assessment (CONTRACT §E.1, §E.5–E.11; ADR-0013 D6, D7).

Routers call exactly these two functions (signatures from the service foundation):
    assess_farm(portfolio, farm_id, as_of) -> FarmAssessment
    assess_portfolio(portfolio, as_of) -> PortfolioAssessment

Modules
- formula.py  pure risk maths (§E.1): ramp, noisy-OR, base/score, tiers, formula string, headline
- credit.py   credit-rule evaluation (§E.7)
- signals.py  series → signals: last-7-day extremes, 72 h rain, chill hours, z / persistent z, dry season
- drivers.py  C, D and G drivers (§E.5)
- water.py    water ladder (§E.11), peers (§E.9), abandonment (§E.10)
- dem.py      Copernicus DEM GLO-30 (Planetary Computer) for the frost-pocket factor
- deps.py     calls into the other builder packages (patched in tests)
- assess.py   orchestration, DuckDB cache, portfolio aggregation
"""

from __future__ import annotations

from datetime import date

from app.models import FarmAssessment, Portfolio, PortfolioAssessment
from app.risk import assess as _assess


def assess_farm(portfolio: Portfolio, farm_id: str, as_of: date) -> FarmAssessment:
    """POST /assess/farm. farm_id already checked by the router (404 handled there)."""
    return _assess.assess_farm(portfolio, farm_id, as_of)


def assess_portfolio(portfolio: Portfolio, as_of: date) -> PortfolioAssessment:
    """POST /assess/portfolio. Farm-level failures become warnings, never a failed request."""
    return _assess.assess_portfolio(portfolio, as_of)
