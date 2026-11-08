"""Probe CIREN / IDE Minagri Catastro Fruticola (orchard parcels) with point+buffer queries.
No auth. ArcGIS REST MapServer query. Usage: python probe_ciren_catastro.py"""
import json, time, requests, sys
BASE = "https://esri.ciren.cl/server/rest/services/IDEMINAGRI/CATASTRO_FRUTICOLA/MapServer"
SITES = [  # name, lon, lat, productores layer id (by region)
 ("Quillota avocados", -71.25, -32.88, 59),
 ("Ovalle table grapes", -71.20, -30.60, 58),
 ("Requinoa cherries", -70.80, -34.28, 61),
 ("Santa Cruz Colchagua wine", -71.37, -34.64, 61),
 ("Curico apples/cherries", -71.24, -34.98, 62),
 ("Talca vineyards", -71.66, -35.43, 62),
 ("Chillan blueberries", -72.10, -36.60, 63),
 ("Los Angeles", -72.35, -37.47, 64),
 ("Temuco", -72.60, -38.74, 65),
 ("Osorno", -73.13, -40.57, 67),
]
def q(layer, lon, lat, dist=1000, **kw):
    p = dict(f="json", geometry=f"{lon},{lat}", geometryType="esriGeometryPoint", inSR=4326,
             spatialRel="esriSpatialRelIntersects", distance=dist, units="esriSRUnit_Meter",
             outFields="*", returnGeometry="false", resultRecordCount=200)
    p.update(kw)
    t = time.time(); r = requests.get(f"{BASE}/{layer}/query", params=p, timeout=60)
    return r.status_code, round(time.time()-t, 2), r.json()
if __name__ == "__main__":
    out = {}
    for name, lon, lat, lid in SITES:
        st, dt, j = q(lid, lon, lat, dist=int(sys.argv[1]) if len(sys.argv) > 1 else 1000)
        feats = j.get("features", [])
        print(f"{name}: HTTP {st} {dt}s n={len(feats)} err={j.get('error')}")
        for f in feats[:3]:
            print("   ", {k: v for k, v in f["attributes"].items() if v not in (None, "", " ")})
        out[name] = dict(http=st, latency_s=dt, n=len(feats), sample=[f["attributes"] for f in feats[:5]])
    json.dump(out, open(__file__.replace("probe_ciren_catastro.py", "samples/ciren_catastro_point_queries.json"), "w"), ensure_ascii=False, indent=1, default=str)
