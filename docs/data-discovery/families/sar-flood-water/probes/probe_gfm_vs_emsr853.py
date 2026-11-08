"""Cross-check: does GFM (EODC STAC, keyless COGs) detect the EMSR853 Dec-2025 flood polygons?
Takes the largest EMSR853 observed-flood polygon, and reads GFM ensemble_flood_extent over its bbox for every
GFM item 2025-12-10..2025-12-31. Also reads GFM at farm 'Canaveral San Antonio' (closest farm, 16 km)."""
import sys, glob, zipfile, json, requests, numpy as np, rasterio
from shapely.geometry import shape
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds
polys = []
for z in glob.glob(sys.argv[1] + "/EMSR853_*DEL*.zip"):
    zf = zipfile.ZipFile(z)
    for n in zf.namelist():
        if "observedEvent" in n and n.endswith(".json"):
            polys += [shape(f["geometry"]) for f in json.loads(zf.read(n))["features"]]
big = max(polys, key=lambda p: p.area)
print("largest EMSR polygon bbox", [round(v, 3) for v in big.bounds], "centroid", big.centroid.x, big.centroid.y)
def scan(label, bb):
    r = requests.post("https://stac.eodc.eu/api/v1/search", json={"collections": ["GFM"], "bbox": list(bb),
        "datetime": "2025-12-10T00:00:00Z/2025-12-31T23:59:59Z", "limit": 100}, timeout=60).json()
    for f in sorted(r["features"], key=lambda f: f["properties"]["datetime"]):
        with rasterio.open(f["assets"]["ensemble_flood_extent"]["href"]) as s:
            b = transform_bounds("EPSG:4326", s.crs, *bb)
            a = s.read(1, window=from_bounds(*b, s.transform), boundless=True, fill_value=255)
        valid = a[a != 255]
        print(f"  {label} {f['properties']['datetime'][:16]} {f['id'][-14:]} valid_px={valid.size:7d} flood_px={int((valid == 1).sum()):6d} flood_km2={(valid == 1).sum() * 400 / 1e6:6.2f}")
scan("EMSR-poly", big.bounds)
scan("Canaveral", (-63.22, -17.30, -63.20, -17.28))
