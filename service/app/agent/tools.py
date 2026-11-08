"""Agent tools: JSON schemas for the model and their executors (ADR-0013 D9).

Every executor returns a JSON-ready dict. Failures inside other builders (including
NotImplementedError from placeholders) are caught by `execute()` and returned as an error tool
result: they must never escape recommend(), because dispatch would then serve the contract fixture.
"""

from __future__ import annotations

import json
import math
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable

from app import config
from app.agent import data, rules, verify
from app.agent.backtest import KnownEvent, run_backtest
from app.agent.known_events import reference_events_for
from app.models import Actor, AgentEvidence, AgentToolCall, ChangeScope, Farm, Portfolio, RuleChange, Zone, dump

MAX_HISTORY_YEARS = 15
MAX_CANDIDATES = 6
MAX_PROPOSALS = 6
FIRST_SEASON = 2013
WEATHER_VARS = ("tmin", "tmax", "precip", "eto")
VEG_VARS = ("ndvi", "ndmi")
CROPS = ("cherry", "blueberry", "avocado", "walnut", "hazelnut", "table_grape")
CONTEXT_EVENT_KINDS = ("fire", "declared_emergency", "water", "flood")


class ToolError(Exception):
    """A problem the model can fix (bad input) or must report (data unavailable)."""


@dataclass
class ToolContext:
    portfolio: Portfolio
    as_of: date
    recommendation_id: str
    zone_id: str | None = None
    farm_id: str | None = None
    deadline: float = field(default_factory=lambda: time.monotonic() + 80)
    proposals: list[RuleChange] = field(default_factory=list)
    evidence: list[AgentEvidence] = field(default_factory=list)
    tool_calls: list[AgentToolCall] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)
    #: successful get_history / backtest outputs: the only evidence a proposed threshold may come from
    data_outputs: list[str] = field(default_factory=list)

    def remaining(self) -> float:
        return self.deadline - time.monotonic()

    def data_budget(self) -> float:
        """Seconds a tool may spend waiting on builders: leave room for the model to answer."""
        return max(1.0, min(45.0, self.remaining() - 20.0))


# ───────────────────────── scope helpers ─────────────────────────


def _resolve_scope(ctx: ToolContext, inp: dict[str, Any]) -> tuple[Zone, Farm | None, list[Farm]]:
    """(zone, farm or None, farms in zone) from the tool input, else the request's focus."""
    p = ctx.portfolio
    farm_id = inp.get("farmId") or None
    zone_id = inp.get("zoneId") or None
    if not farm_id and not zone_id:
        farm_id, zone_id = ctx.farm_id, ctx.zone_id
    farm = None
    if farm_id:
        farm = p.farm(farm_id)
        if farm is None:
            raise ToolError(f"farmId '{farm_id}' is not in the portfolio; farms: {[f.id for f in p.farms]}")
        zone = rules.effective_zone(p, farm)
    elif zone_id:
        zone = rules.zone_by_id(p, zone_id)
        if zone is None:
            raise ToolError(f"zoneId '{zone_id}' is not in the portfolio; zones: {[z.id for z in p.zones]}")
    else:
        raise ToolError("give a zoneId or farmId (this question has no zone or farm focus)")
    return zone, farm, rules.farms_in_zone(p, zone.id)


def _crop_for(inp: dict[str, Any], farm: Farm | None, farms: list[Farm]) -> str:
    crop = inp.get("crop") or (farm.crop if farm else None)
    if not crop:
        crops = sorted({f.crop for f in farms})
        if len(crops) == 1:
            crop = crops[0]
        else:
            raise ToolError(f"give a crop: the zone has {crops or 'no farms'}")
    if crop not in CROPS:
        raise ToolError(f"crop must be one of {list(CROPS)}")
    return crop


