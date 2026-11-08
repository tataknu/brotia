"""Build a daily series + same-time-of-year climatology for Viru Viru (WMO 85244 / SLVR).

Inputs (raw, kept in a scratch dir, NOT committed):
  - OGIMET raw SYNOP yearly files  og_85244_YYYY.txt   (ogimet_bulk_pull.sh)
  - GHCN-Daily station CSV        ghcn_BLM00085244.csv  (NCEI access/, keyless)
  - IEM daily METAR summary       iem_daily_SLVR.csv    (IEM daily.py, keyless)
Outputs (small, in this family folder):
  - slvr_daily.csv                daily precip/Tx/Tn 2000..today with per-field source
  - slvr_climatology_monthly.csv  per calendar month: precip mean/p10/p50/p90, wet-day freq, Tx/Tn stats
  - slvr_histograms.csv           daily precip bins (wet/dry season) and Tx/Tn 1-degC bins
  - slvr_monthly_2023_now.csv      monthly totals Jul-2023..now with percentile vs same-month baseline
usage: python build_slvr_climatology.py RAW_DIR OUT_DIR
"""
import sys, glob, os
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from ogimet_synop import parse  # noqa: E402

raw, out = sys.argv[1], sys.argv[2]
ST = "85244"

# ---------- 1. OGIMET SYNOP -> daily ----------
recs = []
for f in sorted(glob.glob(f"{raw}/og85244/og_{ST}_*.txt")):
    for line in open(f, encoding="latin-1"):
        if line.startswith(ST + ","):
            try:
                recs.append(parse(line))
            except Exception:  # malformed / truncated bulletin
                pass
s = pd.DataFrame(recs).drop_duplicates("time").sort_values("time")
s["date"] = s.time.dt.normalize()
print("synops", len(s), s.time.min(), s.time.max())
print("tR at 12Z:", s[s.time.dt.hour == 12].tR.value_counts(dropna=False).to_dict())
print("iR at 12Z:", s[s.time.dt.hour == 12].iR.value_counts(dropna=False).to_dict())

r12 = s[s.time.dt.hour == 12].set_index("date")
r00 = s[s.time.dt.hour == 0].set_index("date")


def p24(row):
    if pd.notna(row.p24):
        return row.p24, "synop_333_7RRRR"
    if row.tR == "4" and pd.notna(row.p6):
        return row.p6, "synop_6RRR_tR4"
    if row.iR == "3":
        return 0.0, "synop_iR3_zero"
    return np.nan, None


pp = r12.apply(lambda r: pd.Series(p24(r), index=["p", "psrc"]), axis=1)
# QC: gross-error cap. Station coding errors exist (2024-01-11 12Z: sec-1 '69114' = 911 mm vs sec-3 '70001' = 0.1 mm)
bad = pp.p > 250
print("QC rejected precip values:", pp[bad].p.to_dict())
pp.loc[bad, "p"] = np.nan; pp.loc[bad, "psrc"] = "qc_reject_gt250"
# 12Z(D) report covers 12Z(D-1)..12Z(D) = 08:00 local D-1 .. 08:00 local D -> label D-1
pp.index = pp.index - pd.Timedelta(days=1)
tx = r00.tx.copy(); tx.index = tx.index - pd.Timedelta(days=1)  # 00Z(D+1) daytime max -> day D
tn = r12.tn  # 12Z(D) night min -> day D
idx = pd.date_range("1985-01-01", max(s.date.max(), pd.Timestamp.now("UTC").tz_localize(None).normalize()), freq="D")
d = pd.DataFrame(index=idx)
d["precip_mm"] = pp.p.reindex(idx)
d["precip_src"] = pp.psrc.reindex(idx)
d["tmax_c"] = tx.reindex(idx)
d["tmin_c"] = tn.reindex(idx)
d["tmax_src"] = np.where(d.tmax_c.notna(), "ogimet_synop", None)
d["tmin_src"] = np.where(d.tmin_c.notna(), "ogimet_synop", None)

