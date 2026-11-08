"""Build a QC'd daily series + same-time-of-year climatology for one Chilean WMO station
from raw OGIMET SYNOP (2000 -> now) and GHCN-Daily (pre-2000 / cross-check), then compare
2023-2024 with ERA5-Land (Tmax/Tmin) and ERA5 (precip) at the station point (Open-Meteo archive).

usage: python build_station_daily.py WMO GHCN_ID RAW_OG_DIR GHCND_CSV ERA5_JSON OUT_DIR

Daily rules (Chile, RA III; verified on the 2026-11 bulletins):
  precip day D = 12Z(D) -> 12Z(D+1) [= 08/09 local D -> D+1]; labelled with the START day (D),
    the same convention as the DMC "dia pluviometrico" ends at 12Z, and the gridded products' local day
    mostly overlaps it. Priority:
      1. sec-3 7RRRR at 12Z(D+1)            (24 h amount, tenths of mm, 9999 = trace)
      2. sec-1 6RRRt tR=4 at 12Z(D+1)        (24 h amount)
      3. sum of sec-1 6RRRt tR=1 (6 h) at 18Z, 00Z, 06Z, 12Z  (all four present)
      4. sum of sec-3 6RRRt tR=5 (1 h) amounts, if >= 22 of 24 hours present (modern hourly AWS SYNOP)
      5. iR = 3 at 12Z(D+1)                  -> 0 mm (group omitted because dry)
    Days with only 3 of 4 six-hour slots are left missing (a sum would be a lower bound).
    QC: reject > 250 mm/day.
  Tmax day D = sec-3 1sTTT at 00Z(D+1) (12 h daytime max); Tmin day D = sec-3 2sTTT at 12Z(D).
    QC: Tx >= Tn, -15 < T < 46.
"""
import sys, os, glob, json
import numpy as np
import pandas as pd

wmo, gid, raw, ghcnd_csv, era5_json, out = sys.argv[1:7]
os.makedirs(out, exist_ok=True)


def temp(g):
    if len(g) != 5 or not g[2:5].isdigit() or g[1] not in "01":
        return np.nan
    return (-1 if g[1] == "1" else 1) * int(g[2:5]) / 10


def rrr(g):
    v = int(g[1:4])
    return 0.0 if v == 990 else (v - 990) / 10 if v > 990 else float(v)


def parse(line):
    p = line.strip().rstrip("=").split(",", 6)
    t = pd.Timestamp(int(p[1]), int(p[2]), int(p[3]), int(p[4]), int(p[5]))
    msg = p[6].replace("=", " ").split()
    o = dict(time=t, iR=None, p_sec1=np.nan, tR1=None, p1h=np.nan, p24=np.nan, tx=np.nan, tn=np.nan, t=np.nan)
    try:
        body = msg[msg.index(wmo) + 1:]
    except ValueError:
        return o
    if not body:
        return o
    o["iR"] = body[0][0]
    sec = 1
    for g in body[2:]:
        if g == "333":
            sec = 3; continue
        if g in ("444", "555"):
            break
        if len(g) != 5 or not g[0].isdigit():
            continue
        if sec == 1:
            if g[0] == "1" and np.isnan(o["t"]):
                o["t"] = temp(g)
            elif g[0] == "6" and g[1:4].isdigit():
                o["p_sec1"], o["tR1"] = rrr(g), g[4]
        else:
            if g[0] == "1" and np.isnan(o["tx"]):
                o["tx"] = temp(g)
            elif g[0] == "2" and np.isnan(o["tn"]):
                o["tn"] = temp(g)
            elif g[0] == "6" and g[1:4].isdigit() and g[4] == "5":
                o["p1h"] = rrr(g)
            elif g[0] == "7" and g[1:].isdigit():
                v = int(g[1:]); o["p24"] = 0.05 if v == 9999 else v / 10
    return o


recs = []
for f in sorted(glob.glob(f"{raw}/og_{wmo}_*.txt")):
    for line in open(f, encoding="latin-1"):
        if line.startswith(wmo + ","):
            try:
                recs.append(parse(line))
            except Exception:
                pass
s = pd.DataFrame(recs)
# merge duplicate bulletins for the same hour (manned + AWS, corrections): first non-null per field
s = s.sort_values("time").groupby("time").first().reset_index()
print(f"[{wmo}] synops (dedup) {len(s)}  {s.time.min()} .. {s.time.max()}")
s = s.set_index("time")
days = pd.date_range(s.index.min().normalize(), s.index.max().normalize(), freq="D")


