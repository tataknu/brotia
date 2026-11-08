"""Farm and portfolio assessment (CONTRACT §E.1–E.11). Orchestration only: inputs come from the other
builder packages through app.risk.deps; the maths lives in formula/drivers/water/credit (pure).

assess_farm(portfolio, farm_id, as_of) -> FarmAssessment
assess_portfolio(portfolio, as_of) -> PortfolioAssessment

Failure semantics: a source that fails (or is still a placeholder) becomes an unavailable value with the
reason in provenance.note plus a plain-language warning; the assessment itself never fails for that.
Domain (rules/zones/stages) errors propagate: nothing is computable without them.

Caching: each FarmAssessment is stored in DuckDB (assessments table, kind 'risk_farm') keyed by a hash of
everything that changes the result (farm, effective zone and template, country, as-of, code version).
Rule edits change the effective template and so miss the cache. Max age CLM_RISK_CACHE_TTL_S (default 1 h;
10 min when a source was unavailable so it is retried soon). CLM_RISK_CACHE=0 disables it.
"""

from __future__ import annotations

import calendar
import hashlib
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Callable

from app import config, store
from app import provenance as prov
from app.models import (
    SERIES_UNITS,
    SERIES_VARIABLES,
    ClimateEvent,
    CropExposureSlice,
    CropTemplate,
    FarmAssessment,
    FarmCreditAction,
    Farm,
    Installment,
    Portfolio,
    PortfolioAssessment,
    Provenance,
    RankedFarm,
    Series,
    Stage,
    StageBand,
    StageRef,
    WaterSupply,
    Zone,
    ZoneExposureSlice,
)
from app.risk import credit, deps, drivers, geo, signals, water
from app.risk.formula import assess_risk, components, score_only
from app.risk.inputs import Elevation, FarmContext, FarmInputs, Irrigation, Peer, PeerData

log = logging.getLogger("clm.risk")

CACHE_KIND = "risk_farm"
CACHE_VERSION = "risk-v1.6"  # v1.5: §E.10 guard, fire cross-check, honest veg provenance
FIRE_HISTORY_SINCE = date(2012, 1, 1)
DECREE_HISTORY_SINCE = 2008
EVENTS_PAD_M = 25_000.0
FARM_WORKERS = 2


# ───────────────────────── settings ─────────────────────────

def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def cache_enabled() -> bool:
    return os.environ.get("CLM_RISK_CACHE", "1").strip().lower() not in {"0", "false", "no"}


def peers_enabled() -> bool:
    return os.environ.get("CLM_RISK_PEERS", "1").strip().lower() not in {"0", "false", "no"}


def max_peers() -> int:
    return int(_env_float("CLM_RISK_MAX_PEERS", 6))


def peer_budget_s() -> float:
    return _env_float("CLM_RISK_PEER_BUDGET_S", 30.0)


# ───────────────────────── dates ─────────────────────────

def window_start(as_of: date) -> date:
    """Same day 13 months before as_of (clamped to the month length)."""
    y, m = as_of.year, as_of.month - 13
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, min(as_of.day, calendar.monthrange(y, m)[1]))


# ───────────────────────── normalisation ─────────────────────────

def _as(model: Any, v: Any) -> Any:
    return v if v is None or isinstance(v, model) else model.model_validate(v)


def _as_list(model: Any, vs: Any) -> list:
    return [_as(model, v) for v in (vs or [])]


def _tuple2(v: Any) -> tuple[Any, list[str]]:
    """Domain functions return (value, warnings); tolerate a bare value."""
    if isinstance(v, tuple) and len(v) == 2 and isinstance(v[1], list):
        return v[0], list(v[1])
    return v, []


# ───────────────────────── context ─────────────────────────

#: Table-grape farms north of this latitude (° S as negative) get the "central-Chile calendar" warning.
NORTH_GRAPE_LAT = -31.0


