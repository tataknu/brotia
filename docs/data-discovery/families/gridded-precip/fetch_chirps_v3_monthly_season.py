"""CHIRPS v3 monthly Oct..Mar for seasons 1991/92..2023/24 at 2 farms (CHC COG range reads, paced) -> CSV."""
import time, csv, rasterio
from rasterio.env import Env
pts = [(-62.52, -16.86), (-63.29, -17.20)]
out = []
with Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="5"):
    for y in range(1991, 2024):
        for ym in [f"{y}.10", f"{y}.11", f"{y}.12", f"{y+1}.01", f"{y+1}.02", f"{y+1}.03"]:
            with rasterio.open(f"/vsicurl/https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/global/tifs/chirps-v3.0.{ym}.tif") as ds:
                v = [float(x[0]) for x in ds.sample(pts)]
            out.append((y, ym, *[round(x, 1) for x in v])); time.sleep(0.3)
        print(y, flush=True)
with open("chirps_v3_monthly_octmar_2farms.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["season_start", "month", "tajibos", "mineros"]); w.writerows(out)
