"""Pure risk maths (CONTRACT §E.1, §E.5, §E.7). No IO here: callers feed drivers in, a Risk comes out.

Ported from contracts/v1/tools/gen_fixtures.py (`ramp`, `noisy_or`, `assess_risk`) so the two contract
fixtures are reproduced exactly (tests/test_risk_formula.py).

C = 1 − ∏(1 − s_p·x_p) over climate perils       (noisy-OR, §E.1 contract definition)
D = 1 − ∏(1 − s_p·x_p) over disaster perils
G = mean of the AVAILABLE geography factors (0 when none)
base  = 0.5·(a·C + b·D)/(a + b) + 0.5·max(C, D)
score = round(100·min(1, base·(1 + c·G)), 1); tiers normal < 35 ≤ watch < 60 ≤ high
"""

from __future__ import annotations

from typing import Any, Iterable

from app.models import Driver, FiredCreditAction, Provenance, Risk, RiskComponent, RiskComponents, RiskWeights, StageRef

TIER_ORDER = ["normal", "watch", "high"]
WATCH_AT = 35.0
HIGH_AT = 60.0

#: Credit action → tier floor (§E.7).
ACTION_FLOOR = {"watch": "watch", "field_visit": "watch", "high": "high", "restructure_review": "high"}


def ramp(v: float, v0: float, v1: float) -> float:
    """clamp((v − v0)/(v1 − v0), 0, 1); works for decreasing ramps (v1 < v0)."""
    if v1 == v0:  # degenerate ramp (e.g. a threshold edited to 0): no defined slope
        return 0.0
    return max(0.0, min(1.0, (v - v0) / (v1 - v0)))


def noisy_or(xs: Iterable[float]) -> float:
    p = 1.0
    for x in xs:
        p *= 1.0 - max(0.0, min(1.0, x))
    return 1.0 - p


def tier_for(score: float) -> str:
    return "high" if score >= HIGH_AT else "watch" if score >= WATCH_AT else "normal"


def max_tier(*tiers: str) -> str:
    return max(tiers, key=TIER_ORDER.index)


def r3(x: float) -> float:
    return round(float(x), 3)


def make_driver(
    component: str,
    peril: str,
    metric: str,
    severity: float,
    sensitivity: float | None,
    c: float,
    text: str,
    value: Any,
    normal: Any,
    unit: str | None,
    provenance: Provenance,
) -> Driver:
    """impact = s·x for C/D drivers, c·x for geography drivers (§E.1)."""
    severity = max(0.0, min(1.0, float(severity)))
    if component == "geography":
        impact, sens = c * severity, None
    else:
        sens = float(sensitivity or 0.0)
        impact = sens * severity
    return Driver(
        component=component,
        peril=peril,
        metric=metric,
        severity=r3(severity),
        sensitivity=sens,
        impact=r3(impact),
        text=text,
        value=value,
        normal=normal,
        unit=unit,
        provenance=provenance,
    )


def components(climate: list[Driver], disaster: list[Driver], geography: list[Driver],
               geography_available: list[Driver] | None = None) -> tuple[float, float, float]:
    """(C, D, G) unrounded. Severities are taken unrounded where possible: drivers store 3 decimals,
    which is what the fixture generator also multiplies."""
    C = noisy_or((d.sensitivity or 0.0) * d.severity for d in climate)
    D = noisy_or((d.sensitivity or 0.0) * d.severity for d in disaster)
    geo = geography if geography_available is None else geography_available
    G = sum(d.severity for d in geo) / len(geo) if geo else 0.0
    return C, D, G


def combine(C: float, D: float, G: float, w: RiskWeights) -> tuple[float, float]:
    """(base, score) per §E.1. Score rounded to 1 decimal from the unrounded base."""
    a, b, c = w.a, w.b, w.c
    wsum = a + b
    mean = (a * C + b * D) / wsum if wsum > 0 else 0.0
    base = 0.5 * mean + 0.5 * max(C, D)
    score = round(100.0 * min(1.0, base * (1.0 + c * G)), 1)
    return base, score


def formula_text(C: float, D: float, G: float, base: float, score: float, w: RiskWeights) -> str:
    a, b, c = w.a, w.b, w.c
    return (f"base = 0.5·({a:.2f}·{C:.2f} + {b:.2f}·{D:.2f})/({a:.2f}+{b:.2f}) + 0.5·max({C:.2f}, {D:.2f}) = {base:.2f}; "
            f"risk = 100·min(1, {base:.2f}·(1 + {c:.2f}·{G:.2f})) = {score:.1f}")


def _by_impact(ds: Iterable[Driver]) -> list[Driver]:
    # stable sort: ties keep the evaluation order
    return sorted(ds, key=lambda d: -d.impact)


def headline_for(stage_label: str, climate: list[Driver], disaster: list[Driver]) -> str:
    """'<stage label>: <top C/D driver text>' when its impact ≥ 0.1, else 'No significant stress at <stage>.'
    Geography never headlines (it amplifies, never acts alone)."""
    cd = _by_impact(d for d in climate + disaster if d.impact > 0)
    top = cd[0] if cd else None
    if top is not None and top.impact >= 0.1:
        return f"{stage_label}: {top.text}"
    return f"No significant stress at {stage_label.lower()}."


def assess_risk(
    stage_key: str,
    stage_label: str,
    weights: RiskWeights,
    climate: list[Driver],
    disaster: list[Driver],
    geography: list[Driver],
    fired: list[FiredCreditAction],
    geography_available: list[Driver] | None = None,
) -> Risk:
    """Build the Risk object from evaluated drivers and fired credit actions (§E.1, §E.7).
    `geography_available`: the subset of geography drivers whose input was available (G is their mean);
    defaults to all geography drivers."""
    C, D, G = components(climate, disaster, geography, geography_available)
    base, score = combine(C, D, G, weights)
    st = tier_for(score)
    floor = "normal"
    for f in fired:
        floor = max_tier(floor, ACTION_FLOOR.get(f.action, "normal"))
    final = max_tier(st, floor)
    top5 = _by_impact(d for d in climate + disaster + geography if d.impact > 0)[:5]
    comp = lambda key, val, ds: RiskComponent(key=key, value=r3(val), drivers=_by_impact(ds))  # noqa: E731
    return Risk(
        score=score,
        score_tier=st,
        tier=final,
        stage=StageRef(key=stage_key, label=stage_label),
        components=RiskComponents(
            climate=comp("climate", C, climate),
            disaster=comp("disaster", D, disaster),
            geography=comp("geography", G, geography),
        ),
        weights=weights,
        formula=formula_text(C, D, G, base, score, weights),
        headline=headline_for(stage_label, climate, disaster),
        drivers=top5,
        credit_actions=fired,
    )


def score_only(C: float, D: float, G: float, weights: RiskWeights) -> tuple[float, str]:
    """(score, scoreTier) — used by credit-rule evaluation before the Risk object exists."""
    _, score = combine(C, D, G, weights)
    return score, tier_for(score)
