"""Driver builders for the three components (CONTRACT §E.5). Pure: FarmContext + FarmInputs in, Drivers out.

Every peril of a component always yields a driver (impact 0 when calm or unavailable), so the farm page
shows what was evaluated. Unavailable inputs give severity 0, value null and a provenance whose note says why.
"""

from __future__ import annotations

from datetime import date, timedelta

from app import provenance as prov
from app.models import ClimateEvent, Driver, Provenance, WaterStatus
from app.risk import geo, signals
from app.risk.formula import make_driver, ramp
from app.risk.inputs import (FarmContext, FarmInputs, day, long_date, num, unavailable, veg_z_provenance, with_observed,
                             z_phrase)

SINCE_FIRE_YEAR = 2012


def _series_prov(inp: FarmInputs, var: str) -> Provenance | None:
    s = inp.series.get(var)
    return s.provenance if s is not None else None


def _missing(inp: FarmInputs, key: str, default: str) -> str:
    return inp.missing.get(key) or default


# ───────────────────────── climate (C) ─────────────────────────

#: A station week counts when at least this share of its hours is present.
STATION_MIN_COVERAGE = 0.8


def _station(inp: FarmInputs, kind: str, key: str):
    """(value, when: date, station label, provenance) from a RAN station week, or None."""
    we = inp.station.get(kind)
    if we is None:
        return None
    sm = we.summary or {}
    v = sm.get(key)
    n, exp = sm.get("n_hours") or 0, sm.get("expected_hours") or 0
    if v is None or (exp and n < STATION_MIN_COVERAGE * exp):
        return None
    at = sm.get({"min_c": "min_at", "max_c": "max_at", "max_72h_mm": "max_72h_end"}[key])
    try:
        when = date.fromisoformat(str(at)[:10])
    except ValueError:
        when = we.end
    st = we.station or {}
    label = f"{st.get('name', 'RAN station')} station, {num(float(st.get('distance_km') or 0), 1)} km away"
    return float(v), when, label, we.provenance



def frost(ctx: FarmContext, inp: FarmInputs) -> Driver:
    th, s = ctx.thresholds, ctx.stage.sensitivity.get("frost", 0.0)
    st = _station(inp, "frost", "min_c")
    if st is not None:
        v, when, label, p = st
        sev = ramp(v, th.frost_critical_c + 1, th.frost_severe_c)
        text = (f"Coldest hour {num(v)} °C on {day(when)} ({label}); "
                f"{ctx.stage.label.lower()} damage starts at {num(th.frost_critical_c)} °C.")
        return make_driver("climate", "frost", "tmin_7d_min", sev, s, 0, text, round(v, 1), th.frost_critical_c, "°C",
                           with_observed(p, when, ctx.data_tier, "ran_station"))
    ex = signals.window_extreme(inp.series.get("tmin"), ctx.as_of, "min")
    if ex is None:
        p = unavailable("unavailable", _missing(inp, "tmin", "no recent daily minimum temperature"), ctx.data_tier)
        return make_driver("climate", "frost", "tmin_7d_min", 0, s, 0,
                           "Frost not assessed: no recent minimum temperature data.", None, th.frost_critical_c, "°C", p)
    sev = ramp(ex.value, th.frost_critical_c + 1, th.frost_severe_c)
    stage = ctx.stage.label.lower()
    text = f"Coldest night {num(ex.value)} °C on {day(ex.on)}; {stage} damage starts at {num(th.frost_critical_c)} °C."
    return make_driver("climate", "frost", "tmin_7d_min", sev, s, 0, text, round(ex.value, 1), th.frost_critical_c, "°C",
                       with_observed(_series_prov(inp, "tmin"), ex.on, ctx.data_tier))


