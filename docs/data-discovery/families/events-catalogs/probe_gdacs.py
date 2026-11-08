"""GDACS probe: paginate Bolivia events 2023-01-01..today, fetch footprints for
events whose centroid is near the Santa Cruz farm cluster, intersect with farms.
No auth. Writes gdacs_bolivia_events.csv (small)."""
import json, time, csv, requests
from shapely.geometry import shape, Point
from farms import FARMS
BASE="https://www.gdacs.org/gdacsapi/api"
rows=[]; page=1
while True:
    t=time.time()
    r=requests.get(f"{BASE}/events/geteventlist/SEARCH",params=dict(country="Bolivia",fromdate="2023-01-01",todate="2026-11-06",alertlevel="green;orange;red",eventlist="FL;DR;WF;TC;VO",pagesize=100,pagenumber=page),timeout=60)
    print("page",page,r.status_code,round(time.time()-t,2),"s")
    if r.status_code!=200 or not r.text.strip(): break
    fs=r.json().get("features",[])
    if not fs: break
    rows+=fs
    if len(fs)<100: break
    page+=1; time.sleep(1)
print("total events (excluding EQ):",len(rows))
farm_pts=[Point(*f["lonlat"]) for f in FARMS]
out=[]
for f in rows:
    p=f["properties"]; c=f["geometry"]["coordinates"]
    near=abs(c[0]+62.9)<3 and abs(c[1]+17.3)<3   # within ~3 deg of farm cluster
    hits=""; mind=""
    if near or p["eventtype"]=="DR":
        g=requests.get(p["url"]["geometry"],timeout=60).json()
        polys=[shape(x["geometry"]).buffer(0) for x in g["features"] if x["geometry"]["type"]!="Point" and x["properties"].get("Class")!="Poly_Global"]
        if polys:
            from shapely.ops import unary_union
            U=unary_union(polys)
            hits=sum(U.contains(pt) for pt in farm_pts)
            mind=round(min(U.distance(pt) for pt in farm_pts)*111,1)
        time.sleep(0.5)
    out.append(dict(type=p["eventtype"],id=p["eventid"],episode=p.get("episodeid"),from_=p["fromdate"][:10],to=p["todate"][:10],alert=p["alertlevel"],source=p.get("source"),severity=p["severitydata"].get("severitytext"),countries=p.get("country"),glide=p.get("glide"),lon=c[0],lat=c[1],farms_inside=hits,min_dist_km=mind))
with open("gdacs_bolivia_events.csv","w",newline="") as fh:
    w=csv.DictWriter(fh,fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
for o in out:
    if o["min_dist_km"]!="": print(o)