# ---------- 2. gap-fill temps from GHCN-D (same SYNOP origin, via GSOD) ----------
g = pd.read_csv(f"{raw}/ghcn_BLM00085244.csv", parse_dates=["DATE"], low_memory=False).set_index("DATE")
for col, gc in (("tmax_c", "TMAX"), ("tmin_c", "TMIN")):
    fill = (g[gc] / 10).reindex(idx)
    m = d[col].isna() & fill.notna()
    d.loc[m, col] = fill[m]
    d.loc[m, col.replace("_c", "_src")] = "ghcnd"

# precip: GHCN-D only for 1985-1998 dense years (264-352 PRCP days/yr, dry days present).
# Post-1999 GHCN-D PRCP mostly omits dry days -> never used to fill (missing != 0).
gp = (g.PRCP / 10)
dense = gp.groupby(gp.index.year).count()
dense_years = [y for y, n in dense.items() if n >= 0.7 * 365 and y <= 1998]
fill = gp[gp.index.year.isin(dense_years)].reindex(idx)
m = d.precip_mm.isna() & fill.notna()
d.loc[m, "precip_mm"] = fill[m]
d.loc[m, "precip_src"] = "ghcnd_dense_year"
print("GHCN-D dense precip years used:", dense_years)

# ---------- 3. gap-fill temps from IEM METAR daily (bias-adjusted Tx) ----------
i = pd.read_csv(f"{raw}/iem_daily_SLVR.csv", parse_dates=["day"]).set_index("day")
i = i[i.max_temp_f > i.min_temp_f]  # drop single-observation days (max == min), e.g. sparse 2009
itx = ((i.max_temp_f - 32) * 5 / 9).reindex(idx)
itn = ((i.min_temp_f - 32) * 5 / 9).reindex(idx)
both = d.tmax_c.notna() & itx.notna()
txbias = float((d.tmax_c[both] - itx[both]).mean())
both = d.tmin_c.notna() & itn.notna()
tnbias = float((d.tmin_c[both] - itn[both]).mean())
print(f"IEM->SYNOP bias: Tx {txbias:+.2f} C, Tn {tnbias:+.2f} C")
for col, ser, b in (("tmax_c", itx, txbias), ("tmin_c", itn, tnbias)):
    m = d[col].isna() & ser.notna()
    d.loc[m, col] = (ser[m] + b).round(1)
    d.loc[m, col.replace("_c", "_src")] = "iem_metar_biasadj"

d.index.name = "date"
d.round(1).to_csv(f"{out}/slvr_daily.csv")

# ---------- 4. completeness ----------
comp = d[["precip_mm", "tmax_c", "tmin_c"]].notna().groupby(d.index.year).mean().round(3)
comp.index.name = "year"
comp.to_csv(f"{out}/slvr_completeness_by_year.csv")
print(comp.to_string())

# ---------- 5. climatology ----------
# precip baseline: every month <= 2022-12 with >=80% of days present (excludes the 2023-24 event)
# temperature baseline: 1991-2020 WMO normal period (GHCN-D + IEM make it ~complete)
pre = d.loc[:"2022-12-31"]
mon = pre.precip_mm.resample("MS").agg(["sum", "count"])
mon["ndays"] = mon.index.days_in_month
mon = mon[mon["count"] >= 0.8 * mon.ndays]  # month usable if >=80% days present
mon["sum_adj"] = mon["sum"] * mon.ndays / mon["count"]
P_YEARS = sorted(set(mon.index.year))
print("precip baseline years:", P_YEARS)
tbase = d.loc["1991":"2020"]
NT = tbase.index.year.nunique()
base = pre[pre.index.year.isin(P_YEARS)]
rows = []
for m in range(1, 13):
    pm = mon[mon.index.month == m].sum_adj
    dm = base[base.index.month == m]
    tm = tbase[tbase.index.month == m]
    rows.append({
        "month": m, "n_years_precip": len(pm),
        "precip_mean_mm": pm.mean(), "precip_p10_mm": pm.quantile(.1), "precip_p50_mm": pm.median(),
        "precip_p90_mm": pm.quantile(.9),
        "wetday_freq_ge1mm": (dm.precip_mm >= 1).sum() / dm.precip_mm.notna().sum(),
        "daily_p95_wet_mm": dm.precip_mm[dm.precip_mm >= 1].quantile(.95),
        "precip_baseline_years": f"{len(pm)} yrs in {P_YEARS[0]}-{P_YEARS[-1]}",
        "tmax_mean_c": tm.tmax_c.mean(), "tmax_p90_c": tm.tmax_c.quantile(.9),
        "tmax_p99_c": tm.tmax_c.quantile(.99), "tmin_mean_c": tm.tmin_c.mean(),
        "tmin_p10_c": tm.tmin_c.quantile(.1), "tmin_min_c": tm.tmin_c.min(),
        "days_tmax_ge35_per_month": (tm.tmax_c >= 35).sum() / tm.tmax_c.notna().sum() * len(tm) / NT,
        "days_tmin_le5_per_month": (tm.tmin_c <= 5).sum() / tm.tmin_c.notna().sum() * len(tm) / NT,
        "temp_baseline": "1991-2020",
    })
