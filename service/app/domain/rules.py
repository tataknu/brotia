"""Rules engine: Python mirror of app/src/domain/rules.ts (CONTRACT §E.2, §E.7 helpers, audit).

Everything works on the JSON (camelCase) form of the models, because RuleChange paths are JSON dot
paths. Public helpers accept models and return models where the contract has a type.

- Layering: effective leaf = farm.overrides ?? zone.overrides[crop] ?? portfolio.cropOverrides[crop] ?? template,
  merged per leaf; null/missing = not set.
- Credit rules: template (by id) -> portfolio.creditRules (same id replaces, new id appends) ->
  farm.creditRuleOverrides[id] merged per field (`when` per field).
- Credit evaluation (§E.7): conditions on a metrics dict keyed by CreditMetric; null metric -> false.
- Audit: apply a RuleChange (null newValue deletes the leaf and prunes empty parents; in
  portfolio.creditRules the segment after 'creditRules' selects the rule by id), make a change with
  oldValue = effective value before it, commit (apply + append).
"""

from __future__ import annotations

import copy
import itertools
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from app.models import (
    CreditRule,
    CropTemplate,
    Farm,
    FiredCreditAction,
    Installment,
    Portfolio,
    RuleChange,
    Stage,
    Zone,
)
from app.domain.stages import tiling_warnings
from app.domain.zones import assign_zone_id, effective_zone

Obj = dict[str, Any]

# ───────────────────────── generic path helpers ─────────────────────────


def _is_obj(v: Any) -> bool:
    return isinstance(v, dict)


def _is_set(v: Any) -> bool:
    return v is not None


def is_deep_empty(v: Any) -> bool:
    return (not _is_set(v)) or (_is_obj(v) and all(is_deep_empty(x) for x in v.values()))


def split_path(path: str | list[str]) -> list[str]:
    if isinstance(path, list):
        return path
    return [s for s in path.split(".") if s]


def get_at_path(root: Any, path: str | list[str]) -> Any:
    """Reads a dot path. Lists of objects with `id` (portfolio.creditRules) are indexed by id."""
    cur = root
    for s in split_path(path):
        if isinstance(cur, list):
            cur = next((x for x in cur if _is_obj(x) and x.get("id") == s), None)
        elif _is_obj(cur):
            cur = cur.get(s)
        else:
            return None
    return cur


def set_at_path(root: Any, path: str | list[str], value: Any, prune_top_level: bool = False) -> Any:
    """Returns a new structure with `value` set at the path (missing objects created). value None deletes
    the leaf and prunes empty parent objects, below the root's top-level keys unless prune_top_level.
    In lists a segment selects the element by id: setting the whole element upserts it, None removes it."""
    segs = split_path(path)
    if not segs:
        return root
    return _set_rec(root, segs, value, 1 if prune_top_level else 0)


def _set_rec(node: Any, segs: list[str], value: Any, depth: int) -> Any:
    head, rest = segs[0], segs[1:]
    delete = not _is_set(value)
    if isinstance(node, list):
        idx = next((i for i, x in enumerate(node) if _is_obj(x) and x.get("id") == head), -1)
        if not rest:
            if delete:
                return node if idx < 0 else [x for i, x in enumerate(node) if i != idx]
            if idx < 0:
                return [*node, copy.deepcopy(value)]
            return [copy.deepcopy(value) if i == idx else x for i, x in enumerate(node)]
        if idx < 0:
            return node
        child = _set_rec(node[idx], rest, value, depth + 1)
        return [child if i == idx else x for i, x in enumerate(node)]
    obj: Obj = dict(node) if _is_obj(node) else {}
    if not rest:
        if delete:
            obj.pop(head, None)
        else:
            obj[head] = copy.deepcopy(value)
        return obj
    child = _set_rec(obj.get(head), rest, value, depth + 1)
    if delete and depth >= 1 and _is_obj(child) and is_deep_empty(child):
        obj.pop(head, None)
    else:
        obj[head] = child
    return obj


