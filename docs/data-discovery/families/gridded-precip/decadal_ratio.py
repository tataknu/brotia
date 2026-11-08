"""Decadal mean Oct-Mar totals ERA5 vs CHIRPSv2 at 2 farms: is the ERA5/CHIRPS ratio stable (baseline-compatible)?"""
import json, gzip, pandas as pd
era = json.load(gzip.open("sample_era5_om_12farms_1981_2026.json.gz", "rt")); idx = pd.to_datetime(era["time"])
tot = lambda s, y: s[f"{y}-10-01":f"{y+1}-03-31"].sum()
for k, nm in (("tajibos", "Estancia Los Tajibos"), ("mineros", "Arrocera Mineros")):
    e = pd.Series(era["farms"][nm]["p"], index=idx, dtype=float)
    c = pd.read_csv(f"sample_chirps_cs_{k}.csv", parse_dates=["date"]).set_index("date")["precip_mm"]
    print(nm)
    for a, b in ((1981, 1990), (1991, 2000), (2001, 2010), (2011, 2020), (2021, 2024)):
        ys = range(a, b + 1) if b < 2024 else range(2021, 2025)
        ys = [y for y in ys if y <= 2024 and not (y == 2024 and k == '')]
        ys = [y for y in ys if y < 2025 and pd.Timestamp(f"{y+1}-03-31") <= c.index.max()]
        me = sum(tot(e, y) for y in ys) / len(ys); mc = sum(tot(c, y) for y in ys) / len(ys)
        print(f"  {a}-{ys[-1]}  ERA5 {me:6.0f}  CHIRPS {mc:6.0f}  ratio {me/mc:4.2f}")
    r = pd.Series({y: tot(e, y) / tot(c, y) for y in range(1981, 2025)})
    print("  corr of yearly totals:", round(pd.Series({y: tot(e, y) for y in range(1981, 2025)}).corr(pd.Series({y: tot(c, y) for y in range(1981, 2025)})), 2))
