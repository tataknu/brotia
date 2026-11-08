"""Rules engine (CONTRACT §E.2–E.4, §E.7 helpers, audit): mirror of app/src/domain/rules.test.ts."""

from __future__ import annotations

from datetime import date

import pytest

from app.domain import (
    apply_change,
    commit_change,
    current_stage,
    effective_template,
    effective_zone,
    evaluate_credit_rules,
    get_crop_template,
    get_crop_templates,
    make_change,
    stage_bands,
    sync_zones,
    tier_floor,
)
from app.domain.rules import (
    compare_metric,
    effective_credit_rules_for_farm,
    effective_rules_for_zone,
    effective_value_at,
    get_at_path,
    installment_within,
    resolve_farm_leaf,
    score_tier,
    set_at_path,
)
from app.domain.stages import check_stage_tiling, find_current_stage
from app.domain.zones import ZONE_RADIUS_M, assign_zone_id, make_shared_zone
from app.models import CreditRuleOverride, Installment, Portfolio, RuleChange, Stage


@pytest.fixture()
def pf(sample_portfolio) -> Portfolio:
    return Portfolio.model_validate(sample_portfolio)


def _farm(p, fid):
    return p.farm(fid)


# ───────────── path helpers ─────────────


def test_set_at_path_creates_and_prunes_but_keeps_top_level():
    farm = {"overrides": {}}
    a = set_at_path(farm, "overrides.rules.stages.bloom.frostCriticalC", -2)
    assert get_at_path(a, "overrides.rules.stages.bloom.frostCriticalC") == -2 and farm == {"overrides": {}}
    b = set_at_path(a, "overrides.rules.stages.bloom.frostCriticalC", None)
    assert b == {"overrides": {}}


def test_arrays_indexed_by_id():
    p = {"creditRules": [{"id": "x", "when": {"value": 1}}]}
    assert get_at_path(p, "creditRules.x.when.value") == 1
    q = set_at_path(p, "creditRules.x.when.value", 2)
    assert get_at_path(q, "creditRules.x.when.value") == 2
    r = set_at_path(q, "creditRules.y", {"id": "y"})
    assert [c["id"] for c in r["creditRules"]] == ["x", "y"]
    s = set_at_path(r, "creditRules.x", None)
    assert [c["id"] for c in s["creditRules"]] == ["y"]


# ───────────── layering ─────────────


def test_farm_override_wins(pf):
    t = get_crop_template("cherry")
    assert t.rules.stages["bloom"].frost_critical_c == -2.4
    eff, _ = effective_template(pf, _farm(pf, "cl-requinoa-cherry"))
    assert eff.rules.stages["bloom"].frost_critical_c == -2.0
    assert eff.rules.stages["bloom"].frost_severe_c == t.rules.stages["bloom"].frost_severe_c
    assert resolve_farm_leaf(pf, t, _farm(pf, "cl-requinoa-cherry"), "rules.stages.bloom.frostCriticalC").layer == "farm"
    assert resolve_farm_leaf(pf, t, _farm(pf, "cl-requinoa-cherry"), "rules.stages.bloom.heatC").layer == "template"


def test_zone_override_wins_over_template(pf):
    t = get_crop_template("table_grape")
    assert t.rules.stages["harvest"].harvest_rain_mm72h == 8
    eff, _ = effective_template(pf, _farm(pf, "cl-ovalle-table-grape"))
    assert eff.rules.stages["harvest"].harvest_rain_mm72h == 5
    assert effective_rules_for_zone(pf, t, "auto-cl-ovalle-table-grape")["rules"]["stages"]["harvest"]["harvestRainMm72h"] == 5
    assert resolve_farm_leaf(pf, t, _farm(pf, "cl-ovalle-table-grape"), "rules.stages.harvest.harvestRainMm72h").layer == "zone"