def _j(model: Any) -> Any:
    """Model -> JSON-ready camelCase dict (None stays None)."""
    if model is None:
        return None
    if hasattr(model, "model_dump"):
        return model.model_dump(by_alias=True, mode="json")
    return copy.deepcopy(model)


# ───────────────────────── templates and layering ─────────────────────────

RuleLayer = str  # 'template' | 'crop' | 'zone' | 'farm'


def template_leaf(template: CropTemplate | Obj, path: str | list[str]) -> Any:
    """Value of a RulesPatch-shaped leaf path in a template ('stages.<k>.…' maps onto the stages list)."""
    t = _j(template)
    segs = split_path(path)
    if segs and segs[0] == "stages":
        st = next((s for s in t["stages"] if len(segs) > 1 and s["key"] == segs[1]), None)
        return get_at_path(st, segs[2:]) if st is not None else None
    return get_at_path(t, segs)


def _apply_patch(eff: Obj, patch: Obj | None, warnings: list[str] | None = None, label: str = "") -> None:
    if not patch:
        return
    for key, sp in (patch.get("stages") or {}).items():
        st = next((s for s in eff["stages"] if s["key"] == key), None)
        if st is None or not sp:
            if warnings is not None and sp:
                warnings.append(f"{label}: override for unknown stage '{key}' ignored.")
            continue
        if _is_set(sp.get("start")):
            st["start"] = sp["start"]
        if _is_set(sp.get("end")):
            st["end"] = sp["end"]
        for p, v in (sp.get("sensitivity") or {}).items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                st["sensitivity"][p] = v
    r = patch.get("rules")
    if r:
        for key, th in (r.get("stages") or {}).items():
            base = eff["rules"]["stages"].get(key)
            if base is None or not th:
                if warnings is not None and th:
                    warnings.append(f"{label}: threshold override for unknown stage '{key}' ignored.")
                continue
            for f, v in th.items():
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    base[f] = v
        for k in ("chillHoursMin", "baselineYears"):
            v = r.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                eff["rules"][k] = v
    for k, v in (patch.get("weights") or {}).items():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            eff["weights"][k] = v


def resolve_rules(template: CropTemplate, patches_least_specific_first: list[Any],
                  warnings: list[str] | None = None, labels: list[str] | None = None) -> Obj:
    """Deep-merges patches (least specific first) onto the template per leaf. Returns
    {'crop', 'stages', 'rules', 'weights'} in JSON form."""
    t = _j(template)
    eff = {"crop": t["crop"], "stages": copy.deepcopy(t["stages"]), "rules": copy.deepcopy(t["rules"]),
           "weights": copy.deepcopy(t["weights"])}
    for i, p in enumerate(patches_least_specific_first):
        _apply_patch(eff, _j(p), warnings, (labels[i] if labels else f"layer {i}"))
    return eff


def _farm_chain(portfolio: Portfolio, farm: Farm, zone: Zone | None) -> list[tuple[RuleLayer, Any]]:
    """Override chain for a farm, most specific first."""
    return [
        ("farm", _j(farm.overrides)),
        ("zone", _j((zone.overrides or {}).get(farm.crop)) if zone else None),
        ("crop", _j(portfolio.crop_overrides.get(farm.crop))),
    ]


def _zone_of(portfolio: Portfolio, farm: Farm) -> Zone | None:
    return portfolio.zone(assign_zone_id(farm.id, farm.centroid, portfolio.zones))


def effective_rules_for_farm(portfolio: Portfolio, template: CropTemplate, farm: Farm,
                             warnings: list[str] | None = None) -> Obj:
    chain = _farm_chain(portfolio, farm, _zone_of(portfolio, farm))
    rev = list(reversed(chain))
    return resolve_rules(template, [p for _, p in rev], warnings,
                         [f"{farm.id} {layer} override" for layer, _ in rev])


