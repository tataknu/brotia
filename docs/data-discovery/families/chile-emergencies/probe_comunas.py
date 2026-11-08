"""Point-in-commune lookup (keyless) so commune-level decrees/alerts can be joined to farms.
Uses SENAPRED's public ArcGIS Online layer Comunas_Region_2026."""
import requests, time
from farms_cl import FARMS
# CONAF GEPRIF national layer (343 communes). SENAPRED's Comunas_Region_2026 holds only Valparaiso.
U = "https://services5.arcgis.com/A1ELWse9bRAi2JiV/arcgis/rest/services/Comunas/FeatureServer/0"
m = requests.get(U, params={"f": "json"}, timeout=30).json()
print("fields", [f["name"] for f in m.get("fields", [])][:20], "maxRecordCount", m.get("maxRecordCount"))
for name, lon, lat in FARMS:
    t = time.time()
    r = requests.get(U + "/query", params={"geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "returnGeometry": "false", "f": "json"}, timeout=30).json()
    a = r["features"][0]["attributes"] if r.get("features") else {}
    keep = {k: v for k, v in a.items() if any(s in k.lower() for s in ("comuna", "cut", "provin", "region", "nom", "name", "saff", "dpa"))}
    print(f"  {name}: {keep} ({time.time()-t:.2f}s)")
