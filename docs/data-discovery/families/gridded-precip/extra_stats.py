"""(a) ERA5 2023-24 Oct-Mar percentile for all 12 farms; (b) wet-day frequency & max dry spell per product at 2 farms (dryDays metric sensitivity)."""
import json, gzip, pandas as pd
era = json.load(gzip.open("sample_era5_om_12farms_1981_2026.json.gz", "rt")); idx = pd.to_datetime(era["time"])
def tot(s, y): return s[f"{y}-10-01":f"{y+1}-03-31"].sum()
print("(a) ERA5 Oct23-Mar24 total, pctile vs 1991-2020, base mean")
for nm, f in era["farms"].items():
    s = pd.Series(f["p"], index=idx, dtype=float); b = [tot(s, y) for y in range(1991, 2021)]; t = tot(s, 2023)
    print(f"  {nm:32s} cell=({f['lat']},{f['lon']}) {t:6.0f} mm  p{sum(x < t for x in b)/30*100:3.0f}  mean {sum(b)/30:6.0f}")
def spells(s):
    dry = (s < 1.0).astype(int); g = (dry != dry.shift()).cumsum(); return dry.groupby(g).sum().max()
print("(b) Oct23-Mar24: wet days(>=1mm) / max dry spell (<1mm) / clim wet days per season 1991-2020")
for k, nm in (("tajibos", "Estancia Los Tajibos"), ("mineros", "Arrocera Mineros")):
    e = pd.Series(era["farms"][nm]["p"], index=idx, dtype=float)
    c = pd.read_csv(f"sample_chirps_cs_{k}.csv", parse_dates=["date"]).set_index("date")["precip_mm"]
    pj = json.load(open("power_hist.json" if k == "tajibos" else "power_hist_mineros.json"))["properties"]["parameter"]["PRECTOTCORR"]
    p = pd.Series({pd.Timestamp(d): v for d, v in pj.items()}, dtype=float).where(lambda x: x > -900)
    for lab, s in (("ERA5", e), ("CHIRPSv2", c), ("POWER", p)):
        w = s["2023-10-01":"2024-03-31"]
        cw = sum((s[f"{y}-10-01":f"{y+1}-03-31"] >= 1).sum() for y in range(1991, 2021)) / 30
        print(f"  {nm:22s} {lab:9s} wet={int((w>=1).sum()):3d} maxdry={int(spells(w)):3d} climwet={cw:5.1f}")
