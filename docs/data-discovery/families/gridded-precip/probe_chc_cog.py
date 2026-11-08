"""Probe CHC (UCSB) CHIRPS GeoTIFF/COG files over HTTP range reads with rasterio (no key).
Reads the single 0.05 deg pixel at a farm for a few dates and reports latency + layout."""
import sys, time, rasterio
from rasterio.env import Env
LON, LAT = -62.52, -16.86  # Estancia Los Tajibos
URLS = [
 "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/daily/final/rnl/2024/chirps-v3.0.rnl.2024.01.15.tif",
 "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/daily/final/rnl/2026/chirps-v3.0.rnl.2026.09.30.tif",
 "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/daily/prelim/sat/2026/chirps-v3.0.prelim.2026.10.31.tif",
 "https://data.chc.ucsb.edu/products/CHIRPS/v2.0/global_daily/cogs/p05/2024/chirps-v2.0.2024.01.15.cog",
 "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/global/tifs/chirps-v3.0.2024.01.tif",
]
with Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.cog", GDAL_HTTP_MULTIRANGE="NO", GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="5"):
    for u in URLS[int(sys.argv[1]) if len(sys.argv) > 1 else 0:]:
        time.sleep(8); t0 = time.time()
        try:
            with rasterio.open("/vsicurl/" + u) as ds:
                v = next(ds.sample([(LON, LAT)]))[0]
                print(f"{u.split('/')[-1]}: value={v:.2f} nodata={ds.nodata} tiled={ds.profile.get('tiled')} "
                      f"block={ds.block_shapes[0]} ovr={ds.overviews(1)[:3]} shape={ds.shape} {time.time()-t0:.2f}s")
        except Exception as e:
            print(u.split('/')[-1], "ERR", str(e)[:150], f"{time.time()-t0:.2f}s")
