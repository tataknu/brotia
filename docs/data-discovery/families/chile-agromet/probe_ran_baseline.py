"""Same-time-of-year baseline demo from RAN (agromet.cl) hourly data for one station.
Window: 07-Oct..06-Nov of each year 2009..2026 (30 days ending at as-of). Derives daily
Tmin/Tmax from hourly fields 7/8 (hourly min/max), PP from field 2, frost hours (hourly Tmin<0),
hot hours (hourly Tmax>=30), then percentile of 2026 vs history.
"""
import os, sys, time, statistics as stx
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_agromet_ran import hourly

SID = sys.argv[1] if len(sys.argv) > 1 else "82"  # 82 = Requinoa (RAN)
out = []
for y in range(2009, 2027):
    rows = hourly(SID, f"{y}-10-08 00:00:00", f"{y}-11-06 23:59:59")
    T = [r["1"] for r in rows if r.get("1") is not None]
    TN = [r["7"] for r in rows if r.get("7") is not None]; TX = [r["8"] for r in rows if r.get("8") is not None]
    P = [r["2"] for r in rows if r.get("2") is not None]
    dn, dx = {}, {}
    for r in rows:
        d = r["ts"][:10]
        if r.get("7") is not None: dn.setdefault(d, []).append(r["7"])
        if r.get("8") is not None: dx.setdefault(d, []).append(r["8"])
    fn = [min(v) for v in dn.values() if len(v) >= 20]; fx = [max(v) for v in dx.values() if len(v) >= 20]
    rec = dict(year=y, hours=len(T), pp_mm=round(sum(P), 1) if P else None,
               tmin_mean=round(stx.mean(fn), 2) if fn else None,
               tmax_mean=round(stx.mean(fx), 2) if fx else None,
               frost_h=sum(t < 0 for t in TN), hot_h=sum(t >= 30 for t in TX))
    print(rec); out.append(rec); time.sleep(1)
cur = out[-1]; hist = [r for r in out[:-1] if r["hours"] > 600]
for k in ["pp_mm", "tmin_mean", "tmax_mean", "frost_h", "hot_h"]:
    h = [r[k] for r in hist if r[k] is not None]
    if cur[k] is None or not h: continue
    pct = 100 * sum(v <= cur[k] for v in h) / len(h)
    print(f"{k}: 2026={cur[k]}  hist n={len(h)} median={stx.median(h)}  empirical pct={pct:.0f}")
