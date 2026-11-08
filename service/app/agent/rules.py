"""Rule lookups the agent needs (CONTRACT §E.2–E.4, §E.8), with the domain builder preferred.

app.domain owns the full layering. The agent only needs single leaves (the effective value of one
path, for RuleChange.oldValue), the farm's zone, the current stage and the exposure. Each helper tries
the domain function first and falls back to a small local implementation of the same contract rule,
so the agent keeps working while app.domain is a placeholder.
"""

from __future__ import annotations

import math
import re
from datetime import date
from typing import Any

from app.models import CropTemplate, Farm, Portfolio, Zone, dump

ZONE_RADIUS_M = 3338.0

THRESHOLD_FIELDS = ("frostCriticalC", "frostSevereC", "heatC", "harvestRainMm72h", "kc")
WEIGHT_FIELDS = ("a", "b", "c")
PERILS = (
    "frost", "heat", "harvest_rain", "water", "chill", "fire", "flood", "declared_emergency", "abandonment", "vigour",
)

#: Value limits for proposals (agronomic sanity bounds, not recommendations).
LIMITS: dict[str, tuple[float, float]] = {
    "frostCriticalC": (-20.0, 5.0),
    "frostSevereC": (-25.0, 5.0),
    "heatC": (20.0, 50.0),
    "harvestRainMm72h": (1.0, 300.0),
    "kc": (0.0, 2.0),
    "sensitivity": (0.0, 1.0),
    "weights": (0.0, 5.0),
    "chillHoursMin": (0.0, 3000.0),
    "baselineYears": (1.0, 15.0),
}

MMDD = re.compile(r"^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")


class PathError(ValueError):
    """A proposal path that is not an editable §E.2 leaf."""


# ───────────────────────── templates ─────────────────────────


def crop_template(crop: str) -> CropTemplate:
    from app import domain

    return domain.get_crop_template(crop)


def template_dict(crop: str) -> dict[str, Any]:
    return dump(crop_template(crop))


def template_leaf(tpl: dict[str, Any], patch_path: list[str]) -> Any:
    """Value of a RulesPatch-shaped path in the template (CONTRACT §E.2 leaf table)."""
    head, *rest = patch_path
    if head == "stages" and len(rest) >= 2:
        stage = next((s for s in tpl["stages"] if s["key"] == rest[0]), None)
        if stage is None:
            return None
        if rest[1] in ("start", "end") and len(rest) == 2:
            return stage[rest[1]]
        if rest[1] == "sensitivity" and len(rest) == 3:
            return stage["sensitivity"].get(rest[2])
        return None
    if head == "rules" and rest:
        if rest[0] == "stages" and len(rest) == 3:
            return tpl["rules"]["stages"].get(rest[1], {}).get(rest[2])
        if len(rest) == 1:
            return tpl["rules"].get(rest[0])
        return None
    if head == "weights" and len(rest) == 1:
        return tpl["weights"].get(rest[0])
    return None


def _get(d: Any, path: list[str]) -> Any:
    for p in path:
        if not isinstance(d, dict) or p not in d:
            return None
        d = d[p]
    return d


# ───────────────────────── zones ─────────────────────────


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def _auto_zone(farm: Farm) -> Zone:
    return Zone(id=f"auto-{farm.id}", name=f"{farm.name} zone", center=tuple(farm.centroid), radius_m=ZONE_RADIUS_M,
                auto=True, overrides={})


def effective_zone(portfolio: Portfolio, farm: Farm) -> Zone:
    """§E.4: nearest shared zone containing the centroid (tie -> smallest id), else the farm's auto zone."""
    try:
        from app import domain

        zone, _ = domain.effective_zone(portfolio, farm)
        return zone
    except Exception:
        pass
    shared = [
        (haversine_m(tuple(farm.centroid), tuple(z.center)), z.id, z)
        for z in portfolio.zones
        if not z.auto and haversine_m(tuple(farm.centroid), tuple(z.center)) <= z.radius_m
    ]
    if shared:
        return min(shared, key=lambda t: (t[0], t[1]))[2]
    return portfolio.zone(f"auto-{farm.id}") or _auto_zone(farm)


def farms_in_zone(portfolio: Portfolio, zone_id: str) -> list[Farm]:
    return [f for f in portfolio.farms if effective_zone(portfolio, f).id == zone_id]


