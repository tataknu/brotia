"""Planetary Computer STAC (anonymous): latest MODIS items over a farm + SAS token check."""
import requests,time,json
S="https://planetarycomputer.microsoft.com/api/stac/v1"
pt={"type":"Point","coordinates":[-62.52,-16.86]}
for c in ["modis-13Q1-061","modis-13A1-061","modis-09Q1-061","modis-43A4-061","modis-15A2H-061","viirs-13A1","noaa-cdr-ndvi" ]:
    t=time.time()
    r=requests.post(f"{S}/search",json={"collections":[c],"intersects":pt,"sortby":[{"field":"datetime","direction":"desc"}],"limit":3},timeout=60)
    dt=time.time()-t
    if r.status_code!=200: print(c,r.status_code,f"{dt:.2f}s",r.text[:150]); continue
    fs=r.json().get("features",[])
    print(c,r.status_code,f"{dt:.2f}s",[ (f["id"],f["properties"].get("datetime") or f["properties"].get("start_datetime")) for f in fs][:2], "assets=", list(fs[0]["assets"].keys())[:8] if fs else None)
t=time.time(); r=requests.get("https://planetarycomputer.microsoft.com/api/sas/v1/token/modis-13Q1-061",timeout=30)
print("SAS token:",r.status_code,f"{time.time()-t:.2f}s","keys=",list(r.json().keys()) if r.ok else r.text[:100], "expiry=",r.json().get("msft:expiry") if r.ok else None)
# collection extent
r=requests.get(f"{S}/collections/modis-13Q1-061",timeout=30); print("13Q1 extent",r.json()["extent"]["temporal"])