def heat(ctx: FarmContext, inp: FarmInputs) -> Driver:
    th, s = ctx.thresholds, ctx.stage.sensitivity.get("heat", 0.0)
    st = _station(inp, "heat", "max_c")
    if st is not None:
        v, when, label, p = st
        sev = ramp(v, th.heat_c - 2, th.heat_c + 3)
        text = f"Hottest hour {num(v)} °C on {day(when)} ({label}); heat stress starts at {num(th.heat_c, 0)} °C."
        return make_driver("climate", "heat", "tmax_7d_max", sev, s, 0, text, round(v, 1), th.heat_c, "°C",
                           with_observed(p, when, ctx.data_tier, "ran_station"))
    ex = signals.window_extreme(inp.series.get("tmax"), ctx.as_of, "max")
    if ex is None:
        p = unavailable("unavailable", _missing(inp, "tmax", "no recent daily maximum temperature"), ctx.data_tier)
        return make_driver("climate", "heat", "tmax_7d_max", 0, s, 0,
                           "Heat not assessed: no recent maximum temperature data.", None, th.heat_c, "°C", p)
    sev = ramp(ex.value, th.heat_c - 2, th.heat_c + 3)
    text = f"Hottest day {num(ex.value)} °C on {day(ex.on)}; heat stress starts at {num(th.heat_c, 0)} °C."
    return make_driver("climate", "heat", "tmax_7d_max", sev, s, 0, text, round(ex.value, 1), th.heat_c, "°C",
                       with_observed(_series_prov(inp, "tmax"), ex.on, ctx.data_tier))


def harvest_rain(ctx: FarmContext, inp: FarmInputs) -> Driver:
    th, s = ctx.thresholds, ctx.stage.sensitivity.get("harvest_rain", 0.0)
    T = th.harvest_rain_mm72h
    st = _station(inp, "rain", "max_72h_mm")
    if st is not None:
        v, when, label, p = st
        sev = ramp(v, 0.5 * T, 1.5 * T)
        text = ("No rain in the last 7 days" if v < 0.1 else
                f"{num(v)} mm of rain in the wettest 72 h (to {day(when)})") + f" ({label})"
        text += "." if v < 0.1 else f"; damaging rain at this stage is about {num(T, 0)} mm."
        return make_driver("climate", "harvest_rain", "max_rain_72h", sev, s, 0, text, round(v, 1), T, "mm",
                           with_observed(p, when, ctx.data_tier, "ran_station"))
    ex = signals.max_rain_72h(inp.series.get("precip"), ctx.as_of)
    if ex is None:
        p = unavailable("unavailable", _missing(inp, "precip", "no recent daily rainfall"), ctx.data_tier)
        return make_driver("climate", "harvest_rain", "max_rain_72h", 0, s, 0,
                           "Rain not assessed: no recent daily rainfall data.", None, T, "mm", p)
    sev = ramp(ex.value, 0.5 * T, 1.5 * T)
    if ex.value < 0.1:
        text = "No rain in the last 7 days."
    else:
        text = (f"{num(ex.value)} mm of rain in the wettest 72 h (to {day(ex.on)}); "
                f"damaging rain at this stage is about {num(T, 0)} mm.")
    return make_driver("climate", "harvest_rain", "max_rain_72h", sev, s, 0, text, round(ex.value, 1), T, "mm",
                       with_observed(_series_prov(inp, "precip"), ex.anchor, ctx.data_tier))


