"""Climate-stress indicators for one farm, one crop season, as of one date.

Every number is compared with the same calendar window in each of the previous ~30 years,
so "stress" always means "unusual for this place at this point in the season".
`fetch_farm` downloads (cached); `evaluate` is pure and cheap, so we can replay a season
week by week for the early-warning backtest without refetching.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

import numpy as np
import pandas as pd

from crops import CROPS
import sources

NDVI_LAG = pd.Timedelta(days=20)   # a 16-day composite is usable ~20 days after its start date
WEATHER_LAG = pd.Timedelta(days=5)


def season_dates(crop: str, season_year: int) -> tuple[pd.Timestamp, pd.Timestamp]:
    c = CROPS[crop]
    sow = pd.Timestamp(season_year, *c["sow"])
    hy = season_year + (1 if c["harvest"] <= c["sow"] else 0)
    return sow, pd.Timestamp(hy, *c["harvest"])


def _shift(ts: pd.Timestamp, years: int) -> pd.Timestamp:
    try:
        return ts.replace(year=ts.year - years)
    except ValueError:            # Feb 29
        return ts.replace(year=ts.year - years, day=28)


@dataclass
class FarmData:
    weather: pd.DataFrame
    ndvi: pd.Series               # current season composites
    ndvi_hist: pd.DataFrame       # rows = composite day-of-season, cols = past years


def fetch_farm(lat: float, lon: float, crop: str, season_year: int, ndvi_years: int = 12) -> FarmData:
    sow, harvest = season_dates(crop, season_year)
    pre = pd.Timedelta(days=60)
    wx = sources.weather(lat, lon)
    today = pd.Timestamp(dt.date.today())
    s0, s1 = (sow - pre).date(), min(harvest, today).date()
    cur = sources.ndvi_window(lat, lon, s0, s1)
    hist = {}
    for k in range(1, ndvi_years + 1):
        a, b = _shift(sow - pre, k), _shift(harvest, k)
        if a.year < sources.NDVI_FIRST_YEAR:
            break
        hist[season_year - k] = sources.ndvi_window(lat, lon, a.date(), b.date())
    return FarmData(wx, cur, _align_hist(hist, sow, season_year))


def _align_hist(hist: dict[int, pd.Series], sow: pd.Timestamp, season_year: int) -> pd.DataFrame:
    """Index past seasons by day-of-year so they line up with the current season's composites."""
    cols = {}
    for y, s in hist.items():
        cols[y] = pd.Series(s.values, index=[d.dayofyear for d in s.index])
    return pd.DataFrame(cols)


def _longest_dry(p: pd.Series, thresh: float = 1.0) -> int:
    run = best = 0
    for v in (p.fillna(0) < thresh):
        run = run + 1 if v else 0
        best = max(best, run)
    return best


def _metrics(w: pd.DataFrame, heat_t: float) -> dict:
    if w.empty:
        return {}
    tail = w["sm"].iloc[-21:]
    return {
        "rain": float(w["p"].sum()),
        "water": float((w["p"] - w["et0"]).sum()),
        "dry": _longest_dry(w["p"]),
        "heat": int((w["tmax"] >= heat_t).sum()),
        "frost": int((w["tmin"] <= 0).sum()),
        "sm": float(tail.mean()) if tail.notna().any() else np.nan,
    }


def _pct(cur: float, hist: np.ndarray) -> float:
    hist = hist[~np.isnan(hist)]
    if not len(hist) or np.isnan(cur):
        return np.nan
    return float(((hist < cur).sum() + 0.5 * (hist == cur).sum()) / len(hist))


def _ramp(x: float, lo: float, hi: float) -> float:
    if x is None or np.isnan(x):
        return 0.0
    return float(np.clip((x - lo) / (hi - lo), 0, 1))


