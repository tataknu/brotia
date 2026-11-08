"""Smoothing / gap-filling experiment on a real MOD13Q1 single-pixel series (ORNL sample).

Methods compared (all numpy/scipy only, no compiled extras):
  raw      : NDVI as delivered (cloudy composites included)
  masked   : drop pixel_reliability not in {0,1}
  WS(l)    : weighted Whittaker (Eilers 2003), 2nd-order differences, weights 1 good / 0.5 marginal / 0 bad,
             on the composites' TRUE acquisition dates (composite_day_of_the_year) placed on a daily grid
  WS-env   : WS + 2 upper-envelope iterations (cloud residue biases NDVI low: points below fit get w*=0.2)
  SG       : Savitzky-Golay (window 5 composites, poly 2) after linear interpolation of masked points
  SG-Chen  : Chen et al. 2004 upper-envelope SG (iterative)
  HARM     : 3-harmonic Fourier fit (HANTS-like, one pass)
Metrics: % composites masked; roughness = RMS of first differences; residual RMS vs good obs;
leave-10%-out cross-validation RMSE on good observations (the honest gap-fill metric).
"""
import json, sys, pathlib, glob
import numpy as np, pandas as pd
from scipy import sparse
from scipy.sparse.linalg import spsolve
from scipy.signal import savgol_filter

HERE = pathlib.Path(__file__).parent
fn = sys.argv[1] if len(sys.argv) > 1 else sorted(glob.glob(str(HERE / "sample_mod13q1_tajibos_*.json")))[-1]
d = json.load(open(fn))
rows = []
for cal, v in sorted(d["series"].items()):
    c = pd.Timestamp(cal)
    doy = v.get("composite_day_of_the_year")
    if doy is not None and doy > 0:
        acq = pd.Timestamp(year=c.year, month=1, day=1) + pd.Timedelta(days=int(doy) - 1)
        if acq < c - pd.Timedelta(days=2):  # composite crossing year end
            acq = pd.Timestamp(year=c.year + 1, month=1, day=1) + pd.Timedelta(days=int(doy) - 1)
    else:
        acq = c + pd.Timedelta(days=8)
    rows.append(dict(comp=c, acq=acq, ndvi=v.get("NDVI", -3000) * 1e-4, rel=v.get("pixel_reliability", -1)))
df = pd.DataFrame(rows).set_index("comp")
df["w"] = df.rel.map({0: 1.0, 1: 0.5}).fillna(0.0)
df.loc[df.ndvi < -0.2, "w"] = 0.0
good = df.w > 0
print(f"file={pathlib.Path(fn).name}  n={len(df)}  {df.index[0].date()}..{df.index[-1].date()}")
print("pixel_reliability counts:", df.rel.value_counts().to_dict(), f"masked={100*(~good).mean():.1f}%")

def whittaker(t_days, y, w, lam, d=2):
    """Weighted Whittaker on a daily grid; obs placed at their acquisition day. Returns daily z."""
    n = int(t_days.max()) + 1
    W = np.zeros(n); Y = np.zeros(n)
    for ti, yi, wi in zip(t_days, y, w):
        if wi > W[ti]: W[ti], Y[ti] = wi, yi
    D = sparse.diags([1, -2, 1], [0, 1, 2], shape=(n - 2, n)) if d == 2 else sparse.diags([1, -1], [0, 1], shape=(n - 1, n))
    A = sparse.diags(W) + lam * (D.T @ D)
    return spsolve(A.tocsc(), W * Y)

t0 = df.acq.min()
tday = ((df.acq - t0).dt.days).values
y = df.ndvi.values.copy(); w = df.w.values.copy()

def ws_at_obs(lam, w_, env=0):
    w2 = w_.copy()
    z = whittaker(tday, y, w2, lam)
    for _ in range(env):
        below = (y < z[tday]) & (w_ > 0)
        w2 = np.where(below, w_ * 0.2, w_)
        z = whittaker(tday, y, w2, lam)
    return z

def sg(w_, chen=False):
    s = pd.Series(np.where(w_ > 0, y, np.nan), index=df.acq).interpolate("time").bfill().ffill().values
    f = savgol_filter(s, 5, 2)
    if chen:  # Chen 2004: replace points below the trend with the fit, refit with smaller window
        cur = s.copy()
        for _ in range(4):
            cur = np.where(cur < f, f, cur)
            f = savgol_filter(cur, 5, 3)
    return f

def harm(w_, k=3):
    t = tday / 365.25 * 2 * np.pi
    X = np.column_stack([np.ones_like(t), t / (2 * np.pi)] + [f(j * t) for j in range(1, k + 1) for f in (np.sin, np.cos)])
    m = w_ > 0
    beta = np.linalg.lstsq(X[m] * w_[m, None], y[m] * w_[m], rcond=None)[0]
    return X @ beta

def rough(x): return float(np.sqrt(np.mean(np.diff(x) ** 2)))

methods = {
    "WS l=5d": lambda w_: ws_at_obs(5, w_)[tday], "WS l=50d": lambda w_: ws_at_obs(50, w_)[tday],
    "WS l=500d": lambda w_: ws_at_obs(500, w_)[tday], "WS l=5000d": lambda w_: ws_at_obs(5000, w_)[tday],
    "WS-env l=500d": lambda w_: ws_at_obs(500, w_, env=2)[tday],
    "SG 5/2": lambda w_: sg(w_), "SG-Chen": lambda w_: sg(w_, True), "HARM k=3": lambda w_: harm(w_),
}
print(f"\nroughness (RMS 1st diff, NDVI units): raw={rough(y):.4f}  good-only={rough(y[good.values]):.4f}")
rng = np.random.default_rng(0)
gi = np.where(good.values)[0]
folds = np.array_split(rng.permutation(gi), 10)
res = []
for name, fnc in methods.items():
    z = fnc(w)
    resid = (y - z)[good.values]
    cv = []
    for fo in folds:
        w_ = w.copy(); w_[fo] = 0
        cv.append((y[fo] - fnc(w_)[fo]))
    cv = np.concatenate(cv)
    res.append(dict(method=name, roughness=round(rough(z), 4), rough_reduction_pct=round(100 * (1 - rough(z) / rough(y)), 1),
                    resid_rms_good=round(float(np.sqrt(np.mean(resid ** 2))), 4),
                    cv_rmse=round(float(np.sqrt(np.mean(cv ** 2))), 4), cv_bias=round(float(cv.mean()), 4)))
print(pd.DataFrame(res).to_string(index=False))

# lambda by GCV-like V-curve is overkill; pick the CV-best WS. Show 2023-24 drought window at a glance
z = ws_at_obs(500, w, env=2)
daily = pd.Series(z, index=pd.date_range(t0, periods=len(z), freq="D"))
print("\nWS-env l=500d, value on the 1st of each month (shows seasonal cycle + 2023-24 drought):")
mo = daily.resample("MS").first()
print(" ".join(f"{i.strftime('%y-%m')}:{v:.2f}" for i, v in mo.items()))
out = pd.DataFrame({"acq": df.acq.dt.date.astype(str), "ndvi": y.round(4), "rel": df.rel.values, "ws_env_500": z[tday].round(4), "ws_50": ws_at_obs(50, w)[tday].round(4)}, index=df.index.date.astype(str))
out.to_csv(HERE / ("exp_smooth_series_" + ("cuatrocanadas" if "Cuatro" in d["farm"] else d["farm"].split()[-1].lower()) + ".csv"))
