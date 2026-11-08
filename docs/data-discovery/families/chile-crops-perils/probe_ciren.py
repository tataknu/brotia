"""Probe CIREN / IDE Minagri public ArcGIS services for Chile test farms (no auth).

- Irrigated-area polygons (CIREN "Areas de riego", by region) -> irrigated flag.
- Fruit cadastre table (CIREN-ODEPA Catastro Fruticola, by block) -> species, variety,
  planting year, irrigation method per commune.
Run: .venv/bin/python probe_ciren.py
"""
import json, time, requests

UA = {"User-Agent": "ClimateLoanMonitor-hackathon-research (MIT Energy Hack 2026)"}
HIDRICO = "https://esri.ciren.cl/server/rest/services/Emergencias/HIDRICO_PUBLICO/MapServer"
CATFRU = ("https://services3.arcgis.com/DmlBJVTrQbCmoXcR/arcgis/rest/services/"
          "servicio_tb_catastro_fruticola/FeatureServer/0/query")

# (layer id in HIDRICO_PUBLICO, lon, lat, name)
POINTS = [
    (5, -70.80, -34.28, "Requinoa cherries (O'Higgins 2021)"),
    (5, -71.37, -34.64, "Santa Cruz Colchagua vines (O'Higgins 2021)"),
    (6, -71.24, -34.98, "Curico apples (Maule 2021)"),
    (6, -71.83, -36.14, "Parral rice (Maule 2021)"),
    (4, -71.25, -32.88, "Quillota avocados (Valparaiso 2016)"),
    (2, -71.20, -30.60, "Ovalle grapes (Coquimbo 2022)"),
]


def irrigated(layer, lon, lat, buf_m=500):
    t = time.time()
    r = requests.get(f"{HIDRICO}/{layer}/query", headers=UA, timeout=30, params={
        "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": 4326,
        "distance": buf_m, "units": "esriSRUnit_Meter", "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*", "returnGeometry": "false", "resultRecordCount": 2, "f": "json"})
    dt = time.time() - t
    try:
        d = r.json()
    except ValueError:
        return r.status_code, dt, f"non-json: {r.text[:120]!r}"
    if "error" in d:
        return r.status_code, dt, d["error"]
    return r.status_code, dt, [f["attributes"] for f in d.get("features", [])]


def catfru_commune(commune_like, year=None):
    where = f"desccomu LIKE '{commune_like}'" + (f" AND anoinfor={year}" if year else "")
    r = requests.get(CATFRU, headers=UA, timeout=30, params={
        "where": where, "groupByFieldsForStatistics": "descespe,anoinfor",
        "outStatistics": json.dumps([{"statisticType": "sum", "onStatisticField": "supbloq_ha",
                                       "outStatisticFieldName": "ha"}]),
        "orderByFields": "ha DESC", "f": "json"})
    return r.status_code, r.json().get("features", [])[:6]


if __name__ == "__main__":
    for layer, lon, lat, name in POINTS:
        code, dt, res = irrigated(layer, lon, lat)
        print(f"[riego] {name}: HTTP {code} {dt:.2f}s -> {str(res)[:300]}")
    for c in ["QUILLOTA", "OVALLE", "REQUINOA", "CURICO", "CHILLAN", "SANTA CRUZ"]:
        code, feats = catfru_commune(c)
        print(f"[catfru] {c}: HTTP {code} ->", [(f['attributes']['descespe'], f['attributes']['anoinfor'],
                                               round(f['attributes']['ha'])) for f in feats])