def _flatten(d: Any, prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    if isinstance(d, dict):
        for k, v in d.items():
            out.update(_flatten(v, f"{prefix}.{k}" if prefix else k))
    elif d is not None:
        out[prefix] = d
    return out


def _bbox_around(center: tuple[float, float], radius_m: float) -> tuple[float, float, float, float]:
    lng, lat = center
    dlat = radius_m / 111_320.0
    dlng = radius_m / (111_320.0 * max(0.1, math.cos(math.radians(lat))))
    return (round(lng - dlng, 5), round(lat - dlat, 5), round(lng + dlng, 5), round(lat + dlat, 5))


def _parse_date(v: Any, default: date) -> date:
    if not v:
        return default
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        raise ToolError(f"'{v}' is not a YYYY-MM-DD date")


def _stage_for_rule(stages: list[dict[str, Any]], rule: str, stage_key: str | None) -> dict[str, Any]:
    if stage_key:
        st = next((s for s in stages if s["key"] == stage_key), None)
        if st is None:
            raise ToolError(f"stage '{stage_key}' not in {[s['key'] for s in stages]}")
        return st
    peril = "frost" if rule == "frost" else "harvest_rain"
    # most sensitive stage; dormancy/winter frost is not what lenders tune, so prefer active stages on ties
    return max(stages, key=lambda s: ((s["sensitivity"].get(peril) or 0), s["key"] not in ("dormancy", "winter")))


def _past_seasons(stage: dict[str, Any], as_of: date, first: int, last: int | None) -> dict[int, tuple[date, date]]:
    out: dict[int, tuple[date, date]] = {}
    for y in range(first, as_of.year + 1):
        if last is not None and y > last:
            break
        s, e = rules.season_window(stage["start"], stage["end"], y)
        if e < as_of:
            out[y] = (s, e)
    return out


# ───────────────────────── tools ─────────────────────────


def t_get_zone(ctx: ToolContext, inp: dict[str, Any]) -> dict[str, Any]:
    zone, _farm, farms = _resolve_scope(ctx, inp)
    farm_rows = []
    for f in farms:
        stages = rules.effective_stages(ctx.portfolio, f.crop, zone, f)
        key = rules.current_stage_key(stages, ctx.as_of)
        farm_rows.append({
            "id": f.id, "name": f.name, "crop": f.crop, "areaHa": f.area_ha, "centroid": list(f.centroid),
            "exposure": rules.outstanding_at(f, ctx.as_of), "nextInstallment": rules.next_installment(f, ctx.as_of),
            "currentStage": key, "covered": f.covered, "irrigatedDeclared": f.irrigated_declared,
            "farmOverrides": _flatten(dump(f.overrides)),
            "creditRuleOverrides": _flatten(dump(f.credit_rule_overrides)),
        })
    return {
        "zoneId": zone.id, "name": zone.name, "auto": zone.auto, "center": list(zone.center), "radiusM": zone.radius_m,
        "areaKm2": round(math.pi * zone.radius_m ** 2 / 1e6, 1), "currency": ctx.portfolio.currency,
        "asOf": ctx.as_of.isoformat(), "zoneOverrides": _flatten(dump(zone.overrides)),
        "portfolioCropOverrides": _flatten(dump(ctx.portfolio.crop_overrides)),
        "farms": farm_rows, "totalExposure": round(sum(r["exposure"] for r in farm_rows), 2),
        "recentAudit": [
            {"at": c.at, "actor": c.actor.kind, "scope": f"{c.scope.level}:{c.scope.id}", "path": c.path,
             "oldValue": c.old_value, "newValue": c.new_value, "status": c.status}
            for c in ctx.portfolio.audit[-10:]
        ],
    }


def t_get_crop_template(ctx: ToolContext, inp: dict[str, Any]) -> dict[str, Any]:
    zone = farm = None
    crop = inp.get("crop")
    if inp.get("zoneId") or inp.get("farmId"):
        zone, farm, farms = _resolve_scope(ctx, inp)
        crop = _crop_for(inp, farm, farms)
    if crop not in CROPS:
        raise ToolError(f"crop must be one of {list(CROPS)}")
    tpl = rules.template_dict(crop)
    stages = rules.effective_stages(ctx.portfolio, crop, zone, farm)
    scope_rules = {}
    for leaf in ("chillHoursMin", "baselineYears"):
        v, by = rules.effective_leaf(ctx.portfolio, crop, ["rules", leaf], zone, farm)
        scope_rules[leaf] = {"value": v, "setBy": by}
    weights = {}
    for w in rules.WEIGHT_FIELDS:
        v, by = rules.effective_leaf(ctx.portfolio, crop, ["weights", w], zone, farm)
        weights[w] = {"value": v, "setBy": by}
    return {
        "crop": crop, "labels": tpl["labels"], "approximate": tpl["approximate"], "evergreen": tpl["evergreen"],
        "effectiveFor": (f"farm:{farm.id}" if farm else f"zone:{zone.id}" if zone else "portfolio crop level"),
        "currentStage": rules.current_stage_key(stages, ctx.as_of), "asOf": ctx.as_of.isoformat(),
        "stages": [
            {"key": s["key"], "label": s["label"], "start": s["start"], "end": s["end"], **s["thresholds"],
             "sensitivity": {k: v for k, v in s["sensitivity"].items() if v}, "customBy": s["customBy"]}
            for s in stages
        ],
        "rules": scope_rules, "weights": weights, "sources": tpl["sources"],
        "note": "Template values are approximate expert defaults (ADR-0013 D5). customBy names the override layer.",
    }


def _summarise_window(variable: str, daily: dict[date, float | None], s: date, e: date,
                      thresholds: dict[str, Any] | None) -> dict[str, Any]:
    days = []
    d = s
    while d <= e:
        days.append(d)
        d += timedelta(days=1)
    vals = [(d, daily[d]) for d in days if daily.get(d) is not None]
    row: dict[str, Any] = {"from": s.isoformat(), "to": e.isoformat(), "days": len(days), "validDays": len(vals)}
    if not vals:
        return row
    nums = [v for _, v in vals]
    if variable == "tmin":
        dmin, vmin = min(vals, key=lambda t: t[1])
        row.update(min=round(vmin, 1), minDate=dmin.isoformat(), mean=round(sum(nums) / len(nums), 1),
                   nightsAtOrBelow0C=sum(1 for v in nums if v <= 0))
        if thresholds and thresholds.get("frostCriticalC") is not None:
            row["nightsAtOrBelowFrostCritical"] = sum(1 for v in nums if v <= thresholds["frostCriticalC"])
    elif variable == "tmax":
        dmax, vmax = max(vals, key=lambda t: t[1])
        row.update(max=round(vmax, 1), maxDate=dmax.isoformat(), mean=round(sum(nums) / len(nums), 1))
        if thresholds and thresholds.get("heatC") is not None:
            row["daysAtOrAboveHeat"] = sum(1 for v in nums if v >= thresholds["heatC"])
    elif variable == "precip":
        sums = []
        for d in days:
            three = [daily.get(d - timedelta(days=k)) for k in (2, 1, 0)]
            if all(x is not None for x in three):
                sums.append((d, sum(three)))
        row.update(total=round(sum(nums), 1), wetDaysAtOrAbove10mm=sum(1 for v in nums if v >= 10))
        if sums:
            d72, v72 = max(sums, key=lambda t: t[1])
            row.update(max72h=round(v72, 1), max72hEndDate=d72.isoformat())
            if thresholds and thresholds.get("harvestRainMm72h") is not None:
                row["daysWith72hAtOrAboveTrigger"] = sum(1 for _, v in sums if v >= thresholds["harvestRainMm72h"])
    elif variable == "eto":
        row.update(total=round(sum(nums), 1), mean=round(sum(nums) / len(nums), 2))
    else:  # ndvi / ndmi
        row.update(mean=round(sum(nums) / len(nums), 3), min=round(min(nums), 3), max=round(max(nums), 3))
    return row


def t_get_history(ctx: ToolContext, inp: dict[str, Any]) -> dict[str, Any]:
    variable = inp.get("variable")
    if variable not in WEATHER_VARS + VEG_VARS:
        raise ToolError(f"variable must be one of {list(WEATHER_VARS + VEG_VARS)}")
    zone, farm, farms = _resolve_scope(ctx, inp)
    years = int(inp.get("years") or 5)
    if not 1 <= years <= MAX_HISTORY_YEARS:
        raise ToolError(f"years must be 1..{MAX_HISTORY_YEARS}")
    stage_key = inp.get("stage")
    crop = None
    thresholds = None
    if stage_key:
        crop = _crop_for(inp, farm, farms)
        stages = rules.effective_stages(ctx.portfolio, crop, zone, farm)
        st = next((s for s in stages if s["key"] == stage_key), None)
        if st is None:
            raise ToolError(f"stage '{stage_key}' not in {[s['key'] for s in stages]}")
        thresholds = st["thresholds"]
        seasons = _past_seasons(st, ctx.as_of, ctx.as_of.year - years - 1, None)
        windows = dict(sorted(seasons.items())[-years:])
    else:
        if years > 3:
            raise ToolError("without a stage, years is limited to 3 (pass a stage to scan up to 15 seasons cheaply)")
        windows = {y: (date(y, 1, 1), min(date(y, 12, 31), ctx.as_of)) for y in range(ctx.as_of.year - years + 1, ctx.as_of.year + 1)}
    src = farm or data.representative_farm(ctx.portfolio, zone, crop, farms)
    got = data.fetch_windows(variable, src, windows, ctx.portfolio.country, ctx.data_budget())
    per = [{"season": k, **_summarise_window(variable, got["daily"], s, e, thresholds)} for k, (s, e) in windows.items()]
    available = any(r["validDays"] for r in per)
    out = {
        "variable": variable, "unit": {"tmin": "°C", "tmax": "°C", "precip": "mm", "eto": "mm"}.get(variable, "index"),
        "scope": f"farm:{src.id}" if farm else f"zone:{zone.id} (series of {src.id})",
        "stage": stage_key, "stageThresholds": thresholds, "available": available,
        "seasons": per, "provenance": data.provenance_summary(got["provenances"]),
        "errors": got["errors"], "timedOutWindows": got["timedOut"],
    }
    if not available:
        out["note"] = "No data returned for any window; do not state values for this variable."
    return out


def t_list_events(ctx: ToolContext, inp: dict[str, Any]) -> dict[str, Any]:
    zone, farm, _farms = _resolve_scope(ctx, inp)
    since = _parse_date(inp.get("since"), date(FIRST_SEASON, 1, 1))
    kinds = inp.get("kinds") or None
    bbox = _bbox_around(tuple(zone.center), zone.radius_m + 25_000)
    out: dict[str, Any] = {"bbox": list(bbox), "since": since.isoformat()}
    try:
        evs = data.list_events(bbox, since)
        if kinds:
            evs = [e for e in evs if e.get("kind") in kinds]
        by_kind: dict[str, int] = {}
        for e in evs:
            by_kind[e["kind"]] = by_kind.get(e["kind"], 0) + 1
        out["catalog"] = {
            "count": len(evs), "byKind": by_kind,
            "events": [
                {"id": e["id"], "kind": e["kind"], "title": e["title"], "start": e["start"], "end": e.get("end"),
                 "severity": e.get("severity"), "evidenceKind": e.get("evidenceKind"), "source": e.get("source"),
                 "stale": (e.get("provenance") or {}).get("stale"), "note": (e.get("provenance") or {}).get("note")}
                for e in evs[:40]
            ],
            "truncated": len(evs) > 40,
        }
    except NotImplementedError:
        out["catalogError"] = "the event catalog builder is not implemented yet: no fire/decree/flood events available"
    except Exception as exc:
        out["catalogError"] = f"event catalog unavailable: {exc.__class__.__name__}: {str(exc)[:160]}"
    refs = reference_events_for(*zone.center)
    out["referenceEvents"] = [
        {"id": e.id, "kind": e.rule, "title": e.title, "start": e.start.isoformat(), "end": e.end.isoformat(),
         "source": e.source}
        for e in refs if e.end >= since
    ]
    return out


def t_backtest(ctx: ToolContext, inp: dict[str, Any]) -> dict[str, Any]:
    rule = inp.get("rule")
    if rule not in ("frost", "harvest_rain"):
        raise ToolError("rule must be 'frost' or 'harvest_rain'")
    zone, farm, farms = _resolve_scope(ctx, inp)
    crop = _crop_for(inp, farm, farms)
    stages = rules.effective_stages(ctx.portfolio, crop, zone, farm)
    st = _stage_for_rule(stages, rule, inp.get("stage"))
    field_name = "frostCriticalC" if rule == "frost" else "harvestRainMm72h"
    current = st["thresholds"][field_name]
    template_value = rules.template_leaf(rules.template_dict(crop), ["rules", "stages", st["key"], field_name])
    cands = [c for c in (inp.get("candidates") or []) if isinstance(c, (int, float)) and not isinstance(c, bool)]
    if len(cands) > MAX_CANDIDATES:
        raise ToolError(f"at most {MAX_CANDIDATES} candidates")
    for c in cands:
        rules.check_value(field_name, c)
    cands = sorted({float(c) for c in cands} | {float(current), float(template_value)})
    first = int(inp.get("fromSeason") or FIRST_SEASON)
    last = inp.get("toSeason")
    seasons = _past_seasons(st, ctx.as_of, first, int(last) if last else None)
    seasons = dict(sorted(seasons.items())[-MAX_HISTORY_YEARS:])
    if not seasons:
        raise ToolError("no complete past season in the requested range")
    variable = "tmin" if rule == "frost" else "precip"
    # 2 extra days before each window so 72 h sums at the window start are complete
    fetch = {y: (s - timedelta(days=2), e) for y, (s, e) in seasons.items()}
    src = farm or data.representative_farm(ctx.portfolio, zone, crop, farms)
    got = data.fetch_windows(variable, src, fetch, ctx.portfolio.country, ctx.data_budget())
    if inp.get("damageProxy") is not None:
        proxy = float(inp["damageProxy"])
        proxy_note = "damage proxy given by the caller"
    elif rule == "frost":
        proxy = st["thresholds"]["frostSevereC"]
        proxy_note = f"station damage proxy: a night with Tmin <= frostSevereC (T90) = {proxy} °C in the {st['key']} window"
    else:
        tv = rules.template_leaf(rules.template_dict(crop), ["rules", "stages", st["key"], "harvestRainMm72h"])
        proxy = round(1.5 * float(tv), 1)
        proxy_note = (f"station damage proxy: a 72 h rain sum >= 1.5 x template trigger = {proxy} mm "
                      f"(severity 1 in CONTRACT §E.5) in the {st['key']} window")
    known: list[KnownEvent] = reference_events_for(*zone.center)
    result = run_backtest(rule, got["daily"], seasons, cands, proxy, known)
    if result["seasonsEvaluated"] == 0:
        result = {"rule": rule, "available": False, "seasonsSkipped": result["seasonsSkipped"],
                  "reason": "no season had enough daily data: " + ("; ".join(got["errors"]) or "builder returned nothing"),
                  "candidates": []}
    else:
        result["available"] = True
    context_events: list[dict[str, Any]] = []
    try:
        bbox = _bbox_around(tuple(zone.center), zone.radius_m + 25_000)
        for e in data.list_events(bbox, min(s for s, _ in seasons.values())):
            if e.get("kind") in CONTEXT_EVENT_KINDS:
                context_events.append({"id": e["id"], "kind": e["kind"], "title": e["title"], "start": e["start"],
                                       "end": e.get("end"), "evidenceKind": e.get("evidenceKind")})
    except Exception as exc:
        context_events = [{"error": f"event catalog unavailable: {exc.__class__.__name__}"}]
    return {
        **result,
        "crop": crop, "stage": st["key"], "stageWindow": [st["start"], st["end"]],
        "param": f"rules.stages.{st['key']}.{field_name}", "currentValue": current, "templateValue": template_value,
        "scope": f"farm:{src.id}" if farm else f"zone:{zone.id} (series of {src.id})",
        "method": (
            ("Alert = any night in the window with Tmin <= candidate." if rule == "frost"
             else "Alert = any 72 h rain sum in the window >= candidate.")
            + " Damaging season = a curated reference event overlapping the window, or the " + proxy_note
            + ". Counts are per season. Seasons with < 70 % valid days are skipped."
        ),
        "dataProvenance": data.provenance_summary(got["provenances"]),
        "dataErrors": got["errors"], "timedOutSeasons": got["timedOut"],
        "contextEvents": context_events[:20],
        "contextNote": "Fires, decrees and floods are listed for context only; they are not frost/rain truth labels.",
    }


#: numeric leaves whose new value must come from a get_history or backtest output (data-tested)
#: (backtest runs frost and harvest_rain only; other numeric leaves need a number from any earlier tool output)
DATA_GROUNDED_KINDS = {"frostCriticalC", "frostSevereC", "harvestRainMm72h"}


def _check_grounded(ctx: ToolContext, kind: str, new_value: Any) -> None:
    """The "never invent values" rule, enforced in code (not only by the prompt).

    A numeric threshold must equal a number in an earlier get_history or backtest output of this answer
    (ideally a backtest candidate). Other numeric leaves (sensitivities, weights, baselineYears) must equal a
    number in an earlier data tool output (template, zone, history or backtest). Resets (None) and stage
    windows ('MM-DD') are not numbers and are not checked here."""
    if new_value is None or kind == "mmdd" or isinstance(new_value, str):
        return
    pool = ctx.data_outputs if kind in DATA_GROUNDED_KINDS else ctx.outputs
    v = float(new_value)
    # signed match (verify._close also accepts a flipped sign, which is fine for prose, not for a threshold)
    if not any(abs(v - k) <= 0.051 for k in verify.known_numbers(pool)):
        where = "a get_history or backtest output" if kind in DATA_GROUNDED_KINDS else "an earlier tool output"
        raise ToolError(
            f"newValue {new_value} does not appear in {where} of this answer. Run backtest with this value as a "
            "candidate (or get_history) first, then propose a value the tool output supports."
        )


def t_propose_change(ctx: ToolContext, inp: dict[str, Any]) -> dict[str, Any]:
    if len(ctx.proposals) >= MAX_PROPOSALS:
        raise ToolError(f"at most {MAX_PROPOSALS} proposals per answer")
    scope = inp.get("scope") or {}
    level, sid, path = scope.get("level"), scope.get("id"), inp.get("path") or ""
    reason = (inp.get("reason") or "").strip()
    if not reason:
        raise ToolError("reason is required (cite the tool output that supports the change)")
    try:
        parsed = rules.parse_change_path(ctx.portfolio, level, sid, path)
        new_value = rules.check_value(parsed["leafKind"], inp.get("newValue"))
    except rules.PathError as exc:
        raise ToolError(str(exc))
    _check_grounded(ctx, parsed["leafKind"], new_value)
    old_value, layer = rules.effective_leaf(ctx.portfolio, parsed["crop"], parsed["patchPath"], parsed["zone"], parsed["farm"])
    if new_value is not None and old_value == new_value:
        raise ToolError(f"the effective value is already {old_value} (set by {layer}); nothing to propose")
    shadowed = []
    if level in ("zone", "crop"):
        farms = rules.farms_in_zone(ctx.portfolio, sid) if level == "zone" else [f for f in ctx.portfolio.farms if f.crop == sid]
        for f in farms:
            v = rules._get(dump(f.overrides), parsed["patchPath"])
            if v is not None:
                shadowed.append({"farmId": f.id, "farmValue": v})
    if any(c.scope.level == level and c.scope.id == sid and c.path == path for c in ctx.proposals):
        raise ToolError("this path is already proposed in this answer")
    change = RuleChange(
        id=f"chg-{ctx.recommendation_id}-{len(ctx.proposals) + 1}",
        at=config.iso_utc(),
        actor=Actor(kind="agent", name="Farming agent"),
        scope=ChangeScope(level=level, id=sid),
        path=path,
        old_value=old_value,
        new_value=new_value,
        reason=reason[:500],
        status="proposed",
        recommendation_id=ctx.recommendation_id,
    )
    ctx.proposals.append(change)
    out = {"proposalId": change.id, "scope": f"{level}:{sid}", "path": path, "oldValue": old_value,
           "oldValueSetBy": layer, "newValue": new_value, "status": "proposed"}
    if shadowed:
        out["warning"] = ("These farms have their own override for this leaf, so the change will not affect them "
                          "unless the lender resets it")
        out["shadowedBy"] = shadowed
    return out


# ───────────────────────── schemas ─────────────────────────

_SCOPE_PROPS = {
    "zoneId": {"type": "string", "description": "Zone id from the portfolio. Omit to use the question's zone/farm."},
    "farmId": {"type": "string", "description": "Farm id from the portfolio. Omit to use the question's zone/farm."},
}

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "get_zone",
        "description": (
            "Zone facts from the lender's portfolio: centre, radius (35 km² circle), the farms in it with crop, "
            "outstanding exposure, next installment and current growth stage, plus every override already set at "
            "zone, farm and portfolio-crop level and the recent audit trail. No external data."
        ),
        "input_schema": {"type": "object", "properties": dict(_SCOPE_PROPS), "additionalProperties": False},
    },
    {
        "name": "get_crop_template",
        "description": (
            "Crop rules: growth stages (MM-DD windows), per-stage thresholds (frostCriticalC = T10, frostSevereC = "
            "T90, heatC, harvestRainMm72h, kc), stage sensitivities, chill hours, NDVI baseline years and risk "
            "weights. With zoneId/farmId it returns the EFFECTIVE values there and names the layer that set each "
            "custom value."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "crop": {"type": "string", "enum": list(CROPS)},
                **_SCOPE_PROPS,
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_history",
        "description": (
            "Past weather or vegetation for a farm or zone, summarised per season: tmin (min, nights <= 0 °C and "
            "<= the stage frost threshold), tmax, precip (total, max 72 h sum, wet days), eto, ndvi, ndmi. Pass a "
            "stage to scan that stage's window over up to 15 past seasons (fast); without a stage, up to 3 calendar "
            "years. Data: CR2MET / RAN stations / Sentinel-2 via the service's cached sources, with provenance."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "variable": {"type": "string", "enum": list(WEATHER_VARS + VEG_VARS)},
                "years": {"type": "integer", "minimum": 1, "maximum": MAX_HISTORY_YEARS},
                "stage": {"type": "string", "description": "Stage key, e.g. 'bloom' or 'harvest'."},
                "crop": {"type": "string", "enum": list(CROPS)},
                **_SCOPE_PROPS,
            },
            "required": ["variable"],
            "additionalProperties": False,
        },
    },
    {
        "name": "list_events",
        "description": (
            "Climate events around the zone (zone circle + 25 km) since a date: fires (GWIS/FIRMS), DGA water "
            "scarcity decrees, emergency declarations, floods, plus curated reference events such as the September "
            "2013 central-Chile frost."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "since": {"type": "string", "description": "YYYY-MM-DD, default 2013-01-01"},
                "kinds": {"type": "array", "items": {"type": "string"}},
                **_SCOPE_PROPS,
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "backtest",
        "description": (
            "Replay the frost rule (stage frostCriticalC, °C) or the harvest-rain rule (stage harvestRainMm72h, mm) "
            "over past seasons (default 2013 to the last complete season) with candidate thresholds. Reports per "
            "candidate hits, false alarms, missed damaging seasons and quiet seasons. Damaging season = a curated "
            "reference event (e.g. September 2013 frost) or a station damage proxy (frost: Tmin <= frostSevereC; "
            "rain: 72 h >= 1.5 x template trigger). The current effective value and the template value are always "
            "included as candidates. Default stage = the stage most sensitive to the peril."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "rule": {"type": "string", "enum": ["frost", "harvest_rain"]},
                "candidates": {"type": "array", "items": {"type": "number"}, "maxItems": MAX_CANDIDATES},
                "stage": {"type": "string"},
                "crop": {"type": "string", "enum": list(CROPS)},
                "fromSeason": {"type": "integer", "minimum": 2009},
                "toSeason": {"type": "integer"},
                "damageProxy": {"type": "number", "description": "Override the station damage proxy threshold."},
                **_SCOPE_PROPS,
            },
            "required": ["rule"],
            "additionalProperties": False,
        },
    },
    {
        "name": "propose_change",
        "description": (
            "Record ONE recommended rule change for the lender to apply or dismiss (nothing is applied). Paths "
            "(CONTRACT §E.2): zone scope 'overrides.<crop>.rules.stages.<stage>.<frostCriticalC|frostSevereC|heatC|"
            "harvestRainMm72h|kc>', 'overrides.<crop>.stages.<stage>.start|end' (MM-DD), "
            "'overrides.<crop>.stages.<stage>.sensitivity.<peril>', 'overrides.<crop>.rules.baselineYears', "
            "'overrides.<crop>.weights.a|b|c'; crop scope (id = crop) uses the same path without "
            "'overrides.<crop>.'; farm scope uses 'overrides.' + the same. newValue null resets to inherited. The "
            "server fills oldValue with the current effective value. The reason must cite the tool numbers."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "scope": {
                    "type": "object",
                    "properties": {
                        "level": {"type": "string", "enum": ["zone", "crop", "farm"]},
                        "id": {"type": "string"},
                    },
                    "required": ["level", "id"],
                    "additionalProperties": False,
                },
                "path": {"type": "string"},
                "newValue": {"type": ["number", "string", "null"]},
                "reason": {"type": "string"},
            },
            "required": ["scope", "path", "newValue", "reason"],
            "additionalProperties": False,
        },
    },
]