def test_order_farm_zone_crop_template(sample_portfolio):
    d = dict(sample_portfolio)
    d["cropOverrides"] = {"table_grape": {"rules": {"stages": {"harvest": {"harvestRainMm72h": 20, "kc": 0.5}}}}}
    p = Portfolio.model_validate(d)
    eff, _ = effective_template(p, p.farm("cl-ovalle-table-grape"))
    assert eff.rules.stages["harvest"].harvest_rain_mm72h == 5  # zone beats crop
    assert eff.rules.stages["harvest"].kc == 0.5  # crop beats template
    d["farms"] = [dict(f) for f in d["farms"]]
    g = next(f for f in d["farms"] if f["id"] == "cl-ovalle-table-grape")
    g["overrides"] = {"rules": {"stages": {"harvest": {"harvestRainMm72h": 3}}}}
    p = Portfolio.model_validate(d)
    eff, _ = effective_template(p, p.farm("cl-ovalle-table-grape"))
    assert eff.rules.stages["harvest"].harvest_rain_mm72h == 3


def test_stage_windows_sensitivity_weights_merge_per_leaf(pf):
    f = _farm(pf, "cl-requinoa-cherry")
    f.overrides = f.overrides.model_validate({
        "stages": {"bloom": {"start": "08-25", "sensitivity": {"frost": 0.5}}},
        "weights": {"c": 0.5},
    })
    t = get_crop_template("cherry")
    eff, warnings = effective_template(pf, f)
    bloom = next(s for s in eff.stages if s.key == "bloom")
    tb = next(s for s in t.stages if s.key == "bloom")
    assert bloom.start == "08-25" and bloom.end == tb.end
    assert bloom.sensitivity["frost"] == 0.5 and bloom.sensitivity["heat"] == tb.sensitivity["heat"]
    assert eff.weights.model_dump() == {**t.weights.model_dump(), "c": 0.5}
    assert any("overlap" in w for w in warnings)  # 08-25..08-31 now in budbreak and bloom
    assert next(s for s in get_crop_template("cherry").stages if s.key == "bloom").start == tb.start  # untouched


def test_unknown_stage_override_is_warned_not_applied(pf):
    f = _farm(pf, "cl-requinoa-cherry")
    f.overrides = f.overrides.model_validate({"rules": {"stages": {"nope": {"kc": 9}}}})
    eff, warnings = effective_template(pf, f)
    assert "nope" not in eff.rules.stages and any("unknown stage 'nope'" in w for w in warnings)


def test_credit_rules_merge(pf):
    f = _farm(pf, "cl-requinoa-cherry")
    rules = effective_credit_rules_for_farm(pf, get_crop_template("cherry"), f)
    r = next(x for x in rules if x.rule.id == "cr-risk-high-before-installment")
    assert r.rule.when.within_days_before_installment == 90 and r.rule.when.metric == "risk.tier"
    assert r.farm_overridden == ["when.withinDaysBeforeInstallment"]
    assert [x.rule.id for x in rules] == ["cr-risk-high-before-installment", "cr-abandonment", "cr-decree-low-snowmelt",
                                          "cr-burned-area", "pf-score-80"]
    eff, _ = effective_template(pf, f)
    assert [r.id for r in eff.credit_rules][-1] == "pf-score-80"


def test_portfolio_rule_with_template_id_replaces(sample_portfolio):
    d = dict(sample_portfolio)
    tr = get_crop_template("cherry").credit_rules[1].model_dump(by_alias=True)
    tr["then"] = "high"
    d["creditRules"] = [tr]
    p = Portfolio.model_validate(d)
    rules = effective_credit_rules_for_farm(p, get_crop_template("cherry"), p.farm("cl-requinoa-cherry"))
    r = next(x for x in rules if x.rule.id == tr["id"])
    assert r.rule.then == "high" and r.source == "portfolio" and len(rules) == 4


# ───────────── credit evaluation (§E.7) ─────────────


