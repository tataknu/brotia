"""CHIRTS-ERA5 daily Tmax/Tmin (CHC UCSB, 0.05 deg, 1980-present) point sampling via HTTP range reads (/vsicurl)."""
import os,time,rasterio,pandas as pd,numpy as np,io,requests
os.environ.update(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",GDAL_HTTP_MAX_RETRY="5",GDAL_HTTP_RETRY_DELAY="3",GDAL_HTTP_RETRY_CODES="429,502,503")
pts={"Tajibos":(-62.52,-16.86),"SLVR":(-63.135,-17.645)}
def url(v,d): return f"/vsicurl/https://data.chc.ucsb.edu/experimental/CHIRTS-ERA5/{v.lower()}/tifs/daily/{d.year}/CHIRTS-ERA5.daily_{v}.{d:%Y.%m.%d}.tif"
t=time.time()
with rasterio.open(url("Tmax",pd.Timestamp("2026-11-01"))) as ds:
    print("profile",ds.res,ds.bounds,ds.dtypes,ds.nodata,"tiled",ds.profile.get("tiled"),ds.profile.get("blockxsize"),ds.profile.get("blockysize"),"overviews",ds.overviews(1))
    print("2026-11-01 Tmax",{k:float(v[0]) for k,v in zip(pts,ds.sample(list(pts.values())))},f"{time.time()-t:.1f}s")
# validation sample: every 7th day of 2023 at SLVR vs GSOD
g=pd.read_csv(io.StringIO(requests.get("https://www.ncei.noaa.gov/data/global-summary-of-the-day/access/2023/85244099999.csv",timeout=60).text)); g.index=pd.to_datetime(g.DATE)
rows=[]; FAILS=[]; t=time.time()
for d in pd.date_range("2023-01-03","2023-12-31",freq="30D"):
    rec={"date":d}
    for v in ["Tmax","Tmin"]:
        try:
            with rasterio.open(url(v,d)) as ds: rec[v]=float(next(ds.sample([pts["SLVR"]]))[0])
        except Exception as e: rec[v]=np.nan; FAILS.append((d.date(),v,str(e)[:60]))
        time.sleep(2)
    rows.append(rec)
c=pd.DataFrame(rows).set_index("date"); print(f"{len(c)*2} reads in {time.time()-t:.0f}s")
c["st_tmax"]=(g.MAX.where(g.MAX<9999)-32)*5/9; c["st_tmin"]=(g.MIN.where(g.MIN<9999)-32)*5/9
for v,s in [("Tmax","st_tmax"),("Tmin","st_tmin")]:
    x=c[[v,s]].dropna(); d=x[v]-x[s]; print(f"CHIRTS-ERA5 {v} vs SLVR 2023 weekly: n={len(x)} bias={d.mean():+.2f} MAE={d.abs().mean():.2f} r={x.corr().iloc[0,1]:.3f}")
print("failed reads:",len(FAILS),FAILS[:3])
