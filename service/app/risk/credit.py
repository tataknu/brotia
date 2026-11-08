"""Credit-rule evaluation (CONTRACT §E.7). Pure: the caller supplies the metric values.

A rule fires when `when` AND every `when.and[]` condition hold. A condition on a null metric is false.
`withinDaysBeforeInstallment: N` additionally requires the next installment (dueDate > asOf) to be due
within N days after asOf. 'risk.*' metrics read scoreTier / score (never the final tier).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from app.models import CreditCondition, CreditRule, FiredCreditAction, Installment

TIER_ORDER = {"normal": 0, "watch": 1, "high": 2}
STRESS_ORDER = {"none": 0, "mild": 1, "moderate": 2, "severe": 3}  # 'unknown' → condition false


@dataclass
class CreditMetrics:
    score: float
    score_tier: str
    decree_active: bool | None
    snowmelt_pct: float | None
    stress_level: str | None
    abandonment: bool | None
    burned_area_intersects: bool | None
    next_installment: Installment | None
    as_of: date

    def get(self, metric: str) -> Any:
        return {
            "risk.tier": self.score_tier,
            "risk.score": self.score,
            "water.decreeActive": self.decree_active,
            "water.snowmeltPct": self.snowmelt_pct,
            "water.stressLevel": self.stress_level,
            "imagery.abandonment": self.abandonment,
            "events.burnedAreaIntersects": self.burned_area_intersects,
        }.get(metric)


def _compare(op: str, a: Any, b: Any) -> bool:
    if op == "eq":
        return a == b
    if op == "neq":
        return a != b
    if op == "gt":
        return a > b
    if op == "gte":
        return a >= b
    if op == "lt":
        return a < b
    if op == "lte":
        return a <= b
    return False


def _ordered(metric: str, v: Any) -> Any:
    if metric == "risk.tier":
        return TIER_ORDER.get(str(v))
    if metric == "water.stressLevel":
        return STRESS_ORDER.get(str(v))
    return v


def condition_holds(cond: CreditCondition, m: CreditMetrics) -> bool:
    actual = m.get(cond.metric)
    if actual is None:
        return False
    expected: Any = cond.value
    if cond.metric in ("risk.tier", "water.stressLevel"):
        a, b = _ordered(cond.metric, actual), _ordered(cond.metric, expected)
        if a is None or b is None:
            return False
    elif isinstance(actual, bool) or isinstance(expected, bool):
        if cond.op not in ("eq", "neq"):
            return False
        a, b = bool(actual), (expected if isinstance(expected, bool) else str(expected).lower() == "true")
    else:
        try:
            a, b = float(actual), float(expected)
        except (TypeError, ValueError):
            return False
    if not _compare(cond.op, a, b):
        return False
    n = cond.within_days_before_installment
    if n is not None:
        inst = m.next_installment
        if inst is None:
            return False
        days = (date.fromisoformat(inst.due_date) - m.as_of).days
        if days <= 0 or days > n:
            return False
    return True


def rule_fires(rule: CreditRule, m: CreditMetrics) -> bool:
    if not rule.enabled:
        return False
    if not condition_holds(rule.when, m):
        return False
    return all(condition_holds(c, m) for c in (rule.when.and_ or []))


def evaluate(rules: list[CreditRule], m: CreditMetrics) -> list[FiredCreditAction]:
    return [FiredCreditAction(rule_id=r.id, action=r.then, message=r.message) for r in rules if rule_fires(r, m)]
