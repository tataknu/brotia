"""Weather baseline bands (CONTRACT §E.6, ADR-0004 D1) and Series assembly, shared by every gridded
weather provider (CR2MET, ERA5).

- tmin / tmax / eto: for each calendar day, the 10th/50th/90th percentile of the daily values on the same
  day of year ±7 days, pooled over the baseline years (1991–2020).
- precip: same, but on 30-day running totals expressed as a daily rate (total / 30), so that summing
  p50 over a week or a month gives a meaningful "normal" amount.
- Days are counted on a 365-day calendar: 29 Feb is treated as 28 Feb.
- A year counts toward n_years when it has ≥ 300 valid days for the variable. Bands need ≥ MIN_YEARS_ANY
  years; fewer than MIN_YEARS_OK (ADR-0004 D1: 15) are served with a note saying so.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Iterable

import numpy as np
import pandas as pd

from app.models import Provenance, Series, SeriesPoint

BASELINE_YEARS = range(1991, 2021)
WINDOW_DAYS = 7
MIN_YEARS_OK = 15
MIN_YEARS_ANY = 5
UNITS = {"precip": "mm", "eto": "mm", "tmin": "°C", "tmax": "°C"}


def noleap_doy(d: date) -> int:
    """0..364; 29 Feb -> 28 Feb."""
    if d.month == 2 and d.day == 29:
        d = d.replace(day=28)
    return (date(2001, d.month, d.day) - date(2001, 1, 1)).days


@dataclass
class Bands:
    variable: str
    #: (365, 3) array of p10/p50/p90, NaN where unavailable. None when no baseline at all.
    table: np.ndarray | None
    n_years: int
    years: list[int] = field(default_factory=list)
    reason: str | None = None

    def at(self, d: date) -> tuple[float | None, float | None, float | None]:
        if self.table is None:
            return (None, None, None)
        row = self.table[noleap_doy(d)]
        return tuple(None if np.isnan(v) else round(float(v), 3) for v in row)  # type: ignore[return-value]

    def describe(self) -> str:
        if self.table is None:
            return f"no 1991–2020 baseline ({self.reason or 'no baseline years available'})"
        span = f"{min(self.years)}–{max(self.years)}" if self.years else ""
        s = f"baseline n_years={self.n_years} of 30 ({span})"
        if self.n_years < MIN_YEARS_OK:
            s += f"; fewer than {MIN_YEARS_OK} years, indicative only"
        return s


def compute_bands(values: dict[date, float | None] | Iterable[tuple[date, float | None]], variable: str,
                  years: Iterable[int] = BASELINE_YEARS) -> Bands:
    """values: daily values (any dates; only `years` are used, plus the 29 days before for precip)."""
    items = values.items() if isinstance(values, dict) else values
    s = pd.Series({pd.Timestamp(d): (np.nan if v is None else float(v)) for d, v in items}, dtype=float)
    years = list(years)
    if s.empty:
        return Bands(variable, None, 0, [], "no baseline data")
    s = s.sort_index()
    s = s[~s.index.duplicated(keep="last")]
    full = pd.date_range(s.index.min(), s.index.max(), freq="D")
    s = s.reindex(full)
    if variable == "precip":
        s = s.rolling(30, min_periods=30).sum() / 30.0

    mat = np.full((len(years), 365), np.nan)
    used: list[int] = []
    for i, y in enumerate(years):
        ys = s[(s.index.year == y)]
        ys = ys.dropna()
        if len(ys) < 300:
            continue
        used.append(y)
        for ts, v in ys.items():
            mat[i, noleap_doy(ts.date())] = v
    if len(used) < MIN_YEARS_ANY:
        return Bands(variable, None, len(used), used, f"only {len(used)} baseline years available")
    mat = mat[[years.index(y) for y in used]]
    table = np.full((365, 3), np.nan)
    for d in range(365):
        cols = [(d + k) % 365 for k in range(-WINDOW_DAYS, WINDOW_DAYS + 1)]
        pool = mat[:, cols].ravel()
        pool = pool[~np.isnan(pool)]
        if pool.size >= 10:
            table[d] = np.percentile(pool, [10, 50, 90])
    return Bands(variable, table, len(used), used)


def build_series(variable: str, values: dict[date, float | None], bands: Bands | None, start: date, end: date,
                 provenance: Provenance, estimated_dates: set[date] | None = None) -> Series:
    """Daily points for every date in [start, end] (value null where no observation)."""
    pts: list[SeriesPoint] = []
    d = start
    while d <= end:
        v = values.get(d)
        p10, p50, p90 = bands.at(d) if bands is not None else (None, None, None)
        pts.append(SeriesPoint(
            date=d.isoformat(),
            value=None if v is None else round(float(v), 3),
            p10=p10, p50=p50, p90=p90,
            estimated=True if (estimated_dates and d in estimated_dates) else None,
        ))
        d += timedelta(days=1)
    return Series(variable=variable, unit=UNITS[variable], points=pts, provenance=provenance)


def latest_date(values: dict[date, float | None]) -> date | None:
    ds = [d for d, v in values.items() if v is not None]
    return max(ds) if ds else None