def test_compare_metric_orders_and_nulls():
    assert compare_metric("risk.tier", "gte", "high", "high")
    assert not compare_metric("risk.tier", "gte", "watch", "high")
    assert compare_metric("water.stressLevel", "gte", "severe", "moderate")
    assert not compare_metric("water.stressLevel", "gte", "unknown", "mild")
    assert not compare_metric("water.snowmeltPct", "lt", None, 70)
    assert compare_metric("water.snowmeltPct", "lt", 55.0, 70)
    assert compare_metric("water.decreeActive", "eq", True, True)
    assert not compare_metric("water.decreeActive", "gt", True, False)
    assert score_tier(34.9) == "normal" and score_tier(35) == "watch" and score_tier(60) == "high"


def test_evaluate_credit_rules_fixture_story(pf):
    """Ovalle: decree active + snowmelt < 70 % -> cr-decree-low-snowmelt fires (watch)."""
    eff, _ = effective_template(pf, _farm(pf, "cl-ovalle-table-grape"))
    metrics = {"risk.tier": "watch", "risk.score": 58.6, "water.decreeActive": True, "water.snowmeltPct": 55.0,
               "water.stressLevel": "mild", "imagery.abandonment": False, "events.burnedAreaIntersects": False}
    nxt = Installment(due_date="2026-11-30", amount=30000)
    fired = evaluate_credit_rules(eff.credit_rules, metrics, nxt, date(2026, 11, 7))
    assert [a.rule_id for a in fired] == ["cr-decree-low-snowmelt"]
    assert tier_floor(fired) == "watch"
    metrics["water.snowmeltPct"] = None  # null metric -> condition false
    assert evaluate_credit_rules(eff.credit_rules, metrics, nxt, date(2026, 11, 7)) == []


def test_within_days_before_installment(pf):
    eff, _ = effective_template(pf, _farm(pf, "cl-requinoa-cherry"))  # 90 days (farm override)
    m = {"risk.tier": "high", "risk.score": 70.0}
    nxt = Installment(due_date="2027-01-31", amount=60000)
    assert [a.rule_id for a in evaluate_credit_rules(eff.credit_rules, m, nxt, "2026-11-07")] == ["cr-risk-high-before-installment"]
    assert installment_within(nxt, "2026-11-07", 90) and not installment_within(nxt, "2026-11-07", 60)
    assert not installment_within(None, "2026-11-07", 90)
    m["risk.score"] = 85.0
    fired = evaluate_credit_rules(eff.credit_rules, m, nxt, "2026-11-07")
    assert [a.action for a in fired] == ["watch", "restructure_review"] and tier_floor(fired) == "high"


def test_disabled_rule_skipped(pf):
    f = _farm(pf, "cl-requinoa-cherry")
    f.credit_rule_overrides = {"cr-abandonment": CreditRuleOverride(enabled=False)}
    eff, _ = effective_template(pf, f)
    assert not next(r for r in eff.credit_rules if r.id == "cr-abandonment").enabled
    assert evaluate_credit_rules(eff.credit_rules, {"imagery.abandonment": True}, None, "2026-11-07") == []


# ───────────── stages ─────────────


def test_every_template_tiles_the_year():
    for t in get_crop_templates():
        assert check_stage_tiling(t.stages) == ([], []), t.crop


def test_current_stage_wraps_and_feb29():
    cherry = get_crop_template("cherry")
    assert current_stage(cherry, date(2026, 9, 20))[0].key == "bloom"
    assert current_stage(cherry, date(2026, 12, 25))[0].key == "harvest"
    assert current_stage(cherry, "2027-01-10")[0].key == "harvest"
    assert current_stage(cherry, "2028-02-29")[0].key == current_stage(cherry, "2027-02-28")[0].key
    assert current_stage(cherry, date(2026, 11, 7)) == (next(s for s in cherry.stages if s.key == "fruit_growth"), [])


