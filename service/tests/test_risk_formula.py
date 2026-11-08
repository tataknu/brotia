"""svc-risk: golden tests for the pure maths (CONTRACT §E.1, §E.5, §E.7) and signal extraction."""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from app import provenance as prov
from app.models import CreditRule, Driver, FarmAssessment, FiredCreditAction, Installment, RiskWeights, Series, SeriesPoint
from app.risk import credit, signals
from app.risk.assess import window_start
from app.risk.formula import assess_risk, combine, make_driver, noisy_or, ramp, tier_for

FIX = Path(__file__).resolve().parents[2] / "contracts" / "v1" / "fixtures"
W = RiskWeights(a=0.65, b=0.35, c=0.30)
P = prov.build("derived", note="test")


def crops():
    return {t["crop"]: t for t in json.loads((FIX / "crops.json").read_text())}


def stage_of(crop: str, key: str) -> dict:
    return next(s for s in crops()[crop]["stages"] if s["key"] == key)


def cd(component, peril, sev, sens):
    return make_driver(component, peril, "m", sev, sens, 0, f"{peril} text", None, None, None, P)


def gd(peril, sev, c=0.3):
    return make_driver("geography", peril, "g", sev, None, c, f"{peril} geo", None, None, None, P)


# ───────────────────────── primitives ─────────────────────────

def test_ramp_increasing_decreasing_and_clamped():
    assert ramp(5, 0, 10) == 0.5
    assert ramp(-3.0, -1.4, -3.9) == pytest.approx(0.64)  # decreasing ramp (frost)
    assert ramp(20, 0, 10) == 1.0 and ramp(-5, 0, 10) == 0.0
    assert ramp(1, 1, 1) == 0.0  # degenerate ramp never divides by zero


def test_noisy_or_and_tiers():
    assert noisy_or([]) == 0
    assert noisy_or([0.5, 0.5]) == pytest.approx(0.75)
    assert tier_for(34.9) == "normal" and tier_for(35) == "watch" and tier_for(59.9) == "watch" and tier_for(60) == "high"


# ───────────────────────── hand-computed goldens (ADR-0013 D6) ─────────────────────────

def test_single_severe_frost_at_bloom_is_high():
    s = stage_of("cherry", "bloom")["sensitivity"]
    th = crops()["cherry"]["rules"]["stages"]["bloom"]
    sev = ramp(-4.5, th["frostCriticalC"] + 1, th["frostSevereC"])  # −4.5 °C below T90 −3.9 → 1
    assert sev == 1.0
    r = assess_risk("bloom", "Bloom", W, [cd("climate", "frost", sev, s["frost"])], [], [], [])
    # C = 1, D = 0: base = 0.5·0.65 + 0.5·1 = 0.825 → 82.5
    assert r.score == 82.5 and r.score_tier == "high" and r.tier == "high"
    assert r.headline == "Bloom: frost text"


def test_same_frost_in_dormancy_is_normal():
    s = stage_of("cherry", "dormancy")["sensitivity"]
    th = crops()["cherry"]["rules"]["stages"]["dormancy"]
    # −4.5 °C does not reach the dormant-bud threshold (−8 °C): severity 0
    sev = ramp(-4.5, th["frostCriticalC"] + 1, th["frostSevereC"])
    assert sev == 0.0
    r = assess_risk("dormancy", "Dormancy", W, [cd("climate", "frost", sev, s["frost"])], [], [], [])
    assert r.score == 0.0 and r.tier == "normal"
    assert r.headline == "No significant stress at dormancy."
    # Even a full-severity frost is damped by the dormancy sensitivity 0.1: C = 0.1 → 8.25 → normal
    r2 = assess_risk("dormancy", "Dormancy", W, [cd("climate", "frost", 1.0, s["frost"])], [], [], [])
    assert r2.score == pytest.approx(8.2, abs=0.11) and r2.tier == "normal"