def build_context(portfolio: Portfolio, farm: Farm, as_of: date) -> FarmContext:
    warnings: list[str] = []
    zone, w = _tuple2(deps.effective_zone(portfolio, farm))
    zone = _as(Zone, zone)
    warnings += w
    template, w = _tuple2(deps.effective_template(portfolio, farm))
    template = _as(CropTemplate, template)
    warnings += w
    stage, w = _tuple2(deps.current_stage(template, as_of))
    stage = _as(Stage, stage)
    warnings += w
    th = template.rules.stages.get(stage.key)
    if th is None:
        raise ValueError(f"crop template {template.crop} has no thresholds for stage {stage.key}")
    return FarmContext(
        portfolio=portfolio,
        farm=farm,
        as_of=as_of,
        window_start=window_start(as_of),
        data_tier=prov.data_tier_for(portfolio.country),
        zone=zone,
        template=template,
        stage=stage,
        thresholds=th,
        warnings=warnings,
    )


# ───────────────────────── input gathering ─────────────────────────

@dataclass
class SharedEvents:
    """Event lists fetched once for a whole portfolio. None = unavailable (with reason)."""
    events: list[ClimateEvent] | None
    events_missing: str | None
    fire_history: list[ClimateEvent] | None
    fire_missing: str | None


def _events_bbox(shapes: list[Any], pad_m: float) -> tuple[float, float, float, float] | None:
    b = geo.union_bbox(shapes)
    return geo.pad_bbox(b, pad_m) if b else None


def fetch_events(bbox, since: date, until: date) -> tuple[list[ClimateEvent] | None, str | None]:
    if bbox is None:
        return None, "no farm geometry to search events around"
    v, err = deps.safe("Event catalogues", deps.list_events, bbox, since, until)
    if v is None:
        return None, err
    try:
        return _as_list(ClimateEvent, v), None
    except Exception as exc:
        return None, f"Event catalogues: returned data that does not match the contract ({exc.__class__.__name__})."


def _normalise_irrigation(v: Any, tier: str) -> Irrigation | None:
    if v is None:
        return None
    get = (lambda k: v.get(k)) if isinstance(v, dict) else (lambda k: getattr(v, k, None))
    p = _as(Provenance, get("provenance"))
    if p is None:
        return None
    p = p.model_copy()
    p.data_tier = tier
    value = get("value") or "unknown"
    return Irrigation(value="yes" if value == "yes" else "unknown", evidence=str(get("evidence") or ""),
                      estimated=bool(get("estimated")), provenance=p)


def _peer_farm(feature: Any, farm: Farm, zone: Zone) -> Farm | None:
    try:
        f = feature if isinstance(feature, dict) else feature.model_dump(by_alias=True, mode="json")
        geom = f["geometry"]
        shp = geo.event_shape(geom)
        if shp is None:
            return None
        c = shp.centroid
        props = f.get("properties") or {}
        oid = props.get("objectId", f.get("id"))
        return Farm(id=f"peer-{oid}", name=f"CIREN orchard {oid}", crop=farm.crop, polygon=geom,
                    area_ha=float(props.get("areaHa") or 0.0), centroid=(c.x, c.y), zone_id=zone.id)
    except Exception:
        return None


