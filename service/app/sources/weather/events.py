"""Frost, heat and harvest-rain summaries from hourly station data (RAN) or daily grids (CR2MET/ERA5).

These are measurements and counts only; severities/ramps belong to svc-risk (CONTRACT §E.5).
Missing data is unknown, never dry or frost-free (ADR-0004 D1): days carry `n_hours`/`complete`, and
72 h sums with missing hours are flagged `incomplete` (a lower bound).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Iterable

from app.models import Provenance

COMPLETE_HOURS = 18  # a station day with fewer valid hours is "incomplete"


@dataclass
class Hour:
    ts: datetime  # local station time (America/Santiago), naive
    tavg: float | None = None
    precip: float | None = None
    tmin: float | None = None  # hourly minimum
    tmax: float | None = None  # hourly maximum


@dataclass
class WeatherEvents:
    """Return type of frost_events / heat_events / harvest_rain.

    kind          'frost' | 'heat' | 'harvest_rain'
    source_kind   'station_hourly' (RAN) | 'grid_daily' (CR2MET or ERA5 fallback) | 'unavailable'
    station       {id, name, distance_km, lng, lat} for station data, else None
    thresholds    the thresholds counted (°C, or mm for harvest rain)
    summary       see each builder below; keys with threshold suffixes use str(float(thr)), e.g. "-2.0"
    days          one dict per local/UTC day in [start, end]
    events        frost: runs of hours (station) / days (grid) at or below thresholds[0];
                  heat: runs at or above thresholds[0]; harvest_rain: 72 h windows ≥ threshold (if given)
    data_as_of    latest date (station: timestamp) with data, or None
    """

    kind: str
    farm_id: str
    start: date
    end: date
    source_kind: str
    station: dict | None
    thresholds: list[float]
    summary: dict
    days: list[dict]
    events: list[dict]
    provenance: Provenance
    data_as_of: str | None = None
    warnings: list[str] = field(default_factory=list)

    @property
    def available(self) -> bool:
        return self.source_kind != "unavailable"

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["start"] = self.start.isoformat()
        d["end"] = self.end.isoformat()
        d["provenance"] = self.provenance.model_dump(by_alias=True)
        return d


def _k(thr: float) -> str:
    return str(float(thr))


def _dates(start: date, end: date) -> list[date]:
    out, d = [], start
    while d <= end:
        out.append(d)
        d += timedelta(days=1)
    return out


def _runs(flags: list[tuple[Any, bool, float | None]], step: timedelta, better) -> list[dict]:
    """Group consecutive flagged items (ts, flag, value) into events {start, end, n, extreme}."""
    out: list[dict] = []
    cur: dict | None = None
    prev_ts = None
    for ts, flag, v in flags:
        if flag and cur is not None and prev_ts is not None and ts - prev_ts <= step:
            cur["end"] = ts
            cur["n"] += 1
            if v is not None and (cur["extreme"] is None or better(v, cur["extreme"])):
                cur["extreme"] = v
        elif flag:
            cur = {"start": ts, "end": ts, "n": 1, "extreme": v}
            out.append(cur)
        else:
            cur = None
        prev_ts = ts if flag else prev_ts
    return out


def _iso(x: Any) -> str:
    return x.isoformat(sep=" ") if isinstance(x, datetime) else x.isoformat()


# ───────────────────────── hourly (station) ─────────────────────────


def frost_hourly(hours: list[Hour], start: date, end: date, thresholds: Iterable[float]) -> dict:
    thr = [float(t) for t in thresholds]
    hs = sorted((h for h in hours if start <= h.ts.date() <= end and h.tmin is not None), key=lambda h: h.ts)
    days = []
    for d in _dates(start, end):
        dh = [h for h in hs if h.ts.date() == d]
        days.append({
            "date": d.isoformat(),
            "min_c": min((h.tmin for h in dh), default=None),
            "n_hours": len(dh),
            "complete": len(dh) >= COMPLETE_HOURS,
            "hours_at_or_below": {_k(t): sum(1 for h in dh if h.tmin <= t) for t in thr},
        })
    lowest = min(hs, key=lambda h: h.tmin, default=None)
    runs = _runs([(h.ts, h.tmin <= thr[0], h.tmin) for h in hs], timedelta(hours=1), lambda a, b: a < b) if thr else []
    summary = {
        "min_c": lowest.tmin if lowest else None,
        "min_at": _iso(lowest.ts) if lowest else None,
        "hours_at_or_below": {_k(t): sum(1 for h in hs if h.tmin <= t) for t in thr},
        "days_at_or_below": {_k(t): sum(1 for d in days if d["min_c"] is not None and d["min_c"] <= t) for t in thr},
        "n_hours": len(hs),
        "expected_hours": 24 * len(days),
    }
    events = [{"start": _iso(r["start"]), "end": _iso(r["end"]), "hours": r["n"], "min_c": r["extreme"]} for r in runs]
    return {"summary": summary, "days": days, "events": events,
            "data_as_of": _iso(hs[-1].ts) if hs else None}


def heat_hourly(hours: list[Hour], start: date, end: date, thresholds: Iterable[float]) -> dict:
    thr = [float(t) for t in thresholds]
    hs = sorted((h for h in hours if start <= h.ts.date() <= end and h.tmax is not None), key=lambda h: h.ts)
    days = []
    for d in _dates(start, end):
        dh = [h for h in hs if h.ts.date() == d]
        days.append({
            "date": d.isoformat(),
            "max_c": max((h.tmax for h in dh), default=None),
            "n_hours": len(dh),
            "complete": len(dh) >= COMPLETE_HOURS,
            "hours_at_or_above": {_k(t): sum(1 for h in dh if h.tmax >= t) for t in thr},
            "degree_hours_above": {_k(t): round(sum(max(0.0, h.tmax - t) for h in dh), 2) for t in thr},
        })
    hottest = max(hs, key=lambda h: h.tmax, default=None)
    runs = _runs([(h.ts, h.tmax >= thr[0], h.tmax) for h in hs], timedelta(hours=1), lambda a, b: a > b) if thr else []
    summary = {
        "max_c": hottest.tmax if hottest else None,
        "max_at": _iso(hottest.ts) if hottest else None,
        "hours_at_or_above": {_k(t): sum(1 for h in hs if h.tmax >= t) for t in thr},
        "degree_hours_above": {_k(t): round(sum(max(0.0, h.tmax - t) for h in hs), 2) for t in thr},
        "days_at_or_above": {_k(t): sum(1 for d in days if d["max_c"] is not None and d["max_c"] >= t) for t in thr},
        "n_hours": len(hs),
        "expected_hours": 24 * len(days),
    }
    events = [{"start": _iso(r["start"]), "end": _iso(r["end"]), "hours": r["n"], "max_c": r["extreme"]} for r in runs]
    return {"summary": summary, "days": days, "events": events,
            "data_as_of": _iso(hs[-1].ts) if hs else None}


def rain_hourly(hours: list[Hour], start: date, end: date, threshold_mm: float | None = None) -> dict:
    """72 h sums for windows ENDING in [start, end] (so rain up to 71 h before start counts)."""
    t0 = datetime.combine(start, datetime.min.time()) - timedelta(hours=71)
    t1 = datetime.combine(end, datetime.max.time())
    by_ts = {h.ts.replace(minute=0, second=0, microsecond=0): h.precip for h in hours
             if h.precip is not None and t0 <= h.ts <= t1}
    windows = []  # (end_ts, sum, n_hours)
    ts = datetime.combine(start, datetime.min.time())
    while ts <= t1:
        vals = [by_ts.get(ts - timedelta(hours=k)) for k in range(72)]
        got = [v for v in vals if v is not None]
        if got:
            windows.append((ts, round(sum(got), 2), len(got)))
        ts += timedelta(hours=1)
    days = []
    for d in _dates(start, end):
        dv = [v for t, v in by_ts.items() if t.date() == d]
        dw = [w for w in windows if w[0].date() == d]
        best = max(dw, key=lambda w: w[1], default=None)
        days.append({
            "date": d.isoformat(),
            "precip_mm": round(sum(dv), 2) if dv else None,
            "n_hours": len(dv),
            "complete": len(dv) >= COMPLETE_HOURS,
            "max_72h_mm": best[1] if best else None,
        })
    best = max(windows, key=lambda w: w[1], default=None)
    in_range = [v for t, v in by_ts.items() if start <= t.date() <= end]
    summary = {
        "max_72h_mm": best[1] if best else None,
        "max_72h_end": _iso(best[0]) if best else None,
        "max_72h_incomplete": bool(best and best[2] < 72),
        "total_mm": round(sum(in_range), 2) if in_range else None,
        "days_ge_10mm": sum(1 for d in days if d["precip_mm"] is not None and d["precip_mm"] >= 10),
        "n_hours": len(in_range),
        "expected_hours": 24 * len(days),
    }
    events = []
    if threshold_mm is not None:
        runs = _runs([(w[0], w[1] >= threshold_mm, w[1]) for w in windows], timedelta(hours=1), lambda a, b: a > b)
        events = [{"start": _iso(r["start"]), "end": _iso(r["end"]), "hours": r["n"], "max_72h_mm": r["extreme"]} for r in runs]
    last = max(by_ts) if by_ts else None
    return {"summary": summary, "days": days, "events": events, "data_as_of": _iso(last) if last else None}


# ───────────────────────── daily (grid) ─────────────────────────


def frost_daily(tmin: dict[date, float | None], start: date, end: date, thresholds: Iterable[float]) -> dict:
    thr = [float(t) for t in thresholds]
    ds = _dates(start, end)
    vals = [(d, tmin.get(d)) for d in ds]
    have = [(d, v) for d, v in vals if v is not None]
    lowest = min(have, key=lambda x: x[1], default=None)
    days = [{"date": d.isoformat(), "min_c": v, "at_or_below": {_k(t): (v is not None and v <= t) for t in thr}} for d, v in vals]
    runs = _runs([(d, v <= thr[0], v) for d, v in have], timedelta(days=1), lambda a, b: a < b) if thr else []
    summary = {
        "min_c": lowest[1] if lowest else None,
        "min_at": lowest[0].isoformat() if lowest else None,
        "hours_at_or_below": None,  # daily data: no hours
        "days_at_or_below": {_k(t): sum(1 for _, v in have if v <= t) for t in thr},
        "n_days": len(have),
        "expected_days": len(ds),
    }
    events = [{"start": r["start"].isoformat(), "end": r["end"].isoformat(), "days": r["n"], "min_c": r["extreme"]} for r in runs]
    return {"summary": summary, "days": days, "events": events,
            "data_as_of": have[-1][0].isoformat() if have else None}


def heat_daily(tmax: dict[date, float | None], start: date, end: date, thresholds: Iterable[float]) -> dict:
    thr = [float(t) for t in thresholds]
    ds = _dates(start, end)
    vals = [(d, tmax.get(d)) for d in ds]
    have = [(d, v) for d, v in vals if v is not None]
    hottest = max(have, key=lambda x: x[1], default=None)
    days = [{"date": d.isoformat(), "max_c": v, "at_or_above": {_k(t): (v is not None and v >= t) for t in thr}} for d, v in vals]
    runs = _runs([(d, v >= thr[0], v) for d, v in have], timedelta(days=1), lambda a, b: a > b) if thr else []
    summary = {
        "max_c": hottest[1] if hottest else None,
        "max_at": hottest[0].isoformat() if hottest else None,
        "hours_at_or_above": None,
        "degree_hours_above": None,
        "degree_days_above": {_k(t): round(sum(max(0.0, v - t) for _, v in have), 2) for t in thr},
        "days_at_or_above": {_k(t): sum(1 for _, v in have if v >= t) for t in thr},
        "n_days": len(have),
        "expected_days": len(ds),
    }
    events = [{"start": r["start"].isoformat(), "end": r["end"].isoformat(), "days": r["n"], "max_c": r["extreme"]} for r in runs]
    return {"summary": summary, "days": days, "events": events,
            "data_as_of": have[-1][0].isoformat() if have else None}


def rain_daily(precip: dict[date, float | None], start: date, end: date, threshold_mm: float | None = None) -> dict:
    """72 h = 3 daily totals ending on each day of [start, end] (the 2 days before start count)."""
    ds = _dates(start, end)
    days, sums = [], []
    for d in ds:
        three = [precip.get(d - timedelta(days=k)) for k in range(3)]
        got = [v for v in three if v is not None]
        s = round(sum(got), 2) if got else None
        sums.append((d, s, len(got)))
        days.append({"date": d.isoformat(), "precip_mm": precip.get(d), "max_72h_mm": s, "complete": len(got) == 3})
    have = [x for x in sums if x[1] is not None]
    best = max(have, key=lambda x: x[1], default=None)
    in_range = [precip.get(d) for d in ds if precip.get(d) is not None]
    summary = {
        "max_72h_mm": best[1] if best else None,
        "max_72h_end": best[0].isoformat() if best else None,
        "max_72h_incomplete": bool(best and best[2] < 3),
        "total_mm": round(sum(in_range), 2) if in_range else None,
        "days_ge_10mm": sum(1 for v in in_range if v >= 10),
        "n_days": len(in_range),
        "expected_days": len(ds),
    }
    events = []
    if threshold_mm is not None:
        runs = _runs([(d, s >= threshold_mm, s) for d, s, _ in have], timedelta(days=1), lambda a, b: a > b)
        events = [{"start": r["start"].isoformat(), "end": r["end"].isoformat(), "days": r["n"], "max_72h_mm": r["extreme"]} for r in runs]
    last = max((d for d in precip if precip[d] is not None and d <= end), default=None)
    return {"summary": summary, "days": days, "events": events, "data_as_of": last.isoformat() if last else None}
