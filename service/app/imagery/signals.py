"""NDVI/NDMI series with baseline band, peer comparison (§E.9), abandonment (§E.10) and the
dry-season "irrigated?" evidence (§E.11 rung 1). All from native-resolution Sentinel-2 pixels.

Call budget (ADR-0023: <= 8 concurrent calls to PC, ~0.4-0.8 s each):
- farm window: ~80-100 scenes (shared with the imagery timeline, cached forever per item);
- farm history: `baselineYears` years before the window, tile cloud < 50 %, ~40-50 scenes a year;
- peers: nearest MAX_PEERS same-crop CIREN orchards, grouped into shared grids, only the dates the
  reading needs (last ~70 days + the same days of year in the baseline years), under PEER_BUDGET_S
  wall time when cold. nPeers counts the peers actually computed; the note says when the budget cut
  it short. `python -m app.imagery.warm` fills every cache without a budget.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

import numpy as np

from app import provenance as prov, store
from app.models import Farm, PeerComparison, Portfolio, Provenance, Series, SeriesPoint, WaterAbandonment

from . import ctx, s2, series as ser
from .geo import (Grid, as_shape, bbox_of, bbox_polygon, circle_polygon, grid_for_bbox, grid_for_polygon,
                  padded_bbox, polygon_mask)
from .obs import FetchReport, Obs, Target, collect, mark_spikes
from .timeline import build_stack, poly_key, search_bbox

log = logging.getLogger("clm.imagery")

MAX_PEERS = 8
PEER_BUDGET_S = 75.0
CLUSTER_MAX_M = 800.0
PEER_RECENT_DAYS = 40
MEMO_TTL_S = 900.0

_memo: dict[Any, tuple[float, Any]] = {}
_memo_lock = threading.Lock()
_key_locks: dict[Any, threading.Lock] = {}


def _memoised(key: Any, fn):
    with _memo_lock:
        hit = _memo.get(key)
        if hit and time.monotonic() - hit[0] < MEMO_TTL_S:
            return hit[1]
        lk = _key_locks.setdefault(key, threading.Lock())
    with lk:  # one computation per key at a time (svc-risk may ask for ndvi and ndmi in parallel)
        with _memo_lock:
            hit = _memo.get(key)
            if hit and time.monotonic() - hit[0] < MEMO_TTL_S:
                return hit[1]
        val = fn()
        with _memo_lock:
            _memo[key] = (time.monotonic(), val)
        return val


def clear_memo() -> None:
    with _memo_lock:
        _memo.clear()


# ───────────────────────── farm observations (window + history) ─────────────────────────


@dataclass
class FarmObs:
    obs: list[Obs]
    report: FetchReport
    window_items: int
    history_items: int
    search_errors: list[str] = field(default_factory=list)


def _history_range(as_of: date, years: int) -> tuple[date, date]:
    ws = ser.window_start(as_of)
    return ser.years_before(ws, years) - timedelta(days=ser.BASELINE_HALF_DAYS), ws - timedelta(days=ser.CONTEXT_DAYS + 1)


def farm_obs(farm: Farm, as_of: date, years: int, deadline: float | None = None) -> FarmObs:
    def run() -> FarmObs:
        stack = build_stack(farm, as_of)
        rep = FetchReport(fetched=0, failed=stack.failed, stale=stack.stale, latest_fetch=stack.fetched_at,
                          errors=list(stack.errors[:5]))
        h0, h1 = _history_range(as_of, years)
        res = s2.search(search_bbox(tuple(farm.centroid)), h0, h1)
        items = s2.select_per_date(res.items, as_shape(farm.polygon), s2.HISTORY_MAX_CLOUD)
        grid = stack.grid
        tgt = Target(poly_key(farm.polygon, grid), stack.poly_mask)
        have, hrep = collect(items, grid, [tgt], s2.HISTORY_BANDS, deadline=deadline)
        rep.merge(hrep)
        obs = list(stack.obs.values()) + list(have[tgt.key].values())
        for o in obs:
            o.spike = False
        mark_spikes(obs)
        return FarmObs(obs, rep, len(stack.items), len(items), list(stack.search_errors) + list(res.errors))

    key = ("farm_obs", poly_key(farm.polygon, grid_for_polygon(farm.polygon)), as_of, years)
    out = _memoised(key, run)
    if out.report.skipped_budget:  # incomplete: do not keep it memoised
        with _memo_lock:
            _memo.pop(key, None)
    return out


def _series_model(variable: str, pts: list[ser.Point], fo: FarmObs, years: int, data_tier: str) -> Series:
    usable = [o for o in fo.obs if o.usable]
    if not pts or (fo.window_items == 0 and fo.search_errors):
        return Series(variable=variable, unit="index", points=[],
                      provenance=prov.unavailable(s2.SOURCE, "; ".join(fo.search_errors[:2]) or "no Sentinel-2 scenes",
                                                  data_tier=data_tier))
    with_base = sum(1 for p in pts if p.p50 is not None)
    notes = [f"Polygon mean of native pixels ({'NDVI B08/B04, 10 m' if variable == 'ndvi' else 'NDMI B8A/B11, 20 m'}), "
             f"SCL-masked, scenes with polygon clear >= 0.5; 5-day grid, weighted Whittaker (lambda 500); "
             f"null beyond {ser.MAX_GAP_DAYS} days from a clear scene. Baseline: same day of year ±{ser.BASELINE_HALF_DAYS} d "
             f"in the previous {years} years ({sum(1 for o in usable)} usable scenes; band on {with_base}/{len(pts)} dates)"]
    if fo.report.skipped_budget:
        notes.append(f"history incomplete: {fo.report.skipped_budget} scene(s) not fetched yet (time budget); retry fills the cache")
    if fo.report.failed:
        notes.append(f"{fo.report.failed} scene(s) failed to download and were skipped")
    last = max((o.date for o in usable), default=None)
    p = prov.build(s2.SOURCE, observed_at=last, fetched_at=fo.report.latest_fetch, stale=fo.report.stale,
                   note="; ".join(notes), data_tier=data_tier, resolution="10 m" if variable == "ndvi" else "20 m")
    points = [SeriesPoint(date=x.date.isoformat(), value=None if x.value is None else round(x.value, 3),
                          p10=None if x.p10 is None else round(x.p10, 3), p50=None if x.p50 is None else round(x.p50, 3),
                          p90=None if x.p90 is None else round(x.p90, 3), estimated=bool(x.estimated))
              for x in pts]
    return Series(variable=variable, unit="index", points=points, provenance=p)


def farm_points(farm: Farm, variable: str, start: date, end: date, years: int, evergreen: bool,
                deadline: float | None = None) -> tuple[list[ser.Point], FarmObs]:
    fo = farm_obs(farm, end, years, deadline)
    pts = ser.compute(fo.obs, variable, start, end, years, ser.sd_floor_for(evergreen))
    return pts, fo


def vegetation_series(farm: Farm, variable: str, start: date, end: date, baseline_years: int = 5,
                      country: str = "CL", evergreen: bool | None = None) -> Series:
    if variable not in ("ndvi", "ndmi"):
        raise ValueError(f"imagery series supports ndvi/ndmi, not {variable!r}")
    ev = ctx.evergreen(None, farm) if evergreen is None else evergreen
    pts, fo = farm_points(farm, variable, start, end, baseline_years, ev)
    return _series_model(variable, pts, fo, baseline_years, prov.data_tier_for(country))


def farm_persistent_z(farm: Farm, variable: str, as_of: date, years: int, evergreen: bool) -> tuple[float | None, list[ser.Point]]:
    pts, _fo = farm_points(farm, variable, ser.window_start(as_of), as_of, years, evergreen)
    return ser.persistent_z(pts, as_of), pts


# ───────────────────────── peers (§E.9) ─────────────────────────


@dataclass
class PeerResult:
    zone_id: str
    candidates: int
    peers: list[dict]  # {id, ndvi_z, ndmi_z, points_ndvi}
    note: str | None
    report: FetchReport
    ciren_note: str | None = None


def _clusters(peers: list[dict]) -> list[list[dict]]:
    out: list[list[dict]] = []
    for p in peers:
        placed = False
        for c in out:
            bb = bbox_of([q["geometry"] for q in c] + [p["geometry"]])
            g = grid_for_bbox(padded_bbox(bb))
            if g.width * 10 <= CLUSTER_MAX_M and g.height * 10 <= CLUSTER_MAX_M:
                c.append(p)
                placed = True
                break
        if not placed:
            out.append([p])
    return out


def _peer_dates(as_of: date, years: int, spans: list[tuple[date, date]]) -> tuple[list[tuple[date, date]], list[tuple[date, date]]]:
    """(recent ranges, history ranges) of acquisition dates needed for z on grid dates in `spans`."""
    recent, hist = [], []
    for a, b in spans:
        recent.append((a - timedelta(days=ser.CONTEXT_DAYS), b))
        for k in range(1, years + 1):
            hist.append((ser.years_before(a, k) - timedelta(days=ser.BASELINE_HALF_DAYS),
                         ser.years_before(b, k) + timedelta(days=ser.BASELINE_HALF_DAYS)))
    return recent, hist


def _in_ranges(d: date, ranges: list[tuple[date, date]]) -> bool:
    return any(a <= d <= b for a, b in ranges)


def peer_z(portfolio: Portfolio | None, farm: Farm, as_of: date, spans: list[tuple[date, date]],
           years: int, evergreen: bool, deadline: float | None) -> PeerResult:
    """Peers' NDVI/NDMI series (same method as the farm) over the grid dates in `spans`."""
    zone = ctx.effective_zone(portfolio, farm)
    cands, ciren_note = ctx.find_peers(farm, zone, max_peers=20)
    farm_shape = as_shape(farm.polygon)
    clean = []
    for p in cands:
        try:
            s = as_shape(p["geometry"])
            if s.is_empty or (s.intersects(farm_shape) and s.intersection(farm_shape).area > 0.5 * min(s.area, farm_shape.area)):
                continue  # the farm itself under another id
        except Exception:
            continue
        clean.append(p)
    chosen = clean[:MAX_PEERS]
    rep = FetchReport()
    if not chosen:
        return PeerResult(zone.id, len(clean), [], ciren_note, rep, ciren_note)
    lo = min(ser.years_before(a, years) for a, _ in spans) - timedelta(days=ser.BASELINE_HALF_DAYS + ser.CONTEXT_DAYS)
    hi = max(b for _, b in spans)
    res = s2.search(search_bbox(tuple(farm.centroid)), lo, hi)
    recent_r, hist_r = _peer_dates(as_of, years, spans)
    computed: list[dict] = []
    for cl in _clusters(chosen):
        bb = padded_bbox(bbox_of([q["geometry"] for q in cl]))
        grid = grid_for_bbox(bb)
        target_shape = as_shape(bbox_polygon(bb))
        rec = [i for i in s2.select_per_date(res.items, target_shape, s2.RECENT_PEER_MAX_CLOUD) if _in_ranges(i.date, recent_r)]
        his = [i for i in s2.select_per_date(res.items, target_shape, s2.HISTORY_MAX_CLOUD) if _in_ranges(i.date, hist_r)
               and not _in_ranges(i.date, recent_r)]
        targets = [Target(f"{store.polygon_hash(q['geometry'])}:{grid.key}", polygon_mask(q["geometry"], grid)) for q in cl]
        have, r = collect(rec + his, grid, targets, s2.HISTORY_BANDS, deadline=deadline)
        rep.merge(r)
        for q, t in zip(cl, targets):
            obs = list(have[t.key].values())
            mark_spikes(obs)
            out = {"id": q["id"], "ndvi": [], "ndmi": []}
            for var in ("ndvi", "ndmi"):
                for a, b in spans:
                    out[var].extend(ser.compute(obs, var, a, b, years, ser.sd_floor_for(evergreen)))
            computed.append(out)
    note = None
    if rep.skipped_budget:
        note = (f"time budget reached: {rep.skipped_budget} peer scene(s) not fetched yet; peers with no z are left out "
                f"(run `python -m app.imagery.warm` or retry to complete)")
    return PeerResult(zone.id, len(clean), computed, note, rep, ciren_note)