def chill(ctx: FarmContext, inp: FarmInputs) -> Driver:
    s = ctx.stage.sensitivity.get("chill", 0.0)
    need = float(ctx.template.rules.chill_hours_min or 0)
    start, end, in_progress = signals.chill_period(ctx.as_of)
    scored = "" if s > 0 else " (not scored at this stage)"
    if need <= 0:
        p = prov.build("template", data_tier=ctx.data_tier, note="Crop template: no winter chill requirement.")
        return make_driver("climate", "chill", "chill_hours_season", 0, s, 0,
                           f"No winter chill requirement for {ctx.template.labels.en.lower()}.", None, 0, "h", p)
    hours: float | None = None
    p: Provenance | None = None
    if inp.chill_hourly is not None:
        hours, p = float(inp.chill_hourly[0]), inp.chill_hourly[1]
    else:
        est = signals.chill_hours_estimate(inp.series.get("tmin"), inp.series.get("tmax"), ctx.as_of)
        if est is not None:
            hours = est.hours
            p = prov.derived(
                "Chill hours < 7.2 °C estimated from daily Tmin/Tmax with a linear daily temperature curve "
                f"({est.valid_days} of {est.total_days} days with data); hourly station data would be more exact",
                inputs=[x for x in (_series_prov(inp, "tmin"), _series_prov(inp, "tmax")) if x],
                observed_at=est.end, data_tier=ctx.data_tier)
            p.estimated = True
    if hours is None or p is None:
        pu = unavailable("unavailable", "not enough daily temperatures for 1 May – 31 Aug", ctx.data_tier)
        return make_driver("climate", "chill", "chill_hours_season", 0, s, 0,
                           "Winter chill not assessed: not enough temperature data.", None, need, "h", pu)
    if in_progress:
        # Contract §E.5 compares the season-to-date total with the full requirement; mid-winter that would
        # flag every farm in May. We prorate the requirement by days elapsed (reported as a decision).
        frac = ((end - start).days + 1) / 123.0
        target = need * frac
        sev = ramp(hours, target, 0.5 * target) if target > 0 else 0.0
        text = (f"Winter chill so far {num(hours, 0)} h by {day(end)} vs about {num(target, 0)} h expected by now "
                f"({num(need, 0)} h for the season){scored}.")
        p.note = f"{p.note}; requirement prorated by days elapsed (winter in progress)" if p.note else \
            "requirement prorated by days elapsed (winter in progress)"
    else:
        sev = ramp(hours, need, 0.5 * need)
        text = f"Winter chill {num(hours, 0)} h vs {num(need, 0)} h needed{scored}."
    return make_driver("climate", "chill", "chill_hours_season", sev, s, 0, text, round(hours), need, "h", p)


def water(ctx: FarmContext, inp: FarmInputs, ws: WaterStatus) -> Driver:
    """§E.5 water: irrigated yes/unknown → max(ramp(snowmelt %, 90, 40), stressMap); irrigated no → stressMap."""
    s = ctx.stage.sensitivity.get("water", 0.0)
    snow = ws.supply.snowmelt_pct_of_normal
    level = ws.stress.level
    stress_x = signals.STRESS_SEVERITY.get(level, 0.0)
    snow_x = ramp(snow, 90, 40) if snow is not None else 0.0
    sev = max(snow_x, stress_x) if ws.irrigated.value in ("yes", "unknown") else stress_x
    basin = f" for the {ws.supply.basin} basin" if ws.supply.basin else ""
    snow_txt = f"snowmelt forecast {num(snow, 0)} % of normal{basin}" if snow is not None else None
    level_txt = "no stress" if level == "none" else f"{level} stress"
    ndmi_txt = (f"canopy moisture (NDMI) {z_phrase(ws.stress.ndmi_z)} ({level_txt})"
                if ws.stress.ndmi_z is not None else None)
    stress_leads = stress_x > 0 and stress_x >= snow_x and ndmi_txt is not None
    if snow_txt is None and ndmi_txt is None:
        text = "Water not assessed: no snowmelt forecast and no canopy-moisture reading."
    elif stress_leads:
        # name the cause first; supply is context ("despite a good snowmelt" reads very differently)
        text = ndmi_txt[0].upper() + ndmi_txt[1:]
        if snow_txt is not None:
            text += (f", although the {snow_txt}: supply is not the cause" if snow_x == 0
                     else f"; {snow_txt}")
        text += "."
    else:
        parts = [x for x in (snow_txt, ndmi_txt) if x]
        text = "; ".join(parts) + "."
        text = text[0].upper() + text[1:]
    # show the quantity that drives the severity (DC-4): NDMI z when stress leads, else the snowmelt forecast
    if (stress_leads or snow is None) and ws.stress.ndmi_z is not None:
        value, normal, unit = round(ws.stress.ndmi_z, 2), 0, "z"
    elif snow is not None:
        value, normal, unit = snow, 100, "% of normal"
    else:
        value, normal, unit = None, 0, "z"
    inputs = [ws.supply.provenance, ws.stress.provenance]
    p = prov.derived("Water: snowmelt forecast vs 1991–2020 and NDMI stress level (§E.5)", inputs=inputs,
                     data_tier=ctx.data_tier)
    return make_driver("climate", "water", "water_supply", sev, s, 0, text, value, normal, unit, p)


