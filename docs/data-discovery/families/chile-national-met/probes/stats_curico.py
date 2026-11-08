"""Stats for curico_2023_2024_three_source.csv (DMC station = reference)."""
import os, pandas as pd, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
df = pd.read_csv(os.path.join(HERE, "curico_2023_2024_three_source.csv"), index_col=0, parse_dates=True)
srcs = [s for s in ["cr2", "pow", "era"] if f"{s}_pr" in df and df[f"{s}_pr"].notna().any()]
out = []
for s in srcs:
    r = {"src": s}
    for lag in (-1, 0, 1):
        r[f"pr_corr_lag{lag}"] = round(df["dmc_pr"].corr(df[f"{s}_pr"].shift(lag)), 3)
        r[f"tmin_corr_lag{lag}"] = round(df["dmc_tmin"].corr(df[f"{s}_tmin"].shift(lag)), 3)
    best = max((-1, 0, 1), key=lambda l: r[f"pr_corr_lag{l}"])
    r["pr_best_lag"] = best
    p = df[f"{s}_pr"].shift(best)
    r["pr_total_ratio_%"] = round(100 * (df[f"{s}_pr"].sum() / df["dmc_pr"].sum() - 1), 1)
    obs_wet, mod_wet = df["dmc_pr"] >= 1, p >= 1
    r["wet_POD"] = round((obs_wet & mod_wet).sum() / obs_wet.sum(), 2)
    r["wet_FAR"] = round((~obs_wet & mod_wet).sum() / mod_wet.sum(), 2)
    r["wetdays_obs/mod"] = f"{obs_wet.sum()}/{mod_wet.sum()}"
    r["pr3d_corr"] = round(df["dmc_pr"].rolling(3).sum().corr(df[f"{s}_pr"].rolling(3).sum()), 3)
    mo = df[["dmc_pr", f"{s}_pr"]].resample("MS").sum()
    r["pr_month_corr"] = round(mo.corr().iloc[0, 1], 3)
    r["2023-08-21..22_mm"] = round(df.loc["2023-08-20":"2023-08-23", f"{s}_pr"].sum(), 1)
    for v in ("tmax", "tmin"):
        d = df[f"{s}_{v}"] - df[f"dmc_{v}"]
        r[f"{v}_bias"] = round(d.mean(), 2); r[f"{v}_mae"] = round(d.abs().mean(), 2)
        r[f"{v}_corr"] = round(df[f"dmc_{v}"].corr(df[f"{s}_{v}"]), 3)
    r["frostdays_tmin<0 (obs=%d)" % (df["dmc_tmin"] < 0).sum()] = int((df[f"{s}_tmin"] < 0).sum())
    r["hotdays_tmax>=33 (obs=%d)" % (df["dmc_tmax"] >= 33).sum()] = int((df[f"{s}_tmax"] >= 33).sum())
    out.append(r)
print("DMC 2023 total", df.loc["2023", "dmc_pr"].sum(), "2024 total", df.loc["2024", "dmc_pr"].sum(),
      "| DMC 2023-08-20..23:", df.loc["2023-08-20":"2023-08-23", "dmc_pr"].sum())
for s in srcs:
    print(s, "annual totals", df[f"{s}_pr"].resample("YS").sum().round(0).tolist())
print(pd.DataFrame(out).set_index("src").T.to_string())
