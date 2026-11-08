"""Does bias correction matter if we use percentiles? ERA5 (Open-Meteo) vs CHIRPS (ClimateSERV) at Los Tajibos.

Reads the gridded-precip family's samples read-only (no network). For 1991-2020 + 2021-2026:
  - mean bias of 30-day totals (absolute mm)       -> what quantile mapping would fix
  - agreement of 30-day PERCENTILES (each vs own DOY+-7 climatology) -> what our anomaly uses
  - wet-day frequency (>=1 mm) and 72-h >=120 mm exceedances -> absolute thresholds that DO feel bias
  - empirical quantile mapping ERA5->CHIRPS (per calendar month, 1991-2020) and its effect on those counts
"""
import gzip, json, pathlib
import numpy as np, pandas as pd
from scipy import stats

H = pathlib.Path(__file__).parent; G = H.parent / "gridded-precip"
d = json.load(gzip.open(G / "sample_era5_om_12farms_1981_2026.json.gz"))
era = pd.Series(d["farms"]["Estancia Los Tajibos"]["p"], index=pd.to_datetime(d["time"]), dtype=float)
ch = pd.read_csv(G / "sample_chirps_cs_tajibos.csv", parse_dates=["date"]).set_index("date").precip_mm
ch = ch.where(ch >= 0)
df = pd.DataFrame({"era5": era, "chirps": ch}).loc["1981-01-01":"2026-09-30"].dropna()
print("overlap days:", len(df), df.index[0].date(), df.index[-1].date())
r30 = df.rolling(30).sum().dropna()
cal = r30.loc["1991":"2020"]
print("\n30-day totals 1991-2020: mean ERA5=%.1f CHIRPS=%.1f  (bias %.1f%%), corr=%.3f" % (
    cal.era5.mean(), cal.chirps.mean(), 100 * (cal.era5.mean() / cal.chirps.mean() - 1), cal.era5.corr(cal.chirps)))

doy = r30.index.day_of_year.values; yr = r30.index.year.values
def pctile(col, half=7):
    out = np.full(len(r30), np.nan); v = r30[col].values
    for i in range(0, len(r30), 5):   # every 5th day is enough for a comparison
        dd = (doy - doy[i] + 183) % 366 - 183
        m = (np.abs(dd) <= half) & (yr >= 1991) & (yr <= 2020) & (yr != yr[i])
        out[i] = stats.percentileofscore(v[m], v[i], kind="mean")
    return out
pe, pc = pctile("era5"), pctile("chirps")
ok = ~np.isnan(pe)
print("30-day PERCENTILE agreement (all years): corr=%.3f  mean|diff|=%.1f pct-points  same 'dry' flag (<20th): %.1f%%" % (
    np.corrcoef(pe[ok], pc[ok])[0, 1], np.mean(np.abs(pe[ok] - pc[ok])), 100 * np.mean((pe[ok] < 20) == (pc[ok] < 20))))
for day in ["2023-10-31", "2024-01-31", "2024-09-30", "2026-09-30"]:
    i = r30.index.get_indexer([pd.Timestamp(day)], method="nearest")[0]
    i -= i % 5
    print(f"  {r30.index[i].date()}  30d mm ERA5={r30.era5.iloc[i]:6.1f} CHIRPS={r30.chirps.iloc[i]:6.1f}   pctile ERA5={pe[i]:5.1f} CHIRPS={pc[i]:5.1f}")

def counts(s):
    wet = (s >= 1).mean() * 100
    r72 = s.rolling(3).sum()
    return wet, int((r72 >= 120).sum())
base = df.loc["1991":"2020"]
# empirical quantile mapping per month
qm = df.era5.copy()
qs = np.linspace(0.01, 0.99, 99)
for mo in range(1, 13):
    b = base[base.index.month == mo]
    qe, qc = np.quantile(b.era5, qs), np.quantile(b.chirps, qs)
    sel = df.index.month == mo
    qm[sel] = np.interp(df.era5[sel], qe, qc, left=0, right=None)
    top = df.era5[sel] > qe[-1]
    qm[sel & top.reindex(df.index, fill_value=False).values] = df.era5[sel & top.reindex(df.index, fill_value=False).values] * (qc[-1] / max(qe[-1], 1e-6))
for name, s in [("ERA5 raw", df.era5), ("ERA5 QM->CHIRPS", qm), ("CHIRPS", df.chirps)]:
    w, f = counts(s.loc["1991":"2026"])
    print(f"  {name:16s} wet-day freq (>=1mm)={w:5.1f}%   72h>=120mm days 1991-2026={f}")