def gather_peers(ctx: FarmContext, start: date, baseline_years: int) -> PeerData:
    if not ctx.chile:
        return PeerData(note="zone peers come from the Chilean fruit cadastre (CIREN): Chile only")
    if not peers_enabled():
        return PeerData(note="peer comparison disabled (CLM_RISK_PEERS=0)")
    coll, err = deps.safe("CIREN peer orchards", deps.find_peers, ctx.farm, ctx.zone, 20)
    if coll is None:
        return PeerData(note=err)
    feats = coll.get("features") if isinstance(coll, dict) else getattr(coll, "features", [])
    cprov = coll.get("provenance") if isinstance(coll, dict) else getattr(coll, "provenance", None)
    cprov = _as(Provenance, cprov)
    own = ctx.farm.ciren.object_id if ctx.farm.ciren else None
    farms = []
    for f in feats or []:
        pf = _peer_farm(f, ctx.farm, ctx.zone)
        if pf is not None and pf.id != f"peer-{own}":
            farms.append(pf)
    cap = max_peers()
    farms = farms[:cap]
    if not farms:
        return PeerData(requested=0, provenance=cprov,
                        note="no same-crop CIREN orchard found inside the zone circle")
    evergreen = bool(ctx.template.evergreen)

    def one(pf: Farm) -> Peer:
        nd = _as(Series, deps.vegetation_series(pf, "ndvi", start, ctx.as_of, baseline_years))
        md, _ = deps.safe("peer NDMI", deps.vegetation_series, pf, "ndmi", start, ctx.as_of, baseline_years)
        md = _as(Series, md)
        nz = signals.z_points(nd, evergreen, ctx.as_of)
        mz = signals.z_points(md, evergreen, ctx.as_of) if md is not None else []
        return Peer(pf.id, signals.persistent_z(nz, ctx.as_of), signals.persistent_z(mz, ctx.as_of), nz)

    pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="risk-peer")
    futs = [pool.submit(one, pf) for pf in farms]
    done, not_done = wait(futs, timeout=peer_budget_s())
    pool.shutdown(wait=False, cancel_futures=True)
    peers, failed, first_err = [], 0, None
    for fu in futs:
        if fu in done:
            try:
                peers.append(fu.result())
            except Exception as exc:
                failed += 1
                first_err = first_err or (getattr(exc, "reason", None) or str(exc) or exc.__class__.__name__)
    notes = [f"nearest {len(farms)} of {len(feats or [])} same-crop CIREN orchards in the zone used (cap {cap})"]
    if not_done:
        notes.append(f"{len(not_done)} peer(s) skipped: time budget {int(peer_budget_s())} s reached")
    if failed:
        notes.append(f"{failed} peer(s) without imagery ({str(first_err)[:120]})")
    ok_dates = [p.ndvi.on for p in peers if p.ndvi is not None]
    p = prov.derived("Peer z from Sentinel-2 native 10 m polygon means of CIREN orchards",
                     inputs=[x for x in [cprov] if x], observed_at=max(ok_dates) if ok_dates else None,
                     data_tier=ctx.data_tier)
    if not ok_dates:
        p.observed_at = None
    p.source, p.source_label = "ciren_catastro", "CIREN Catastro Frutícola + Sentinel-2 L2A"
    return PeerData(requested=len(farms), peers=peers, provenance=p, note="; ".join(notes))


