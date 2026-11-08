"""svc-risk: assess_farm / assess_portfolio orchestration with every other builder package mocked
(they are built in parallel). Domain functions are replaced by small local fakes over crops.json."""

from __future__ import annotations

import json
import math
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from app import provenance as prov
from app.models import (
    ClimateEvent,
    CropTemplate,
    FarmAssessment,
    Installment,
    Portfolio,
    PortfolioAssessment,
    Series,
    SeriesPoint,
    Stage,
    WaterSupply,
    Zone,
)
from app.risk import assess, deps
from app.risk.inputs import Elevation

FIX = Path(__file__).resolve().parents[2] / "contracts" / "v1" / "fixtures"
AS_OF = date(2026, 11, 7)


# ───────────────────────── fakes ─────────────────────────

def _templates():
    return {t["crop"]: CropTemplate.model_validate(t) for t in json.loads((FIX / "crops.json").read_text())}


def _in(md, s, e):
    return (s <= md <= e) if s <= e else (md >= s or md <= e)


class World:
    """Configurable fake upstream world."""

    def __init__(self):
        self.tmin = 6.0
        self.tmax = 24.0
        self.precip = 0.0
        self.eto = 4.0
        self.cold_night: tuple[date, float] | None = None
        self.ndvi_z_override: dict[str, float] = {}  # 'YYYY-MM-DD' -> z
        self.supply = WaterSupply(decree_active=False, snowmelt_pct_of_normal=105, basin="Cachapoal",
                                  provenance=prov.build("dga_decrees", observed_at="2026-10-15"))
        self.events: list[ClimateEvent] = []
        self.fail: set[str] = set()
        self.calls: dict[str, int] = {}
        self.fail_template_for: set[str] = set()

    def hit(self, k):
        self.calls[k] = self.calls.get(k, 0) + 1
        if k in self.fail:
            raise NotImplementedError(k)

    # domain
    def effective_zone(self, portfolio, farm):
        z = portfolio.zone(f"auto-{farm.id}") or Zone(id=f"auto-{farm.id}", name="z", center=farm.centroid,
                                                       radius_m=3338, auto=True)
        return z, []

    def effective_template(self, portfolio, farm):
        if farm.id in self.fail_template_for:
            raise RuntimeError("bad rules")
        return _templates()[farm.crop], []

    def current_stage(self, template, as_of):
        md = as_of.strftime("%m-%d")
        return next(s for s in template.stages if _in(md, s.start, s.end)), []

    def stage_bands(self, template, as_of):
        return []

    def outstanding_at(self, loan, as_of):
        if loan is None:
            return 0.0
        return max(0.0, loan.amount - sum(i.amount for i in loan.installments if i.due_date <= as_of.isoformat()))

    def next_installment(self, loan, as_of):
        if loan is None:
            return None
        later = sorted((i for i in loan.installments if i.due_date > as_of.isoformat()), key=lambda i: i.due_date)
        return later[0] if later else None

    # sources
    def weather_series(self, variable, farm, start, end, country):
        self.hit(variable)
        val = {"tmin": self.tmin, "tmax": self.tmax, "precip": self.precip, "eto": self.eto}[variable]
        pts, d = [], start
        while d < end:  # data ends the day before as-of
            v = val
            if variable == "tmin" and self.cold_night and d == self.cold_night[0]:
                v = self.cold_night[1]
            pts.append(SeriesPoint(date=d.isoformat(), value=v))
            d += timedelta(days=1)
        return Series(variable=variable, unit="mm" if variable in ("precip", "eto") else "°C", points=pts,
                      provenance=prov.build("cr2met_nrt", observed_at=end - timedelta(days=1)))

    def vegetation_series(self, farm, variable, start, end, baseline_years=5):
        self.hit(variable)
        pts, d = [], start
        while d <= end:
            z = self.ndvi_z_override.get(d.isoformat(), -0.2) if variable == "ndvi" else -0.3
            p50, sd = 0.6, 0.06
            pts.append(SeriesPoint(date=d.isoformat(), value=round(p50 + z * sd, 4), p10=round(p50 - 1.2816 * sd, 4),
                                   p50=p50, p90=round(p50 + 1.2816 * sd, 4), estimated=False))
            d += timedelta(days=5)
        return Series(variable=variable, unit="index", points=pts,
                      provenance=prov.build("s2_l2a_pc", observed_at=pts[-1].date))

    def water_supply(self, portfolio, farm, as_of):
        self.hit("supply")
        return self.supply

    def decree_history_years(self, farm, since_year=2008, as_of=None):
        self.hit("decree_years")
        return 3, prov.build("dga_decrees", observed_at="2026-10-01")

    def list_events(self, bbox, since, until=None):
        self.hit("events")
        return [e for e in self.events if e.start >= since.isoformat()]

    def find_peers(self, farm, zone, max_peers=20):
        self.hit("peers")
        raise NotImplementedError("peers")

    #: kind -> WeatherEvents-like object from a RAN station, or absent = no station (series path)
    stations: dict = {}

    def station_events(self, kind, farm, start, end, country):
        return self.stations.get(kind)

    #: svc-imagery vigour_signals result, or None = placeholder (peers unavailable, risk's own abandonment)
    vigour: dict | None = None

    def imagery_vigour(self, portfolio, farm, as_of):
        self.hit("peers")
        if self.vigour is None:
            raise NotImplementedError("peers")
        return self.vigour

    def irrigation_check(self, farm, distance_m=500):
        self.hit("irrigation")
        return SimpleNamespace(value="yes", evidence="2 CIREN irrigated-area polygon(s) within 500 m.", estimated=False,
                               provenance=prov.build("ciren_irrigated", observed_at="2022-01-01"))

    def relative_elevation(self, centroid, zone_center, radius_m, data_tier):
        self.hit("elevation")
        return Elevation(rel_m=-12.0, farm_m=500, zone_mean_m=512, provenance=prov.build("copernicus_dem"))

    def chill_hours(self, farm, start, end, country):
        return None


