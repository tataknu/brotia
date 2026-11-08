"""Percentile baseline (DOY moving window, min-sample rule) + SPI check with climate_indices.

Input: ERA5 daily precip for the 12 farms, 1981-2026, already downloaded by the gridded-precip
family from Open-Meteo (read-only reuse, no network). Computes for Los Tajibos:
  1. 30-day rain total ending on each day; its empirical percentile vs the same-DOY window
     (+-7 and +-15 days) in 1991-2020 (sample-size check).
  2. SPI-3 (gamma, monthly) via climate_indices vs a hand-rolled scipy gamma SPI-3.
"""
import gzip, json, pathlib, time
import numpy as np, pandas as pd
from scipy import stats

HERE = pathlib.Path(__file__).parent
d = json.load(gzip.open(HERE.parent / "gridded-precip" / "sample_era5_om_12farms_1981_2026.json.gz"))
fk = list(d["farms"])[0]
far = d["farms"][fk]
p = pd.Series(far["p"], index=pd.to_datetime(d["time"]), dtype=float)
print("farm key:", fk, far["lat"], far["lon"], "days:", len(p), "NaN:", int(p.isna().sum()), "last valid:", p.last_valid_index().date())
p = p[: p.last_valid_index()]

# 1. DOY window percentile of 30-day totals
r30 = p.rolling(30, min_periods=28).sum()
doy = r30.index.dayofyear.values
yrs = r30.index.year.values

def pct_of(day, half, base=(1991, 2020), min_n=20):
    x = r30.loc[day]
    dd = (doy - day.dayofyear + 183) % 366 - 183   # circular DOY distance
    m = (np.abs(dd) <= half) & (yrs >= base[0]) & (yrs <= base[1]) & (yrs != day.year)
    ref = r30.values[m]; ref = ref[~np.isnan(ref)]
    if len(ref) < min_n:
        return x, None, len(ref)
    return x, stats.percentileofscore(ref, x, kind="mean"), len(ref)

for day in ["2023-10-31", "2024-01-31", "2024-09-30", "2025-10-31", str(r30.last_valid_index().date())]:
    day = pd.Timestamp(day)
    for half in (0, 7, 15):
        x, pc, n = pct_of(day, half)
        print(f"  {day.date()} 30d={x:6.1f} mm  window=+-{half:2d}d  n={n:4d}  pctile={pc if pc is None else round(pc,1)}")

# 2. SPI-3
m = p.resample("MS").sum(min_count=28)
m = m[m.index < pd.Timestamp(p.last_valid_index().strftime("%Y-%m-01"))]  # drop partial month
t = time.time()
try:
    from climate_indices import indices, compute
    spi = indices.spi(m.values, scale=3, distribution=indices.Distribution.gamma,
                      data_start_year=int(m.index[0].year), calibration_year_initial=1991,
                      calibration_year_final=2020, periodicity=compute.Periodicity.monthly)
    spi = pd.Series(spi, index=m.index)
    print(f"climate_indices SPI-3 ok in {time.time()-t:.2f}s; n={spi.notna().sum()}")
except Exception as e:
    spi = None; print("climate_indices FAILED:", repr(e)[:300])

# hand-rolled: gamma fit per calendar month over 1991-2020, with zero-prob mixture
m3 = m.rolling(3).sum()
own = pd.Series(np.nan, index=m3.index)
for mo in range(1, 13):
    sel = m3[(m3.index.month == mo)]
    cal = sel[(sel.index.year >= 1991) & (sel.index.year <= 2020)].dropna()
    q = (cal == 0).mean(); a, loc, sc = stats.gamma.fit(cal[cal > 0], floc=0)
    cdf = q + (1 - q) * stats.gamma.cdf(sel.clip(lower=0), a, loc=0, scale=sc)
    own[sel.index] = stats.norm.ppf(np.clip(cdf, 1e-6, 1 - 1e-6))
cmp = pd.DataFrame({"P3_mm": m3.round(0), "spi3_climate_indices": None if spi is None else spi.round(2), "spi3_scipy": own.round(2)})
print(cmp.loc["2023-06-01":].to_string())
if spi is not None:
    both = cmp.dropna()
    print("agreement 1991-2026: corr=%.3f  max|diff|=%.2f" % (both.spi3_climate_indices.astype(float).corr(both.spi3_scipy), (both.spi3_climate_indices.astype(float) - both.spi3_scipy).abs().max()))
