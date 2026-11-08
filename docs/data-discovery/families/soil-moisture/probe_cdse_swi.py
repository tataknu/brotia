"""CLMS global Soil Water Index 12.5 km (Metop ASCAT) via CDSE STAC: latest item, first item, asset access without auth."""
import requests, time, json
S="https://stac.dataspace.copernicus.eu/v1"
for col in ["clms_swi_global_12.5km_daily_v4_cog","clms_swi_global_12.5km_10daily_v4_cog","clms_swi-timeseries_global_12.5km_daily_v4_nc"]:
    c=requests.get(f"{S}/collections/{col}",timeout=60).json()
    print("==",col,"extent:",c.get("extent",{}).get("temporal"))
    for order in ["-datetime","+datetime"]:
        t=time.time()
        r=requests.post(f"{S}/search",json={"collections":[col],"intersects":{"type":"Point","coordinates":[-62.52,-16.86]},
                         "limit":1,"sortby":[{"field":"properties.datetime","direction":"desc" if order[0]=="-" else "asc"}]},timeout=60)
        j=r.json(); f=(j.get("features") or [None])[0]
        print(f"  search {order}: HTTP {r.status_code} {time.time()-t:.2f}s", f and f["id"], f and f["properties"].get("datetime"))
        if f and order=="-datetime":
            for k,a in list(f["assets"].items())[:6]:
                print("   asset",k,a.get("href")[:160], a.get("type"))
            href=next((a["href"] for a in f["assets"].values() if a["href"].startswith("http")),None)
            if href:
                h=requests.head(href,timeout=60,allow_redirects=False); print("   HEAD no-auth:",h.status_code,h.headers.get("Location","")[:100])