def at(ts, col):
    try:
        return s.at[ts, col]
    except KeyError:
        return np.nan if col not in ("iR", "tR1") else None


rows = []
H = pd.Timedelta(hours=1)


def p6(ts):
    """6-h amount ending at ts: sec-1 6RRRt with tR=1, or 0 if iR=3 (omitted because dry)."""
    if at(ts, "tR1") == "1" and not pd.isna(at(ts, "p_sec1")):
        return at(ts, "p_sec1")
    if at(ts, "iR") == "3":
        return 0.0
    return np.nan


for D in days:
    e = D + 36 * H  # 12Z D+1
    p, src = np.nan, None
    six = [p6(D + h * H) for h in (18, 24, 30, 36)]
    if not pd.isna(at(e, "p24")):
        p, src = at(e, "p24"), "7RRRR_12Z"
    elif at(e, "tR1") == "4" and not pd.isna(at(e, "p_sec1")):
        p, src = at(e, "p_sec1"), "6RRR4_12Z"
    elif all(not pd.isna(x) for x in six):
        p, src = float(np.sum(six)), "sum4x6h"
    # NOTE: in Apr-Aug 2024 the 12Z bulletin is empty ('43/// /////') and an 18Z sec-3 7RRRR appears, but it equals
    # the 18Z 6-h amount (rain since the 12Z day reset), NOT a 24 h total -> deliberately not used.
    else:
        hrs = s.loc[D + 13 * H: e, "p1h"]
        if hrs.notna().sum() >= 22:
            p, src = float(hrs.sum()), "sum1h"
        elif at(e, "iR") == "3":
            p, src = 0.0, "iR3_12Z"
    if not pd.isna(p) and p > 250:
        p, src = np.nan, "qc_gt250"
    w = s.loc[D + 12 * H: D + 24 * H, "t"]; txh = w.max() if w.notna().sum() >= 10 else np.nan
    w = s.loc[D: D + 14 * H, "t"]; tnh = w.min() if w.notna().sum() >= 10 else np.nan
    rows.append(dict(date=D, precip_mm=p, precip_src=src, tmax_c=at(D + 24 * H, "tx"), tmin_c=at(D + 12 * H, "tn"),
                     tx_hourly=txh, tn_hourly=tnh))
d = pd.DataFrame(rows).set_index("date")
bad = (d.tmax_c < d.tmin_c) | (d.tmax_c > 46) | (d.tmax_c < -15)
d.loc[bad, "tmax_c"] = np.nan
d.loc[(d.tmin_c > 35) | (d.tmin_c < -15), "tmin_c"] = np.nan
# hourly-derived extremes miss the true max/min: fit an additive offset where both exist, apply to fallback days
for c, hcol in (("tmax", "tx_hourly"), ("tmin", "tn_hourly")):
    both_ = d[[c + "_c", hcol]].dropna()
    off = float((both_[c + "_c"] - both_[hcol]).median()) if len(both_) > 100 else 0.0
    print(f"{c}: hourly-fallback offset (synop - hourly) median {off:+.2f} C over n={len(both_)}, MAE after offset "
          f"{float((both_[c + '_c'] - both_[hcol] - off).abs().mean()):.2f}")
    d[c + "_src"] = np.where(d[c + "_c"].notna(), "synop_" + ("1sTTT_00Z" if c == "tmax" else "2sTTT_12Z"), None)
    fill = d[c + "_c"].isna() & d[hcol].notna()
    d.loc[fill, c + "_c"] = d.loc[fill, hcol] + off
    d.loc[fill, c + "_src"] = f"hourly_{'max' if c == 'tmax' else 'min'}{off:+.1f}"
d = d.drop(columns=["tx_hourly", "tn_hourly"])
print("tmax source mix:", d.tmax_src.value_counts(dropna=False).to_dict())
print("tmin source mix:", d.tmin_src.value_counts(dropna=False).to_dict())
print("precip source mix:", d.precip_src.value_counts(dropna=False).to_dict())

# ---------- GHCN-D (pre-2000 + fill + cross-check) ----------
g = pd.read_csv(ghcnd_csv, low_memory=False, parse_dates=["DATE"]).set_index("DATE")
gd = pd.DataFrame(index=g.index)
for v, c in (("PRCP", "precip_mm"), ("TMAX", "tmax_c"), ("TMIN", "tmin_c")):
    gd[c] = g[v] / 10 if v in g else np.nan  # NCEI access CSV is in tenths of mm / tenths of degC
