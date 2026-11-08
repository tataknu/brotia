"""DMC (Direccion Meteorologica de Chile) current Avisos/Alertas/Alarmas, keyless JSON + zone GeoJSON.
Intersects each active warning with the Chile test points. Writes dmc_aaa_sample.json."""
import requests, json, html, time
from shapely.geometry import shape, Point, Polygon
from farms_cl import FARMS
B = "https://archivos.meteochile.gob.cl/portaldmc/AAA/"
H = {"User-Agent": "Mozilla/5.0 (research probe)"}
t = time.time(); d = requests.get(B + "datos_AAA.json", headers=H, timeout=30).json(); print("datos_AAA.json", f"{time.time()-t:.2f}s", "updated", d["fecha_actualizacion"], "avisos/alertas/alarmas", d["Avisos"], d["Alertas"], d["Alarmas"])
zones = requests.get(B + "coordenadas_zonas_DMC_v3.geojson", headers=H, timeout=60).json()
regs = requests.get(B + "coordenadas_regiones_DMC.geojson", headers=H, timeout=60).json()
zprop = list(zones["features"][0]["properties"].keys()); print("zone props", zprop, "n", len(zones["features"]))
rprop = list(regs["features"][0]["properties"].keys()); print("region props", rprop, "n", len(regs["features"]))
def zone_geom(fc, code):
    for f in fc["features"]:
        if code in [str(v) for v in f["properties"].values()]: return shape(f["geometry"])
for a in d["AAA"]:
    kind, data = a["tipoZonaAfecta"], a["dataZonaAfecta"]
    if kind == "area":
        g = Polygon([(float(p.split(",")[1]), float(p.split(",")[0])) for p in data.split("|") if p])
    else:
        codes = [c.strip() for c in data.replace("|", ",").split(",") if c.strip()]
        fc = zones if kind == "zonas" else regs
        gs = [zone_geom(fc, c) for c in codes]; gs = [x for x in gs if x is not None]
        from shapely.ops import unary_union; g = unary_union(gs) if gs else None
    hit = [n for n, lon, lat in FARMS if g is not None and g.contains(Point(lon, lat))]
    print(a["tipo"], a["codigoMeteo"], html.unescape(a["fenomeno"]), "|", html.unescape(a["desde"]), "->", html.unescape(a["hasta"]), "| zone", kind, data[:60], "| farms hit:", hit)
json.dump({k: v for k, v in d.items() if k != "AAA"} | {"AAA": [{k: a[k] for k in ("id","tipo","codigoMeteo","emision","fenomeno","desde","hasta","tipoZonaAfecta","textoZonaAfecta")} for a in d["AAA"]]}, open("dmc_aaa_sample.json", "w"), ensure_ascii=False, indent=1)
