"""Same-date NDVI z-score baseline on a 26-year MOD13Q1 pixel series (cropland farm), raw vs smoothed.

Variants (baseline = all OTHER years, as ADR-0002 D5):
  RAW-slot : value of the composite in the same 16-day slot each year, good QA only (n <= 25)
  RAW-pool : same slot +-1 slot (pooled ~+-16 d), good QA only (n <= 75)
  WS-doy   : Whittaker-smoothed daily curve (lambda 50, no envelope), value at same DOY +-8 d in other years
sd floor 0.03 NDVI (an assumption to tune); min-sample rule n>=8 else 'insufficient baseline'.
Reports z for the 2023-24 drought months and recent months, plus sd and n.
"""
import sys, json, pathlib, importlib.util, io, contextlib, warnings
import numpy as np, pandas as pd
warnings.filterwarnings("ignore")
H = pathlib.Path(__file__).parent
fn = sys.argv[1]
sys.argv = [sys.argv[0], fn]
spec = importlib.util.spec_from_file_location("es", H / "exp_smooth.py"); es = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()): spec.loader.exec_module(es)
df, y, w, tday = es.df.copy(), es.y, es.w, es.tday
z = es.whittaker(tday, y, w, 50)  # lambda 50 (daily grid), no envelope: CV-best on cropland
daily = pd.Series(z, index=pd.date_range(es.t0, periods=len(z), freq="D"))
df["ws"] = z[tday]
df["slot"] = df.index.day_of_year; df["year"] = df.index.year
SD_FLOOR, MIN_N = 0.03, 8
print(f"{pathlib.Path(fn).name}: {len(df)} composites, masked {100*(w==0).mean():.1f}%, marginal {100*(df.rel==1).mean():.1f}%")

def zraw(i, pool):
    c = df.index[i]; slots = sorted(df.slot.unique())
    k = slots.index(df.slot.iloc[i]); near = {slots[(k + j) % len(slots)] for j in range(-pool, pool + 1)}
    ref = df[(df.slot.isin(near)) & (df.year != c.year) & (es.w > 0)]
    if len(ref) < MIN_N: return np.nan, np.nan, len(ref)
    sd = max(ref.ndvi.std(), SD_FLOOR); return (df.ndvi.iloc[i] - ref.ndvi.mean()) / sd, ref.ndvi.std(), len(ref)

doy_d = daily.index.day_of_year.values; yr_d = daily.index.year.values
def zws(i):
    c = df.acq.iloc[i]; x = daily.loc[c]
    dd = (doy_d - c.day_of_year + 183) % 366 - 183
    m = (np.abs(dd) <= 8) & (yr_d != c.year)
    ref = daily.values[m]
    # one value per other year (mean over the +-8 d) so n counts years, not days
    per_year = pd.Series(ref, index=yr_d[m]).groupby(level=0).mean()
    if len(per_year) < MIN_N: return np.nan, np.nan, len(per_year)
    sd = max(per_year.std(), SD_FLOOR); return (x - per_year.mean()) / sd, per_year.std(), len(per_year)

rows = []
for i in range(len(df)):
    if df.index[i] < pd.Timestamp("2023-06-01") and not (pd.Timestamp("2019-06-01") <= df.index[i] < pd.Timestamp("2020-06-01")): continue
    a = zraw(i, 0); b = zraw(i, 1); c = zws(i)
    rows.append(dict(comp=df.index[i].date(), rel=int(df.rel.iloc[i]), ndvi=round(y[i], 3), ws=round(df.ws.iloc[i], 3),
                     z_raw_slot=round(a[0], 2), n1=a[2], z_raw_pool=round(b[0], 2), sd_pool=round(b[1], 3), n3=b[2],
                     z_ws=round(c[0], 2), sd_ws=round(c[1], 3), nws=c[2]))
r = pd.DataFrame(rows)
print(r.to_string(index=False))
s = r[(r.comp >= pd.Timestamp("2023-09-01").date()) & (r.comp <= pd.Timestamp("2024-04-30").date())]
print("\n2023-09..2024-04 (drought season) mean z: raw-slot %.2f  raw-pool %.2f  ws %.2f ; composites with z<-1.5: raw-slot %d raw-pool %d ws %d of %d" % (
    s.z_raw_slot.mean(), s.z_raw_pool.mean(), s.z_ws.mean(), (s.z_raw_slot < -1.5).sum(), (s.z_raw_pool < -1.5).sum(), (s.z_ws < -1.5).sum(), len(s)))
t = r[r.comp >= pd.Timestamp("2024-06-01").date()]
print("jitter (RMS of z change between consecutive composites, 2024-06..): raw-slot %.2f raw-pool %.2f ws %.2f" % (
    np.sqrt(np.nanmean(np.diff(t.z_raw_slot) ** 2)), np.sqrt(np.nanmean(np.diff(t.z_raw_pool) ** 2)), np.sqrt(np.nanmean(np.diff(t.z_ws) ** 2))))
print("median baseline sd: raw-pool %.3f ws %.3f ; share of points hitting sd floor 0.03: pool %.0f%% ws %.0f%%" % (
    r.sd_pool.median(), r.sd_ws.median(), 100 * (r.sd_pool < SD_FLOOR).mean(), 100 * (r.sd_ws < SD_FLOOR).mean()))
