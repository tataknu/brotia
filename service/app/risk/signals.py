"""Signal extraction from series (pure): last-7-day extremes, 72 h rain, chill hours, NDVI/NDMI z,
persistent z, abandonment run detection, stress level (CONTRACT §E.5, §E.6, §E.10, §E.11).

Every function reads only native-resolution series values (trust rule). None = not computable.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import date, timedelta

from app.models import Series, SeriesPoint

#: Max age (days) of the latest observation for a "last 7 days" signal to count as current.
MAX_LAG_DAYS = 10
#: z floor for the NDVI/NDMI sd (§E.6): deciduous 0.05, avocado (evergreen) 0.035.
Z_FLOOR = 0.05
Z_FLOOR_EVERGREEN = 0.035
#: (p90 − p10) of a normal distribution = 2·1.2816·sd.
P10_P90_SD = 2.5631
CHILL_BASE_C = 7.2


def d(s: str) -> date:
    return date.fromisoformat(s[:10])


def valid_points(series: Series | None, end: date | None = None) -> list[SeriesPoint]:
    if series is None:
        return []
    out = [p for p in series.points if p.value is not None]
    if end is not None:
        out = [p for p in out if d(p.date) <= end]
    return out


def anchor_date(series: Series | None, as_of: date, max_lag: int = MAX_LAG_DAYS) -> date | None:
    """Latest date ≤ as_of with a non-null value, if not older than max_lag days."""
    pts = valid_points(series, as_of)
    if not pts:
        return None
    a = max(d(p.date) for p in pts)
    return a if (as_of - a).days <= max_lag else None


def latest_date(series: Series | None, as_of: date | None = None, observed_only: bool = False) -> str | None:
    pts = valid_points(series, as_of)
    if observed_only:
        pts = [p for p in pts if not p.estimated]
    return max((p.date[:10] for p in pts), default=None)


@dataclass
class Extreme:
    value: float
    on: date
    anchor: date


def window_extreme(series: Series | None, as_of: date, kind: str, days: int = 7) -> Extreme | None:
    """min ('min') or max ('max') daily value over the `days` days ending at the anchor date."""
    a = anchor_date(series, as_of)
    if a is None:
        return None
    start = a - timedelta(days=days - 1)
    pts = [p for p in valid_points(series, a) if d(p.date) >= start]
    if not pts:
        return None
    pick = min(pts, key=lambda p: p.value) if kind == "min" else max(pts, key=lambda p: p.value)
    return Extreme(float(pick.value), d(pick.date), a)


def max_rain_72h(series: Series | None, as_of: date) -> Extreme | None:
    """Max 3-day rain sum over windows lying inside the 7 days ending at the anchor (§E.5).
    A 3-day window needs all three days valid. `on` = last day of the wettest window."""
    a = anchor_date(series, as_of)
    if a is None:
        return None
    vals = {d(p.date): float(p.value) for p in valid_points(series, a)}
    best: Extreme | None = None
    for end_off in range(0, 5):  # windows ending at a, a-1, ..., a-4 (all inside a-6..a)
        e = a - timedelta(days=end_off)
        days_ = [e - timedelta(days=i) for i in range(3)]
        if all(x in vals for x in days_):
            s = sum(vals[x] for x in days_)
            if best is None or s > best.value:
                best = Extreme(round(s, 1), e, a)
    return best


def window_sum(series: Series | None, as_of: date, days: int, min_valid: float = 0.8) -> tuple[float, date, bool] | None:
    """Sum over the `days` days ending at the anchor. With missing days (≥ min_valid present) the sum is
    scaled up and flagged estimated. Returns (sum, anchor, estimated)."""
    a = anchor_date(series, as_of)
    if a is None:
        return None
    start = a - timedelta(days=days - 1)
    pts = [p for p in valid_points(series, a) if d(p.date) >= start]
    n = len({p.date[:10] for p in pts})
    if n < min_valid * days:
        return None
    s = sum(float(p.value) for p in pts)
    est = n < days or any(bool(p.estimated) for p in pts)
    return (s * days / n if n < days else s), a, est


def window_days_present(series: Series | None, as_of: date, days: int) -> int:
    """Days with a value in the `days`-day window window_sum() uses (for its 'scaled' note)."""
    a = anchor_date(series, as_of)
    if a is None:
        return 0
    start = a - timedelta(days=days - 1)
    return len({p.date[:10] for p in valid_points(series, a) if d(p.date) >= start})


# ───────────────────────── chill ─────────────────────────

@dataclass
class Chill:
    hours: float
    start: date
    end: date
    valid_days: int
    total_days: int
    in_progress: bool


def chill_period(as_of: date) -> tuple[date, date, bool]:
    """1 May to min(as_of, 31 Aug) of the latest winter (southern hemisphere). in_progress when as_of
    falls inside May–Aug."""
    y = as_of.year if as_of >= date(as_of.year, 5, 1) else as_of.year - 1
    start, end = date(y, 5, 1), date(y, 8, 31)
    return start, min(end, as_of), as_of < end


def daily_chill_hours(tmin: float, tmax: float, base: float = CHILL_BASE_C) -> float:
    """Hours below `base` from daily Tmin/Tmax with a linear (triangular) diurnal curve. An estimate:
    hourly station data are better (labelled estimated by the caller)."""
    if tmax <= base:
        return 24.0
    if tmin >= base:
        return 0.0
    return 24.0 * (base - tmin) / (tmax - tmin)


def chill_hours_estimate(tmin: Series | None, tmax: Series | None, as_of: date, min_valid: float = 0.8) -> Chill | None:
    start, end, in_progress = chill_period(as_of)
    lo = {p.date[:10]: float(p.value) for p in valid_points(tmin, end) if d(p.date) >= start}
    hi = {p.date[:10]: float(p.value) for p in valid_points(tmax, end) if d(p.date) >= start}
    days = [k for k in lo if k in hi]
    total = (end - start).days + 1
    if total <= 0 or len(days) < min_valid * total:
        return None
    h = sum(daily_chill_hours(lo[k], hi[k]) for k in days)
    h = h * total / len(days)
    return Chill(round(h), start, end, len(days), total, in_progress)


# ───────────────────────── vegetation z ─────────────────────────

@dataclass
class ZPoint:
    date: date
    z: float
    estimated: bool


def z_points(series: Series | None, evergreen: bool = False, end: date | None = None) -> list[ZPoint]:
    """z = (v − mean)/max(sd, floor) with mean ≈ p50 and sd ≈ (p90 − p10)/2.563 from the baseline band
    (§E.6; the band is the only baseline the series carries). Points without a band are skipped."""
    floor = Z_FLOOR_EVERGREEN if evergreen else Z_FLOOR
    out: list[ZPoint] = []
    for p in valid_points(series, end):
        if p.p50 is None or p.p10 is None or p.p90 is None:
            continue
        sd = max((p.p90 - p.p10) / P10_P90_SD, floor)
        out.append(ZPoint(d(p.date), (float(p.value) - p.p50) / sd, bool(p.estimated)))
    out.sort(key=lambda zp: zp.date)
    return out


@dataclass
class PersistentZ:
    z: float
    on: date
    method: str  # 'last2' | 'mean32d'
    #: True when z is svc-imagery's exact §E.6 value (per-date mean/sd), not the band approximation.
    exact: bool = False


def persistent_z(zs: list[ZPoint], as_of: date) -> PersistentZ | None:
    """§E.6: mean of the last 2 composites if both are below −1, else the 32-day mean z."""
    zs = [z for z in zs if z.date <= as_of]
    if not zs:
        return None
    last = zs[-1]
    if (as_of - last.date).days > 32:
        return None
    if len(zs) >= 2 and zs[-1].z < -1 and zs[-2].z < -1:
        return PersistentZ((zs[-1].z + zs[-2].z) / 2, last.date, "last2")
    recent = [z.z for z in zs if (last.date - z.date).days < 32]
    return PersistentZ(sum(recent) / len(recent), last.date, "mean32d")


def stress_level(ndmi_z: float | None) -> str:
    """§E.11 rung 4."""
    if ndmi_z is None:
        return "unknown"
    if ndmi_z > -0.5:
        return "none"
    if ndmi_z > -1.0:
        return "mild"
    if ndmi_z > -1.5:
        return "moderate"
    return "severe"


STRESS_SEVERITY = {"none": 0.0, "mild": 0.33, "moderate": 0.66, "severe": 1.0, "unknown": 0.0}


# ───────────────────────── abandonment (§E.10) ─────────────────────────

def dry_season(as_of: date, window_start: date) -> tuple[date, date] | None:
    """Most recent dry season (1 Dec – 30 Apr) that has started inside the window, clipped to as_of."""
    for y in (as_of.year, as_of.year - 1, as_of.year - 2):
        start, end = date(y - 1, 12, 1), date(y, 4, 30)
        if start <= as_of and end >= window_start:
            return max(start, window_start), min(end, as_of)
    return None


@dataclass
class DryRun:
    dates: list[date]
    mean_z: float


def low_vigour_run(zs: list[ZPoint], start: date, end: date, thresh: float = -2.0, min_len: int = 3) -> DryRun | None:
    """Longest run of ≥ min_len consecutive composites with z ≤ thresh inside [start, end]."""
    pts = [z for z in zs if start <= z.date <= end]
    best: list[ZPoint] = []
    cur: list[ZPoint] = []
    for z in pts:
        if z.z <= thresh:
            cur.append(z)
            if len(cur) > len(best):
                best = list(cur)
        else:
            cur = []
    if len(best) < min_len:
        return None
    return DryRun([z.date for z in best], sum(z.z for z in best) / len(best))


def median(xs: list[float]) -> float | None:
    return statistics.median(xs) if xs else None