def reading(n: int, farm_z: float | None, peer_med: float | None) -> str:
    """§E.9."""
    if n < 3:
        return "insufficient_peers"
    if peer_med is not None and peer_med <= -1.0:
        return "zone_wide"
    if farm_z is not None and peer_med is not None and farm_z <= -1.0 and farm_z - peer_med <= -1.0:
        return "farm_specific"
    return "normal"


def peers(portfolio: Portfolio, farm: Farm, as_of: date, budget_s: float | None = PEER_BUDGET_S) -> PeerComparison:
    data_tier = prov.data_tier_for(portfolio.country)
    zone = ctx.effective_zone(portfolio, farm)
    if data_tier != "enhanced":
        return PeerComparison(zone_id=zone.id, n_peers=0, reading="insufficient_peers",
                              provenance=prov.unavailable("ciren_catastro", "zone peers use CIREN orchards (Chile only); "
                                                          "not available in the standard tier", data_tier=data_tier))
    years = ctx.baseline_years(portfolio, farm)
    ev = ctx.evergreen(portfolio, farm)

    def run() -> PeerComparison:
        fz_n, _ = farm_persistent_z(farm, "ndvi", as_of, years, ev)
        fz_m, _ = farm_persistent_z(farm, "ndmi", as_of, years, ev)
        deadline = time.monotonic() + budget_s if budget_s else None
        span = (as_of - timedelta(days=PEER_RECENT_DAYS), as_of)
        pr = peer_z(portfolio, farm, as_of, [span], years, ev, deadline)
        zn, zm = [], []
        for p in pr.peers:
            a = ser.persistent_z(p["ndvi"], as_of)
            b = ser.persistent_z(p["ndmi"], as_of)
            if a is not None:
                zn.append(a)
                if b is not None:
                    zm.append(b)
        n = len(zn)
        med_n = float(np.median(zn)) if zn else None
        med_m = float(np.median(zm)) if zm else None
        notes = [f"{n} of {min(pr.candidates, MAX_PEERS)} nearest same-crop CIREN orchards in zone {pr.zone_id} with a z "
                 f"({pr.candidates} found, max {MAX_PEERS} used); z = persistent NDVI/NDMI z vs each orchard's own "
                 f"{years}-year same-date history, native 10 m Sentinel-2"]
        if pr.ciren_note:
            notes.append(pr.ciren_note)
        if pr.note:
            notes.append(pr.note)
        inputs = [prov.build(s2.SOURCE, fetched_at=pr.report.latest_fetch, stale=pr.report.stale, observed_at=as_of)]
        inputs.append(prov.build("ciren_catastro"))
        p = prov.derived("; ".join(notes), inputs=inputs, data_tier=data_tier)
        return PeerComparison(
            zone_id=pr.zone_id, n_peers=n,
            farm_ndvi_z=None if fz_n is None else round(fz_n, 2),
            peer_median_ndvi_z=None if med_n is None else round(med_n, 2),
            farm_ndmi_z=None if fz_m is None else round(fz_m, 2),
            peer_median_ndmi_z=None if med_m is None else round(med_m, 2),
            reading=reading(n, fz_n, med_n), provenance=p)

    key = ("peers", poly_key(farm.polygon, grid_for_polygon(farm.polygon)), zone.id, zone.center, as_of, years)
    out = _memoised(key, run)
    if "time budget reached" in (out.provenance.note or ""):
        with _memo_lock:
            _memo.pop(key, None)
    return out


