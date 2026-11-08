"""Probe CONAF SIDCO fire points/polygons as republished on SENAPRED's public ArcGIS Server.
No key. Writes sidco_polygons_sample.geojson (small)."""
import requests, json, time, datetime as dt
from shapely.geometry import shape, Point
from farms_cl import FARMS
B = "https://visor-grd.senapred.gob.cl/arcgis/rest/services/"
def ts(ms): return dt.datetime.utcfromtimestamp(ms/1000).strftime("%Y-%m-%d %H:%M") if ms else None
# active / recent incident points
t = time.time()
pts = requests.get(B+"SIIE/sidco/MapServer/0/query", params={"where":"1=1","outFields":"*","outSR":4326,"f":"geojson"}, timeout=60).json()
print("points", len(pts["features"]), f"{time.time()-t:.2f}s")
for f in pts["features"]:
    p = f["properties"]; print("  ", p["nombre"], p["tipo"], p["estado"], f["geometry"]["coordinates"])
# perimeters
t = time.time()
pol = requests.get(B+"interoperabilidad/sidco_ide/MapServer/0/query", params={"where":"1=1","outFields":"*","outSR":4326,"f":"geojson"}, timeout=60).json()
print("polygons", len(pol["features"]), f"{time.time()-t:.2f}s")
dates = sorted(f["properties"]["fecha_hora"] for f in pol["features"] if f["properties"]["fecha_hora"])
print("  fecha_hora range", ts(dates[0]), "..", ts(dates[-1]))
upd = sorted(f["properties"]["ultima_actualizacion"] for f in pol["features"] if f["properties"].get("ultima_actualizacion"))
print("  ultima_actualizacion max", ts(upd[-1]))
tot = sum(f["properties"]["hectareas"] or 0 for f in pol["features"])
print("  total ha", round(tot), "regions", sorted({f["properties"]["region"] for f in pol["features"]}))
for f in sorted(pol["features"], key=lambda f: -(f["properties"]["hectareas"] or 0))[:6]:
    p = f["properties"]; print("   ", p["nombre_incendio"], p["comuna"], p["hectareas"], "ha", ts(p["fecha_hora"]), p["estado"])
for name, lon, lat in FARMS:
    best = min(((shape(f["geometry"]).distance(Point(lon, lat))*100, f["properties"]["nombre_incendio"]) for f in pol["features"] if f["geometry"]), default=None)
    if best and best[0] < 60: print(f"  {name}: nearest perimeter ~{best[0]:.1f} km ({best[1]})")
json.dump({"type":"FeatureCollection","features":pol["features"][:5]}, open("sidco_polygons_sample.geojson","w"))