def test_geography_amplifies_but_never_acts_alone():
    r0 = assess_risk("bloom", "Bloom", W, [], [], [gd("frost", 1.0), gd("fire", 1.0), gd("water", 1.0)], [])
    assert r0.score == 0.0 and r0.tier == "normal"
    assert r0.headline == "No significant stress at bloom."  # geography never headlines
    base_only = assess_risk("bloom", "Bloom", W, [cd("climate", "frost", 0.5, 1.0)], [], [], [])
    amplified = assess_risk("bloom", "Bloom", W, [cd("climate", "frost", 0.5, 1.0)], [], [gd("frost", 1.0)], [])
    # base = 0.5·0.65·0.5 + 0.5·0.5 = 0.4125 → 41.25 (float rounding: 41.2) ; ×(1 + 0.3·1) → 53.625
    assert base_only.score == pytest.approx(41.25, abs=0.06) and base_only.tier == "watch"
    assert amplified.score == pytest.approx(53.6, abs=0.06) and amplified.score > base_only.score
    assert amplified.components.geography.value == 1.0


def test_disaster_alone_reaches_high():
    # burned area on the farm: fire severity 1 × sensitivity 1 → D = 1: base = 0.5·0.35 + 0.5 = 0.675
    fired = [FiredCreditAction(rule_id="cr-burned-area", action="restructure_review", message="m")]
    r = assess_risk("bloom", "Bloom", W, [], [cd("disaster", "fire", 1.0, 1.0)], [], fired)
    assert r.score == 67.5 and r.score_tier == "high" and r.tier == "high"


def test_active_decree_alone_floors_at_watch():
    r = assess_risk("bloom", "Bloom", W, [], [cd("disaster", "declared_emergency", 0.6, 1.0)], [], [])
    # D = 0.6: base = 0.5·0.35·0.6 + 0.5·0.6 = 0.405
    assert r.score == 40.5 and r.tier == "watch"


def test_credit_floor_raises_final_tier_not_score_tier():
    fired = [FiredCreditAction(rule_id="cr-abandonment", action="field_visit", message="m")]
    r = assess_risk("bloom", "Bloom", W, [], [], [], fired)
    assert r.score_tier == "normal" and r.tier == "watch"


def test_g_is_mean_of_available_factors_only():
    geo = [gd("frost", 0.6), gd("fire", 0.0), gd("water", 0.0)]
    r = assess_risk("x", "X", W, [cd("climate", "frost", 0.5, 1.0)], [], geo, [], geography_available=[geo[0]])
    assert r.components.geography.value == 0.6


# ───────────────────────── fixture reproduction ─────────────────────────

def _drivers(d: list[dict]) -> list[Driver]:
    return [Driver.model_validate(x) for x in d]


def test_reproduces_ovalle_fixture_exactly():
    fx = json.loads((FIX / "assessment-farm-cl-ovalle-table-grape.json").read_text())
    rk = fx["risk"]
    comp = rk["components"]
    fired = [FiredCreditAction.model_validate(x) for x in rk["creditActions"]]
    r = assess_risk(rk["stage"]["key"], rk["stage"]["label"], RiskWeights.model_validate(rk["weights"]),
                    _drivers(comp["climate"]["drivers"]), _drivers(comp["disaster"]["drivers"]),
                    _drivers(comp["geography"]["drivers"]), fired)
    got = r.model_dump(by_alias=True, mode="json")
    assert got["score"] == 58.6 == rk["score"]
    assert got["scoreTier"] == rk["scoreTier"] and got["tier"] == rk["tier"] == "watch"
    assert got["formula"] == rk["formula"]
    assert got["headline"] == rk["headline"]
    assert [d["metric"] for d in got["drivers"]] == [d["metric"] for d in rk["drivers"]]
    for k in ("climate", "disaster", "geography"):
        assert got["components"][k]["value"] == comp[k]["value"]
    FarmAssessment.model_validate({**fx, "risk": got})