EXECUTORS: dict[str, Callable[[ToolContext, dict[str, Any]], dict[str, Any]]] = {
    "get_zone": t_get_zone,
    "get_crop_template": t_get_crop_template,
    "get_history": t_get_history,
    "list_events": t_list_events,
    "backtest": t_backtest,
    "propose_change": t_propose_change,
}


# ───────────────────────── summaries and evidence ─────────────────────────


def _fmt(v: Any) -> str:
    if isinstance(v, float):
        return f"{v:g}"
    return str(v)


def summarise(name: str, out: dict[str, Any]) -> str:
    try:
        if name == "get_zone":
            return (f"{out['zoneId']}: {len(out['farms'])} farm(s), exposure {_fmt(out['totalExposure'])} {out['currency']}, "
                    f"{len(out['zoneOverrides'])} zone override(s)")
        if name == "get_crop_template":
            return f"{out['crop']} ({out['effectiveFor']}): {len(out['stages'])} stages, current stage {out['currentStage']}"
        if name == "get_history":
            n = sum(r["validDays"] for r in out["seasons"])
            src = ", ".join(out["provenance"].get("sources") or []) or "no source"
            if not out["available"]:
                return f"{out['variable']}: no data ({'; '.join(out['errors'])[:160] or 'unavailable'})"
            return f"{out['variable']}: {len(out['seasons'])} window(s), {n} valid daily values, {src}"
        if name == "list_events":
            cat = out.get("catalog")
            base = f"{cat['count']} catalog event(s) {cat['byKind']}" if cat else out.get("catalogError", "no catalog")
            return f"{base}; {len(out['referenceEvents'])} reference event(s)"
        if name == "backtest":
            if not out.get("available"):
                return f"{out['rule']}: unavailable ({out.get('reason', '')[:160]})"
            parts = [f"{_fmt(c['value'])}: {c['hits']} hits, {c['falseAlarms']} false alarms, {c['missed']} missed"
                     for c in out["candidates"]]
            return f"{out['param']} over {out['seasonsEvaluated']} seasons; " + "; ".join(parts)
        if name == "propose_change":
            return f"{out['proposalId']}: {out['scope']} {out['path']} {_fmt(out['oldValue'])} -> {_fmt(out['newValue'])}"
    except Exception:
        pass
    return json.dumps(out, ensure_ascii=False, default=str)[:200]


