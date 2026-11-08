"""Same-time-of-year snow-covered-area anomaly from MODIS MOD10A2 (8-day max snow extent, Terra), 2001-2026,
over crude upper-basin boxes. Keyless: Planetary Computer STAC + data API zonal stats (categorical: 200=snow, 25=no snow, 50=cloud)."""
import requests, time, json, datetime as dt
UA={"User-Agent":"climate-loan-monitor-hackathon (research probe)"}
STAC="https://planetarycomputer.microsoft.com/api/stac/v1"; DATA="https://planetarycomputer.microsoft.com/api/data/v1"
boxes={"upper Aconcagua":[-70.35,-33.05,-69.95,-32.6],"upper Maule":[-70.95,-36.2,-70.35,-35.6]}
DOY=273  # composite starting Sep 30 (DOY 273, 8-day grid: 1,9,...,273,281)
def poly(b): x0,y0,x1,y1=b; return {"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]}}
out={}
for name,b in boxes.items():
    series={}
    for y in range(2001,2027):
        d0=dt.date(y,1,1)+dt.timedelta(days=DOY-1)
        s=requests.post(f"{STAC}/search",json={"collections":["modis-10A2-061"],"bbox":b,"datetime":f"{d0}T00:00:00Z/{d0}T23:59:59Z","limit":10},headers=UA,timeout=60).json()
        feats=[f for f in s["features"] if f["id"].startswith("MOD10A2") and "h12v12" in f["id"]]
        if not feats: series[y]=None; continue
        st=requests.post(f"{DATA}/item/statistics",params={"collection":"modis-10A2-061","item":feats[0]["id"],"assets":"Maximum_Snow_Extent","categorical":"true"},json=poly(b),headers=UA,timeout=120).json()
        h=st["properties"]["statistics"]["Maximum_Snow_Extent_b1"]["histogram"]; cnt=dict(zip(h[1],h[0]))
        snow=cnt.get(200,0); land=cnt.get(25,0); cloud=cnt.get(50,0)
        series[y]={"snow_frac_clear":round(snow/max(1,snow+land),3),"cloud_frac":round(cloud/max(1,sum(h[0])),3),"date":str(d0)}
    vals=[v["snow_frac_clear"] for yy,v in series.items() if v and yy<2026]
    cur=series.get(2026)
    pct=round(100*sum(x<cur["snow_frac_clear"] for x in vals)/len(vals)) if cur else None
    out[name]={"series":series,"2026_percentile_vs_2001_2025":pct}
    print(name,"2026:",cur,"percentile:",pct,"median:",sorted(vals)[len(vals)//2], flush=True)
json.dump(out,open("sample_modis_snow_sca_baseline.json","w"),indent=1)
