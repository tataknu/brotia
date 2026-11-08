"""Keyless NASA CMR granule search: latest granule per product over a Santa Cruz bbox."""
import requests,time
U="https://cmr.earthdata.nasa.gov/search/granules.json"
bbox="-63.3,-17.8,-62.4,-16.8"
for sn,v in [("MOD13Q1","061"),("MYD13Q1","061"),("MOD13A1","061"),("MYD13A1","061"),("MOD09Q1","061"),("MYD09Q1","061"),("MCD43A4","061"),("VNP13A1","002"),("VNP13A1","001"),("VJ113A1","002"),("VJ213A1","002"),("VNP09H1","002"),("VJ109H1","002"),("VNP43IA4","002"),("VJ143IA4","002")]:
    t=time.time()
    try:
        r=requests.get(U,params={"short_name":sn,"version":v,"bounding_box":bbox,"sort_key":"-start_date","page_size":1},timeout=60)
        dt=time.time()-t
        e=r.json()["feed"]["entry"]
        hits=r.headers.get("CMR-Hits")
        if e:
            g=e[0]; print(f"{sn} v{v}: {r.status_code} {dt:.2f}s hits={hits} latest_start={g['time_start'][:10]} updated={g.get('updated','')[:10]} title={g['title']}")
        else: print(f"{sn} v{v}: {r.status_code} {dt:.2f}s hits={hits} none")
    except Exception as ex: print(sn,v,"ERR",ex)
# earliest granules for history start
for sn,v in [("MOD13Q1","061"),("VNP13A1","002"),("VJ113A1","002")]:
    r=requests.get(U,params={"short_name":sn,"version":v,"bounding_box":bbox,"sort_key":"start_date","page_size":1},timeout=60)
    e=r.json()["feed"]["entry"]; print("earliest",sn,v,e[0]["time_start"][:10] if e else None)