@pytest.fixture()
def world(monkeypatch):
    w = World()
    for name in ("effective_zone", "effective_template", "current_stage", "stage_bands", "outstanding_at",
                 "next_installment", "weather_series", "vegetation_series", "water_supply", "decree_history_years",
                 "list_events", "find_peers", "irrigation_check", "relative_elevation", "chill_hours",
                 "imagery_vigour", "station_events"):
        monkeypatch.setattr(deps, name, getattr(w, name))
    monkeypatch.setenv("CLM_RISK_CACHE", "0")
    return w


@pytest.fixture()
def portfolio(sample_portfolio) -> Portfolio:
    return Portfolio.model_validate(sample_portfolio)


def _fire_on(farm, start="2026-02-10") -> ClimateEvent:
    return ClimateEvent(id="gwis:1", kind="fire", title="Burned area 120 ha", region="O'Higgins", start=start,
                        end=start, severity="severe", source="GWIS (Copernicus)", evidence_kind="observed_footprint",
                        geometry=farm.polygon.model_dump(by_alias=True, mode="json"),
                        provenance=prov.build("gwis_ba", observed_at=start))


def _burn_drop(world, start=date(2026, 2, 10), days=12, z=-6.0):
    """NDVI collapses right after the fire (native S2 confirms the footprint)."""
    d = start + timedelta(days=1)
    while d <= start + timedelta(days=days):
        world.ndvi_z_override[d.isoformat()] = z
        d += timedelta(days=1)


def _ovalle(p: Portfolio):
    return next(f for f in p.farms if "ovalle" in f.id)


def _requinoa(p: Portfolio):
    return next(f for f in p.farms if "requinoa" in f.id)


# ───────────────────────── farm ─────────────────────────

