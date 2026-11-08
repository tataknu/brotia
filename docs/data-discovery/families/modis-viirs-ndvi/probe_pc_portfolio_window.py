"""One windowed COG read covering the whole 12-farm portfolio bbox per tile (h11v10 / h12v10), MOD13Q1 2001 + latest."""
import requests,time,rasterio,numpy as np
from rasterio.windows import from_bounds
from pyproj import Transformer
S="https://planetarycomputer.microsoft.com/api/stac/v1"
bbox=[-63.35,-17.80,-62.42,-16.80]
tok=requests.get("https://planetarycomputer.microsoft.com/api/sas/v1/token/modiseuwest/modis-061-cogs").json()["token"]
for dt in ("2001-10-15T00:00:00Z/2001-10-17T00:00:00Z","2026-09-29T00:00:00Z/2026-10-01T00:00:00Z"):
    t=time.time()
    fs=requests.post(f"{S}/search",json={"collections":["modis-13Q1-061"],"bbox":bbox,"datetime":dt,"limit":10}).json()["features"]
    print(dt,"items",[f["id"] for f in fs],f"search {time.time()-t:.2f}s")
    for f in fs:
        href=f["assets"]["250m_16_days_NDVI"]["href"]+"?"+tok
        t=time.time()
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
            with rasterio.open(href) as ds:
                tr=Transformer.from_crs("EPSG:4326",ds.crs,always_xy=True)
                xs,ys=tr.transform([bbox[0],bbox[2],bbox[0],bbox[2]],[bbox[1],bbox[1],bbox[3],bbox[3]])
                w=from_bounds(min(xs),min(ys),max(xs),max(ys),ds.transform).intersection(rasterio.windows.Window(0,0,ds.width,ds.height))
                a=ds.read(1,window=w)
        v=a[a>-3000]
        print("  ",f["id"].split(".")[2],f"{time.time()-t:.2f}s",a.shape,"valid=",v.size,"meanNDVI=",round(float(v.mean())*1e-4,3) if v.size else None)
# which tile is each farm in
farms={"Estancia Los Tajibos":(-62.52,-16.86),"Arrocera Mineros":(-63.29,-17.2),"Finca Okinawa Dos":(-62.85,-17.18),"Agropecuaria Brecha 8":(-62.7,-16.97)}
import math
R=6371007.181; T=1111950.5197665
for n,(lo,la) in farms.items():
    x=R*math.radians(lo)*math.cos(math.radians(la)); h=int((x+18*T)//T); print(n,"h%02d"%h)