def add_evidence(ctx: ToolContext, name: str, out: dict[str, Any]) -> None:
    if name == "backtest" and out.get("available"):
        ctx.evidence.append(AgentEvidence(
            kind="backtest",
            summary=f"{out['crop']} {out['param']} at {out['scope']}, {out['seasonsEvaluated']} seasons",
            data={k: out[k] for k in ("param", "rule", "stage", "currentValue", "templateValue", "seasonsEvaluated",
                                      "damagingSeasons", "damageProxy", "candidates", "knownEventsUsed", "method",
                                      "dataProvenance")}
            | {"seasons": [{k: s[k] for k in ("season", "extreme", "extremeDate", "damage", "damageReasons", "alerts")}
                           for s in out["seasons"]],
               "seasonsSkipped": [s["season"] for s in out["seasonsSkipped"]]},
        ))
    elif name == "get_history" and out.get("available"):
        ctx.evidence.append(AgentEvidence(
            kind="history",
            summary=f"{out['variable']} history at {out['scope']}" + (f", stage {out['stage']}" if out.get("stage") else ""),
            data={"variable": out["variable"], "unit": out["unit"], "seasons": out["seasons"], "provenance": out["provenance"]},
        ))
    elif name == "list_events":
        evs = (out.get("catalog") or {}).get("events") or []
        refs = out.get("referenceEvents") or []
        if evs or refs:
            ctx.evidence.append(AgentEvidence(
                kind="event",
                summary=f"{len(evs)} catalog event(s) and {len(refs)} reference event(s) since {out['since']}",
                data={"events": evs[:10], "referenceEvents": refs},
            ))


