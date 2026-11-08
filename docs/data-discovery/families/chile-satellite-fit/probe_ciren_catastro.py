"""Probe: CIREN/ODEPA Catastro Frutícola polygons (species per parcel) from the public, keyless ArcGIS REST
service IDEMINAGRI/CATASTRO_FRUTICOLA (layer group 'PRODUCTORES FRUTÍCOLAS', one layer per region).
For a ~10 km box around fruit sites: count polygons, area distribution per species (geodesic),
and save the largest polygon of the target species as a GeoJSON test field.
Outputs: out_ciren_catastro.json, field_<site>.geojson"""
import json, time, collections, requests
from pyproj import Geod
B = "https://esri.ciren.cl/server/rest/services/IDEMINAGRI/CATASTRO_FRUTICOLA/MapServer"
geod = Geod(ellps="WGS84")
# site, layer id (region), lon, lat, target species
SITES = [("requinoa_cherry", 61, -70.80, -34.28, "CEREZO"), ("quillota_avocado", 59, -71.25, -32.88, "PALTO"),
         ("curico_apple_cherry", 62, -71.24, -34.98, "MANZANO ROJO"), ("ovalle_table_grape", 58, -71.20, -30.60, "VID DE MESA"),
         ("colchagua_wine", 61, -71.37, -34.64, "VID DE MESA"), ("chillan_blueberry", 63, -72.10, -36.60, "ARANDANO AMERICANO")]
H = 0.05
def area_ha(rings):
    a = 0.0
    for i, r in enumerate(rings):
        lons, lats = zip(*r)
        ar, _ = geod.polygon_area_perimeter(lons, lats)
        a += abs(ar) if i == 0 else -abs(ar)  # crude: first ring outer, rest holes
    return a / 1e4
out = {}
for key, lyr, lon, lat, target in SITES:
    feats, off, t0, calls = [], 0, time.time(), 0
    while True:
        r = requests.get(f"{B}/{lyr}/query", params={"geometry": f"{lon-H},{lat-H},{lon+H},{lat+H}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                        "spatialRel": "esriSpatialRelIntersects", "outFields": "objectid,desccomu,especie_01,especie_02", "returnGeometry": "true", "outSR": 4326,
                        "resultOffset": off, "resultRecordCount": 2000, "f": "json"}, timeout=90)
        calls += 1
        j = r.json(); fs = j.get("features", [])
        feats += fs
        if not j.get("exceededTransferLimit") or not fs: break
        off += len(fs)
    dt = round(time.time() - t0, 2)
    by = collections.defaultdict(list)
    for f in feats:
        f["ha"] = area_ha(f["geometry"]["rings"])
        by[f["attributes"]["especie_01"].strip()].append(f["ha"])
    def summ(v):
        v = sorted(v); n = len(v)
        return {"n": n, "median_ha": round(v[n // 2], 2), "p90_ha": round(v[int(n * 0.9)], 2), "max_ha": round(v[-1], 1),
                "share_lt_modis_px": round(sum(x < 5.37 for x in v) / n, 2)}  # 5.37 ha = one MODIS 231.66 m pixel
    allv = [f["ha"] for f in feats]
    tops = sorted(by.items(), key=lambda kv: -sum(kv[1]))[:8]
    rec = {"layer": lyr, "http": r.status_code, "seconds": dt, "calls": calls, "n_polygons": len(feats), "all": summ(allv) if allv else None,
           "by_species": {k: summ(v) for k, v in tops}}
    cand = [f for f in feats if f["attributes"]["especie_01"].strip() == target]
    if cand:
        best = max(cand, key=lambda f: f["ha"])
        gj = {"type": "Feature", "properties": {"site": key, "species": target, "ha": round(best["ha"], 2), "source": f"CIREN CATASTRO_FRUTICOLA layer {lyr}",
              "comuna": best["attributes"]["desccomu"]}, "geometry": {"type": "Polygon", "coordinates": best["geometry"]["rings"]}}
        json.dump(gj, open(f"field_{key}.geojson", "w"))
        rec["test_field"] = gj["properties"]
    out[key] = rec
    print(key, json.dumps({k: v for k, v in rec.items() if k != "by_species"}), "\n   ", json.dumps(rec["by_species"])[:900])
json.dump(out, open("out_ciren_catastro.json", "w"), indent=1)