def vigour(ctx: FarmContext, inp: FarmInputs, ndvi_pz: signals.PersistentZ | None) -> Driver:
    s = ctx.stage.sensitivity.get("vigour", 0.0)
    if ndvi_pz is None:
        p = unavailable("s2_l2a_pc", _missing(inp, "ndvi", "no recent NDVI with a baseline"), ctx.data_tier)
        return make_driver("climate", "vigour", "ndvi_z", 0, s, 0,
                           "Vigour not assessed: no recent clear NDVI with a baseline.", None, 0, "z", p)
    sev = ramp(ndvi_pz.z, -1.0, -2.5)
    when = ndvi_pz.on.strftime("%B")
    period = ("early " if ndvi_pz.on.day <= 10 else "mid " if ndvi_pz.on.day <= 20 else "late ") + when
    text = f"Vigour (NDVI) {z_phrase(ndvi_pz.z)} for {period}."
    if ctx.covered:
        text += " The orchard is covered: NDVI reads the cover."
    zsrc = ("z vs the same dates in previous seasons (per-date mean and sd, svc-imagery §E.6)" if ndvi_pz.exact else
            "z vs the same dates in previous seasons, from the baseline band (mean ≈ p50, sd ≈ (p90 − p10)/2.56)")
    p = veg_z_provenance(inp.series.get("ndvi"), ndvi_pz, ctx.data_tier,
                         note=zsrc + "; " + ("mean of the last 2 composites" if ndvi_pz.method == "last2" else "32-day mean"))
    return make_driver("climate", "vigour", "ndvi_z", sev, s, 0, text, round(ndvi_pz.z, 2), 0, "z", p)


ABANDON_SEV = {"high": 1.0, "medium": 0.7, "low": 0.4}


def abandonment(ctx: FarmContext, ws: WaterStatus) -> Driver:
    s = ctx.stage.sensitivity.get("abandonment", 0.0)
    a = ws.abandonment
    sev = ABANDON_SEV[a.confidence] if a.flag else 0.0
    text = a.evidence if a.flag else ("No abandonment signal in the last dry season." if a.provenance.observed_at
                                      else a.evidence)
    return make_driver("climate", "abandonment", "abandonment_flag", sev, s, 0, text, a.flag, False, None, a.provenance)


# ───────────────────────── disaster (D) ─────────────────────────

def _active_on(e: ClimateEvent, d: date) -> bool:
    return e.start[:10] <= d.isoformat() and (e.end is None or e.end[:10] >= d.isoformat())


def _in_window(e: ClimateEvent, start: date, end: date) -> bool:
    return e.start[:10] <= end.isoformat() and (e.end is None or e.end[:10] >= start.isoformat())


def _events_prov(events: list[ClimateEvent], note: str, ctx: FarmContext) -> Provenance:
    return prov.derived(note, inputs=[e.provenance for e in events], observed_at=ctx.as_of, data_tier=ctx.data_tier)


def burned_area_on_farm(ctx: FarmContext, inp: FarmInputs) -> tuple[bool | None, ClimateEvent | None]:
    if inp.events is None:
        return None, None
    fs = geo.farm_shape(ctx.farm)
    for e in inp.events:
        if (e.kind == "fire" and e.evidence_kind == "observed_footprint"
                and _in_window(e, ctx.window_start, ctx.as_of) and geo.intersects(fs, geo.event_shape(e.geometry))):
            return True, e
    return False, None


#: CONTRACT §E.5 v1.1 note: a coarse burned-area footprint on the farm is checked against the farm's own
#: native 10 m Sentinel-2 NDVI: clear composites within ±BURN_CHECK_DAYS of the event start. A drop smaller
#: than BURN_MIN_DROP means the pixels contradict the polygon: scored as zone-level (0.4), no burned-area flag.
BURN_CHECK_DAYS = 15
BURN_MIN_DROP = 0.10
BURN_GREEN_NDVI = 0.40


