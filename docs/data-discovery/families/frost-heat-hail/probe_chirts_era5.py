"""CHIRTS-ERA5 (CHC UCSB, keyless HTTP): read Tmin/Tmax pixels at Pailon from daily GeoTIFFs via GDAL /vsicurl range reads."""
import rasterio, time, requests, re
from rasterio.env import Env
B = "https://data.chc.ucsb.edu/experimental/CHIRTS-ERA5/"
LON, LAT = -62.68, -17.56
yrs = re.findall(r'href="(\d{4})/"', requests.get(B + "tmin/tifs/daily/", timeout=60).text)
print("tmin daily years:", yrs[:3], "...", yrs[-3:])
last = sorted(re.findall(r'(CHIRTS-ERA5\.daily_Tmin\.\d{4}\.\d\d\.\d\d\.tif)', requests.get(B + f"tmin/tifs/daily/{yrs[-1]}/", timeout=60).text))[-1]
print("latest tmin file:", last)
with Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
    for var, fn in [("Tmin", last), ("Tmin", "CHIRTS-ERA5.daily_Tmin.2021.07.01.tif"), ("Tmin", "CHIRTS-ERA5.daily_Tmin.2021.06.30.tif"), ("Tmax", "CHIRTS-ERA5.daily_Tmax.2023.10.10.tif")]:
        y = fn.split(".")[2]; url = f"/vsicurl/{B}{var.lower()}/tifs/daily/{y}/{fn}"
        t = time.time()
        with rasterio.open(url) as ds:
            r, c = ds.index(LON, LAT); v = ds.read(1, window=((r, r + 1), (c, c + 1)))[0, 0]
            print(var, fn, "val=%.2f" % v, "res", ds.res, "tiled", ds.profile.get("tiled"), "blocks", ds.block_shapes[0], "%.2fs" % (time.time() - t))
    h = requests.head(B + f"tmin/tifs/daily/2021/CHIRTS-ERA5.daily_Tmin.2021.07.01.tif", timeout=60); print("file size MB", round(int(h.headers.get("Content-Length", 0)) / 1e6, 1), "accept-ranges", h.headers.get("Accept-Ranges"))