def effective_rules_for_zone(portfolio: Portfolio, template: CropTemplate, zone_id: str) -> Obj:
    zone = portfolio.zone(zone_id)
    zp = _j((zone.overrides or {}).get(template.crop)) if zone else None
    return resolve_rules(template, [_j(portfolio.crop_overrides.get(template.crop)), zp])


def effective_rules_for_crop(portfolio: Portfolio, template: CropTemplate) -> Obj:
    return resolve_rules(template, [_j(portfolio.crop_overrides.get(template.crop))])


@dataclass
class ResolvedLeaf:
    value: Any
    #: 'template' (inherited default) | 'crop' | 'zone' | 'farm'. Non-template layers are "Custom" in the UI.
    layer: RuleLayer


def _resolve_chain(chain: list[tuple[RuleLayer, Any]], template: CropTemplate | None, path: str) -> ResolvedLeaf:
    for layer, patch in chain:
        v = get_at_path(patch, path)
        if _is_set(v):
            return ResolvedLeaf(v, layer)
    return ResolvedLeaf(template_leaf(template, path) if template is not None else None, "template")


def resolve_farm_leaf(portfolio: Portfolio, template: CropTemplate | None, farm: Farm, path: str) -> ResolvedLeaf:
    return _resolve_chain(_farm_chain(portfolio, farm, _zone_of(portfolio, farm)), template, path)


def resolve_zone_leaf(portfolio: Portfolio, template: CropTemplate | None, zone_id: str, crop: str, path: str) -> ResolvedLeaf:
    zone = portfolio.zone(zone_id)
    chain = [("zone", _j((zone.overrides or {}).get(crop)) if zone else None),
             ("crop", _j(portfolio.crop_overrides.get(crop)))]
    return _resolve_chain(chain, template, path)


def resolve_crop_leaf(portfolio: Portfolio, template: CropTemplate | None, crop: str, path: str) -> ResolvedLeaf:
    return _resolve_chain([("crop", _j(portfolio.crop_overrides.get(crop)))], template, path)


# ───────────────────────── credit rules (merge) ─────────────────────────


@dataclass
class EffectiveCreditRule:
    rule: CreditRule
    #: 'template' | 'portfolio'
    source: str
    #: fields changed by farm.creditRuleOverrides[id], e.g. ['when.withinDaysBeforeInstallment']
    farm_overridden: list[str] = field(default_factory=list)


def effective_credit_rules(template_rules: list[CreditRule], portfolio_rules: list[CreditRule],
                           farm_overrides: dict[str, Any] | None = None) -> list[EffectiveCreditRule]:
    """Template rules -> portfolio rules (replace by id / append) -> farm overrides per field.
    Includes disabled rules (the evaluator skips them)."""
    out: list[tuple[Obj, str, list[str]]] = [(_j(r), "template", []) for r in template_rules]
    for r in portfolio_rules:
        rj = _j(r)
        i = next((k for k, x in enumerate(out) if x[0]["id"] == rj["id"]), -1)
        if i >= 0:
            out[i] = (rj, "portfolio", [])
        else:
            out.append((rj, "portfolio", []))
    ovs = {k: _j(v) for k, v in (farm_overrides or {}).items()}
    for rule, _src, changed in out:
        ov = ovs.get(rule["id"])
        if not ov:
            continue
        for k in ("enabled", "then", "message"):
            if _is_set(ov.get(k)):
                rule[k] = ov[k]
                changed.append(k)
        for k, v in (ov.get("when") or {}).items():
            if not _is_set(v):
                continue
            rule["when"][k] = copy.deepcopy(v)
            changed.append(f"when.{k}")
    return [EffectiveCreditRule(CreditRule.model_validate(r), src, ch) for r, src, ch in out]