def burn_imagery_check(ctx: FarmContext, inp: FarmInputs, ev: ClimateEvent) -> dict | None:
    """{contradicted, before, beforeOn, after, afterOn, drop} from observed (non gap-filled) NDVI composites
    around the fire start, or None when there is no clear composite on one of the sides."""
    nd = inp.series.get("ndvi")
    try:
        t0 = date.fromisoformat(ev.start[:10])
    except ValueError:
        return None
    if nd is None:
        return None
    obs = [(date.fromisoformat(p.date[:10]), float(p.value)) for p in nd.points
           if p.value is not None and not p.estimated]
    before = [x for x in obs if t0 - timedelta(days=BURN_CHECK_DAYS) <= x[0] < t0]
    after = [x for x in obs if t0 < x[0] <= t0 + timedelta(days=BURN_CHECK_DAYS)]
    if not before or not after:
        return None
    b = before[-1]
    a = min(after, key=lambda x: x[1])
    drop = b[1] - a[1]
    # only a green canopy can contradict the map (a leafless winter orchard shows little drop either way)
    return {"contradicted": drop < BURN_MIN_DROP and b[1] >= BURN_GREEN_NDVI, "before": b[1], "beforeOn": b[0], "after": a[1], "afterOn": a[0],
            "drop": drop}


def burn_confirmed_on_farm(ctx: FarmContext, inp: FarmInputs) -> bool | None:
    """`events.burnedAreaIntersects` (§E.7, v1.1): a footprint on the farm that native S2 does not contradict."""
    on_farm, ev = burned_area_on_farm(ctx, inp)
    if not on_farm or ev is None:
        return on_farm
    chk = burn_imagery_check(ctx, inp, ev)
    return not (chk and chk["contradicted"])


def fire(ctx: FarmContext, inp: FarmInputs) -> Driver:
    s = ctx.stage.sensitivity.get("fire", 0.0)
    if inp.events is None:
        p = unavailable("unavailable", _missing(inp, "events", "event catalogues unavailable"), ctx.data_tier)
        return make_driver("disaster", "fire", "burned_area", 0, s, 0, "Fire not assessed: event catalogues unavailable.",
                           None, False, None, p)
    zone_c = geo.circle(ctx.zone.center, ctx.zone.radius_m)
    on_farm, ev = burned_area_on_farm(ctx, inp)
    if on_farm and ev is not None:
        chk = burn_imagery_check(ctx, inp, ev)
        if chk is not None:
            nd_txt = (f"orchard NDVI {num(chk['before'], 2)} on {day(chk['beforeOn'].isoformat())} before and "
                      f"{num(chk['after'], 2)} on {day(chk['afterOn'].isoformat())} after (native 10 m Sentinel-2)")
        if chk is not None and chk["contradicted"]:
            text = (f"Burned area mapped on the orchard, unconfirmed by imagery: {ev.title} ({long_date(ev.start)}). "
                    f"The map is coarse; {nd_txt}, so the canopy shows no fire damage. Scored as a fire in the "
                    f"zone; confirm with a field visit.")
            p = ev.provenance.model_copy(update={"estimated": True, "note": (
                (ev.provenance.note + "; ") if ev.provenance.note else "")
                + f"footprint contradicted by native S2 NDVI (drop {num(chk['drop'], 2)} < {BURN_MIN_DROP}): severity 0.4"})
            return make_driver("disaster", "fire", "burned_area", 0.4, s, 0, text, True, False, None, p)
        text = f"Burned area mapped on the orchard: {ev.title} ({long_date(ev.start)})."
        if chk is not None:
            text += f" Imagery agrees: {nd_txt}."
        else:
            text += " No clear Sentinel-2 view on both sides of the fire date to confirm it: confirm with a field visit."
        return make_driver("disaster", "fire", "burned_area", 1.0, s, 0, text, True, False, None, ev.provenance)
    recent = ctx.as_of - timedelta(days=7)
    fires = [e for e in inp.events if e.kind == "fire"]
    for e in sorted(fires, key=lambda e: e.start, reverse=True):
        if e.start[:10] >= recent.isoformat() and e.start[:10] <= ctx.as_of.isoformat() \
                and geo.intersects(zone_c, geo.event_shape(e.geometry)):
            if e.evidence_kind == "own_signal":  # FIRMS hotspots: thermal detections, not a burned area (DC-7)
                return make_driver("disaster", "fire", "active_fire", 0.6, s, 0,
                                   f"Active-fire hotspots inside the zone since {day(e.start)}: {e.title}. These are "
                                   "satellite heat detections, not a mapped burned area, and are often small "
                                   "agricultural burns.", True, False, None, e.provenance)
            return make_driver("disaster", "fire", "burned_area", 0.6, s, 0,
                               f"Fire activity inside the zone since {day(e.start)}: {e.title}.", True, False, None,
                               e.provenance)
    for e in sorted(fires, key=lambda e: e.start, reverse=True):
        if e.evidence_kind == "observed_footprint" and _in_window(e, ctx.window_start, ctx.as_of) \
                and geo.intersects(zone_c, geo.event_shape(e.geometry)):
            return make_driver("disaster", "fire", "burned_area", 0.4, s, 0,
                               f"Burned area mapped inside the zone circle: {e.title} ({long_date(e.start)}).", True,
                               False, None, e.provenance)
    return make_driver("disaster", "fire", "burned_area", 0, s, 0,
                       "No burned area mapped in the zone in the last 13 months.", False, False, None,
                       _events_prov(fires, "No fire event in the catalogues intersects the zone", ctx))