# Alignment: GHCN-D labels by UTC observation date. Find the best day shift per variable and era
# (shift k means GHCN-D value at date D+k corresponds to our day D).
SHIFT = {}
for c in ("precip_mm", "tmax_c", "tmin_c"):
    for era, sl in (("<2010", slice(None, "2009-12-31")), (">=2015", slice("2015-01-01", None))):
        best = None
        for k in (-1, 0, 1, 2):
            m = d.loc[sl, [c]].join(gd[c].shift(-k, freq="D").rename("g"), how="inner").dropna()
            if c == "precip_mm":
                m = m[(m[c] > 0) | (m.g > 0)]
            if len(m) < 30:
                continue
            ex = float(np.mean((m[c] - m.g).abs() <= 0.15 if c != "precip_mm" else (m[c] - m.g).abs() <= 0.5))
            mae = float((m[c] - m.g).abs().mean())
            print(f"cross-check {c} {era} shift {k:+d}: n={len(m)} match={ex:.0%} MAE={mae:.2f} bias(ours-ghcnd)={float((m[c]-m.g).mean()):+.2f}")
            if best is None or ex > best[1]:
                best = (k, ex)
        if best:
            SHIFT[(c, era)] = best[0]
print("best shifts:", SHIFT)
for c in ("precip_mm", "tmax_c", "tmin_c"):
    k = SHIFT.get((c, "<2010"), 0)
    gd[c] = gd[c].shift(-k, freq="D")
pre = gd[gd.index < d.index.min()].copy()
for c in ("tmax", "tmin"):
    pre[c + "_src"] = np.where(pre[c + "_c"].notna(), "ghcnd", None)
pre["precip_src"] = np.where(pre.precip_mm.notna(), "ghcnd", None)
full = pd.concat([pre, d]).sort_index()
full = full[~full.index.duplicated(keep="last")]
full.index.name = "date"
full.round(1).to_csv(f"{out}/{wmo}_daily.csv")

# ---------- completeness ----------
comp = full.groupby(full.index.year).agg(days=("tmax_c", "size"), precip_n=("precip_mm", "count"),
                                         tmax_n=("tmax_c", "count"), tmin_n=("tmin_c", "count"),
                                         precip_total=("precip_mm", "sum"))
comp.to_csv(f"{out}/{wmo}_completeness_by_year.csv")
print(comp[comp.index >= 1985].to_string())

# ---------- climatology: same calendar month, baseline years with >= 80 % days ----------
BASE = (2000, 2022)
b = full[(full.index.year >= BASE[0]) & (full.index.year <= BASE[1])].copy()
b["ym"] = b.index.to_period("M")
mm = b.groupby("ym").agg(n=("precip_mm", "count"), size=("precip_mm", "size"), p=("precip_mm", "sum"),
                         ntx=("tmax_c", "count"), tx=("tmax_c", "mean"), ntn=("tmin_c", "count"), tn=("tmin_c", "mean"))
mm["month"] = mm.index.month
okp = mm[mm.n >= 0.8 * mm["size"]]
okt = mm[(mm.ntx >= 0.8 * mm["size"]) & (mm.ntn >= 0.8 * mm["size"])]
dly = b.copy(); dly["month"] = dly.index.month
clim = pd.DataFrame({
    "n_years_precip": okp.groupby("month").size(),
    "precip_mean_mm": okp.groupby("month").p.mean(),
    "precip_p10_mm": okp.groupby("month").p.quantile(0.1),
    "precip_p50_mm": okp.groupby("month").p.median(),
    "precip_p90_mm": okp.groupby("month").p.quantile(0.9),
    "wetday_freq_ge1mm": dly.groupby("month").precip_mm.apply(lambda x: (x >= 1).sum() / x.count()),
    "n_years_temp": okt.groupby("month").size(),
    "tmax_mean_c": dly.groupby("month").tmax_c.mean(),
    "tmax_p90_c": dly.groupby("month").tmax_c.quantile(0.9),
    "tmin_mean_c": dly.groupby("month").tmin_c.mean(),
    "tmin_p10_c": dly.groupby("month").tmin_c.quantile(0.1),
    "tmin_min_c": dly.groupby("month").tmin_c.min(),
    "days_tmax_ge30_per_month": dly.groupby("month").tmax_c.apply(lambda x: 30.4 * (x >= 30).sum() / max(x.count(), 1)),
    "days_tmin_le0_per_month": dly.groupby("month").tmin_c.apply(lambda x: 30.4 * (x <= 0).sum() / max(x.count(), 1)),
}).round(2)
clim.index.name = "month"
clim.to_csv(f"{out}/{wmo}_climatology_monthly_{BASE[0]}_{BASE[1]}.csv")
print(f"\nclimatology {BASE}: annual precip mean = {clim.precip_mean_mm.sum():.0f} mm")
print(clim.to_string())