def test_farm_assessment_shape_and_decree_rule(world, portfolio):
    world.supply = WaterSupply(decree_active=True, decree_id="DGA decree No. 177", decree_until="2027-07-10",
                               snowmelt_pct_of_normal=64, basin="Limarí",
                               provenance=prov.build("dga_decrees", observed_at="2026-07-09"))
    fa = assess.assess_farm(portfolio, _ovalle(portfolio).id, AS_OF)
    FarmAssessment.model_validate(fa.model_dump(by_alias=True, mode="json"))  # round trip
    assert fa.zone_id == f"auto-{_ovalle(portfolio).id}" and fa.data_tier == "enhanced"
    assert set(fa.series) == {"ndvi", "ndmi", "precip", "tmin", "tmax", "eto"}
    assert fa.risk.stage.key == "bloom"
    d = {x.metric: x for x in fa.risk.components.disaster.drivers}
    assert d["decree_active"].severity == 0.6 and "No. 177" in d["decree_active"].text
    assert [a.rule_id for a in fa.risk.credit_actions] == ["cr-decree-low-snowmelt"]
    assert fa.risk.tier in ("watch", "high")
    assert fa.water.irrigated.value == "yes" and fa.water.demand.kc == 0.6
    assert fa.water.demand.eto7d_mm == 28.0 and fa.water.demand.need7d_mm == pytest.approx(16.8)
    w = {x.metric: x for x in fa.risk.components.climate.drivers}
    assert w["water_supply"].severity == pytest.approx(0.52) and "64 %" in w["water_supply"].text
    g = {x.metric: x for x in fa.risk.components.geography.drivers}
    assert g["frost_pocket"].severity == 0.4 and g["basin_water_security"].value == 3
    assert fa.peers.reading == "insufficient_peers"
    assert fa.data_as_of["tmin"] == "2026-11-06" and fa.data_as_of["events"] == "2026-11-07"
    assert len(fa.risk.components.climate.drivers) == 7 and len(fa.risk.components.disaster.drivers) == 3
    for drv in fa.risk.drivers:
        assert drv.provenance.source and drv.provenance.fetched_at


def test_severe_bloom_frost_is_high_with_frost_headline(world, portfolio):
    farm = _requinoa(portfolio)  # cherry
    as_of = date(2026, 9, 20)  # cherry bloom
    world.cold_night = (date(2026, 9, 17), -4.6)
    fa = assess.assess_farm(portfolio, farm.id, as_of)
    assert fa.risk.stage.key == "bloom"
    assert fa.risk.tier == "high" and fa.risk.score >= 80
    assert fa.risk.headline.startswith("Bloom: Coldest night −4.6 °C on 17 Sep")
    assert fa.risk.drivers[0].metric == "tmin_7d_min"


def test_frost_in_dormancy_is_normal(world, portfolio):
    farm = _requinoa(portfolio)
    world.tmin, world.tmax = 1.0, 12.0  # a normal winter: enough chill (the fake default 6/24 °C would not be)
    world.cold_night = (date(2026, 6, 28), -4.6)
    fa = assess.assess_farm(portfolio, farm.id, date(2026, 7, 1))
    assert fa.risk.stage.key == "dormancy"
    frost = next(x for x in fa.risk.components.climate.drivers if x.peril == "frost")
    assert frost.severity == 0.0 and fa.risk.tier == "normal"
    chill = next(x for x in fa.risk.components.climate.drivers if x.peril == "chill")
    assert chill.severity == 0.0 and "so far" in chill.text and chill.provenance.estimated


def test_warm_winter_chill_shortfall_counts_in_dormancy(world, portfolio):
    farm = _requinoa(portfolio)
    fa = assess.assess_farm(portfolio, farm.id, date(2026, 7, 1))  # 6/24 °C all winter: little chill
    chill = next(x for x in fa.risk.components.climate.drivers if x.peril == "chill")
    assert chill.severity == 1.0 and chill.sensitivity == 0.5 and fa.risk.tier == "watch"


def test_burned_area_on_farm_is_high_and_restructure(world, portfolio):
    farm = _requinoa(portfolio)
    world.events = [_fire_on(farm)]
    _burn_drop(world)
    fa = assess.assess_farm(portfolio, farm.id, AS_OF)
    fire = next(x for x in fa.risk.components.disaster.drivers if x.peril == "fire")
    assert fire.severity == 1.0 and "Imagery agrees" in fire.text
    assert "cr-burned-area" in [a.rule_id for a in fa.risk.credit_actions]
    assert fa.risk.score_tier == "high" and fa.risk.tier == "high"
    fr = next(x for x in fa.risk.components.geography.drivers if x.metric == "fire_recurrence")
    assert fr.value == 1  # 2026 counted once