def execute(ctx: ToolContext, name: str, inp: Any) -> tuple[str, bool]:
    """Run one tool. Returns (content for the tool_result, is_error). Never raises."""
    inp = inp if isinstance(inp, dict) else {}
    fn = EXECUTORS.get(name)
    if fn is None:
        out_text, err, summary = json.dumps({"error": f"unknown tool '{name}'"}), True, f"unknown tool {name}"
    else:
        try:
            out = fn(ctx, inp)
            out_text = json.dumps(out, ensure_ascii=False, default=str)
            err, summary = False, summarise(name, out)
            add_evidence(ctx, name, out)
            if name in ("get_history", "backtest") and out.get("available", True) is not False:
                ctx.data_outputs.append(out_text)
        except ToolError as exc:
            out_text, err, summary = json.dumps({"error": str(exc)}, ensure_ascii=False), True, f"error: {exc}"[:200]
        except NotImplementedError as exc:
            msg = f"a data builder this tool needs is not implemented yet ({str(exc)[:120]})"
            out_text, err, summary = json.dumps({"error": msg}), True, f"error: {msg}"[:200]
        except Exception as exc:  # never let a builder failure escape (dispatch would serve the fixture or 500)
            msg = f"{exc.__class__.__name__}: {str(exc)[:200]}"
            out_text, err, summary = json.dumps({"error": msg}), True, f"error: {msg}"[:200]
    if name != "propose_change":  # a proposal echoes its own newValue: never let it count as evidence
        ctx.outputs.append(out_text)
    ctx.tool_calls.append(AgentToolCall(name=name, input=inp, output_summary=summary))
    return out_text, err


def new_recommendation_id() -> str:
    return f"rec-{uuid.uuid4().hex[:10]}"