# ---------- baseline-era sensitivity (megadrought 2010-) ----------
def monthly_ok(y0, y1):
    bb = full[(full.index.year >= y0) & (full.index.year <= y1)].copy(); bb["ym"] = bb.index.to_period("M")
    q = bb.groupby("ym").agg(n=("precip_mm", "count"), size=("precip_mm", "size"), p=("precip_mm", "sum"))
    q["month"] = q.index.month
    return q[q.n >= 0.8 * q["size"]]
ERAS = {"1985_2009": (1985, 2009), "2000_2022": (2000, 2022), "2010_2022": (2010, 2022), "1985_2022": (1985, 2022)}
eraok = {k: monthly_ok(*v) for k, v in ERAS.items()}
sens = pd.DataFrame({f"{k}_{st}": getattr(v.groupby("month").p, st)() if st != "n" else v.groupby("month").size()
                     for k, v in eraok.items() for st in ("n", "mean", "median")}).round(1)
sens.index.name = "month"
sens.to_csv(f"{out}/{wmo}_baseline_era_sensitivity.csv")
print("\nbaseline-era sensitivity (monthly precip, years with >=80% days):")
print(sens.to_string())
print({k: round(v.groupby('month').p.mean().sum(), 0) for k, v in eraok.items()}, "annual mean (sum of monthly means)")

# ---------- histograms ----------
bins = [-0.01, 0.0, 1, 5, 10, 20, 50, 1e9]; lab = ["0", "0.1-1", "1-5", "5-10", "10-20", "20-50", ">50"]
hist = []
for name, sel in (("wet_season_may_sep", dly.month.between(5, 9)), ("dry_season_oct_apr", ~dly.month.between(5, 9))):
    x = pd.cut(dly.loc[sel, "precip_mm"].dropna(), bins, labels=lab).value_counts(normalize=True).reindex(lab)
    hist += [dict(var=name, bin=k, frac=round(v, 4)) for k, v in x.items()]
for c in ("tmax_c", "tmin_c"):
    x = dly[c].dropna(); x = np.floor(x).astype(int).value_counts(normalize=True).sort_index()
    hist += [dict(var=c, bin=f"{k}..{k+1}", frac=round(v, 4)) for k, v in x.items()]
pd.DataFrame(hist).to_csv(f"{out}/{wmo}_histograms.csv", index=False)
for vname in ("wet_season_may_sep", "dry_season_oct_apr", "tmax_c", "tmin_c"):
    print(vname)
    for h in hist:
        if h["var"] == vname and h["frac"] >= 0.004:
            print(f"  {h['bin']:>8} {100*h['frac']:5.1f}% " + "#" * int(round(60 * h["frac"])))

# ---------- monthly 2023 -> now with percentile vs baseline ----------
rec = full[full.index >= "2023-01-01"].copy(); rec["ym"] = rec.index.to_period("M")
rm = rec.groupby("ym").agg(days_present=("precip_mm", "count"), precip_mm=("precip_mm", "sum"),
                           tx=("tmax_c", "mean"), tn=("tmin_c", "mean"),
                           frost_days=("tmin_c", lambda x: int((x <= 0).sum())), hot_days_ge30=("tmax_c", lambda x: int((x >= 30).sum())))
rm["month"] = rm.index.month
rm.loc[rm.days_present < 0.8 * rm.index.days_in_month, "precip_mm"] = np.nan
rm["baseline_mean_mm"] = rm.month.map(clim.precip_mean_mm)
rm["pct_of_mean"] = (100 * rm.precip_mm / rm.baseline_mean_mm).round(0)
rm["percentile_vs_baseline"] = [round(100 * (okp[okp.month == m].p < v).mean(), 0) if not pd.isna(v) else np.nan for m, v in zip(rm.month, rm.precip_mm)]
for k, v in eraok.items():
    rm[f"pctl_{k}"] = [round(100 * (v[v.month == m].p < x).mean(), 0) if not pd.isna(x) and (v.month == m).sum() >= 5 else np.nan for m, x in zip(rm.month, rm.precip_mm)]
