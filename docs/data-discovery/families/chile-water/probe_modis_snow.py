"""Probe MODIS snow (MOD10A1 daily NDSI snow cover, MOD10A2 8-day max extent) on Microsoft Planetary Computer.
Keyless STAC + data API (titiler) -> zonal stats over an upper-basin polygon. No download of full tiles."""
import requests, time, json
UA={"User-Agent":"climate-loan-monitor-hackathon (research probe)"}
STAC="https://planetarycomputer.microsoft.com/api/stac/v1"
DATA="https://planetarycomputer.microsoft.com/api/data/v1"
# crude upper-Aconcagua box (above ~2000 m), lon/lat
poly={"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[-70.35,-33.05],[-69.95,-33.05],[-69.95,-32.6],[-70.35,-32.6],[-70.35,-33.05]]]}}
def latest(coll,pt=(-70.13,-32.83),n=2):
    r=requests.post(f"{STAC}/search",json={"collections":[coll],"intersects":{"type":"Point","coordinates":list(pt)},"limit":n,"sortby":[{"field":"datetime","direction":"desc"}]},headers=UA,timeout=60)
    return r.json()["features"]
for coll,asset in [("modis-10A2-061","Maximum_Snow_Extent"),("modis-10A1-061","NDSI_Snow_Cover")]:
    feats=latest(coll)
    for f in feats[:1]:
        print(coll,f["id"],f["properties"].get("start_datetime"),f["properties"].get("end_datetime"),list(f["assets"])[:6])
        t=time.time()
        r=requests.post(f"{DATA}/item/statistics",params={"collection":coll,"item":f["id"],"assets":list(f["assets"])[1] if asset not in f["assets"] else asset,"categorical":"true"},json=poly,headers=UA,timeout=120)
        print(" stats",r.status_code,round(time.time()-t,2),r.text[:700])