def test_burned_area_contradicted_by_imagery_is_zone_level(world, portfolio):
    """ST-6/DC-2: a footprint on the farm with flat native NDVI across the fire date scores 0.4, is marked
    estimated, does not set burnedAreaIntersects and quotes the before/after NDVI."""
    farm = _requinoa(portfolio)
    world.events = [_fire_on(farm)]
    fa = assess.assess_farm(portfolio, farm.id, AS_OF)
    fire = next(x for x in fa.risk.components.disaster.drivers if x.peril == "fire")
    assert fire.severity == 0.4 and fire.provenance.estimated
    assert "unconfirmed by imagery" in fire.text and "before" in fire.text and "after" in fire.text
    assert "cr-burned-area" not in [a.rule_id for a in fa.risk.credit_actions]


def test_abandonment_flag_without_peers_is_medium(world, portfolio):
    farm = _requinoa(portfolio)
    d0 = assess.window_start(AS_OF)
    # composites on the 5-day grid inside the 2025-26 dry season, 4 in a row at z −2.5
    grid = [d0 + timedelta(days=5 * i) for i in range(80)]
    # §E.10 v1.1 guard: the canopy collapses (NDVI 0.24 < 0.30) from mid-January and never recovers
    after = [g for g in grid if g >= date(2026, 1, 10)]
    world.ndvi_z_override = {g.isoformat(): -6.0 for g in after}
    fa = assess.assess_farm(portfolio, farm.id, AS_OF)
    ab = fa.water.abandonment
    assert ab.flag and ab.confidence == "medium" and "too few peers" in ab.evidence
    assert "near bare soil" in ab.evidence
    assert "cr-abandonment" in [a.rule_id for a in fa.risk.credit_actions]
    assert fa.risk.tier in ("watch", "high")
    drv = next(x for x in fa.risk.components.climate.drivers if x.peril == "abandonment")
    assert drv.severity == 0.7


def test_abandonment_green_or_recovered_is_low_vigour_loss(world, portfolio):
    """ST-2/DC-1: a z run on a canopy that stayed green (0.45 vs 0.6) and has since recovered is a vigour
    loss to verify (low, severity 0.4), never 'irrigation stopped' with high confidence."""
    farm = _requinoa(portfolio)
    d0 = assess.window_start(AS_OF)
    grid = [d0 + timedelta(days=5 * i) for i in range(80)]
    dry = [g for g in grid if date(2026, 1, 10) <= g <= date(2026, 1, 31)]
    world.ndvi_z_override = {g.isoformat(): -2.5 for g in dry}
    fa = assess.assess_farm(portfolio, farm.id, AS_OF)
    ab = fa.water.abandonment
    assert ab.flag and ab.confidence == "low"
    assert ab.evidence.startswith("Vigour loss, not a confirmed stop of irrigation")
    assert "recovered" in ab.evidence and "stayed green" in ab.evidence
    drv = next(x for x in fa.risk.components.climate.drivers if x.peril == "abandonment")
    assert drv.severity == 0.4


def test_all_sources_unavailable_never_fails(world, portfolio):
    world.fail = {"precip", "tmin", "tmax", "eto", "ndvi", "ndmi", "supply", "decree_years", "irrigation",
                  "events", "elevation", "peers"}
    fa = assess.assess_farm(portfolio, _ovalle(portfolio).id, AS_OF)
    assert fa.risk.score == 0.0 and fa.risk.tier == "normal"
    assert all(s.points == [] for s in fa.series.values())
    assert any("placeholder" in w for w in fa.warnings)
    assert "G = 0" in " ".join(fa.warnings)
    declared = _ovalle(portfolio).irrigated_declared
    assert fa.water.irrigated.value == ("unknown" if declared is None else "yes" if declared else "no")
    assert fa.water.stress.level == "unknown"
    assert fa.water.supply.provenance.note.startswith("unavailable")
    frost = next(x for x in fa.risk.components.climate.drivers if x.peril == "frost")
    assert frost.value is None and frost.provenance.note.startswith("unavailable")
    assert fa.data_as_of["events"] is None