def effective_credit_rules_for_farm(portfolio: Portfolio, template: CropTemplate | None, farm: Farm) -> list[EffectiveCreditRule]:
    return effective_credit_rules(template.credit_rules if template else [], portfolio.credit_rules,
                                  farm.credit_rule_overrides)


# ───────────────────────── effective template ─────────────────────────


def effective_template(portfolio: Portfolio, farm: Farm, template: CropTemplate | None = None) -> tuple[CropTemplate, list[str]]:
    """§E.2: the crop template with portfolio-crop, zone and farm overrides merged per leaf, and with the
    effective credit rules (template -> portfolio -> farm overrides; disabled rules kept with
    enabled=false). Returns (template, warnings)."""
    from app.domain.templates import get_crop_template

    base = template or get_crop_template(farm.crop)
    warnings: list[str] = []
    _zone, zw = effective_zone(portfolio, farm)
    warnings.extend(zw)
    eff = effective_rules_for_farm(portfolio, base, farm, warnings)
    data = _j(base)
    data["stages"] = eff["stages"]
    data["rules"] = eff["rules"]
    data["weights"] = eff["weights"]
    data["creditRules"] = [_j(r.rule) for r in effective_credit_rules_for_farm(portfolio, base, farm)]
    out = CropTemplate.model_validate(data)
    warnings.extend(tiling_warnings(farm.crop, out.stages))
    return out, warnings


# ───────────────────────── credit rules (evaluation, §E.7) ─────────────────────────

TIER_ORDER = {"normal": 0, "watch": 1, "high": 2}
STRESS_ORDER = {"none": 0, "mild": 1, "moderate": 2, "severe": 3}
ACTION_FLOOR = {"watch": "watch", "field_visit": "watch", "high": "high", "restructure_review": "high"}

#: Metric keys of CreditCondition.metric (the evaluator's `metrics` dict uses the same keys).
CREDIT_METRICS = (
    "risk.tier",
    "risk.score",
    "water.decreeActive",
    "water.snowmeltPct",
    "water.stressLevel",
    "imagery.abandonment",
    "events.burnedAreaIntersects",
)


def _cmp(op: str, a: Any, b: Any) -> bool:
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


def compare_metric(metric: str, op: str, actual: Any, expected: Any) -> bool:
    """One condition on one metric value. A null metric is false; ordered enums use their order
    ('unknown' stress -> false); booleans support eq/neq only."""
    if actual is None or expected is None:
        return False
    if metric == "risk.tier":
        if actual not in TIER_ORDER or expected not in TIER_ORDER:
            return False
        return _cmp(op, TIER_ORDER[actual], TIER_ORDER[expected])
    if metric == "water.stressLevel":
        if actual not in STRESS_ORDER or expected not in STRESS_ORDER:
            return False
        return _cmp(op, STRESS_ORDER[actual], STRESS_ORDER[expected])
    if isinstance(actual, bool) or isinstance(expected, bool):
        if op not in ("eq", "neq"):
            return False
        return _cmp(op, bool(actual), bool(expected))
    try:
        return _cmp(op, float(actual), float(expected))
    except (TypeError, ValueError):
        return _cmp(op, actual, expected) if op in ("eq", "neq") else False


def _as_date(d: date | str) -> date:
    return d if isinstance(d, date) else date.fromisoformat(d[:10])


def installment_within(next_inst: Installment | None, as_of: date | str, days: int) -> bool:
    """True when the next installment (dueDate > asOf) is due within `days` days after asOf."""
    if next_inst is None:
        return False
    a = _as_date(as_of)
    due = _as_date(next_inst.due_date)
    return due > a and (due - a).days <= days


def evaluate_condition(cond: Any, metrics: dict[str, Any], next_inst: Installment | None, as_of: date | str) -> bool:
    c = _j(cond)
    if not compare_metric(c["metric"], c["op"], metrics.get(c["metric"]), c.get("value")):
        return False
    n = c.get("withinDaysBeforeInstallment")
    if n is not None and not installment_within(next_inst, as_of, int(n)):
        return False
    return True