def zone_by_id(portfolio: Portfolio, zone_id: str) -> Zone | None:
    z = portfolio.zone(zone_id)
    if z is not None:
        return z
    for f in portfolio.farms:  # auto zone missing from portfolio.zones: synthesised (§E.4)
        if zone_id == f"auto-{f.id}":
            return _auto_zone(f)
    return None


# ───────────────────────── effective values ─────────────────────────


def effective_leaf(portfolio: Portfolio, crop: str, patch_path: list[str], zone: Zone | None = None,
                   farm: Farm | None = None) -> tuple[Any, str]:
    """(value, layer) for one RulesPatch leaf: farm ?? zone[crop] ?? portfolio.cropOverrides[crop] ?? template."""
    if farm is not None:
        v = _get(dump(farm.overrides), patch_path)
        if v is not None:
            return v, "farm"
        zone = zone or effective_zone(portfolio, farm)
    if zone is not None:
        z = dump(zone.overrides).get(crop) or {}
        v = _get(z, patch_path)
        if v is not None:
            return v, "zone"
    co = dump(portfolio.crop_overrides).get(crop) or {}
    v = _get(co, patch_path)
    if v is not None:
        return v, "crop"
    return template_leaf(template_dict(crop), patch_path), "template"


def effective_stages(portfolio: Portfolio, crop: str, zone: Zone | None = None, farm: Farm | None = None) -> list[dict[str, Any]]:
    """Stages with effective windows and thresholds, each leaf tagged with the layer that set it."""
    tpl = template_dict(crop)
    out = []
    for s in tpl["stages"]:
        k = s["key"]
        start, start_by = effective_leaf(portfolio, crop, ["stages", k, "start"], zone, farm)
        end, end_by = effective_leaf(portfolio, crop, ["stages", k, "end"], zone, farm)
        thresholds: dict[str, Any] = {}
        custom: dict[str, str] = {}
        for f in THRESHOLD_FIELDS:
            v, by = effective_leaf(portfolio, crop, ["rules", "stages", k, f], zone, farm)
            thresholds[f] = v
            if by != "template":
                custom[f] = by
        sens = {}
        for p in PERILS:
            v, by = effective_leaf(portfolio, crop, ["stages", k, "sensitivity", p], zone, farm)
            sens[p] = v
            if by != "template":
                custom[f"sensitivity.{p}"] = by
        if start_by != "template":
            custom["start"] = start_by
        if end_by != "template":
            custom["end"] = end_by
        out.append({"key": k, "label": s["label"], "labelEs": s["labelEs"], "start": start, "end": end,
                    "thresholds": thresholds, "sensitivity": sens, "customBy": custom})
    return out


# ───────────────────────── stages and dates ─────────────────────────


def _mmdd(d: date) -> str:
    s = d.strftime("%m-%d")
    return "02-28" if s == "02-29" else s


def in_window(mmdd: str, start: str, end: str) -> bool:
    return start <= mmdd <= end if start <= end else (mmdd >= start or mmdd <= end)


def current_stage_key(stages: list[dict[str, Any]], as_of: date) -> str | None:
    """§E.3: first stage whose window contains as_of; gap -> latest start before as_of."""
    m = _mmdd(as_of)
    for s in stages:
        if s["start"] and s["end"] and in_window(m, s["start"], s["end"]):
            return s["key"]
    before = [s for s in stages if s["start"] and s["start"] <= m]
    pool = before or stages
    return max(pool, key=lambda s: s["start"] or "")["key"] if pool else None


def season_window(start_mmdd: str, end_mmdd: str, season: int) -> tuple[date, date]:
    """Concrete dates of a stage window for the season that starts in calendar year `season`."""
    def mk(y: int, mmdd: str) -> date:
        mo, d = int(mmdd[:2]), int(mmdd[3:])
        try:
            return date(y, mo, d)
        except ValueError:
            return date(y, mo, 28)

    s = mk(season, start_mmdd)
    e = mk(season + 1 if end_mmdd < start_mmdd else season, end_mmdd)
    return s, e


# ───────────────────────── exposure (§E.8) ─────────────────────────


def outstanding_at(farm: Farm, as_of: date) -> float:
    loan = farm.loan
    if loan is None:
        return 0.0
    try:
        from app import domain

        return float(domain.outstanding_at(loan, as_of))
    except Exception:
        pass
    iso = as_of.isoformat()
    if iso < loan.origination_date:
        return 0.0
    plan = loan.installments or []
    paid = sum(i.amount for i in plan if i.due_date <= iso) if plan else (loan.amount if loan.maturity_date <= iso else 0)
    return max(0.0, round(loan.amount - paid, 2))