def test_standard_tier_outside_chile(world, portfolio):
    p = portfolio.model_copy(update={"country": "AR", "currency": "USD"})
    for f in p.farms:
        if f.loan:
            f.loan.currency = "USD"
    fa = assess.assess_farm(p, _ovalle(p).id, AS_OF)
    assert fa.data_tier == "standard"
    assert "supply" not in world.calls and "irrigation" not in world.calls
    assert fa.peers.reading == "insufficient_peers"
    assert all(x.provenance.data_tier == "standard" for x in fa.risk.drivers)
    assert any("Standard data tier" in w for w in fa.warnings)


def test_cache_hit_and_rule_edit_miss(world, portfolio, monkeypatch):
    monkeypatch.setenv("CLM_RISK_CACHE", "1")
    farm = _ovalle(portfolio)
    as_of = date(2026, 11, 2)
    a = assess.assess_farm(portfolio, farm.id, as_of)
    n = world.calls["tmin"]
    b = assess.assess_farm(portfolio, farm.id, as_of)
    assert world.calls["tmin"] == n and a == b
    farm.irrigated_declared = False  # input change → new key
    c = assess.assess_farm(portfolio, farm.id, as_of)
    assert world.calls["tmin"] == n + 1 and c.water.irrigated.value == "no"


# ───────────────────────── portfolio ─────────────────────────

def test_portfolio_sums_ranking_and_events(world, portfolio):
    req = _requinoa(portfolio)
    world.events = [_fire_on(req)]
    _burn_drop(world)
    pa = assess.assess_portfolio(portfolio, AS_OF)
    PortfolioAssessment.model_validate(pa.model_dump(by_alias=True, mode="json"))
    assert len(pa.ranked) == len(portfolio.farms)
    assert [r.score for r in pa.ranked] == sorted([r.score for r in pa.ranked], reverse=True)
    assert pa.ranked[0].farm_id == req.id
    tot = pa.total_exposure
    assert sum(pa.exposure_by_tier.values()) == pytest.approx(tot)
    assert sum(s.exposure for s in pa.by_crop) == pytest.approx(tot)
    assert sum(s.exposure for s in pa.by_zone) == pytest.approx(tot)
    assert sum(pa.farms_by_tier.values()) == len(portfolio.farms)
    assert pa.events and pa.events[0].affected_farm_ids == [req.id]
    assert pa.events[0].affected_exposure == next(r.exposure for r in pa.ranked if r.farm_id == req.id)
    assert {"farmId": req.id, "ruleId": "cr-burned-area"}.items() <= \
        pa.credit_actions[0].model_dump(by_alias=True).items() or \
        any(a.rule_id == "cr-burned-area" and a.farm_id == req.id for a in pa.credit_actions)
    assert world.calls["events"] == 2  # window + fire history, once for the whole portfolio


def test_portfolio_survives_one_failing_farm(world, portfolio):
    bad = _ovalle(portfolio)
    world.fail_template_for = {bad.id}
    pa = assess.assess_portfolio(portfolio, AS_OF)
    assert len(pa.ranked) == len(portfolio.farms)
    r = next(x for x in pa.ranked if x.farm_id == bad.id)
    assert r.headline.startswith("Assessment unavailable") and r.score == 0.0
    assert any(bad.name in w for w in pa.warnings)
    assert sum(s.exposure for s in pa.by_crop) == pytest.approx(pa.total_exposure)


def test_api_uses_risk_package_not_fixture(world, portfolio, client):
    body = {"portfolio": portfolio.model_dump(by_alias=True, mode="json"), "farmId": _ovalle(portfolio).id,
            "asOf": AS_OF.isoformat()}
    r = client.post("/assess/farm", json=body)
    assert r.status_code == 200, r.text
    assert r.headers.get("X-CLM-Fixture") in (None, "0")
    assert r.json()["farmId"] == _ovalle(portfolio).id
    r2 = client.post("/assess/portfolio", json={"portfolio": body["portfolio"], "asOf": AS_OF.isoformat()})
    assert r2.status_code == 200, r2.text
    assert len(r2.json()["ranked"]) == len(portfolio.farms)