def rule_fires(rule: CreditRule, metrics: dict[str, Any], next_inst: Installment | None, as_of: date | str) -> bool:
    if not rule.enabled:
        return False
    w = _j(rule.when)
    if not evaluate_condition(w, metrics, next_inst, as_of):
        return False
    return all(evaluate_condition(c, metrics, next_inst, as_of) for c in (w.get("and") or []))


def evaluate_credit_rules(rules: list[CreditRule], metrics: dict[str, Any], next_inst: Installment | None,
                          as_of: date | str) -> list[FiredCreditAction]:
    """Fired actions in rule order. `metrics` keys are CreditMetric strings (see CREDIT_METRICS);
    risk.* must read Risk.scoreTier / Risk.score, not the final tier (§E.7)."""
    return [FiredCreditAction(rule_id=r.id, action=r.then, message=r.message)
            for r in rules if rule_fires(r, metrics, next_inst, as_of)]


def tier_floor(actions: list[FiredCreditAction] | list[str]) -> str:
    floor = "normal"
    for a in actions:
        act = a if isinstance(a, str) else a.action
        t = ACTION_FLOOR.get(act, "normal")
        if TIER_ORDER[t] > TIER_ORDER[floor]:
            floor = t
    return floor


def max_tier(*tiers: str) -> str:
    return max(tiers, key=lambda t: TIER_ORDER[t])


def score_tier(score: float) -> str:
    """§E.1: score < 35 normal, 35 ≤ score < 60 watch, ≥ 60 high."""
    return "normal" if score < 35 else ("watch" if score < 60 else "high")


# ───────────────────────── audit trail ─────────────────────────


def _template_for(templates: list[CropTemplate] | None, crop: str) -> CropTemplate | None:
    if templates is None:
        from app.domain.templates import get_crop_template

        try:
            return get_crop_template(crop)
        except KeyError:
            return None
    return next((t for t in templates if t.crop == crop), None)


def effective_value_at(portfolio: Portfolio, templates: list[CropTemplate] | None, level: str, scope_id: str, path: str) -> Any:
    """Effective value at a change path before the change (RuleChange.oldValue); may be inherited."""
    segs = split_path(path)
    if level == "crop":
        return resolve_crop_leaf(portfolio, _template_for(templates, scope_id), scope_id, path).value
    if level == "zone":
        if segs and segs[0] == "overrides" and len(segs) >= 3:
            crop = segs[1]
            return resolve_zone_leaf(portfolio, _template_for(templates, crop), scope_id, crop, ".".join(segs[2:])).value
        z = portfolio.zone(scope_id)
        return get_at_path(_j(z), segs) if z else None
    if level == "farm":
        farm = portfolio.farm(scope_id)
        if farm is None:
            return None
        tpl = _template_for(templates, farm.crop)
        if segs and segs[0] == "overrides" and len(segs) >= 2:
            return resolve_farm_leaf(portfolio, tpl, farm, ".".join(segs[1:])).value
        if segs and segs[0] == "creditRuleOverrides" and len(segs) >= 2:
            rule = next((r for r in effective_credit_rules_for_farm(portfolio, tpl, farm) if r.rule.id == segs[1]), None)
            if rule is None:
                return None
            plain = _j(rule.rule)
            return plain if len(segs) == 2 else get_at_path(plain, segs[2:])
        if segs == ["covered"] and farm.covered is None:
            return tpl.covered_default if tpl else None
        return get_at_path(_j(farm), segs)
    if level == "portfolio":
        if segs and segs[0] == "creditRules" and len(segs) >= 2:
            own = next((r for r in portfolio.credit_rules if r.id == segs[1]), None)
            tpls = templates if templates is not None else _all_templates()
            from_t = next((r for t in tpls for r in t.credit_rules if r.id == segs[1]), None)
            rule = own or from_t
            if rule is None:
                return None
            rj = _j(rule)
            return rj if len(segs) == 2 else get_at_path(rj, segs[2:])
        return get_at_path(_j(portfolio), segs)
    return None