rm["tx_anom_c"] = (rm.tx - rm.month.map(clim.tmax_mean_c)).round(1)
rm["tn_anom_c"] = (rm.tn - rm.month.map(clim.tmin_mean_c)).round(1)
rm.round(1).drop(columns="month").to_csv(f"{out}/{wmo}_monthly_2023_now.csv")
print(rm.round(1).drop(columns="month").to_string())

# ---------- ERA5-Land / ERA5 at the station point, 2023-2024 ----------
E = json.load(open(era5_json)); ed = pd.DataFrame(E["daily"]); ed["date"] = pd.to_datetime(ed.time); ed = ed.set_index("date")
print(f"\nERA5 grid point used: lat {E['latitude']} lon {E['longitude']} elev {E['elevation']} m (station-point request)")
st = full.loc["2023-01-01":"2024-12-31"]
# station precip day D = 08 local D -> 08 local D+1, ERA5 daily = 00-24 local: compare monthly + daily with lag 0
J = st.join(ed[["precipitation_sum_era5", "temperature_2m_max_era5_land", "temperature_2m_min_era5_land",
                "temperature_2m_max_era5", "temperature_2m_min_era5"]], how="inner")
res = {}
for a, bcol in (("tmax_c", "temperature_2m_max_era5_land"), ("tmin_c", "temperature_2m_min_era5_land"),
                ("tmax_c", "temperature_2m_max_era5"), ("tmin_c", "temperature_2m_min_era5")):
    m = J[[a, bcol]].dropna(); df_ = m[bcol] - m[a]
    res[f"{a} vs {bcol}"] = dict(n=len(m), bias=round(df_.mean(), 2), mae=round(df_.abs().mean(), 2), r=round(m[a].corr(m[bcol]), 3))
    # frost-day detection
    if a == "tmin_c":
        so, eo = m[a] <= 0, m[bcol] <= 0
        res[f"{a} vs {bcol}"].update(frost_days_station=int(so.sum()), frost_days_model=int(eo.sum()), hits=int((so & eo).sum()))
    else:
        so, eo = m[a] >= 30, m[bcol] >= 30
        res[f"{a} vs {bcol}"].update(hot_days_station=int(so.sum()), hot_days_model=int(eo.sum()), hits=int((so & eo).sum()))
m = J[["precip_mm", "precipitation_sum_era5"]].dropna()
for lag in (0, 1):
    mm_ = J[["precip_mm"]].join(ed.precipitation_sum_era5.shift(-lag).rename("e"), how="inner").dropna()
    res[f"precip daily vs ERA5 lag{lag}"] = dict(n=len(mm_), r=round(mm_.precip_mm.corr(mm_.e), 3),
        wetdays_station=int((mm_.precip_mm >= 1).sum()), wetdays_era5=int((mm_.e >= 1).sum()))
Jm = J.copy(); Jm["ym"] = Jm.index.to_period("M")
mon = Jm.groupby("ym").agg(n=("precip_mm", "count"), st_precip=("precip_mm", "sum"), era5_precip=("precipitation_sum_era5", "sum"),
                           st_tx=("tmax_c", "mean"), e5l_tx=("temperature_2m_max_era5_land", "mean"),
                           st_tn=("tmin_c", "mean"), e5l_tn=("temperature_2m_min_era5_land", "mean"))
mon.loc[mon.n < 25, "st_precip"] = np.nan
ok = mon.dropna(subset=["st_precip"])
res["precip monthly vs ERA5"] = dict(n=len(ok), r=round(ok.st_precip.corr(ok.era5_precip), 3),
    ratio_era5_over_station=round(ok.era5_precip.sum() / ok.st_precip.sum(), 2),
    station_total=round(ok.st_precip.sum(), 0), era5_total=round(ok.era5_precip.sum(), 0))
mon.round(1).to_csv(f"{out}/{wmo}_vs_era5_2023_2024_monthly.csv")
print(mon.round(1).to_string())
for k, v in res.items():
    print(k, v)
json.dump(res, open(f"{out}/{wmo}_vs_era5_2023_2024_stats.json", "w"), indent=1, default=float)
