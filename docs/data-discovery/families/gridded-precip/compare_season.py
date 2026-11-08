"""Compare Oct-2023..Mar-2024 precipitation totals across products at 2 farms, and rank the 2023-24
season against each product's own 1991-2020 same-season history (empirical percentile, ADR-0002 D5)."""
import json, gzip, re, time, requests, pandas as pd
FARMS = {"tajibos": (-62.52, -16.86, "Estancia Los Tajibos"), "mineros": (-63.29, -17.20, "Arrocera Mineros")}
def season_tot(s, y):  # Oct(y)..Mar(y+1)
    return s[f"{y}-10-01":f"{y+1}-03-31"].sum()
def pctl(s):
    tots = {y: season_tot(s, y) for y in range(1981, 2025) if s.index.min() <= pd.Timestamp(f"{y}-10-01")}
    base = [v for y, v in tots.items() if 1991 <= y <= 2020]
    t = tots[2023]
    return round(t, 1), round(sum(b < t for b in base) / len(base) * 100), round(sum(base) / len(base), 1)
# ERA5 via Open-Meteo
era = json.load(gzip.open("sample_era5_om_12farms_1981_2026.json.gz", "rt"))
idx = pd.to_datetime(era["time"])
names = {"tajibos": "Estancia Los Tajibos", "mineros": "Arrocera Mineros"}
rows = []
cpc = "https://psl.noaa.gov/thredds/dodsC/Datasets/cpc_global_precip"
for k, (lon, lat, nm) in FARMS.items():
    out = {"farm": nm}
    s = pd.Series(era["farms"][nm]["p"], index=idx, dtype=float)
    out["ERA5 (Open-Meteo, 0.25)"] = pctl(s)
    c = pd.read_csv(f"sample_chirps_cs_{k}.csv", parse_dates=["date"]).set_index("date")["precip_mm"]
    out["CHIRPS v2 (ClimateSERV, 0.05)"] = pctl(c)
    pj = json.load(open("power_hist.json" if k == "tajibos" else "power_hist_mineros.json"))["properties"]["parameter"]["PRECTOTCORR"]
    p = pd.Series({pd.Timestamp(d): (v if v > -900 else None) for d, v in pj.items()}, dtype=float)
    out["NASA POWER PRECTOTCORR (MERRA-2, 0.5x0.625)"] = pctl(p)
    # CPC Unified gauge (season only), nearest 0.5 cell
    li = round((89.75 - lat) / 0.5); lj = round(((lon + 360) - 0.25) / 0.5)
    tot = 0
    for y, r in ((2023, "273:1:364"), (2024, "0:1:90")):
        txt = requests.get(f"{cpc}/precip.{y}.nc.ascii?precip[{r}][{li}:1:{li}][{lj}:1:{lj}]", timeout=60).text
        tot += sum(float(m) for m in re.findall(r"^\[\d+\]\[0\], ([-\d.eE]+)", txt, re.M))
    out["CPC Unified gauge (PSL OPeNDAP, 0.5)"] = (round(tot, 1), None, None)
    rows.append(out)
for o in rows:
    print("\n==", o.pop("farm"), " [season total mm, percentile of 2023-24 vs 1991-2020, 1991-2020 mean]")
    for kk, v in o.items(): print(f"  {kk:48s} {v}")