def gather(ctx: FarmContext, shared: SharedEvents | None = None) -> FarmInputs:
    inp = FarmInputs()
    farm, start, end = ctx.farm, ctx.window_start, ctx.as_of
    country = ctx.portfolio.country
    baseline_years = int(ctx.template.rules.baseline_years or 5)
    zone_c = geo.circle(ctx.zone.center, ctx.zone.radius_m)
    fshape = geo.farm_shape(farm)

    tasks: dict[str, Callable[[], Any]] = {}
    for v in ("precip", "tmin", "tmax", "eto"):
        tasks[v] = (lambda v=v: deps.weather_series(v, farm, start, end, country))
    for v in ("ndvi", "ndmi"):
        tasks[v] = (lambda v=v: deps.vegetation_series(farm, v, start, end, baseline_years))
    tasks["chill_hourly"] = lambda: deps.chill_hours(farm, *signals.chill_period(end)[:2], country)
    if ctx.chile:  # RAN hourly stations: current to as-of, while CR2MET daily lags 6-11 days
        for k in ("frost", "heat", "rain"):
            tasks[f"station_{k}"] = (lambda k=k: deps.station_events(k, farm, end - timedelta(days=6), end, country))
    tasks["elevation"] = lambda: deps.relative_elevation(farm.centroid, ctx.zone.center, ctx.zone.radius_m,
                                                         ctx.data_tier)
    if ctx.chile:
        tasks["supply"] = lambda: deps.water_supply(ctx.portfolio, farm, end)
        tasks["decree_years"] = lambda: deps.decree_history_years(farm, DECREE_HISTORY_SINCE, end)
        tasks["irrigation"] = lambda: deps.irrigation_check(farm, 500)
        if peers_enabled():
            # §E.9 peers + §E.10 abandonment + exact §E.6 z from svc-imagery (shared peer grids, only the
            # dates the reading needs). Replaces a full vegetation_series per peer (~330 calls each).
            tasks["vigour"] = lambda: deps.imagery_vigour(ctx.portfolio, farm, end)
        else:
            tasks["peers"] = lambda: gather_peers(ctx, start, baseline_years)
    else:
        tasks["peers"] = lambda: gather_peers(ctx, start, baseline_years)
    if shared is None:
        tasks["events"] = lambda: fetch_events(_events_bbox([fshape, zone_c], 5_000), start, end)
        tasks["fire_history"] = lambda: fetch_events(_events_bbox([zone_c], 1_000), FIRE_HISTORY_SINCE, end)

    labels = {"precip": "Rainfall", "tmin": "Minimum temperature", "tmax": "Maximum temperature",
              "eto": "Reference evapotranspiration (ETo)", "ndvi": "Sentinel-2 NDVI", "ndmi": "Sentinel-2 NDMI",
              "chill_hourly": "Hourly chill", "elevation": "Copernicus DEM (frost pocket)",
              "supply": "DGA water supply", "decree_years": "DGA decree history",
              "irrigation": "CIREN irrigated areas", "peers": "Peer orchards",
              "vigour": "Sentinel-2 peers and abandonment", "station_frost": "RAN station frost",
              "station_heat": "RAN station heat", "station_rain": "RAN station rain"}
    results: dict[str, tuple[Any, str | None]] = {}
    with ThreadPoolExecutor(max_workers=6, thread_name_prefix="risk-in") as pool:
        futs = {k: pool.submit(deps.safe, labels.get(k, k), fn) for k, fn in tasks.items()}
        for k, fu in futs.items():
            results[k] = fu.result()

    def note(k: str, err: str | None) -> None:
        if err:
            inp.missing[k] = err
            if k != "chill_hourly":
                inp.warnings.append(err)

    for v in ("precip", "tmin", "tmax", "eto", "ndvi", "ndmi"):
        val, err = results[v]
        try:
            s = _as(Series, val)
        except Exception as exc:
            s, err = None, f"{labels[v]}: returned data that does not match the contract ({exc.__class__.__name__})."
        note(v, err)
        if s is not None and not s.points:
            reason = (s.provenance.note or "no data").removeprefix("unavailable: ").rstrip(".")
            inp.missing[v] = f"{labels[v]}: {reason}"
            inp.warnings.append(f"{labels[v]} unavailable: {reason}.")
        inp.series[v] = s

    val, err = results["chill_hourly"]
    if val is not None:
        try:
            inp.chill_hourly = (float(val[0]), _as(Provenance, val[1]))
        except Exception:
            inp.chill_hourly = None

    for k in ("frost", "heat", "rain"):
        val, _err = results.get(f"station_{k}", (None, None))
        if val is not None and getattr(val, "source_kind", None) == "station_hourly":
            inp.station[k] = val

    val, err = results["elevation"]
    note("elevation", err)
    if val is not None:
        inp.elevation = Elevation(rel_m=val.rel_m, farm_m=val.farm_m, zone_mean_m=val.zone_mean_m,
                                  provenance=val.provenance)

    if ctx.chile:
        val, err = results["supply"]
        note("supply", err)
        try:
            inp.supply = _as(WaterSupply, val)
        except Exception as exc:
            inp.warnings.append(f"DGA water supply: returned data that does not match the contract ({exc}).")
        val, err = results["decree_years"]
        note("decree_years", err)
        if val is not None:
            try:
                inp.decree_years = (int(val[0]), _as(Provenance, val[1]))
            except Exception as exc:
                inp.warnings.append(f"DGA decree history: unexpected result ({exc.__class__.__name__}).")
        val, err = results["irrigation"]
        note("irrigation", err)
        inp.irrigation = _normalise_irrigation(val, ctx.data_tier)
    else:
        inp.warnings.append("Standard data tier: Chile-only signals (DGA decrees, snowmelt, CIREN irrigation and "
                            "peers) are not available for this country.")

    if "vigour" in results:
        val, err = results["vigour"]
        note("peers", err)
        if isinstance(val, dict):
            inp.vigour = val
            inp.peers = PeerData(note="peer comparison from svc-imagery (§E.9)")
        else:
            inp.peers = PeerData(note=err or "peer orchards unavailable")
    else:
        val, err = results["peers"]
        if val is not None:
            inp.peers = val
        else:
            inp.peers = PeerData(note=err)

    if shared is None:
        val, err = results["events"]
        ev, ev_err = val if val is not None else (None, err)
        val, err = results["fire_history"]
        fh, fh_err = val if val is not None else (None, err)
    else:
        ev, ev_err, fh, fh_err = shared.events, shared.events_missing, shared.fire_history, shared.fire_missing
    inp.events = ev
    if ev is None:
        note("events", ev_err or "Event catalogues: unavailable.")
    inp.fire_history = [e for e in fh if e.kind == "fire"] if fh is not None else None
    if fh is None:
        inp.missing["fire_history"] = fh_err or "fire history unavailable"
    return inp


