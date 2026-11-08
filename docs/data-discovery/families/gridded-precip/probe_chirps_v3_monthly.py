"""CHIRPS v3 monthly (final) Oct-2023..Mar-2024 at 2 farms via HTTP range reads of CHC GeoTIFFs (no key, slow, 429-prone)."""
import time, rasterio
from rasterio.env import Env
pts = [(-62.52, -16.86), (-63.29, -17.20)]
tot = [0.0, 0.0]
with Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="10"):
    for ym in ["2023.10", "2023.11", "2023.12", "2024.01", "2024.02", "2024.03"]:
        time.sleep(5); t0 = time.time()
        with rasterio.open(f"/vsicurl/https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/global/tifs/chirps-v3.0.{ym}.tif") as ds:
            v = [float(x[0]) for x in ds.sample(pts)]
        tot = [a + b for a, b in zip(tot, v)]
        print(ym, [round(x, 1) for x in v], f"{time.time()-t0:.1f}s", flush=True)
print("season totals tajibos, mineros:", [round(x, 1) for x in tot])