def flood(ctx: FarmContext, inp: FarmInputs) -> Driver:
    s = ctx.stage.sensitivity.get("flood", 0.0)
    if inp.events is None:
        p = unavailable("unavailable", _missing(inp, "events", "event catalogues unavailable"), ctx.data_tier)
        return make_driver("disaster", "flood", "flood_footprint", 0, s, 0,
                           "Flood not assessed: event catalogues unavailable.", None, False, None, p)
    fs = geo.farm_shape(ctx.farm)
    zone_c = geo.circle(ctx.zone.center, ctx.zone.radius_m)
    floods = [e for e in inp.events if e.kind == "flood" and _in_window(e, ctx.window_start, ctx.as_of)]
    for e in floods:
        if geo.intersects(fs, geo.event_shape(e.geometry)):
            return make_driver("disaster", "flood", "flood_footprint", 1.0, s, 0,
                               f"Flood extent mapped on the orchard: {e.title} ({long_date(e.start)}).", True, False,
                               None, e.provenance)
    for e in floods:
        if geo.intersects(zone_c, geo.event_shape(e.geometry)):
            return make_driver("disaster", "flood", "flood_footprint", 0.4, s, 0,
                               f"Flood extent mapped inside the zone circle: {e.title} ({long_date(e.start)}).", True,
                               False, None, e.provenance)
    return make_driver("disaster", "flood", "flood_footprint", 0, s, 0,
                       "No flood mapped in the zone in the last 13 months.", False, False, None,
                       _events_prov(floods, "No flood event in the catalogues intersects the zone", ctx))


def declared_emergency(ctx: FarmContext, inp: FarmInputs, ws: WaterStatus) -> Driver:
    """0.6 when an official declaration covering the farm is active on asOf: the DGA decree from the water
    ladder (commune/province/basin match done by svc-water-events) or an official_declaration event whose
    geometry intersects the farm."""
    s = ctx.stage.sensitivity.get("declared_emergency", 0.0)
    sup = ws.supply
    if sup.decree_active and (sup.decree_until is None or sup.decree_until[:10] >= ctx.as_of.isoformat()):
        where = f"the {sup.basin} area" if sup.basin else "this area"
        until = f" until {long_date(sup.decree_until)}" if sup.decree_until else ""
        dec = (sup.decree_id or "").strip()
        if not dec:
            text = f"A water-scarcity decree covers {where}{until}."
        elif "decree" in dec.lower():
            text = f"{dec} (water scarcity) covers {where}{until}."
        else:
            text = f"Water-scarcity decree {dec} covers {where}{until}."
        return make_driver("disaster", "declared_emergency", "decree_active", 0.6, s, 0, text, True, False, None,
                           sup.provenance)
    fs = geo.farm_shape(ctx.farm)
    for e in inp.events or []:
        if e.evidence_kind == "official_declaration" and _active_on(e, ctx.as_of) \
                and geo.intersects(fs, geo.event_shape(e.geometry)):
            until = f" until {long_date(e.end)}" if e.end else ""
            return make_driver("disaster", "declared_emergency", "decree_active", 0.6, s, 0,
                               f"{e.title} covers this orchard{until}.", True, False, None, e.provenance)
    note_src = [sup.provenance] + [e.provenance for e in (inp.events or []) if e.evidence_kind == "official_declaration"]
    unknown = (not ctx.chile) or (sup.provenance.note or "").startswith("unavailable")
    text = "No active emergency or scarcity decree." if not unknown else \
        "No active emergency declaration found (decree status could not be checked)."
    p = prov.derived("No official declaration active on the as-of date covers the farm", inputs=note_src,
                     observed_at=ctx.as_of, data_tier=ctx.data_tier)
    return make_driver("disaster", "declared_emergency", "decree_active", 0, s, 0, text, False, False, None, p)