def test_imagery_vigour_signals_are_used(world, portfolio):
    """svc-imagery's §E.9 peers, §E.10 abandonment, exact §E.6 z and dry-season test win over risk's fallbacks."""
    from app.models import PeerComparison, WaterAbandonment

    farm = _ovalle(portfolio)
    sp = prov.build("s2_l2a_pc", observed_at="2026-11-02")
    world.vigour = {
        "peers": PeerComparison(zone_id="whatever", n_peers=6, farm_ndvi_z=-3.1, peer_median_ndvi_z=0.2,
                                farm_ndmi_z=-2.2, peer_median_ndmi_z=0.1, reading="farm_specific", provenance=sp),
        "abandonment": WaterAbandonment(flag=True, confidence="high", evidence="imagery says abandoned", provenance=sp),
        "ndviZ": -3.1, "ndmiZ": -2.2, "ndmiPeerDelta": -2.3,
        "irrigatedEvidence": {"value": "unknown", "evidence": "", "provenance": None},
    }
    fa = assess.assess_farm(portfolio, farm.id, AS_OF)
    assert fa.peers.n_peers == 6 and fa.peers.reading == "farm_specific"
    assert fa.peers.zone_id == fa.zone_id and fa.peers.provenance.data_tier == "enhanced"
    assert fa.water.abandonment.flag and fa.water.abandonment.evidence == "imagery says abandoned"
    assert fa.water.stress.ndmi_z == -2.2 and fa.water.stress.level == "severe"
    assert fa.water.stress.ndmi_peer_delta == -2.3
    vig = next(x for x in fa.risk.components.climate.drivers if x.peril == "vigour")
    assert vig.value == -3.1 and "svc-imagery" in (vig.provenance.note or "")
    wat = next(x for x in fa.risk.components.climate.drivers if x.peril == "water")
    assert wat.text.startswith("Canopy moisture (NDMI) 2.2 sd below")


def test_station_week_wins_over_lagging_grid(world, portfolio):
    """RAN hourly station data (current to as-of) is used for frost/heat/rain; CR2MET daily is the fallback."""
    farm = _ovalle(portfolio)
    sp = prov.build("ran_station", observed_at="2026-11-07")
    st = {"name": "Ovalle", "distance_km": 1.2}
    world.stations = {
        "frost": SimpleNamespace(summary={"min_c": -3.5, "min_at": "2026-11-06 05:00:00", "n_hours": 160,
                                          "expected_hours": 168}, station=st, provenance=sp, end=AS_OF,
                                 source_kind="station_hourly"),
        "rain": SimpleNamespace(summary={"max_72h_mm": 0.0, "max_72h_end": "2026-11-05 00:00:00", "n_hours": 40,
                                         "expected_hours": 168}, station=st, provenance=sp, end=AS_OF,
                                source_kind="station_hourly"),
    }
    fa = assess.assess_farm(portfolio, farm.id, AS_OF)
    drv = {d.peril: d for d in fa.risk.components.climate.drivers}
    assert drv["frost"].value == -3.5 and "Coldest hour" in drv["frost"].text and "Ovalle station" in drv["frost"].text
    assert drv["frost"].severity > 0 and drv["frost"].provenance.observed_at.startswith("2026-11-06")
    # rain week has too few hours -> falls back to the daily grid series
    assert "Ovalle station" not in drv["harvest_rain"].text
    assert "Coldest hour" not in drv["heat"].text and "Hottest day" in drv["heat"].text


def test_veg_z_provenance_is_honest_about_gap_fill():
    """ST-3/DC-3: observedAt = last clear scene, estimated when the z window is gap-filled."""
    from app.risk.inputs import veg_z_provenance
    from app.risk.signals import PersistentZ

    pts = [SeriesPoint(date="2026-10-28", value=0.2, estimated=False),
           SeriesPoint(date="2026-11-02", value=0.18, estimated=True),
           SeriesPoint(date="2026-11-07", value=0.18, estimated=True)]
    s = Series(variable="ndvi", unit="index", points=pts, provenance=prov.build("s2_l2a_pc", observed_at="2026-10-29"))
    p = veg_z_provenance(s, PersistentZ(-1.6, date(2026, 11, 7), "last2"), "enhanced")
    assert p.observed_at == "2026-10-29" and p.estimated is True
    assert "held 9 days" in p.note and "2 of 2" in p.note
    p2 = veg_z_provenance(s, PersistentZ(-0.2, date(2026, 10, 28), "mean32d"), "enhanced")
    assert p2.estimated is False and p2.observed_at == "2026-10-29"