# ───────────────────────── vigour signals (§E.10, §E.11 rung 1) ─────────────────────────


def dry_season(as_of: date, window_start: date) -> tuple[date, date] | None:
    """Most recent 1 Dec - 30 Apr inside the window, clipped to [window_start, as_of]."""
    for y in range(as_of.year + 1, as_of.year - 3, -1):
        a, b = date(y - 1, 12, 1), date(y, 4, 30)
        if a <= as_of and b >= window_start:
            return max(a, window_start), min(b, as_of)
    return None


def _runs(pts: list[ser.Point], thr: float = -2.0, min_len: int = 3) -> list[list[ser.Point]]:
    runs, cur = [], []
    for p in pts:
        if p.z is not None and p.z <= thr:
            cur.append(p)
        else:
            if len(cur) >= min_len:
                runs.append(cur)
            cur = []
    if len(cur) >= min_len:
        runs.append(cur)
    return runs


def _fmt(d: date) -> str:
    return f"{d.day} {d.strftime('%b')} {d.year}"


#: §E.10 v1.1 guard (CONTRACT §E.10 note): a z run alone is not "irrigation stopped". It also needs an
#: absolute canopy collapse during the run and no recovery since.
COLLAPSE_NDVI = 0.30          # run mean NDVI below this ≈ bare soil / dead canopy
COLLAPSE_FRACTION_OF_P50 = 0.6  # or the run mean NDVI ≤ 60 % of its baseline median (a fall of ≥ 40 %)
RECOVERED_Z = -1.0            # current persistent z above this = vigour has recovered


