"""svc-portfolio: crop templates, countries, the sample portfolio, rule layering (§E.2), stages (§E.3),
zones (§E.4), exposure (§E.8), credit-rule evaluation helpers (§E.7) and the audit trail.

Signatures kept from the foundation placeholder (routers and other builders call them). as_of is a
datetime.date (routers resolve the default); 'YYYY-MM-DD' strings are also accepted.

Submodules: templates, schedule, stages, zones, rules, portfolio, sample_spec, build_sample.
"""

from __future__ import annotations

from datetime import date, timedelta

from app.domain import rules as rules  # noqa: F401  (re-export the module)
from app.domain.portfolio import (  # noqa: F401
    get_sample_portfolio,
    get_sample_portfolios,
    list_sample_portfolios,
    sample_commune,
    sample_irrigation,
)
from app.domain.rules import (  # noqa: F401
    ACTION_FLOOR,
    CREDIT_METRICS,
    TIER_ORDER,
    apply_change,
    commit_change,
    compare_metric,
    effective_credit_rules,
    effective_credit_rules_for_farm,
    effective_rules_for_zone,
    effective_template,
    effective_value_at,
    evaluate_condition,
    evaluate_credit_rules,
    installment_within,
    make_change,
    max_tier,
    resolve_farm_leaf,
    rule_fires,
    score_tier,
    tier_floor,
)
from app.domain.schedule import generate_installments, make_loan, next_installment, outstanding_at  # noqa: F401
from app.domain.stages import check_stage_tiling, find_current_stage, stage_bands_for, tiling_warnings  # noqa: F401
from app.domain.templates import get_countries, get_crop_template, get_crop_templates  # noqa: F401
from app.domain.zones import (  # noqa: F401
    ZONE_RADIUS_M,
    assign_zone_id,
    auto_zone_id,
    effective_zone,
    farms_in_zone,
    haversine_m,
    make_auto_zone,
    sync_zones,
)
from app.models import CropTemplate, Stage, StageBand


def _d(as_of: date | str) -> date:
    return as_of if isinstance(as_of, date) else date.fromisoformat(as_of[:10])


def current_stage(template: CropTemplate, as_of: date | str) -> tuple[Stage, list[str]]:
    """§E.3: stage whose window contains as_of. Overlap -> first in order; gap -> latest start before the
    date. A warning is returned in either case."""
    cs = find_current_stage(template.stages, _d(as_of))
    if cs is None:
        raise ValueError(f"crop template '{template.crop}' has no stages")
    warnings: list[str] = []
    if cs.gap:
        warnings.append(f"{template.crop}: {_d(as_of).isoformat()} falls in no stage window (edited calendar); "
                        f"using '{cs.stage.key}', the stage that started last.")
    if cs.overlap:
        warnings.append(f"{template.crop}: several stage windows contain {_d(as_of).isoformat()} (edited calendar); "
                        f"using '{cs.stage.key}', the first in order.")
    return cs.stage, warnings


def window_start(as_of: date | str) -> date:
    """Start of the 13-month display window ending as_of (same arithmetic as app.routers.common)."""
    d = _d(as_of)
    total = d.year * 12 + (d.month - 1) - 13
    y, m0 = divmod(total, 12)
    for day in (d.day, 30, 29, 28):
        try:
            return date(y, m0 + 1, min(d.day, day))
        except ValueError:
            continue
    return date(y, m0 + 1, 28)


def stage_bands(template: CropTemplate, as_of: date | str) -> list[StageBand]:
    """§E.3: concrete dated bands covering the 13-month window ending as_of, clipped, ascending. Pass the
    EFFECTIVE template (effective_template) so zone/farm stage shifts show."""
    end = _d(as_of)
    return stage_bands_for(template.stages, window_start(end), end)


__all__ = [
    "get_countries", "get_crop_templates", "get_crop_template", "get_sample_portfolio", "get_sample_portfolios",
    "list_sample_portfolios", "effective_zone",
    "effective_template", "current_stage", "stage_bands", "outstanding_at", "next_installment",
    "generate_installments", "evaluate_credit_rules", "tier_floor", "score_tier", "apply_change", "make_change",
    "commit_change", "sync_zones", "assign_zone_id", "window_start",
]
