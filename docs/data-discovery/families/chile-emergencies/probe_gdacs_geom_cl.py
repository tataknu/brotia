"""GDACS footprints for key Chile events vs test points (context only)."""
import requests, time
from shapely.geometry import shape, Point
from shapely.ops import unary_union
from farms_cl import FARMS
for et, eid, ep in [("FL", 1102107, 1), ("FL", 1104010, 8), ("WF", 1012119, None), ("WF", 1019173, None), ("WF", 1027016, None)]:
    t = time.time()
    p = {"eventtype": et, "eventid": eid}
    if ep: p["episodeid"] = ep
    r = requests.get("https://www.gdacs.org/gdacsapi/api/polygons/getgeometry", params=p, timeout=60)
    fc = r.json(); polys = [shape(f["geometry"]).buffer(0) for f in fc.get("features", []) if f["geometry"]["type"] in ("Polygon", "MultiPolygon") and f["properties"].get("Class") != "Poly_Global"]  # Poly_Global is a huge envelope
    u = unary_union(polys) if polys else None
    hits = [n for n, lon, lat in FARMS if u is not None and u.contains(Point(lon, lat))]
    near = sorted((round(u.distance(Point(lon, lat))*100, 1), n) for n, lon, lat in FARMS) [:2] if u is not None else None
    cls = sorted({f["properties"].get("Class", "") for f in fc.get("features", [])})
    print(et, eid, cls[:4], r.status_code, f"{time.time()-t:.2f}s", "polys", len(polys), "bounds", [round(b, 2) for b in u.bounds] if u is not None else None, "farms inside", hits, "nearest(~km)", near)
