"""Near-real-time edge effect: how much does the 'as-of' smoothed NDVI change once later data arrives?

For every composite t from 2023-01 on, fit weighted Whittaker using only composites acquired <= t
(what the service would show on that day) and compare its value at t with the full-series fit.
Also reports the plain 'last good observation' as a baseline.
"""
import numpy as np, pandas as pd, importlib.util, pathlib, sys, io, contextlib
H = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("es", H / "exp_smooth.py")
es = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()):
    import warnings; warnings.filterwarnings("ignore"); spec.loader.exec_module(es)
y, w, tday, df = es.y, es.w, es.tday, es.df
for lam, env in [(5, 0), (50, 0), (500, 0), (500, 2)]:
    full = es.ws_at_obs(lam, w, env)[tday]
    errs, lastgood, hold = [], [], []
    for i in range(len(df)):
        if df.index[i] < pd.Timestamp("2023-01-01"): continue
        m = tday <= tday[i]
        ww = np.where(m, w, 0.0)
        z = es.whittaker(tday[m], y[m], ww[m], lam)
        for _ in range(env):
            below = (y[m] < z[tday[m]]) & (ww[m] > 0); w2 = np.where(below, ww[m] * 0.2, ww[m])
            z = es.whittaker(tday[m], y[m], w2, lam)
        errs.append(z[tday[i]] - full[i])
        g = np.where(m & (w > 0))[0]; lastgood.append(y[g[-1]] - full[i])
        hold.append(z[tday[g[-1]]] - full[i])  # WS value at the last good obs, held (no extrapolation)
    e, lg, hd = np.array(errs), np.array(lastgood), np.array(hold)
    print(f"WS l={lam}d env={env}: as-of minus final  RMS={np.sqrt(np.mean(e**2)):.4f}  mean={e.mean():+.4f}  p95|.|={np.percentile(abs(e),95):.4f}   (last-good-obs RMS={np.sqrt(np.mean(lg**2)):.4f}; WS-held-at-last-good RMS={np.sqrt(np.mean(hd**2)):.4f})  n={len(e)}")