# ───────────────────────── compute (pure) ─────────────────────────

def _empty_series(var: str, reason: str, tier: str) -> Series:
    return Series(variable=var, unit=SERIES_UNITS[var], points=[],
                  provenance=prov.unavailable("unavailable", reason, data_tier=tier))


def compute(ctx: FarmContext, inp: FarmInputs, bands: list[StageBand], exposure: float,
            next_inst: Installment | None) -> FarmAssessment:
    vs = water.veg_signals(ctx, inp)
    water.apply_exact_z(vs, inp)
    pc = water.peers(ctx, inp, vs)
    ws = water.water_status(ctx, inp, vs, pc)

    climate = [
        drivers.frost(ctx, inp),
        drivers.heat(ctx, inp),
        drivers.harvest_rain(ctx, inp),
        drivers.water(ctx, inp, ws),
        drivers.chill(ctx, inp),
        drivers.vigour(ctx, inp, vs.ndvi_pz),
        drivers.abandonment(ctx, ws),
    ]
    disaster = [drivers.fire(ctx, inp), drivers.flood(ctx, inp), drivers.declared_emergency(ctx, inp, ws)]
    c = ctx.template.weights.c
    geo_pairs = [drivers.frost_pocket(ctx, inp, c), drivers.fire_recurrence(ctx, inp, c),
                 drivers.basin_water_security(ctx, inp, c)]
    geography = [d for d, _ in geo_pairs]
    geo_avail = [d for d, ok in geo_pairs if ok]
    for d in climate + disaster + geography:  # every value shows the tier that produced it (ADR-0013 D2)
        if d.provenance.data_tier != ctx.data_tier:
            d.provenance = d.provenance.model_copy(update={"data_tier": ctx.data_tier})
    warnings = list(ctx.warnings) + list(inp.warnings)
    if not geo_avail:
        warnings.append("No geography factor was available: G = 0 (no amplification).")

    # credit rules read scoreTier/score, so compute them first
    C, D, G = components(climate, disaster, geography, geo_avail)
    score, st = score_only(C, D, G, ctx.template.weights)
    burned = drivers.burn_confirmed_on_farm(ctx, inp)
    supply_known = inp.supply is not None
    metrics = credit.CreditMetrics(
        score=score,
        score_tier=st,
        decree_active=ws.supply.decree_active if supply_known else None,
        snowmelt_pct=ws.supply.snowmelt_pct_of_normal,
        stress_level=ws.stress.level,
        abandonment=ws.abandonment.flag,
        burned_area_intersects=burned,
        next_installment=next_inst,
        as_of=ctx.as_of,
    )
    fired = credit.evaluate(ctx.template.credit_rules, metrics)
    risk = assess_risk(ctx.stage.key, ctx.stage.label, ctx.template.weights, climate, disaster, geography, fired,
                       geography_available=geo_avail)

    if ctx.covered:
        warnings.append("This orchard is under covers or nets: NDVI and NDMI read the cover, not the trees.")
    elif ctx.farm.covered is None and getattr(ctx.template, "cover_likelihood", None) == "often":
        # same soft hint as the imagery coveredWarning (CONTRACT §E.12); vigour-based signals carry this caveat
        crop_label = getattr(ctx.template.labels, "en", None) or "This crop's"
        warnings.append(f"{crop_label} orchards are "
                        "often under overhead plastic or mesh. If this one is covered, NDVI and NDMI (vigour, "
                        "water stress, abandonment) read the cover, not the plants: confirm before acting.")

    if ctx.farm.crop == "table_grape" and ctx.farm.centroid[1] > NORTH_GRAPE_LAT:
        # DC-9: the templates are central-Chile calendars (ADR-0013 D5: table grapes run earlier in the north)
        warnings.append(f"Stage '{ctx.stage.label}' comes from the central-Chile table-grape calendar. North of about "
                        "31° S (Atacama, Coquimbo) vines run 4–6 weeks earlier, so the real stage is likely later: "
                        "read stage-dependent frost, heat and rain sensitivities with care.")

    series: dict[str, Series] = {}
    for v in SERIES_VARIABLES:
        s = inp.series.get(v)
        series[v] = s if s is not None else _empty_series(v, inp.missing.get(v, "not available"), ctx.data_tier)

    # each signal reports its own latest date (§E.12); NDVI/NDMI gap-filled points after the last clear
    # scene are estimates, so their date is the last clear observation, not the end of the grid
    data_as_of: dict[str, str | None] = {v: signals.latest_date(series[v], ctx.as_of, observed_only=v in ("ndvi", "ndmi"))
                                         for v in SERIES_VARIABLES}
    # the real last clear acquisition (series provenance) beats the 5-day grid date (RT-9/DC-5)
    for v in ("ndvi", "ndmi"):
        obs = series[v].provenance.observed_at if series[v].points else None
        if obs and data_as_of.get(v) and str(obs)[:10] <= ctx.as_of.isoformat():
            data_as_of[v] = str(obs)[:10]
    data_as_of["imagery"] = data_as_of.get("ndvi")
    data_as_of["events"] = ctx.as_of.isoformat() if inp.events is not None else None
    data_as_of["water_supply"] = ws.supply.provenance.observed_at if supply_known else None
    station_perils = {d.peril for d in climate if d.provenance.source == "ran_station"}
    for v, peril, kind in (("tmin", "frost", "frost"), ("tmax", "heat", "heat"), ("precip", "harvest_rain", "rain")):
        we = inp.station.get(kind) if peril in station_perils else None
        if we is not None and getattr(we, "data_as_of", None):  # that driver read the RAN station week
            data_as_of[v] = str(we.data_as_of)[:10]
    for v, peril in (("tmin", "frost"), ("tmax", "heat"), ("precip", "harvest_rain")):
        d = data_as_of.get(v)
        if peril in station_perils:
            continue  # that driver read the RAN station week, current to as-of
        if d and (ctx.as_of - date.fromisoformat(d)).days > 3:
            warnings.append(f"Latest {v} data is from {d}; the last-7-day signals end there.")

    return FarmAssessment(
        farm_id=ctx.farm.id,
        as_of=ctx.as_of.isoformat(),
        zone_id=ctx.zone.id,
        data_tier=ctx.data_tier,
        risk=risk,
        water=ws,
        peers=pc,
        series=series,
        next_installment=next_inst,
        exposure=round(float(exposure), 2),
        stage_bands=bands,
        data_as_of=data_as_of,
        warnings=list(dict.fromkeys(w for w in warnings if w)),
    )