def test_gap_and_overlap_rules():
    sens = {p: 0 for p in ["frost", "heat", "harvest_rain", "water", "chill", "fire", "flood", "declared_emergency",
                           "abandonment", "vigour"]}
    mk = lambda k, s, e: Stage(key=k, label=k, label_es=k, start=s, end=e, sensitivity=sens)
    stages = [mk("a", "03-01", "04-30"), mk("b", "03-15", "06-30"), mk("c", "09-01", "12-31")]
    cs = find_current_stage(stages, "2026-03-20")
    assert cs.stage.key == "a" and cs.overlap and not cs.gap
    cs = find_current_stage(stages, "2026-07-15")
    assert cs.stage.key == "b" and cs.gap
    cs = find_current_stage(stages, "2026-01-15")  # before every start -> wrap to the latest start
    assert cs.stage.key == "c" and cs.gap


def test_stage_bands_cover_window():
    t = get_crop_template("cherry")
    bands = stage_bands(t, date(2026, 11, 7))
    assert bands[0].start == "2025-10-07" and bands[-1].end == "2026-11-07"
    for a, b in zip(bands, bands[1:]):
        assert date.fromisoformat(a.end).toordinal() + 1 == date.fromisoformat(b.start).toordinal()
        assert a.stage != b.stage
    assert bands[-1].stage == "fruit_growth" and bands[-1].start == "2026-10-06"
    assert any(b.stage == "harvest" and b.start == "2025-11-10" and b.end == "2026-01-15" for b in bands)


# ───────────── zones ─────────────


def test_zone_assignment(pf):
    farm = _farm(pf, "cl-requinoa-cherry")
    assert assign_zone_id(farm.id, farm.centroid, pf.zones) == "auto-cl-requinoa-cherry"
    near = make_shared_zone("z-near", "near", (farm.centroid[0] + 0.005, farm.centroid[1]))
    far = make_shared_zone("z-far", "far", (farm.centroid[0] + 0.02, farm.centroid[1]))
    out = make_shared_zone("z-out", "out", (farm.centroid[0] + 0.2, farm.centroid[1]))
    assert near.radius_m == ZONE_RADIUS_M
    assert assign_zone_id(farm.id, farm.centroid, [*pf.zones, far, near, out]) == "z-near"
    assert assign_zone_id(farm.id, farm.centroid, [*pf.zones, out]) == "auto-cl-requinoa-cherry"
    a = make_shared_zone("a-twin", "a", (farm.centroid[0] + 0.005, farm.centroid[1]))
    b = make_shared_zone("b-twin", "b", (farm.centroid[0] + 0.005, farm.centroid[1]))
    assert assign_zone_id(farm.id, farm.centroid, [b, a]) == "a-twin"


def test_effective_zone_synthesises_missing_auto_zone(pf):
    pf.zones = [z for z in pf.zones if z.id != "auto-cl-requinoa-cherry"]
    z, w = effective_zone(pf, _farm(pf, "cl-requinoa-cherry"))
    assert z.id == "auto-cl-requinoa-cherry" and z.radius_m == 3338 and z.auto and w


def test_sync_zones(pf):
    d = pf.model_copy(deep=True)
    d.zones = [z for z in d.zones if z.id != "auto-cl-ovalle-table-grape"] + [
        make_shared_zone("x", "x", (0, 0)).model_copy(update={"id": "auto-gone", "auto": True})]
    f = d.farm("cl-requinoa-cherry")
    f.centroid = (f.centroid[0] + 0.001, f.centroid[1])
    q = sync_zones(d)
    ids = sorted(z.id for z in q.zones)
    assert ids == ["auto-cl-ovalle-table-grape", "auto-cl-requinoa-cherry"]
    assert q.zone("auto-cl-requinoa-cherry").center == q.farm("cl-requinoa-cherry").centroid
    assert all(f.zone_id == f"auto-{f.id}" for f in q.farms)
    assert sync_zones(q).model_dump() == q.model_dump()  # idempotent


