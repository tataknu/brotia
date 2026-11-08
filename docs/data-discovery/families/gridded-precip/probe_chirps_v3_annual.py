"""CHIRPS v3 annual totals 1981-2025 at 2 farms (CHC GeoTIFF range reads, paced) vs CHIRPS v2 (ClimateSERV) and ERA5 annual.
Purpose: homogeneity check of the long baseline (v2 shows a 1990s dip at Santa Cruz)."""
import time, json, gzip, rasterio, pandas as pd
from rasterio.env import Env
pts = {"tajibos": (-62.52, -16.86, "Estancia Los Tajibos"), "mineros": (-63.29, -17.20, "Arrocera Mineros")}
v3 = {k: {} for k in pts}
with Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="10"):
    for y in range(1981, 2026):
        time.sleep(2)
        with rasterio.open(f"/vsicurl/https://data.chc.ucsb.edu/products/CHIRPS/v3.0/annual/global/tifs/chirps-v3.0.{y}.tif") as ds:
            for k, v in zip(pts, ds.sample([(a, b) for a, b, _ in pts.values()])): v3[k][y] = float(v[0])
era = json.load(gzip.open("sample_era5_om_12farms_1981_2026.json.gz", "rt")); idx = pd.to_datetime(era["time"])
rows = []
for k, (lon, lat, nm) in pts.items():
    c = pd.read_csv(f"sample_chirps_cs_{k}.csv", parse_dates=["date"]).set_index("date")["precip_mm"]
    e = pd.Series(era["farms"][nm]["p"], index=idx, dtype=float)
    for y in range(1981, 2026):
        rows.append({"farm": k, "year": y, "chirps_v3": round(v3[k][y], 0), "chirps_v2": round(c[str(y)].sum(), 0), "era5": round(e[str(y)].sum(), 0)})
df = pd.DataFrame(rows); df.to_csv("annual_totals_v3_v2_era5.csv", index=False)
for k in pts:
    d = df[df.farm == k].copy(); d["dec"] = (d.year - 1981) // 10 * 10 + 1981
    print(k, "\n", d.groupby("dec")[["chirps_v3", "chirps_v2", "era5"]].mean().round(0).to_string())
    print("  corr v3~era5", round(d.chirps_v3.corr(d.era5), 2), " v3~v2", round(d.chirps_v3.corr(d.chirps_v2), 2), " v2~era5", round(d.chirps_v2.corr(d.era5), 2))