def _all_templates() -> list[CropTemplate]:
    from app.domain.templates import get_crop_templates

    return get_crop_templates()


def apply_change(portfolio: Portfolio, change: RuleChange, templates: list[CropTemplate] | None = None) -> Portfolio:
    """Applies change.newValue at its scope root. Does not touch the audit. Proposed/dismissed -> no-op.
    Returns a new Portfolio."""
    if change.status != "applied":
        return portfolio
    level, sid = change.scope.level, change.scope.id
    segs = split_path(change.path)
    p = _j(portfolio)
    if level == "crop":
        nxt = set_at_path(p["cropOverrides"].get(sid) or {}, segs, change.new_value, prune_top_level=True)
        if is_deep_empty(nxt):
            p["cropOverrides"].pop(sid, None)
        else:
            p["cropOverrides"][sid] = nxt
    elif level == "zone":
        if not any(z["id"] == sid for z in p["zones"]):
            return portfolio
        p["zones"] = [set_at_path(z, segs, change.new_value) if z["id"] == sid else z for z in p["zones"]]
    elif level == "farm":
        if not any(f["id"] == sid for f in p["farms"]):
            return portfolio
        p["farms"] = [set_at_path(f, segs, change.new_value) if f["id"] == sid else f for f in p["farms"]]
    elif level == "portfolio":
        if segs and segs[0] == "creditRules" and len(segs) > 2 and not any(r["id"] == segs[1] for r in p["creditRules"]):
            tpls = templates if templates is not None else _all_templates()
            seed = next((r for t in tpls for r in t.credit_rules if r.id == segs[1]), None)
            if seed is None:
                return portfolio
            p["creditRules"] = [*p["creditRules"], _j(seed)]
        p = set_at_path(p, segs, change.new_value)
    return Portfolio.model_validate(p)


_counter = itertools.count(1)


def new_change_id(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    ms = int(now.timestamp() * 1000)
    return f"chg-{_b36(ms)}-{_b36(next(_counter))}"


def _b36(n: int) -> str:
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while True:
        n, r = divmod(n, 36)
        out = chars[r] + out
        if n == 0:
            return out


def make_change(portfolio: Portfolio, templates: list[CropTemplate] | None, *, level: str, scope_id: str, path: str,
                new_value: Any, reason: str, actor_kind: str = "user", actor_name: str = "Credit analyst",
                status: str = "applied", recommendation_id: str | None = None, at: str | None = None,
                id: str | None = None) -> RuleChange:
    """A RuleChange with oldValue = the effective value now."""
    now = datetime.now(timezone.utc)
    old = effective_value_at(portfolio, templates, level, scope_id, path)
    return RuleChange.model_validate({
        "id": id or new_change_id(now),
        "at": at or now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "actor": {"kind": actor_kind, "name": actor_name},
        "scope": {"level": level, "id": scope_id},
        "path": path,
        "oldValue": copy.deepcopy(old),
        "newValue": copy.deepcopy(new_value),
        "reason": reason,
        "status": status,
        "recommendationId": recommendation_id,
    })


def commit_change(portfolio: Portfolio, change: RuleChange, templates: list[CropTemplate] | None = None) -> Portfolio:
    """Applies (when status 'applied') and appends to portfolio.audit (append-only)."""
    applied = apply_change(portfolio, change, templates)
    out = applied.model_copy(deep=True)
    out.audit = [*out.audit, change]
    return out


def current_stage_of(stages: list[Stage], d: date | str):
    """Convenience re-export for callers holding effective stages."""
    from app.domain.stages import find_current_stage

    return find_current_stage(stages, d)
