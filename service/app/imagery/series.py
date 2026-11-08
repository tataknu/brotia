"""Polygon NDVI/NDMI series on the 5-day grid, baseline band and z-scores (CONTRACT §E.6, ADR-0007 D6).

- Grid: every 5 days ending at as_of (as_of, as_of-5, ...) back to the window start, ascending.
- Value: weighted Whittaker (lambda 500, daily grid, weights 1 for usable observations) sampled on
  the grid; after the last (before the first) usable observation the curve is HELD at that
  observation's smoothed value, never extrapolated (ADR-0007 D6 'hold the last good observation'). null when the nearest usable observation is more than 32 days away (gap-filled values
  far from an observation are never shown or scored). estimated = true unless a usable observation
  lies within ±2 days of the grid date.
- Baseline: usable observations (raw, not smoothed) within same day-of-year ±8 days in each of the
  previous `baseline_years` years. p10/p50/p90 from those values; null when fewer than
  MIN_BASELINE_N values or fewer than 2 distinct years.
- z = (v - mean) / max(sd, floor); floor 0.05 (deciduous), 0.035 (avocado, evergreen).
- Persistent z = mean of the last 2 composites if both < -1, else the mean z over the last 32 days.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable

import numpy as np

from . import whittaker
from .obs import Obs

STEP_DAYS = 5
NEAR_OBS_DAYS = 2
MAX_GAP_DAYS = 32
BASELINE_HALF_DAYS = 8
MIN_BASELINE_N = 4
CONTEXT_DAYS = 30  # observations before the window start feed the smoother (edge effects)
SD_FLOOR = {"deciduous": 0.05, "evergreen": 0.035}


def months_before(d: date, months: int) -> date:
    y, m = d.year, d.month - months
    while m <= 0:
        m += 12
        y -= 1
    day = min(d.day, [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return date(y, m, day)


def window_start(as_of: date) -> date:
    """13-month display window ending as_of (ADR-0002 D3)."""
    return months_before(as_of, 13)


def grid_dates(start: date, end: date, step: int = STEP_DAYS) -> list[date]:
    out = []
    d = end
    while d >= start:
        out.append(d)
        d -= timedelta(days=step)
    return out[::-1]


def years_before(d: date, k: int) -> date:
    try:
        return d.replace(year=d.year - k)
    except ValueError:  # 29 Feb
        return d.replace(year=d.year - k, day=28)


@dataclass
class Point:
    date: date
    value: float | None
    estimated: bool
    days_to_obs: int | None
    p10: float | None = None
    p50: float | None = None
    p90: float | None = None
    mean: float | None = None
    sd: float | None = None
    n_base: int = 0
    z: float | None = None


def _usable(obs: Iterable[Obs], variable: str) -> list[tuple[date, float]]:
    out = []
    for o in obs:
        v = getattr(o, variable)
        if o.usable and v is not None and np.isfinite(v):
            out.append((o.date, float(v)))
    out.sort()
    return out


def baseline(values: list[tuple[date, float]], target: date, years: int, half: int = BASELINE_HALF_DAYS):
    """(n, mean, sd, p10, p50, p90) from observations at the same day of year ±half in the previous
    `years` years, or None."""
    if not values:
        return None
    ds = np.array([v[0].toordinal() for v in values])
    vs = np.array([v[1] for v in values])
    picked, yrs = [], set()
    for k in range(1, years + 1):
        c = years_before(target, k).toordinal()
        sel = np.abs(ds - c) <= half
        if sel.any():
            picked.extend(vs[sel].tolist())
            yrs.add(k)
    if len(picked) < MIN_BASELINE_N or len(yrs) < 2:
        return None
    a = np.array(picked)
    p10, p50, p90 = np.percentile(a, [10, 50, 90])
    return len(a), float(a.mean()), float(a.std(ddof=1)) if len(a) > 1 else 0.0, float(p10), float(p50), float(p90)


def compute(obs: list[Obs], variable: str, start: date, end: date, baseline_years: int, sd_floor: float,
            lam: float = whittaker.LAMBDA) -> list[Point]:
    """Series points on the 5-day grid over [start, end] (see module doc)."""
    vals = _usable(obs, variable)
    grid = grid_dates(start, end)
    pts: list[Point] = []
    win = [(d, v) for d, v in vals if start - timedelta(days=CONTEXT_DAYS) <= d <= end]
    sm = None
    d0 = start - timedelta(days=CONTEXT_DAYS)
    if len(win) >= whittaker.MIN_OBS:
        n = (end - d0).days + 1
        y = np.full(n, np.nan)
        w = np.zeros(n)
        acc: dict[int, list[float]] = {}
        for d, v in win:
            acc.setdefault((d - d0).days, []).append(v)
        for i, vs in acc.items():
            y[i] = float(np.mean(vs))
            w[i] = 1.0
        sm = whittaker.smooth(y, w, lam)
    obs_ord = np.array([d.toordinal() for d, _ in win]) if win else np.array([], dtype=int)
    for g in grid:
        dist = int(np.min(np.abs(obs_ord - g.toordinal()))) if obs_ord.size else None
        v = None
        if sm is not None and dist is not None and dist <= MAX_GAP_DAYS:
            # ADR-0007 D6: hold the last (first) good observation instead of extrapolating the curve
            gi = min(max(g, win[0][0]), win[-1][0])
            x = sm[(gi - d0).days]
            v = float(np.clip(x, -1, 1)) if np.isfinite(x) else None
        p = Point(date=g, value=v, estimated=not (dist is not None and dist <= NEAR_OBS_DAYS), days_to_obs=dist)
        b = baseline(vals, g, baseline_years)
        if b:
            p.n_base, p.mean, p.sd, p.p10, p.p50, p.p90 = b
            if v is not None:
                p.z = (v - p.mean) / max(p.sd, sd_floor)
        pts.append(p)
    return pts


def persistent_z(points: list[Point], as_of: date) -> float | None:
    """§E.6: mean of the last 2 composites if both are below -1, else the 32-day mean z."""
    zs = [p for p in points if p.z is not None and p.date <= as_of]
    if not zs:
        return None
    last2 = zs[-2:]
    if len(last2) == 2 and all(p.z < -1 for p in last2):
        return float(np.mean([p.z for p in last2]))
    recent = [p.z for p in zs if (as_of - p.date).days <= MAX_GAP_DAYS]
    return float(np.mean(recent)) if recent else None


def sd_floor_for(evergreen: bool) -> float:
    return SD_FLOOR["evergreen" if evergreen else "deciduous"]