# ───────────── audit trail ─────────────


def test_fixture_audit_old_values_are_reproduced(sample_portfolio):
    """Replay the fixture audit on the bare portfolio: oldValue of each change = effective value before it."""
    p = Portfolio.model_validate(sample_portfolio)
    bare = p.model_copy(deep=True)
    for z in bare.zones:
        z.overrides = {}
    for f in bare.farms:
        f.overrides = f.overrides.model_validate({})
        f.credit_rule_overrides = {}
    bare.audit = []
    for ch in p.audit:
        new = make_change(bare, None, level=ch.scope.level, scope_id=ch.scope.id, path=ch.path,
                          new_value=ch.new_value, reason=ch.reason, at=ch.at, id=ch.id)
        assert new.old_value == ch.old_value, ch.path
        bare = commit_change(bare, new)
    a = bare.model_dump(by_alias=True, exclude={"audit"})
    b = p.model_dump(by_alias=True, exclude={"audit"})
    assert a == b
    assert [c.id for c in bare.audit] == ["chg-0001", "chg-0002", "chg-0003"]


def test_reset_to_inherited_prunes(pf):
    ch = make_change(pf, None, level="farm", scope_id="cl-requinoa-cherry", path="overrides.rules.stages.bloom.frostCriticalC",
                     new_value=None, reason="reset")
    assert ch.old_value == -2.0
    q = commit_change(pf, ch)
    assert q.farm("cl-requinoa-cherry").overrides.model_dump(by_alias=True) == {}
    assert effective_value_at(q, None, "farm", "cl-requinoa-cherry", "overrides.rules.stages.bloom.frostCriticalC") == -2.4
    assert q.audit[-1].id == ch.id and len(q.audit) == len(pf.audit) + 1


def test_crop_and_portfolio_scope_changes(pf):
    ch = make_change(pf, None, level="crop", scope_id="cherry", path="rules.stages.bloom.harvestRainMm72h",
                     new_value=25, reason="x")
    assert ch.old_value == 30
    q = apply_change(pf, ch)
    assert q.crop_overrides["cherry"].model_dump(by_alias=True) == {"rules": {"stages": {"bloom": {"harvestRainMm72h": 25}}}}
    q2 = apply_change(q, RuleChange.model_validate({**ch.model_dump(by_alias=True), "newValue": None}))
    assert "cherry" not in q2.crop_overrides
    # editing a field of an inherited template rule at portfolio level seeds it from the template first
    ch = make_change(pf, None, level="portfolio", scope_id=pf.id, path="creditRules.cr-abandonment.then",
                     new_value="high", reason="x")
    assert ch.old_value == "field_visit"
    q = apply_change(pf, ch)
    assert next(r for r in q.credit_rules if r.id == "cr-abandonment").then == "high"
    # proposals are not applied
    prop = RuleChange.model_validate({**ch.model_dump(by_alias=True), "status": "proposed"})
    assert apply_change(pf, prop) is pf


def test_zone_change_on_shared_zone(pf):
    z = make_shared_zone("zone-x", "X", tuple(pf.farm("cl-requinoa-cherry").centroid))
    pf.zones.append(z)
    path = "overrides.cherry.rules.stages.bloom.frostCriticalC"
    ch = make_change(pf, None, level="zone", scope_id="zone-x", path=path, new_value=-1.8, reason="frost pocket")
    assert ch.old_value == -2.4
    q = commit_change(pf, ch)
    f = q.farm("cl-requinoa-cherry")
    f.overrides = f.overrides.model_validate({})  # drop the farm override so the zone value shows
    eff, _ = effective_template(q, f)
    assert eff.rules.stages["bloom"].frost_critical_c == -1.8
    q = commit_change(q, make_change(q, None, level="zone", scope_id="zone-x", path=path, new_value=None, reason="reset"))
    assert q.zone("zone-x").overrides == {}