def collapse_guard(run: list, z_now: float | None, pts: list, as_of: date,
                   last_obs: tuple[date, float] | None = None) -> dict:
    """Return {confirmed, runNdvi, why, nowTxt}. `run` and `pts` are points with .value/.p50/.z/.date;
    `last_obs` = (acquisition date, NDVI) of the latest clear scene when known (else the latest clear composite)."""
    vals = [float(p.value) for p in run if getattr(p, "value", None) is not None]
    p50s = [float(p.p50) for p in run if getattr(p, "p50", None) is not None]
    run_ndvi = float(np.mean(vals)) if vals else None
    run_p50 = float(np.mean(p50s)) if p50s else None
    collapsed = run_ndvi is not None and (
        run_ndvi < COLLAPSE_NDVI or (run_p50 is not None and run_p50 > 0 and run_ndvi <= COLLAPSE_FRACTION_OF_P50 * run_p50))
    recovered = z_now is not None and z_now > RECOVERED_Z
    if last_obs is None:
        clear = [p for p in pts if getattr(p, "value", None) is not None and not getattr(p, "estimated", False)
                 and p.date <= as_of]
        last_obs = (clear[-1].date, float(clear[-1].value)) if clear else None
    now_txt = ""
    if last_obs is not None or z_now is not None:
        bits = []
        if last_obs is not None:
            bits.append(f"latest clear NDVI {last_obs[1]:.2f} on {_fmt(last_obs[0])}")
        if z_now is not None:
            bits.append(f"persistent z now {z_now:.1f}")
        now_txt = " Now: " + ", ".join(bits) + ("; vigour has since recovered" if recovered else "") + "."
    why = []
    if run_ndvi is not None and not collapsed:
        why.append(f"the canopy stayed green (mean NDVI {run_ndvi:.2f}"
                   + (f" vs a usual {run_p50:.2f}" if run_p50 is not None else "")
                   + f"; bare soil is below {COLLAPSE_NDVI:.2f})")
    if run_ndvi is None:
        why.append("no NDVI values for the run")
    if recovered:
        why.append(f"vigour has since recovered (persistent z {z_now:.1f})")
    return {"confirmed": bool(collapsed and not recovered), "runNdvi": run_ndvi if run_ndvi is not None else float("nan"),
            "why": " and ".join(why) or "not confirmed", "nowTxt": now_txt}