def test_reproduces_requinoa_score():
    fx = json.loads((FIX / "assessment-portfolio.json").read_text())
    req = next(r for r in fx["ranked"] if "requinoa" in r["farmId"])
    s = stage_of("cherry", "fruit_growth")["sensitivity"]
    th = crops()["cherry"]["rules"]["stages"]["fruit_growth"]
    climate = [
        cd("climate", "heat", ramp(31.2, th["heatC"] - 2, th["heatC"] + 3), s["heat"]),
        cd("climate", "frost", ramp(3.4, th["frostCriticalC"] + 1, th["frostSevereC"]), s["frost"]),
        cd("climate", "harvest_rain", ramp(2.1, 10, 30), s["harvest_rain"]),
        cd("climate", "water", 0.0, s["water"]),
        cd("climate", "chill", ramp(862, 500, 250), s["chill"]),
        cd("climate", "vigour", ramp(-0.3, -1.0, -2.5), s["vigour"]),
        cd("climate", "abandonment", 0.0, s["abandonment"]),
    ]
    geo = [gd("frost", ramp(-12.0, 0, -30)), gd("fire", 2 / 5), gd("water", 5 / 10)]
    r = assess_risk("fruit_growth", "Fruit set and growth", W, climate, [], geo, [])
    assert r.score == req["score"] == 13.4 and r.tier == "normal"


def test_combine_matches_formula_text():
    base, score = combine(0.36, 0.6, 0.4, W)
    assert round(base, 2) == 0.52 and score == pytest.approx(58.6, abs=0.15)


# ───────────────────────── credit rules (§E.7) ─────────────────────────

def _rules():
    return [CreditRule.model_validate(r) for r in crops()["cherry"]["creditRules"]]


def _metrics(**kw):
    base = dict(score=20.0, score_tier="normal", decree_active=False, snowmelt_pct=None, stress_level="none",
                abandonment=False, burned_area_intersects=False, next_installment=None, as_of=date(2026, 11, 7))
    base.update(kw)
    return credit.CreditMetrics(**base)


def test_credit_decree_and_low_snowmelt():
    fired = credit.evaluate(_rules(), _metrics(decree_active=True, snowmelt_pct=64))
    assert [f.rule_id for f in fired] == ["cr-decree-low-snowmelt"]
    assert credit.evaluate(_rules(), _metrics(decree_active=True, snowmelt_pct=None)) == []  # null metric → false
    assert credit.evaluate(_rules(), _metrics(decree_active=True, snowmelt_pct=80)) == []


def test_credit_high_risk_before_installment_window():
    soon = Installment(due_date="2026-12-01", amount=1000)
    late = Installment(due_date="2027-03-01", amount=1000)
    assert [f.rule_id for f in credit.evaluate(_rules(), _metrics(score=70, score_tier="high", next_installment=soon))] \
        == ["cr-risk-high-before-installment"]
    assert credit.evaluate(_rules(), _metrics(score=70, score_tier="high", next_installment=late)) == []
    assert credit.evaluate(_rules(), _metrics(score=70, score_tier="high", next_installment=None)) == []
    assert credit.evaluate(_rules(), _metrics(score=50, score_tier="watch", next_installment=soon)) == []


def test_credit_abandonment_burned_area_and_disabled():
    rules = _rules()
    ids = [f.rule_id for f in credit.evaluate(rules, _metrics(abandonment=True, burned_area_intersects=True))]
    assert ids == ["cr-abandonment", "cr-burned-area"]
    rules[1].enabled = False
    assert [f.rule_id for f in credit.evaluate(rules, _metrics(abandonment=True))] == []


def test_credit_ordered_metrics():
    rule = CreditRule.model_validate({"id": "x", "name": "x", "enabled": True, "then": "watch", "message": "m",
                                      "when": {"metric": "water.stressLevel", "op": "gte", "value": "moderate"}})
    assert credit.evaluate([rule], _metrics(stress_level="severe"))
    assert not credit.evaluate([rule], _metrics(stress_level="mild"))
    assert not credit.evaluate([rule], _metrics(stress_level="unknown"))
    r2 = CreditRule.model_validate({"id": "y", "name": "y", "enabled": True, "then": "high", "message": "m",
                                    "when": {"metric": "risk.score", "op": "gte", "value": 80}})
    assert credit.evaluate([r2], _metrics(score=80.0)) and not credit.evaluate([r2], _metrics(score=79.9))