# ───────────────────────── geography (G) ─────────────────────────

def frost_pocket(ctx: FarmContext, inp: FarmInputs, c: float) -> tuple[Driver, bool]:
    el = inp.elevation
    if el is None:
        p = unavailable("copernicus_dem", _missing(inp, "elevation", "Copernicus DEM unavailable"), ctx.data_tier)
        return make_driver("geography", "frost", "frost_pocket", 0, None, c,
                           "Frost-pocket position not assessed: elevation data unavailable.", None, 0, "m", p), False
    rel = el.rel_m
    sev = ramp(rel, 0, -30)
    if rel < -2:
        text = f"Orchard sits {num(abs(rel), 0)} m below the zone average: cold air can pool here."
    elif rel > 2:
        text = f"Orchard sits {num(rel, 0)} m above the zone average: no frost-pocket position."
    else:
        text = "Orchard sits at the zone's average elevation."
    return make_driver("geography", "frost", "frost_pocket", sev, None, c, text, rel, 0, "m", el.provenance), True


def fire_recurrence(ctx: FarmContext, inp: FarmInputs, c: float) -> tuple[Driver, bool]:
    if inp.fire_history is None:
        p = unavailable("gwis_ba", _missing(inp, "fire_history", "fire history unavailable"), ctx.data_tier)
        return make_driver("geography", "fire", "fire_recurrence", 0, None, c,
                           "Fire recurrence not assessed: burned-area history unavailable.", None, 5, "years", p), False
    zone_c = geo.circle(ctx.zone.center, ctx.zone.radius_m)
    years = sorted({int(e.start[:4]) for e in inp.fire_history
                    if e.kind == "fire" and e.evidence_kind == "observed_footprint"
                    and int(e.start[:4]) >= SINCE_FIRE_YEAR and geo.intersects(zone_c, geo.event_shape(e.geometry))})
    n = len(years)
    sev = min(1.0, n / 5)
    yrs = "year" if n == 1 else "years"
    if n:
        shown = ", ".join(map(str, years[-4:])) + (", …" if n > 4 else "")
        text = f"Burned area in the zone in {n} {yrs} since {SINCE_FIRE_YEAR} ({shown})."
    else:
        text = f"No burned area mapped in the zone since {SINCE_FIRE_YEAR}."
    p = prov.derived(f"Distinct years with a mapped burn scar intersecting the zone circle since {SINCE_FIRE_YEAR}",
                     inputs=[e.provenance for e in inp.fire_history[:50]], observed_at=ctx.as_of, data_tier=ctx.data_tier)
    return make_driver("geography", "fire", "fire_recurrence", sev, None, c, text, n, 5, "years", p), True


def basin_water_security(ctx: FarmContext, inp: FarmInputs, c: float) -> tuple[Driver, bool]:
    if inp.decree_years is None:
        reason = _missing(inp, "decree_years", "DGA decree history unavailable")
        if not ctx.chile:
            reason = "DGA decree history is a Chile-only signal"
        p = unavailable("dga_decrees", reason, ctx.data_tier)
        return make_driver("geography", "water", "basin_water_security", 0, None, c,
                           "Basin water security not assessed: decree history unavailable.", None, 10, "years", p), False
    n, p = inp.decree_years
    sev = min(1.0, n / 10)
    text = (f"Water-scarcity decrees covered this area in {n} of the years since 2008." if n else
            "No water-scarcity decree covered this area since 2008.")
    return make_driver("geography", "water", "basin_water_security", sev, None, c, text, n, 10, "years", p), True