clim = pd.DataFrame(rows).round(2)
clim.to_csv(f"{out}/slvr_climatology_monthly.csv", index=False)
print(clim.to_string())
ann = mon.sum_adj.groupby(mon.index.year).agg(["sum", "count"])
print("annual (complete yrs):", ann[ann["count"] == 12]["sum"].round(0).to_dict())

# ---------- 6. histograms ----------
wet = d.index.month.isin([10, 11, 12, 1, 2, 3, 4])
pb = [-0.01, 0.0, 1, 5, 10, 20, 50, 1000]
lab = ["0", "0.1-1", "1-5", "5-10", "10-20", "20-50", ">50"]
h = []
for name, msk in (("wet_season_oct_apr", wet), ("dry_season_may_sep", ~wet)):
    x = d.loc[msk & d.index.year.isin(P_YEARS), "precip_mm"].dropna()
    c = pd.cut(x, pb, labels=lab).value_counts().reindex(lab)
    for k, v in c.items():
        h.append({"variable": "precip_mm", "subset": name, "bin": k, "count": int(v), "share": round(v / len(x), 4)})
for var in ("tmax_c", "tmin_c"):
    x = tbase[var].dropna()
    c = np.floor(x).astype(int).value_counts().sort_index()
    for k, v in c.items():
        h.append({"variable": var, "subset": "all_1991_2020", "bin": f"{k}..{k+1}", "count": int(v), "share": round(v / len(x), 4)})
pd.DataFrame(h).to_csv(f"{out}/slvr_histograms.csv", index=False)

# ---------- 7. drought validation 2023-25 ----------
allm = d.precip_mm.resample("MS").agg(["sum", "count"])
allm["tx_mean"] = d.tmax_c.resample("MS").mean()
allm["tn_mean"] = d.tmin_c.resample("MS").mean()
allm["tx_days_ge35"] = (d.tmax_c >= 35).resample("MS").sum()
ev = allm.loc["2023-07":].copy()
out_rows = []
for t, r in ev.iterrows():
    pm = mon[mon.index.month == t.month].sum_adj
    c = clim.set_index("month").loc[t.month]
    out_rows.append({
        "month": t.strftime("%Y-%m"), "days_present": int(r["count"]),
        "precip_mm": round(r["sum"] * t.days_in_month / r["count"], 1) if r["count"] >= 0.8 * t.days_in_month else None,
        "baseline_mean_mm": c.precip_mean_mm, "pct_of_mean": round(100 * r["sum"] * t.days_in_month / r["count"] / c.precip_mean_mm, 0) if r["count"] >= 0.8 * t.days_in_month else None,
        "percentile_vs_baseline": round(100 * (pm < r["sum"] * t.days_in_month / r["count"]).mean(), 0) if r["count"] >= 0.8 * t.days_in_month else None,
        "tx_mean_c": round(r.tx_mean, 1), "tx_anom_c": round(r.tx_mean - c.tmax_mean_c, 1),
        "tx_days_ge35": int(r.tx_days_ge35),
        "tn_mean_c": round(r.tn_mean, 1), "tn_anom_c": round(r.tn_mean - c.tmin_mean_c, 1),
    })
dv = pd.DataFrame(out_rows)
dv.to_csv(f"{out}/slvr_monthly_2023_now.csv", index=False)
print(dv.to_string())
