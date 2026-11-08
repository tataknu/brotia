"""Read CHIRPS3-GEFS 16-day forecast total (issued today) at a farm pixel via HTTP range read (no key)."""
import time, rasterio
from rasterio.env import Env
u = "https://data.chc.ucsb.edu/products/CHIRPS-GEFS/v3/16_day/2026/11/c3g_2026.11.06.tif"
with Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="5"):
    t0 = time.time()
    with rasterio.open("/vsicurl/" + u) as ds:
        print(ds.profile.get("tiled"), ds.block_shapes[0], ds.count, ds.shape, ds.descriptions, ds.tags())
        for name, lon, lat in [("Tajibos", -62.52, -16.86), ("Mineros", -63.29, -17.2)]:
            print(name, [round(float(x), 1) for x in next(ds.sample([(lon, lat)]))], f"{time.time()-t0:.1f}s")
