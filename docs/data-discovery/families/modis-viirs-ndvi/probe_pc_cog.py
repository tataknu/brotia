"""Anonymous PC SAS token + windowed COG read of MOD/MYD13Q1 NDVI over a farm (no download of full tile)."""
import requests,time,rasterio,numpy as np
from rasterio.windows import from_bounds
from pyproj import Transformer
S="https://planetarycomputer.microsoft.com/api/stac/v1"
lon,lat=-62.52,-16.86
tok=requests.get("https://planetarycomputer.microsoft.com/api/sas/v1/token/modiseuwest/modis-061-cogs").json()["token"]  # per storage account/container
f=requests.post(f"{S}/search",json={"collections":["modis-13Q1-061"],"intersects":{"type":"Point","coordinates":[lon,lat]},"sortby":[{"field":"datetime","direction":"desc"}],"limit":1}).json()["features"][0]
for band in ("250m_16_days_NDVI","250m_16_days_pixel_reliability"):
    href=f["assets"][band]["href"]+"?"+tok
    t=time.time()
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        with rasterio.open(href) as ds:
            tr=Transformer.from_crs("EPSG:4326",ds.crs,always_xy=True)
            x,y=tr.transform(lon,lat)
            w=from_bounds(x-1000,y-1000,x+1000,y+1000,ds.transform)
            a=ds.read(1,window=w)
    print(f["id"],band,f"{time.time()-t:.2f}s",a.shape,"crs=",ds.crs.to_string()[:60],"sample=",a.ravel()[:6].tolist())