# ───────────────────────── signals ─────────────────────────

def _daily(values: dict[str, float | None], var="precip") -> Series:
    pts = [SeriesPoint(date=k, value=v) for k, v in sorted(values.items())]
    return Series(variable=var, unit="mm", points=pts, provenance=P)


def test_window_start_is_13_months_back():
    assert window_start(date(2026, 11, 7)) == date(2025, 10, 7)
    assert window_start(date(2026, 3, 31)) == date(2025, 2, 28)


def test_last_7_days_extremes_and_72h_rain_anchor_on_latest_data():
    as_of = date(2026, 11, 7)
    vals = {(as_of - timedelta(days=i)).isoformat(): 0.0 for i in range(1, 20)}  # data ends 6 Nov
    vals["2026-11-03"], vals["2026-11-04"], vals["2026-11-05"] = 10.0, 12.0, 3.0
    vals["2026-10-25"] = 99.0  # outside the 7 days
    ex = signals.max_rain_72h(_daily(vals), as_of)
    assert ex.value == 25.0 and ex.anchor == date(2026, 11, 6) and ex.on == date(2026, 11, 5)
    tmin = _daily({**{k: 5.0 for k in vals}, "2026-11-02": -3.1}, "tmin")
    m = signals.window_extreme(tmin, as_of, "min")
    assert m.value == -3.1 and m.on == date(2026, 11, 2)
    assert signals.window_extreme(tmin, date(2026, 12, 31), "min") is None  # data too old


def test_persistent_z_and_stress_levels():
    zs = [signals.ZPoint(date(2026, 10, 1) + timedelta(days=5 * i), -0.4, False) for i in range(6)]
    pz = signals.persistent_z(zs, date(2026, 11, 7))
    assert pz.method == "mean32d" and pz.z == pytest.approx(-0.4)
    zs[-1].z, zs[-2].z = -1.6, -1.2
    pz = signals.persistent_z(zs, date(2026, 11, 7))
    assert pz.method == "last2" and pz.z == pytest.approx(-1.4)
    assert [signals.stress_level(z) for z in (None, 0, -0.7, -1.2, -1.5)] == ["unknown", "none", "mild", "moderate", "severe"]


def test_z_from_band_with_floor():
    s = Series(variable="ndvi", unit="index", provenance=P, points=[
        SeriesPoint(date="2026-11-03", value=0.44, p10=0.42, p50=0.49, p90=0.56)])
    z = signals.z_points(s)[0].z
    assert z == pytest.approx((0.44 - 0.49) / (0.14 / 2.5631))  # band sd 0.0546 > floor 0.05
    s.points[0].p10, s.points[0].p90 = 0.48, 0.50  # narrow band → floor 0.05
    assert signals.z_points(s)[0].z == pytest.approx(-1.0)


def test_chill_estimate_full_winter():
    pts_lo, pts_hi = {}, {}
    d = date(2026, 5, 1)
    while d <= date(2026, 8, 31):
        pts_lo[d.isoformat()], pts_hi[d.isoformat()] = 2.0, 12.2  # 24·5.2/10.2 ≈ 12.2 h/day
        d += timedelta(days=1)
    est = signals.chill_hours_estimate(_daily(pts_lo, "tmin"), _daily(pts_hi, "tmax"), date(2026, 11, 7))
    assert est is not None and not est.in_progress
    assert est.hours == pytest.approx(123 * 24 * 5.2 / 10.2, abs=1)


def test_low_vigour_run():
    base = date(2025, 12, 1)
    zs = [signals.ZPoint(base + timedelta(days=5 * i), z, False) for i, z in enumerate([-0.5, -2.1, -2.4, -2.2, -0.3])]
    run = signals.low_vigour_run(zs, base, date(2026, 4, 30))
    assert run is not None and len(run.dates) == 3
    assert signals.low_vigour_run(zs[:3], base, date(2026, 4, 30)) is None