def abandonment(portfolio: Portfolio, farm: Farm, as_of: date, pc: PeerComparison | None = None,
                budget_s: float | None = PEER_BUDGET_S) -> WaterAbandonment:
    data_tier = prov.data_tier_for(portfolio.country)
    years = ctx.baseline_years(portfolio, farm)
    ev = ctx.evergreen(portfolio, farm)
    ws = ser.window_start(as_of)
    season = dry_season(as_of, ws)
    _z, pts = farm_persistent_z(farm, "ndvi", as_of, years, ev)
    fo = farm_obs(farm, as_of, years)
    base_p = prov.build(s2.SOURCE, observed_at=max((o.date for o in fo.obs if o.usable), default=None),
                        fetched_at=fo.report.latest_fetch, stale=fo.report.stale, data_tier=data_tier)
    if season is None:
        return WaterAbandonment(flag=False, confidence="low", evidence="No dry season (1 Dec – 30 Apr) inside the window.",
                                provenance=prov.derived("§E.10 abandonment", inputs=[base_p], data_tier=data_tier))
    sp = [p for p in pts if season[0] <= p.date <= season[1]]
    valid = [p for p in sp if p.z is not None]
    share = len(valid) / len(sp) if sp else 0.0
    runs = _runs(sp)
    label = f"Dry season {_fmt(season[0])} – {_fmt(season[1])}"
    if pc is None:
        pc = peers(portfolio, farm, as_of, budget_s)
    if not runs:
        zmin = min((p.z for p in valid), default=None)
        conf = "low" if share < 0.8 else ("medium" if pc.n_peers < 3 else "high")
        ev_txt = (f"{label}: no run of 3 composites with NDVI z ≤ −2.0"
                  + (f" (lowest z {zmin:.1f})" if zmin is not None else "")
                  + f"; {len(valid)}/{len(sp)} composites valid.")
        return WaterAbandonment(flag=False, confidence=conf, evidence=ev_txt,
                                provenance=prov.derived("§E.10: NDVI z vs own history; peers for context",
                                                        inputs=[base_p, pc.provenance], data_tier=data_tier))
    run = min(runs, key=lambda r: float(np.mean([p.z for p in r])))
    farm_mean = float(np.mean([p.z for p in run]))
    span = (run[0].date, run[-1].date)
    if data_tier == "enhanced":
        deadline = time.monotonic() + budget_s if budget_s else None
        pr = peer_z(portfolio, farm, as_of, [span], years, ev, deadline)
        peer_means = []
        for p in pr.peers:
            zs = [x.z for x in p["ndvi"] if x.z is not None and span[0] <= x.date <= span[1]]
            if zs:
                peer_means.append(float(np.mean(zs)))
        n = len(peer_means)
        med = float(np.median(peer_means)) if peer_means else None
        peer_note = pr.note or pr.ciren_note
    else:
        n, med, peer_note = 0, None, "zone peers are Chile-only (standard tier)"
    rd = reading(n, farm_mean, med)
    flag = rd != "zone_wide"
    if flag:
        if n >= 3 and med is not None and farm_mean - med <= -1.5:
            conf = "high"
        elif n < 3:
            conf = "medium"
        else:
            conf = "low"
        clear_obs = [o for o in fo.obs if o.usable and o.observed and o.ndvi is not None and o.date <= as_of]
        lo = max(clear_obs, key=lambda o: o.date) if clear_obs else None
        last_obs = (lo.date, float(lo.ndvi)) if lo is not None else None
        g = collapse_guard(run, _z, pts, as_of, last_obs)
        peer_txt = (f"; zone peers' median z {med:.1f} (n={n})" if med is not None else
                    f"; too few zone peers to compare (n={n})")
        if g["confirmed"]:
            txt = (f"{label}: NDVI z ≤ −2.0 for {len(run)} composites in a row ({_fmt(span[0])} – {_fmt(span[1])}, "
                   f"mean z {farm_mean:.1f}, mean NDVI {g['runNdvi']:.2f}, near bare soil){peer_txt}.{g['nowTxt']}")
        else:
            conf = "low"
            txt = (f"Vigour loss, not a confirmed stop of irrigation. {label}: NDVI z ≤ −2.0 for {len(run)} composites "
                   f"in a row ({_fmt(span[0])} – {_fmt(span[1])}, mean z {farm_mean:.1f}){peer_txt}; "
                   f"{g['why']}.{g['nowTxt']} Verify with a field visit.")
    else:
        conf = "low"
        txt = (f"{label}: NDVI z ≤ −2.0 for {len(run)} composites ({_fmt(span[0])} – {_fmt(span[1])}), but the whole "
               f"zone was down too (peers' median z {med:.1f}, n={n}): read as weather, not abandonment.")
    note = "§E.10 abandonment: NDVI z vs own history and zone peers" + (f"; {peer_note}" if peer_note else "")
    return WaterAbandonment(flag=flag, confidence=conf, evidence=txt,
                            provenance=prov.derived(note, inputs=[base_p], data_tier=data_tier))