# ───────────────────────── cache ─────────────────────────

def cache_key(ctx: FarmContext) -> str:
    blob = json.dumps({
        "v": CACHE_VERSION,
        "farm": ctx.farm.model_dump(by_alias=True, mode="json"),
        "zone": ctx.zone.model_dump(by_alias=True, mode="json"),
        "template": ctx.template.model_dump(by_alias=True, mode="json"),
        "country": ctx.portfolio.country,
        "currency": ctx.portfolio.currency,
        "asOf": ctx.as_of.isoformat(),
        "peers": [peers_enabled(), max_peers()],
    }, sort_keys=True, separators=(",", ":"))
    return f"{ctx.farm.id}:{ctx.as_of.isoformat()}:{hashlib.sha1(blob.encode()).hexdigest()[:20]}"


def _cache_get(key: str) -> FarmAssessment | None:
    if not cache_enabled():
        return None
    try:
        row = store.assessment_get(CACHE_KIND, key, max_age_s=_env_float("CLM_RISK_CACHE_TTL_S", 3600.0))
        if row is None:
            return None
        fa = FarmAssessment.model_validate(row["assessment"])
        if row.get("degraded") and time.time() - float(row.get("t", 0)) > _env_float("CLM_RISK_CACHE_DEGRADED_TTL_S", 600.0):
            return None
        return fa
    except Exception as exc:
        log.warning("risk cache read failed: %r", exc)
        return None


