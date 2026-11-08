"""MODIS MOD13Q1 <-> Sentinel-2 NDVI cross-calibration on one farm pixel (Los Tajibos), real data.

Inputs (both produced in this folder): ORNL MOD13Q1 single-pixel series with true acquisition DOY,
and Sentinel-2 c1 L2A NDVI averaged over the same MODIS cell (n=0) and a 3x3-cell box (n=1).
Pairing rules tested:
  A. strict: S2 date within +-2 d of the MODIS pixel's acquisition day, MODIS reliability 0, S2 clear>=0.8
  B. smooth: every clear S2 date vs the Whittaker-smoothed (envelope) MODIS daily curve at that date
Fits: OLS (scipy.stats.linregress) and Theil-Sen (robust). Model: MODIS ~ a + b*S2 (maps S2 onto MODIS scale).
"""
import json, glob, pathlib, sys
import numpy as np, pandas as pd
from scipy import stats
H = pathlib.Path(__file__).parent
KEY = sys.argv[1] if len(sys.argv) > 1 else "tajibos"
m = pd.read_csv(H / f"exp_smooth_series_{KEY}.csv", index_col=0, parse_dates=["acq"])
s2 = pd.DataFrame(json.load(open(H / f"sample_s2_on_modis_pixel_{KEY}.json"))["rows"])
s2["date"] = pd.to_datetime(s2.date)
print(f"S2 scenes read: {len(s2)}; clear>=0.8 on MODIS cell: {(s2.clear0>=0.8).sum()}, on 3x3 box: {(s2.clear1>=0.8).sum()}")
print(f"MODIS composites: {len(m)}; reliability 0: {(m.rel==0).sum()}")

def fit(x, y, label):
    x, y = np.asarray(x, float), np.asarray(y, float)
    if len(x) < 4: print(f"  {label}: n={len(x)} too few"); return
    lr = stats.linregress(x, y); ts = stats.theilslopes(y, x)
    rmse = np.sqrt(np.mean((y - (lr.intercept + lr.slope * x)) ** 2))
    print(f"  {label:34s} n={len(x):3d}  OLS MODIS = {lr.intercept:+.3f} + {lr.slope:.3f}*S2  R2={lr.rvalue**2:.3f}  RMSE={rmse:.3f}"
          f"  | Theil-Sen {ts[1]:+.3f} + {ts[0]:.3f}*S2 | mean diff MODIS-S2={np.mean(y-x):+.3f}")

# daily WS curve: reconstruct by linear interp of WS values at acquisition days (WS is already smooth)
ws = pd.Series(m.ws_50.values, index=m.acq).sort_index()
ws = ws[~ws.index.duplicated()].resample("D").interpolate("time")
for n in (0, 1):
    c, v = f"clear{n}", f"ndvi{n}"
    ok = s2[(s2[c] >= 0.8) & s2[v].notna()]
    # A strict
    pairs = []
    good = m[m.rel == 0]
    for _, r in ok.iterrows():
        dd = (good.acq - r.date).dt.days.abs()
        if len(dd) and dd.min() <= 2:
            pairs.append((r[v], good.ndvi.iloc[int(np.argmin(dd.values))], r.date))
    print(f"\nS2 window = {'exact MODIS cell' if n==0 else '3x3 MODIS cells'}")
    if pairs:
        x, y, _ = zip(*pairs); fit(x, y, "A strict (+-2 d, rel=0, clear>=.8)")
    inr = ok[(ok.date >= ws.index[0]) & (ok.date <= ws.index[-1])]
    fit(inr[v], ws.reindex(inr.date).values, "B S2 vs WS-smoothed MODIS")
    # seasonal split for B
    wet = inr.date.dt.month.isin([11, 12, 1, 2, 3, 4])
    fit(inr[v][wet], ws.reindex(inr.date[wet]).values, "B wet season (Nov-Apr)")
    fit(inr[v][~wet], ws.reindex(inr.date[~wet]).values, "B dry season (May-Oct)")
