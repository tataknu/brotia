"""Water status ladder (CONTRACT §E.11, ADR-0013 D7), peer comparison (§E.9) and abandonment (§E.10).
Pure: FarmContext + FarmInputs in, models out. Every rung is computed from native-resolution series.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app import provenance as prov
from app.models import (
    PeerComparison,
    Provenance,
    WaterAbandonment,
    WaterDemand,
    WaterIrrigated,
    WaterStatus,
    WaterStress,
    WaterSupply,
)
from app.risk import signals
from app.risk.inputs import FarmContext, FarmInputs, num, unavailable, veg_z_provenance, with_observed

#: Dry-season vigour test for rung 1 (Chile only): mean observed NDVI and total rain over Dec–Apr.
GREEN_NDVI = 0.5
DRY_RAIN_MM = 60.0


@dataclass
class VegSignals:
    ndvi_z: list[signals.ZPoint]
    ndmi_z: list[signals.ZPoint]
    ndvi_pz: signals.PersistentZ | None
    ndmi_pz: signals.PersistentZ | None


def veg_signals(ctx: FarmContext, inp: FarmInputs) -> VegSignals:
    ev = bool(ctx.template.evergreen)
    nz = signals.z_points(inp.series.get("ndvi"), ev, ctx.as_of)
    mz = signals.z_points(inp.series.get("ndmi"), ev, ctx.as_of)
    return VegSignals(nz, mz, signals.persistent_z(nz, ctx.as_of), signals.persistent_z(mz, ctx.as_of))


def _vig(inp: FarmInputs, key: str):
    return inp.vigour.get(key) if isinstance(inp.vigour, dict) else None


def _as_model(model, v):
    if v is None or isinstance(v, model):
        return v
    try:
        return model.model_validate(v)
    except Exception:
        return None


def apply_exact_z(vs: VegSignals, inp: FarmInputs) -> None:
    """Replace the band-approximated persistent z with svc-imagery's exact §E.6 z when it has one
    (same date and method; svc-imagery computes it from per-date mean/sd of the native series)."""
    for attr, key in (("ndvi_pz", "ndviZ"), ("ndmi_pz", "ndmiZ")):
        z = _vig(inp, key)
        pz = getattr(vs, attr)
        if z is not None and pz is not None:
            setattr(vs, attr, signals.PersistentZ(float(z), pz.on, pz.method, exact=True))


def _sprov(inp: FarmInputs, var: str) -> Provenance | None:
    s = inp.series.get(var)
    return s.provenance if s is not None else None


# ───────────────────────── peers (§E.9) ─────────────────────────

def peers(ctx: FarmContext, inp: FarmInputs, vs: VegSignals) -> PeerComparison:
    ipc = _as_model(PeerComparison, _vig(inp, "peers"))
    if ipc is not None:  # svc-imagery §E.9 (shared peer grids, exact z)
        q = ipc.model_copy()
        upd = {"data_tier": ctx.data_tier}
        sp = _sprov(inp, "ndvi")
        if sp is not None and sp.observed_at:  # the farm's last clear scene, not the as-of date (DC-3)
            upd["observed_at"] = sp.observed_at
        q.provenance = q.provenance.model_copy(update=upd)
        q.zone_id = ctx.zone.id
        return q
    pd = inp.peers
    ok = [p for p in pd.peers if p.ndvi is not None]
    n = len(ok)
    farm_z = round(vs.ndvi_pz.z, 2) if vs.ndvi_pz else None
    farm_mz = round(vs.ndmi_pz.z, 2) if vs.ndmi_pz else None
    med = signals.median([p.ndvi.z for p in ok])
    med_m = signals.median([p.ndmi.z for p in pd.peers if p.ndmi is not None])
    if n < 3:
        reading = "insufficient_peers"
    elif med is not None and med <= -1.0:
        reading = "zone_wide"
    elif farm_z is not None and med is not None and farm_z <= -1.0 and farm_z - med <= -1.0:
        reading = "farm_specific"
    else:
        reading = "normal"
    if pd.provenance is not None:
        p = pd.provenance.model_copy()
    elif not ctx.chile:
        p = unavailable("ciren_catastro", "zone peers come from the Chilean fruit cadastre (CIREN): Chile only",
                        ctx.data_tier)
    else:
        p = unavailable("ciren_catastro", pd.note or "peer orchards unavailable", ctx.data_tier)
    notes = [x for x in [p.note, pd.note if pd.provenance is not None else None,
                         f"{n} of {pd.requested} peer orchard(s) had a recent clear NDVI" if pd.requested else None] if x]
    p.note = "; ".join(dict.fromkeys(notes)) or None
    p.data_tier = ctx.data_tier
    return PeerComparison(
        zone_id=ctx.zone.id,
        n_peers=n,
        farm_ndvi_z=farm_z,
        peer_median_ndvi_z=round(med, 2) if med is not None else None,
        farm_ndmi_z=farm_mz,
        peer_median_ndmi_z=round(med_m, 2) if med_m is not None else None,
        reading=reading,
        provenance=p,
    )


# ───────────────────────── rungs ─────────────────────────

def _dry_season_green(ctx: FarmContext, inp: FarmInputs) -> tuple[bool, str, Provenance] | None:
    """'Stays green in the dry season' evidence from observed NDVI and rainfall (Chile, Dec–Apr)."""
    if not ctx.chile:
        return None
    ds = signals.dry_season(ctx.as_of, ctx.window_start)
    if ds is None:
        return None
    start, end = ds
    nd = [p for p in signals.valid_points(inp.series.get("ndvi"), end)
          if start <= signals.d(p.date) and not p.estimated]
    if len(nd) < 4:
        return None
    rain = [p for p in signals.valid_points(inp.series.get("precip"), end) if start <= signals.d(p.date)]
    span = (end - start).days + 1
    if len(rain) < 0.8 * span:
        return None
    mean_ndvi = sum(float(p.value) for p in nd) / len(nd)
    rain_mm = sum(float(p.value) for p in rain)
    green = mean_ndvi >= GREEN_NDVI and rain_mm <= DRY_RAIN_MM
    season = f"{start.year}–{str(end.year)[2:]}"
    ev = (f"Stayed green through the {season} dry season (mean NDVI {num(mean_ndvi, 2)} on {len(nd)} clear images) "
          f"with {num(rain_mm, 0)} mm of rain: consistent with irrigation.")
    p = prov.derived("Dry-season vigour vs rainfall (§E.11 rung 1); an inference, not a mapped irrigation polygon",
                     inputs=[x for x in (_sprov(inp, "ndvi"), _sprov(inp, "precip")) if x], observed_at=end,
                     data_tier=ctx.data_tier)
    p.estimated = True
    return green, ev, p


def irrigated(ctx: FarmContext, inp: FarmInputs) -> WaterIrrigated:
    ci = inp.irrigation
    ciren_ev = ci.evidence if ci is not None else None
    if ctx.farm.irrigated_declared is not None:
        v = "yes" if ctx.farm.irrigated_declared else "no"
        ev = f"Declared {'irrigated' if v == 'yes' else 'not irrigated'} by the lender"
        ev += f". {ciren_ev}" if ciren_ev else "."
        return WaterIrrigated(value=v, evidence=ev,
                              provenance=prov.build("lender", data_tier=ctx.data_tier, note=ciren_ev))
    if ci is not None and ci.value == "yes":
        p = ci.provenance.model_copy()
        p.data_tier = ctx.data_tier
        return WaterIrrigated(value="yes", evidence=ci.evidence, provenance=p)
    ie = _vig(inp, "irrigatedEvidence")
    if isinstance(ie, dict) and ie.get("value") == "yes" and ie.get("provenance") is not None:
        ip = _as_model(Provenance, ie["provenance"])
        if ip is not None:
            ip = ip.model_copy(update={"data_tier": ctx.data_tier, "estimated": True})
            ev = str(ie.get("evidence") or "Stayed green in the dry season while rain-fed land browned.")
            ev += f" {ciren_ev}" if ciren_ev else ""
            return WaterIrrigated(value="yes", evidence=ev, provenance=ip)
    green = _dry_season_green(ctx, inp)
    if green is not None and green[0]:
        ev = green[1] + (f" {ciren_ev}" if ciren_ev else "")
        return WaterIrrigated(value="yes", evidence=ev, provenance=green[2])
    if ci is not None:
        p = ci.provenance.model_copy()
        p.data_tier = ctx.data_tier
        return WaterIrrigated(value="unknown", evidence=ci.evidence, provenance=p)
    reason = inp.missing.get("irrigation") or (
        "irrigation evidence (CIREN irrigated areas) is Chile-only in v1" if not ctx.chile else "CIREN check unavailable")
    reason = reason.rstrip(".")
    return WaterIrrigated(value="unknown", evidence=f"Irrigation not known: {reason}.",
                          provenance=unavailable("ciren_irrigated", reason, ctx.data_tier))


def demand(ctx: FarmContext, inp: FarmInputs) -> WaterDemand:
    kc = float(ctx.thresholds.kc)
    eto = inp.series.get("eto")
    s7 = signals.window_sum(eto, ctx.as_of, 7)
    s30 = signals.window_sum(eto, ctx.as_of, 30)
    if s7 is None and s30 is None:
        reason = inp.missing.get("eto") or "no recent reference evapotranspiration (ETo)"
        return WaterDemand(kc=kc, provenance=unavailable("unavailable", reason, ctx.data_tier))
    anchor = (s7 or s30)[1]
    p = with_observed(eto.provenance if eto else None, anchor, ctx.data_tier, "derived",
                      note=f"ETc = Kc({ctx.stage.key}) × ETo")
    p.estimated = bool(p.estimated or (s7 and s7[2]) or (s30 and s30[2]))
    scaled = []
    for n_days, sm in ((7, s7), (30, s30)):
        have = signals.window_days_present(eto, ctx.as_of, n_days) if sm else n_days
        if sm and have < n_days:
            scaled.append(f"{n_days}-day sum: {have} of {n_days} days present, scaled to {n_days} days")
    if scaled:
        p.note = f"{p.note}; " + "; ".join(scaled) if p.note else "; ".join(scaled)
    return WaterDemand(
        kc=kc,
        eto7d_mm=round(s7[0], 1) if s7 else None,
        need7d_mm=round(kc * s7[0], 1) if s7 else None,
        need30d_mm=round(kc * s30[0], 1) if s30 else None,
        provenance=p,
    )


def supply(ctx: FarmContext, inp: FarmInputs) -> WaterSupply:
    if inp.supply is not None:
        s = inp.supply.model_copy()
        s.provenance = s.provenance.model_copy()
        s.provenance.data_tier = ctx.data_tier
        return s
    reason = ("DGA decrees and snowmelt forecasts are Chile-only signals" if not ctx.chile
              else inp.missing.get("supply") or "DGA water-supply data unavailable")
    return WaterSupply(decree_active=False, provenance=unavailable(
        "dga_decrees", f"{reason}; decree status unknown (shown as no decree)", ctx.data_tier))


def stress(ctx: FarmContext, inp: FarmInputs, vs: VegSignals, pc: PeerComparison) -> WaterStress:
    z = vs.ndmi_pz.z if vs.ndmi_pz else None
    delta = None
    if z is not None and pc.peer_median_ndmi_z is not None and pc.reading != "insufficient_peers":
        delta = round(z - pc.peer_median_ndmi_z, 2)
    level = signals.stress_level(z)
    if vs.ndmi_pz is None:
        p = unavailable("s2_l2a_pc", inp.missing.get("ndmi") or "no recent clear NDMI with a baseline", ctx.data_tier)
    else:
        p = veg_z_provenance(inp.series.get("ndmi"), vs.ndmi_pz, ctx.data_tier)
    canopy_note = "Canopy-minus-air temperature (Landsat surface temperature) is not computed in v1"
    p.note = f"{p.note}; {canopy_note}" if p.note else canopy_note
    return WaterStress(ndmi_z=round(z, 2) if z is not None else None, ndmi_peer_delta=delta,
                       canopy_minus_air_c=None, level=level, provenance=p)


def abandonment(ctx: FarmContext, inp: FarmInputs, vs: VegSignals, pc: PeerComparison) -> WaterAbandonment:
    """§E.10: flag when NDVI z ≤ −2.0 for ≥ 3 consecutive composites in the latest dry season and the peer
    reading for that period is not zone-wide. svc-imagery's result (exact z, peers over the run's dates) wins
    when present; the band-approximation below is the fallback."""
    ia = _as_model(WaterAbandonment, _vig(inp, "abandonment"))
    if ia is not None:
        return ia.model_copy(update={"provenance": ia.provenance.model_copy(update={"data_tier": ctx.data_tier})})
    ds = signals.dry_season(ctx.as_of, ctx.window_start)
    ndvi = inp.series.get("ndvi")
    if ds is None or ndvi is None or not ndvi.points:
        reason = (inp.missing.get("ndvi") or "no NDVI series for the last dry season").rstrip(".")
        return WaterAbandonment(flag=False, confidence="low", evidence=f"Abandonment not assessed: {reason}.",
                                provenance=unavailable("s2_l2a_pc", reason, ctx.data_tier))
    start, end = ds
    grid = [p for p in ndvi.points if start <= signals.d(p.date) <= end]
    valid = [p for p in grid if p.value is not None]
    frac = len(valid) / len(grid) if grid else 0.0
    season = f"{start.year}–{str(end.year)[2:]}" if start.year != end.year else str(end.year)
    run = signals.low_vigour_run(vs.ndvi_z, start, end)
    n_peers = pc.n_peers if pc.reading != "insufficient_peers" else 0
    p = with_observed(ndvi.provenance, end, ctx.data_tier, "s2_l2a_pc",
                      note=f"{len(valid)} of {len(grid)} dry-season composites valid")
    if run is None:
        if n_peers >= 3 and frac >= 0.8:
            conf = "high"
        elif n_peers < 3 and frac >= 0.8:
            conf = "medium"
        else:
            conf = "low"
        peers_txt = f" and of {n_peers} peers" if n_peers >= 3 else ""
        ev = f"Dry-season {season} NDVI never stayed 2 sd below its own history{peers_txt} for three composites in a row."
        if not vs.ndvi_z:
            ev = f"Dry-season {season} NDVI has no baseline to compare with."
            conf = "low"
        return WaterAbandonment(flag=False, confidence=conf, evidence=ev, provenance=p)
    # peer reading over the run's dates
    peer_means = []
    run_dates = set(run.dates)
    for peer in inp.peers.peers:
        vals = [z.z for z in peer.ndvi_points if z.date in run_dates]
        if vals:
            peer_means.append(sum(vals) / len(vals))
    peer_med = signals.median(peer_means) if len(peer_means) >= 3 else None
    span = f"{run.dates[0].strftime('%d %b')} – {run.dates[-1].strftime('%d %b %Y')}"
    if peer_med is not None and peer_med <= -1.0:
        ev = (f"NDVI fell {num(abs(run.mean_z))} sd below its own history ({span}), but the zone's peers fell too "
              f"(median {num(peer_med)} sd): reads as weather, not abandonment.")
        return WaterAbandonment(flag=False, confidence="high" if frac >= 0.8 else "low", evidence=ev, provenance=p)
    if peer_med is not None and run.mean_z - peer_med <= -1.5:
        conf = "high"
    elif peer_med is None:
        conf = "medium"
    else:
        conf = "low"
    peer_txt = (f" while {len(peer_means)} peers stayed near normal (median {num(peer_med)} sd)" if peer_med is not None
                else " (too few peers to compare)")
    # §E.10 v1.1 guard: the run must also be an absolute canopy collapse with no recovery since.
    from types import SimpleNamespace

    from app.imagery.signals import collapse_guard

    pts = [SimpleNamespace(date=signals.d(x.date), value=x.value, p50=x.p50, estimated=bool(x.estimated))
           for x in ndvi.points if x.value is not None]
    g = collapse_guard([x for x in pts if x.date in run_dates], vs.ndvi_pz.z if vs.ndvi_pz else None, pts, ctx.as_of)
    if g["confirmed"]:
        ev = (f"Vigour loss in the {season} dry season: NDVI {num(abs(run.mean_z))} sd below its own history for "
              f"{len(run.dates)} composites in a row ({span}){peer_txt}, near bare soil.{g['nowTxt']}")
    else:
        conf = "low"
        ev = (f"Vigour loss, not a confirmed stop of irrigation: NDVI {num(abs(run.mean_z))} sd below its own history for "
              f"{len(run.dates)} composites in a row ({span}){peer_txt}; {g['why']}.{g['nowTxt']} Verify with a field visit.")
    return WaterAbandonment(flag=True, confidence=conf, evidence=ev, provenance=p)


def water_status(ctx: FarmContext, inp: FarmInputs, vs: VegSignals, pc: PeerComparison) -> WaterStatus:
    return WaterStatus(
        irrigated=irrigated(ctx, inp),
        demand=demand(ctx, inp),
        supply=supply(ctx, inp),
        stress=stress(ctx, inp, vs, pc),
        abandonment=abandonment(ctx, inp, vs, pc),
    )
