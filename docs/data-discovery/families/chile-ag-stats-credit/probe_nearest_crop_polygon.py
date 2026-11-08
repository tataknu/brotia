"""For each Chile test site (town-centre coords), find the nearest real crop polygon of the target crop
in CIREN Catastro Fruticola (orchards) or CIREN land-use (annual crops, vines) and save it as GeoJSON.
Output: samples/chile_test_farm_polygons.geojson (suggested replacement farm polygons). No auth."""
import json, math, time, requests
R = "https://esri.ciren.cl/server/rest/services/IDEMINAGRI"
CF, LU = f"{R}/CATASTRO_FRUTICOLA/MapServer", f"{R}/USO_DE_LA_TIERRA_CIREN_2/MapServer"
# name, lon, lat, service, layer, where
SITES = [
 ("Quillota avocados", -71.25, -32.88, CF, 59, "especie_01='PALTO'"),
 ("Ovalle/Limari table grapes", -71.20, -30.60, CF, 58, "especie_01='VID DE MESA'"),
 ("Requinoa cherries", -70.80, -34.28, CF, 61, "especie_01='CEREZO'"),
 ("Santa Cruz (Colchagua) wine grapes", -71.37, -34.64, LU, 4, "especie1='VID'"),
 ("Curico apples & cherries", -71.24, -34.98, CF, 62, "especie_01 IN ('CEREZO','MANZANO ROJO','MANZANO VERDE')"),
 ("Talca vineyards", -71.66, -35.43, LU, 5, "especie1 LIKE 'VI%'"),
 ("Parral rice", -71.83, -36.14, LU, 5, "especie1='ARROZ'"),
 ("Chillan blueberries", -72.10, -36.60, CF, 63, "especie_01='ARANDANO AMERICANO'"),
 ("Los Angeles maize & wheat", -72.35, -37.47, LU, 7, "especie1 IN ('MAIZ','TRIGO')"),
 ("Temuco wheat & oats", -72.60, -38.74, LU, 8, "uso_actual LIKE 'ROTACI%' OR especie1 IN ('TRIGO','AVENA')"),
]
def hav(lon1, lat1, lon2, lat2):
    p = math.pi / 180; a = math.sin((lat2-lat1)*p/2)**2 + math.cos(lat1*p)*math.cos(lat2*p)*math.sin((lon2-lon1)*p/2)**2
    return 12742 * math.asin(math.sqrt(a))
def centroid(ring):
    xs = [c[0] for c in ring]; ys = [c[1] for c in ring]; return sum(xs)/len(xs), sum(ys)/len(ys)
feats = []
for name, lon, lat, svc, lid, where in SITES:
    best = None
    for dist in (3000, 8000, 15000):
        p = dict(f="geojson", where=where, geometry=f"{lon},{lat}", geometryType="esriGeometryPoint", inSR=4326,
                 spatialRel="esriSpatialRelIntersects", distance=dist, units="esriSRUnit_Meter", outFields="*",
                 returnGeometry="true", outSR=4326, maxAllowableOffset=0.00005, resultRecordCount=300)
        t = time.time(); r = requests.get(f"{svc}/{lid}/query", params=p, timeout=90); dt = round(time.time()-t, 2)
        j = r.json(); fs = [f for f in j.get("features", []) if f.get("geometry")]
        if fs:
            for f in fs:
                g = f["geometry"]; ring = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"][0][0]
                cx, cy = centroid(ring); d = hav(lon, lat, cx, cy)
                if best is None or d < best[0]: best = (d, cx, cy, f)
            break
    if not best:
        print(f"{name}: none found (HTTP {r.status_code}, {dt}s, err={j.get('error')})"); continue
    d, cx, cy, f = best
    props = {k: v for k, v in f["properties"].items() if v not in (None, "", " ", "-") and k.lower() not in ("shape", "objectid_1")}
    props.update(site=name, town_lonlat=[lon, lat], suggested_lonlat=[round(cx, 5), round(cy, 5)], km_from_town=round(d, 2),
                 source=svc.split("/")[-2] + f"/{lid}", http=r.status_code, latency_s=dt, n_candidates=len(fs), search_radius_m=dist)
    f["properties"] = props; feats.append(f)
    print(f"{name}: n={len(fs)} r={dist}m nearest {d:.2f} km -> ({cx:.5f},{cy:.5f}) "
          f"{props.get('especie_01') or props.get('especie1') or props.get('uso_actual')} [{dt}s]")
json.dump({"type": "FeatureCollection", "features": feats},
          open(__file__.replace("probe_nearest_crop_polygon.py", "samples/chile_test_farm_polygons.geojson"), "w"), ensure_ascii=False)
