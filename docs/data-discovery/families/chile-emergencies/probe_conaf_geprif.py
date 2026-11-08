"""CONAF GEPRIF public ArcGIS Online layers (org A1ELWse9bRAi2JiV), keyless.
1) Fire ignition points >50 ha, seasons 2002-03..2023-24, spatial query 10 km around each test point.
2) Latest daily 'IPO' (Indice de Probabilidad de Ocurrencia) by commune."""
import requests, time, json, datetime as dt
from farms_cl import FARMS
B = "https://services5.arcgis.com/A1ELWse9bRAi2JiV/arcgis/rest/services/"
L = B + "PUNTOS_DE_INICIO_2002_2024_MAYOR_A_50_HA/FeatureServer/0/query"
st = requests.get(L, params={"where": "1=1", "outStatistics": json.dumps([{"statisticType": "min", "onStatisticField": "fecha_inic", "outStatisticFieldName": "mn"}, {"statisticType": "max", "onStatisticField": "fecha_inic", "outStatisticFieldName": "mx"}]), "f": "json"}, timeout=30).json()
a = st["features"][0]["attributes"]; print("ignition date range", dt.datetime.utcfromtimestamp(a["mn"]/1000).date(), "..", dt.datetime.utcfromtimestamp(a["mx"]/1000).date())
for name, lon, lat in FARMS:
    t = time.time()
    r = requests.get(L, params={"geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": 4326, "distance": 10, "units": "esriSRUnit_Kilometer",
                                "spatialRel": "esriSpatialRelIntersects", "outFields": "Temporada,Nombre,Comuna,Superficie,Inicio", "returnGeometry": "false", "f": "json"}, timeout=30).json()
    fs = sorted((f["attributes"] for f in r.get("features", [])), key=lambda x: -(x["Superficie"] or 0))
    print(f"  {name}: >50ha fires within 10 km = {len(fs)} ({time.time()-t:.2f}s); largest: {fs[0]['Nombre']} {fs[0]['Temporada']} {fs[0]['Superficie']} ha" if fs else f"  {name}: 0")
# latest IPO layer: search org items titled IPO*
s = requests.get("https://www.arcgis.com/sharing/rest/search", params={"q": 'orgid:A1ELWse9bRAi2JiV title:IPO type:"Feature Service"', "sortField": "modified", "sortOrder": "desc", "num": 1, "f": "json"}, timeout=30).json()
it = s["results"][0]; print("latest IPO item", it["title"], dt.datetime.utcfromtimestamp(it["modified"]/1000))
q = requests.get(it["url"] + "/0/query", params={"where": "1=1", "outFields": "REGION,COMUNA,IPO_17h,Clase,T17_MAX,HR17_MIN", "returnGeometry": "false", "f": "json"}, timeout=30).json()
print("  communes", len(q["features"]), "sample", [f["attributes"] for f in q["features"][:3]])
