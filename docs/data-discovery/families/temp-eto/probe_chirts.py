import rasterio, time, os
os.environ["GDAL_DISABLE_READDIR_ON_OPEN"]="EMPTY_DIR"
pts={"Tajibos":(-62.52,-16.86),"Mineros":(-63.29,-17.2)}
for var in ["Tmax","Tmin"]:
  for d in ["2026.11.01","2026.10.31","2026.10.30"]:
    url=f"/vsicurl/https://data.chc.ucsb.edu/experimental/CHIRTS-ERA5/{var.lower()}/tifs/daily/2026/CHIRTS-ERA5.daily_{var}.{d}.tif"
    try:
        t0=time.time()
        with rasterio.open(url) as ds:
            vals=[v[0] for v in ds.sample(list(pts.values()))]
            print(var,d,"OK",f"{time.time()-t0:.1f}s", dict(zip(pts,vals)), ds.res, ds.profile.get("tiled"), ds.profile.get("blockysize"), ds.nodata)
        break
    except Exception as e: print(var,d,"ERR",str(e)[:100])
# history start
for var in ["Tmax"]:
    url=f"/vsicurl/https://data.chc.ucsb.edu/experimental/CHIRTS-ERA5/tmax/tifs/daily/1980/CHIRTS-ERA5.daily_Tmax.1980.01.01.tif"
    try:
        with rasterio.open(url) as ds: print("1980-01-01", [v[0] for v in ds.sample(list(pts.values()))])
    except Exception as e: print("1980 ERR", str(e)[:120])