def evaluate(fd: FarmData, crop: str, season_year: int, as_of) -> dict:
    c = CROPS[crop]
    sow, harvest = season_dates(crop, season_year)
    as_of = pd.Timestamp(as_of)
    data_end = min(as_of - WEATHER_LAG, fd.weather.index.max())
    if as_of < sow + pd.Timedelta(days=10):
        phase, start, end = "pre-season", data_end - pd.Timedelta(days=60), data_end
    else:
        phase = "post-harvest" if as_of > harvest else "in-season"
        start, end = sow, min(harvest, data_end)

    m = _metrics(fd.weather[start:end], c["heat"])
    hist = []
    for k in range(1, 40):
        a, b = _shift(start, k), _shift(end, k)
        if a < fd.weather.index.min():
            break
        hist.append(_metrics(fd.weather[a:b], c["heat"]))
    H = {key: np.array([h[key] for h in hist], dtype=float) for key in m}
    P = {key: _pct(m[key], H[key]) for key in m}
    med = {key: float(np.nanmedian(H[key])) for key in m}

    # NDVI: mean z-score of the last two composites visible on the as-of date
    nd = fd.ndvi[(fd.ndvi.index >= sow - pd.Timedelta(days=30)) & (fd.ndvi.index <= as_of - NDVI_LAG)]
    nz, nratio, ndate = np.nan, np.nan, None
    if len(nd) and not fd.ndvi_hist.empty:
        zs, rs = [], []
        for d, v in nd.iloc[-2:].items():
            row = fd.ndvi_hist.loc[d.dayofyear] if d.dayofyear in fd.ndvi_hist.index else None
            if row is None or row.notna().sum() < 5:
                continue
            mu, sd = row.mean(), max(row.std(), 0.04)
            zs.append((v - mu) / sd)
            rs.append(v / mu if mu > 0 else np.nan)
            ndate = d
        if zs:
            nz, nratio = float(np.mean(zs)), float(np.nanmean(rs))

    days_in = max((end - start).days, 1)
    S = {
        "water": _ramp(0.5 - P["water"], 0, 0.45),
        "dry":   _ramp(P["dry"] - 0.5, 0, 0.45) if m["dry"] >= 10 else 0.0,
        "soil":  _ramp(0.5 - P["sm"], 0, 0.45),
        "heat":  _ramp(P["heat"] - 0.5, 0, 0.45) if m["heat"] > 0 else 0.0,
        "frost": _ramp(P["frost"] - 0.5, 0, 0.45) if (c["frost"] and m["frost"] > 0) else 0.0,
        "wet":   _ramp(P["rain"] - 0.85, 0, 0.13),
        "ndvi":  _ramp(-nz, 0.25, 2.25) if phase != "pre-season" else 0.0,
    }
    W = {k: c["w"].get(k, 0) for k in S}
    wsum = sum(W.values())
    wmean = sum(W[k] * S[k] for k in S) / wsum
    peak = max((S[k] for k in S if W[k] >= 1.5), default=0)
    score = round(100 * (0.5 * wmean + 0.5 * peak))

    n = len(hist)
    text = {
        "water": f"Rain {m['rain'] / max(med['rain'], 1):.0%} of normal since {'sowing' if phase != 'pre-season' else 'mid-season'} "
                 f"({m['rain']:.0f} mm vs {med['rain']:.0f} mm typical); water balance drier than "
                 f"{(1 - P['water']) * 100:.0f}% of the last {n} years",
        "dry":   f"{m['dry']} consecutive days without useful rain (typical longest spell: {med['dry']:.0f})",
        "soil":  f"Root-zone soil moisture lower than in {(1 - P['sm']) * 100:.0f}% of past years for these dates",
        "heat":  f"{m['heat']} days at or above {c['heat']}°C (typical: {med['heat']:.0f})",
        "frost": f"{m['frost']} frost nights (typical: {med['frost']:.0f})",
        "wet":   f"Rain {m['rain'] / max(med['rain'], 1):.0%} of normal — wetter than {P['rain'] * 100:.0f}% of past years "
                 f"(waterlogging / flood risk)",
        "ndvi":  (f"Crop greenness (NDVI) {nratio:.0%} of normal for this date ({nz:+.1f} σ)"
                  if not np.isnan(nz) else ""),
    }
    drivers = sorted(({"key": k, "severity": round(S[k], 2), "weight": W[k], "impact": round(W[k] * S[k] / wsum, 3),
                       "text": text[k]} for k in S if S[k] >= 0.15 and text[k]),
                     key=lambda d: -d["impact"])
    return {
        "as_of": as_of.date().isoformat(), "phase": phase, "score": score,
        "tier": "high" if score >= 60 else "watch" if score >= 35 else "normal",
        "window": [start.date().isoformat(), end.date().isoformat()], "days": days_in,
        "drivers": drivers, "subscores": {k: round(v, 2) for k, v in S.items()},
        "metrics": {**{k: (round(v, 3) if isinstance(v, float) else v) for k, v in m.items()},
                    "ndvi_z": None if np.isnan(nz) else round(nz, 2),
                    "ndvi_ratio": None if np.isnan(nratio) else round(nratio, 3),
                    "ndvi_date": ndate.date().isoformat() if ndate is not None else None},
        "normal": {k: round(v, 2) for k, v in med.items()}, "pct": {k: (None if np.isnan(v) else round(v, 3)) for k, v in P.items()},
        "years_compared": n,
    }