def next_installment(farm: Farm, as_of: date) -> dict[str, Any] | None:
    loan = farm.loan
    if loan is None:
        return None
    iso = as_of.isoformat()
    plan = [(i.due_date, i.amount) for i in loan.installments] or [(loan.maturity_date, loan.amount)]
    nxt = sorted(p for p in plan if p[0] > iso)
    return {"dueDate": nxt[0][0], "amount": nxt[0][1]} if nxt else None


# ───────────────────────── proposal paths ─────────────────────────


def parse_change_path(portfolio: Portfolio, level: str, scope_id: str, path: str) -> dict[str, Any]:
    """Validate a RuleChange scope + path (§E.2) and return {crop, patchPath, zone, farm, leafKind}.

    Supported: zone, crop and farm scopes, agronomic leaves only (stage windows, sensitivities,
    stage thresholds, chillHoursMin, baselineYears, weights). Credit rules (portfolio scope) are
    out of the agent's v1 remit."""
    parts = [p for p in path.split(".") if p]
    zone = farm = None
    if level == "zone":
        zone = zone_by_id(portfolio, scope_id)
        if zone is None:
            raise PathError(f"zone '{scope_id}' is not in the portfolio")
        if len(parts) < 3 or parts[0] != "overrides":
            raise PathError("zone paths start with 'overrides.<crop>.' e.g. overrides.cherry.rules.stages.bloom.frostCriticalC")
        crop, patch = parts[1], parts[2:]
    elif level == "crop":
        crop, patch = scope_id, parts
    elif level == "farm":
        farm = portfolio.farm(scope_id)
        if farm is None:
            raise PathError(f"farm '{scope_id}' is not in the portfolio")
        if len(parts) < 2 or parts[0] != "overrides":
            raise PathError("farm paths start with 'overrides.' e.g. overrides.rules.stages.bloom.frostCriticalC")
        crop, patch = farm.crop, parts[1:]
    else:
        raise PathError("the agent proposes zone, crop or farm changes only (credit rules are edited by the lender)")
    try:
        tpl = template_dict(crop)
    except StopIteration:
        raise PathError(f"unknown crop '{crop}'")
    stage_keys = {s["key"] for s in tpl["stages"]}
    kind = None
    if patch[:1] == ["stages"] and len(patch) >= 3 and patch[1] in stage_keys:
        if len(patch) == 3 and patch[2] in ("start", "end"):
            kind = "mmdd"
        elif len(patch) == 4 and patch[2] == "sensitivity" and patch[3] in PERILS:
            kind = "sensitivity"
    elif patch[:2] == ["rules", "stages"] and len(patch) == 4 and patch[2] in stage_keys and patch[3] in THRESHOLD_FIELDS:
        kind = patch[3]
    elif patch[:1] == ["rules"] and len(patch) == 2 and patch[1] in ("chillHoursMin", "baselineYears"):
        kind = patch[1]
    elif patch[:1] == ["weights"] and len(patch) == 2 and patch[1] in WEIGHT_FIELDS:
        kind = "weights"
    if kind is None:
        raise PathError(
            f"'{path}' is not an editable leaf for {crop}. Stage keys: {sorted(stage_keys)}. Leaves: "
            "stages.<stage>.start|end, stages.<stage>.sensitivity.<peril>, "
            f"rules.stages.<stage>.<{'|'.join(THRESHOLD_FIELDS)}>, rules.chillHoursMin, rules.baselineYears, weights.a|b|c"
        )
    return {"crop": crop, "patchPath": patch, "zone": zone, "farm": farm, "leafKind": kind}


def check_value(kind: str, value: Any) -> Any:
    """Validate and normalise a proposed newValue (None = reset to inherited)."""
    if value is None:
        return None
    if kind == "mmdd":
        if not isinstance(value, str) or not MMDD.match(value):
            raise PathError("stage window values are 'MM-DD' strings")
        return value
    if isinstance(value, str):
        # the schema allows strings (stage windows); models often send numbers as "-2.0", "−2" or "-2,0"
        txt = value.strip().replace("\u2212", "-").replace(",", ".")
        try:
            value = float(txt)
        except ValueError:
            raise PathError(f"{kind} must be a number (got {value!r})") from None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        raise PathError(f"{kind} must be a number")
    lo, hi = LIMITS[kind]
    if not (lo <= float(value) <= hi):
        raise PathError(f"{kind} must be between {lo:g} and {hi:g}")
    if kind == "baselineYears":
        return int(value)
    return round(float(value), 3)