def irrigated_evidence(portfolio: Portfolio, farm: Farm, as_of: date) -> dict:
    """Dry-season vigour test (§E.11 rung 1, second clause): 'yes' when the orchard stays green in
    Jan-Mar while the driest quarter of the zone's land browns; otherwise 'unknown' (never 'no')."""
    data_tier = prov.data_tier_for(portfolio.country)
    years = ctx.baseline_years(portfolio, farm)
    ws = ser.window_start(as_of)
    season = dry_season(as_of, ws)
    zone = ctx.effective_zone(portfolio, farm)
    out = {"value": "unknown", "evidence": "", "farmDryNdvi": None, "zoneP25Ndvi": None, "provenance": None}
    if season is None:
        out["evidence"] = "No dry season inside the window."
        out["provenance"] = prov.unavailable(s2.SOURCE, "no dry season inside the window", data_tier=data_tier)
        return out
    a = max(season[0], date(season[1].year, 1, 1))
    b = min(season[1], date(season[1].year, 3, 31))
    fo = farm_obs(farm, as_of, years)
    dry = [o for o in fo.obs if o.usable and a <= o.date <= b and o.ndvi is not None]
    if not dry:
        out["evidence"] = f"No clear Sentinel-2 view of the orchard between {_fmt(a)} and {_fmt(b)}."
        out["provenance"] = prov.unavailable(s2.SOURCE, "no clear dry-season scene", data_tier=data_tier)
        return out
    farm_med = float(np.median([o.ndvi for o in dry]))
    out["farmDryNdvi"] = round(farm_med, 3)
    # zone reference on the clearest dry-season scenes over the farm (lowest tile cloud first)
    best = sorted([o for o in dry if o.observed], key=lambda o: -o.clear_frac)[:6]
    res = s2.search(search_bbox(tuple(farm.centroid)), a, b)
    by_id = {i.id: i for i in res.items}
    cand = sorted([by_id[o.item_id] for o in best if o.item_id in by_id], key=lambda i: i.cloud)[:2]
    circle = circle_polygon(tuple(zone.center), zone.radius_m or 3338.0)
    p25s, provs, errs = [], [], []
    for it in cand:
        try:
            counts, edges, r = s2.zone_ndvi_histogram(it, circle)
        except Exception as e:
            errs.append(f"{it.date}: {getattr(e, 'reason', e.__class__.__name__)}")
            continue
        tot = counts.sum()
        if tot <= 0:
            continue
        cdf = np.cumsum(counts) / tot
        k = int(np.searchsorted(cdf, 0.25))
        lo, hi = edges[k], edges[k + 1]
        prev = cdf[k - 1] if k > 0 else 0.0
        frac = (0.25 - prev) / max(cdf[k] - prev, 1e-9)
        p25s.append(float(lo + frac * (hi - lo)))
        provs.append(prov.from_fetch(s2.SOURCE, r, observed_at=it.date, data_tier=data_tier))
    if not p25s:
        out["evidence"] = (f"Orchard NDVI in {_fmt(a)} – {_fmt(b)}: median {farm_med:.2f}; the zone reference could not be "
                           f"read ({'; '.join(errs[:2]) or 'no clear scene'}), so irrigation is not inferred.")
        out["provenance"] = prov.derived("dry-season vigour test (zone reference unavailable)", inputs=[], data_tier=data_tier)
        return out
    zp25 = float(np.median(p25s))
    out["zoneP25Ndvi"] = round(zp25, 3)
    # relative to the zone (DC-1): a desert orchard at 0.45 next to bare land at 0.10 is irrigated; the 0.35
    # floor keeps sparse scrub out. Central-Chile browned grassland (~0.30) still needs an orchard >= 0.55.
    green = farm_med >= 0.35 and zp25 <= 0.35 and farm_med - zp25 >= 0.25
    out["value"] = "yes" if green else "unknown"
    if green:
        out["evidence"] = (f"Stayed green in the dry season ({_fmt(a)} – {_fmt(b)}: NDVI median {farm_med:.2f}) while the "
                           f"driest quarter of land in the zone browned (NDVI {zp25:.2f}): irrigated.")
    else:
        out["evidence"] = (f"Dry-season test inconclusive ({_fmt(a)} – {_fmt(b)}): orchard NDVI median {farm_med:.2f}, "
                           f"driest quarter of the zone {zp25:.2f}. 'Yes' needs orchard >= 0.35, zone <= 0.35 and a gap >= 0.25.")
    out["provenance"] = prov.derived("dry-season vigour test: orchard vs the 25th percentile of clear-pixel NDVI in the "
                                     "zone circle (proxy for rain-fed land), native 10 m Sentinel-2",
                                     inputs=provs, data_tier=data_tier)
    return out