def _cache_put(key: str, fa: FarmAssessment, degraded: bool) -> None:
    if not cache_enabled():
        return
    try:
        store.assessment_put(CACHE_KIND, key, {"assessment": fa.model_dump(by_alias=True, mode="json"),
                                               "degraded": degraded, "t": time.time()})
    except Exception as exc:
        log.warning("risk cache write failed: %r", exc)


# ───────────────────────── public ─────────────────────────

def assess_farm(portfolio: Portfolio, farm_id: str, as_of: date, shared: SharedEvents | None = None) -> FarmAssessment:
    farm = portfolio.farm(farm_id)
    if farm is None:
        raise KeyError(farm_id)
    ctx = build_context(portfolio, farm, as_of)
    key = cache_key(ctx)
    hit = _cache_get(key)
    if hit is not None:
        return hit
    bands = [_as(StageBand, b) for b in (deps.stage_bands(ctx.template, as_of) or [])]
    exposure = float(deps.outstanding_at(farm.loan, as_of) or 0.0)
    nxt = _as(Installment, deps.next_installment(farm.loan, as_of))
    inp = gather(ctx, shared)
    fa = compute(ctx, inp, bands, exposure, nxt)
    _cache_put(key, fa, degraded=bool(inp.missing))
    return fa


def _failed_rank(portfolio: Portfolio, farm: Farm, as_of: date, reason: str) -> tuple[RankedFarm, float]:
    try:
        exposure = float(deps.outstanding_at(farm.loan, as_of) or 0.0)
    except Exception:
        exposure = 0.0
    try:
        nxt = _as(Installment, deps.next_installment(farm.loan, as_of))
    except Exception:
        nxt = None
    return RankedFarm(farm_id=farm.id, name=farm.name, crop=farm.crop, zone_id=farm.zone_id, score=0.0,
                      tier="normal", exposure=round(exposure, 2),
                      headline=f"Assessment unavailable: {reason}", stage=StageRef(key="unknown", label="Unknown"),
                      next_installment=nxt), exposure


def portfolio_shared_events(portfolio: Portfolio, as_of: date) -> SharedEvents:
    shapes = [geo.farm_shape(f) for f in portfolio.farms]
    circles = [geo.circle(f.centroid, 3338) for f in portfolio.farms]
    start = window_start(as_of)
    bbox = _events_bbox([s for s in shapes if s is not None] + circles, EVENTS_PAD_M)
    fire_bbox = _events_bbox(circles + [s for s in shapes if s is not None], 1_000)
    with ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(fetch_events, bbox, start, as_of)
        f2 = pool.submit(fetch_events, fire_bbox, FIRE_HISTORY_SINCE, as_of)
        (ev, ev_err), (fh, fh_err) = f1.result(), f2.result()
    return SharedEvents(ev, ev_err, fh, fh_err)


