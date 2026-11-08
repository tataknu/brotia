"""Probe CIREN land-use (USO_DE_LA_TIERRA_CIREN_2, query enabled) and CONAF vegetation/land-use
layers at Chile test points. No auth."""
import json, time, requests
R = "https://esri.ciren.cl/server/rest/services"
SITES = [("Quillota", -71.25, -32.88, 2), ("Ovalle", -71.20, -30.60, 1), ("Requinoa", -70.80, -34.28, 4),
         ("SantaCruz_Colchagua", -71.37, -34.64, 4), ("Curico", -71.24, -34.98, 5), ("Talca", -71.66, -35.43, 5),
         ("Parral", -71.83, -36.14, 5), ("Chillan", -72.10, -36.60, 6), ("LosAngeles", -72.35, -37.47, 7),
         ("Temuco", -72.60, -38.74, 8), ("Osorno", -73.13, -40.57, None)]
KEEP = ("uso", "clase", "tipo", "cultivo", "especie", "sub", "desc", "nom", "fecha", "año", "ano")
def q(svc, lid, lon, lat):
    p = dict(f="json", geometry=f"{lon},{lat}", geometryType="esriGeometryPoint", inSR=4326,
             spatialRel="esriSpatialRelIntersects", outFields="*", returnGeometry="false")
    t = time.time(); r = requests.get(f"{R}/{svc}/MapServer/{lid}/query", params=p, timeout=60)
    return r.status_code, round(time.time() - t, 2), r.json()
out = {}
for name, lon, lat, lid in SITES:
    if lid is None:
        print(name, "no CIREN land-use layer for Los Lagos"); continue
    st, dt, j = q("IDEMINAGRI/USO_DE_LA_TIERRA_CIREN_2", lid, lon, lat)
    f = j.get("features", [])
    a = {k: v for k, v in (f[0]["attributes"] if f else {}).items() if any(s in k.lower() for s in KEEP)}
    print(f"{name}: HTTP {st} {dt}s n={len(f)} err={j.get('error',{}).get('message')} {a}")
    out[name] = dict(http=st, latency_s=dt, n=len(f), attrs=a)
json.dump(out, open(__file__.replace("probe_ciren_landuse.py", "samples/ciren_landuse_point_queries.json"), "w"), ensure_ascii=False, indent=1)