def vigour_signals(portfolio: Portfolio, farm: Farm, as_of: date, budget_s: float | None = PEER_BUDGET_S) -> dict:
    """{irrigatedEvidence, abandonment, ndviZ, ndmiZ, ndmiPeerDelta, peers}. See the package doc."""
    data_tier = prov.data_tier_for(portfolio.country)
    years = ctx.baseline_years(portfolio, farm)
    ev = ctx.evergreen(portfolio, farm)
    pc = peers(portfolio, farm, as_of, budget_s)
    ndvi_z, _ = farm_persistent_z(farm, "ndvi", as_of, years, ev)
    ndmi_z, _ = farm_persistent_z(farm, "ndmi", as_of, years, ev)
    delta = None
    if ndmi_z is not None and pc.peer_median_ndmi_z is not None and pc.n_peers >= 3:
        delta = round(ndmi_z - pc.peer_median_ndmi_z, 2)
    try:
        irr = irrigated_evidence(portfolio, farm, as_of)
    except Exception as e:  # never fail the farm on this proxy
        log.warning("irrigated_evidence failed: %r", e)
        irr = {"value": "unknown", "evidence": "Dry-season vigour test failed.", "farmDryNdvi": None, "zoneP25Ndvi": None,
               "provenance": prov.unavailable(s2.SOURCE, f"dry-season test failed ({e.__class__.__name__})", data_tier=data_tier)}
    return {
        "irrigatedEvidence": irr,
        "abandonment": abandonment(portfolio, farm, as_of, pc, budget_s),
        "ndviZ": None if ndvi_z is None else round(ndvi_z, 2),
        "ndmiZ": None if ndmi_z is None else round(ndmi_z, 2),
        "ndmiPeerDelta": delta,
        "peers": pc,
    }