def assess_portfolio(portfolio: Portfolio, as_of: date) -> PortfolioAssessment:
    warnings: list[str] = []
    shared = portfolio_shared_events(portfolio, as_of)
    if shared.events is None:
        warnings.append(shared.events_missing or "Event catalogues unavailable.")

    def run(farm: Farm) -> tuple[Farm, FarmAssessment | None, str | None]:
        try:
            return farm, assess_farm(portfolio, farm.id, as_of, shared), None
        except Exception as exc:
            log.exception("assessment failed for farm %s", farm.id)
            return farm, None, f"{exc.__class__.__name__}: {str(exc)[:200]}"

    with ThreadPoolExecutor(max_workers=FARM_WORKERS, thread_name_prefix="risk-farm") as pool:
        results = list(pool.map(run, portfolio.farms))

    ranked: list[RankedFarm] = []
    tiers: dict[str, str] = {}
    exposures: dict[str, float] = {}
    zones: dict[str, str] = {}
    actions: list[FarmCreditAction] = []
    farm_warnings: dict[str, list[str]] = {}
    for farm, fa, err in results:
        if fa is None:
            rf, exp = _failed_rank(portfolio, farm, as_of, err or "unknown error")
            ranked.append(rf)
            tiers[farm.id], exposures[farm.id], zones[farm.id] = "normal", exp, farm.zone_id
            warnings.append(f"{farm.name}: assessment failed ({err}); shown with score 0, not assessed.")
            continue
        ranked.append(RankedFarm(farm_id=farm.id, name=farm.name, crop=farm.crop, zone_id=fa.zone_id,
                                 score=fa.risk.score, tier=fa.risk.tier, exposure=fa.exposure,
                                 headline=fa.risk.headline, stage=fa.risk.stage, next_installment=fa.next_installment))
        tiers[farm.id], exposures[farm.id], zones[farm.id] = fa.risk.tier, fa.exposure, fa.zone_id
        for a in fa.risk.credit_actions:
            actions.append(FarmCreditAction(farm_id=farm.id, rule_id=a.rule_id, action=a.action, message=a.message))
        for w in fa.warnings:
            farm_warnings.setdefault(w, []).append(farm.name)
    n_ok = sum(1 for _, fa, _ in results if fa is not None)
    for w, names in farm_warnings.items():
        if len(names) == 1 and n_ok > 1:
            warnings.append(f"{names[0]}: {w}")
        elif len(names) == n_ok:
            warnings.append(f"All farms: {w}" if n_ok > 1 else w)
        else:
            warnings.append(f"{w} ({len(names)} farms)")
    ranked.sort(key=lambda r: (-r.score, -r.exposure))

    total = round(sum(exposures.values()), 2)
    by_tier = {t: round(sum(exposures[f] for f in exposures if tiers[f] == t), 2) for t in ("normal", "watch", "high")}
    n_by_tier = {t: sum(1 for f in tiers if tiers[f] == t) for t in ("normal", "watch", "high")}

    def slice_(ids: list[str]) -> dict[str, Any]:
        return {"farms": len(ids), "exposure": round(sum(exposures[i] for i in ids), 2),
                "stressed_exposure": round(sum(exposures[i] for i in ids if tiers[i] in ("watch", "high")), 2)}

    crops_order = ["cherry", "blueberry", "avocado", "walnut", "hazelnut", "table_grape"]
    by_crop = []
    for crop in crops_order:
        ids = [f.id for f in portfolio.farms if f.crop == crop]
        if ids:
            by_crop.append(CropExposureSlice(crop=crop, **slice_(ids)))
    by_zone = []
    for zid in sorted(set(zones.values())):
        ids = [f for f in zones if zones[f] == zid]
        by_zone.append(ZoneExposureSlice(zone_id=zid, **slice_(ids)))
    by_zone.sort(key=lambda s: (-s.exposure, s.zone_id))

    events = _portfolio_events(portfolio, shared.events or [], zones, exposures)
    return PortfolioAssessment(
        portfolio_id=portfolio.id,
        as_of=as_of.isoformat(),
        currency=portfolio.currency,
        total_exposure=total,
        exposure_by_tier=by_tier,
        farms_by_tier=n_by_tier,
        ranked=ranked,
        by_crop=by_crop,
        by_zone=by_zone,
        events=events,
        credit_actions=actions,
        warnings=[w for w in dict.fromkeys(warnings) if f"All farms: {w}" not in warnings],
    )


def _portfolio_events(portfolio: Portfolio, events: list[ClimateEvent], zones: dict[str, str],
                      exposures: dict[str, float]) -> list[ClimateEvent]:
    """Affected farms = farms whose zone circle (or polygon) intersects the event geometry."""
    zone_by_id = {z.id: z for z in portfolio.zones}
    circles = {}
    for f in portfolio.farms:
        z = zone_by_id.get(zones.get(f.id, ""))
        center, radius = (z.center, z.radius_m) if z is not None else (f.centroid, 3338)
        circles[f.id] = (geo.circle(center, radius), geo.farm_shape(f))
    out = []
    for e in events:
        shp = geo.event_shape(e.geometry)
        hit = [fid for fid, (circ, fs) in circles.items() if geo.intersects(circ, shp) or geo.intersects(fs, shp)]
        ec = e.model_copy()
        ec.affected_farm_ids = hit
        ec.affected_exposure = round(sum(exposures.get(f, 0.0) for f in hit), 2)
        out.append(ec)
    out.sort(key=lambda e: e.start, reverse=True)
    return out
