"""Probe: the MODIS 250 m mixed-pixel problem for Chilean orchards.
A) Using every CIREN Catastro Frutícola polygon (species blocks, public ArcGIS REST, keyless) in ~10 km boxes,
   overlay the exact MODIS sinusoidal 231.66 m grid and compute, per block and per predio (rol = farm),
   the best coverage any single MODIS pixel achieves ("is there a pure pixel?").
B) Pull the MOD13Q1 NDVI time series (ORNL DAAC subset REST, keyless) for the MODIS pixel at the centre of the
   test cherry and avocado fields, and write that pixel footprint as GeoJSON so probe_s2_chile.py can compute
   S2 NDVI over the identical footprint (cross-calibration check).
Outputs: out_modis_mixed.json, modispx_<site>.geojson"""
import json, math, time, collections, requests
import numpy as np
from pyproj import Transformer, Geod
from shapely.geometry import shape, box, Polygon, mapping
import os, warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)
from shapely.ops import transform, unary_union
SIN = "+proj=sinu +R=6371007.181 +nadgrids=@null +wktext +units=m +no_defs"
to_sin = Transformer.from_crs(4326, SIN, always_xy=True).transform
to_ll = Transformer.from_crs(SIN, 4326, always_xy=True).transform
X0, Y0, CELL = -20015109.354, 10007554.677, 231.65635826395834
B = "https://esri.ciren.cl/server/rest/services/IDEMINAGRI/CATASTRO_FRUTICOLA/MapServer"
SITES = [("requinoa", 61, -70.80, -34.28), ("quillota", 59, -71.25, -32.88), ("curico", 62, -71.24, -34.98)]
H = 0.05
def fetch(lyr, lon, lat):
    r = requests.get(f"{B}/{lyr}/query", params={"geometry": f"{lon-H},{lat-H},{lon+H},{lat+H}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                     "spatialRel": "esriSpatialRelIntersects", "outFields": "rolpredi,especie_01", "returnGeometry": "true", "outSR": 4326,
                     "resultRecordCount": 2000, "f": "json"}, timeout=90)
    out = []
    for f in r.json()["features"]:
        rings = f["geometry"]["rings"]
        try:
            g = Polygon(rings[0], rings[1:]).buffer(0)
        except Exception:
            continue
        out.append((f["attributes"]["rolpredi"], f["attributes"]["especie_01"].strip(), transform(to_sin, g)))
    return out
def best_cover(g):
    minx, miny, maxx, maxy = g.bounds
    i0, i1 = math.floor((minx - X0) / CELL), math.floor((maxx - X0) / CELL)
    j0, j1 = math.floor((Y0 - maxy) / CELL), math.floor((Y0 - miny) / CELL)
    best = 0.0
    for i in range(i0, i1 + 1):
        for j in range(j0, j1 + 1):
            c = box(X0 + i * CELL, Y0 - (j + 1) * CELL, X0 + (i + 1) * CELL, Y0 - j * CELL)
            best = max(best, g.intersection(c).area / c.area)
    return best
res = json.load(open("out_modis_mixed.json")) if os.environ.get("ONLY_B") else {}
for key, lyr, lon, lat in ([] if os.environ.get("ONLY_B") else SITES):
    t = time.time(); polys = fetch(lyr, lon, lat); dt = round(time.time() - t, 1)
    blocks = [best_cover(g) for _, _, g in polys]
    farms = collections.defaultdict(list)
    for rol, sp, g in polys: farms[rol].append(g)
    farm_geoms = [unary_union(v) for v in farms.values()]
    farm_cov = [best_cover(g) for g in farm_geoms]
    farm_ha = sorted(g.area / 1e4 for g in farm_geoms)  # sinusoidal is equal-area
    def share(v, th): return round(sum(x >= th for x in v) / len(v), 2)
    res[key] = {"fetch_s": dt, "n_blocks": len(blocks), "n_predios": len(farm_geoms),
                "predio_orchard_ha_median": round(farm_ha[len(farm_ha) // 2], 1), "predio_orchard_ha_p90": round(farm_ha[int(len(farm_ha) * .9)], 1),
                "blocks_with_pixel_ge50pct": share(blocks, .5), "blocks_with_pixel_ge80pct": share(blocks, .8), "blocks_with_pure_pixel_ge95pct": share(blocks, .95),
                "predios_with_pixel_ge80pct_orchard": share(farm_cov, .8)}
    print(key, res[key])
# --- B: ORNL series for the field-centre pixel
ORNL = "https://modis.ornl.gov/rst/api/v1"
HDR = {"Accept": "application/json"}
for key in ["requinoa_cherry", "quillota_avocado"]:
    f = json.load(open(f"field_{key}.geojson")); g = shape(f["geometry"]); c = g.centroid
    gs = transform(to_sin, g); x, y = to_sin(c.x, c.y)
    i, j = math.floor((x - X0) / CELL), math.floor((Y0 - y) / CELL)
    cell = box(X0 + i * CELL, Y0 - (j + 1) * CELL, X0 + (i + 1) * CELL, Y0 - j * CELL)
    cov = gs.intersection(cell).area / cell.area
    cell_ll = transform(to_ll, cell.segmentize(20))
    json.dump({"type": "Feature", "properties": {"site": key, "modis_cell_hv_ij": [i, j], "field_cover_frac": round(cov, 3)}, "geometry": mapping(cell_ll)}, open(f"modispx_{key}.geojson", "w"))
    t = time.time(); r = requests.get(f"{ORNL}/MOD13Q1/dates", params={"latitude": c.y, "longitude": c.x}, headers=HDR, timeout=90)
    dates = [d for d in r.json()["dates"] if "2021-11-01" <= d["calendar_date"] <= "2026-11-06"]
    t_dates = round(time.time() - t, 2)
    series, calls, t = {}, 0, time.time()
    for k in range(0, len(dates), 10):
        chunk = dates[k:k + 10]
        for band in ["250m_16_days_NDVI", "250m_16_days_pixel_reliability"]:
            for a in range(3):
                rr = requests.get(f"{ORNL}/MOD13Q1/subset", params={"latitude": c.y, "longitude": c.x, "band": band, "startDate": chunk[0]["modis_date"],
                                  "endDate": chunk[-1]["modis_date"], "kmAboveBelow": 0, "kmLeftRight": 0}, headers=HDR, timeout=120)
                calls += 1
                if rr.status_code == 200: break
                time.sleep(3)
            for s in rr.json().get("subset", []):
                series.setdefault(s["calendar_date"], {})[band[len("250m_16_days_"):]] = s["data"][0]
            time.sleep(0.3)
    hdr = {k: rr.json().get(k) for k in ("xllcorner", "yllcorner", "cellsize")}
    ser = {d: {"ndvi": v.get("NDVI", -3000) / 1e4, "rel": v.get("pixel_reliability")} for d, v in sorted(series.items())}
    clim = collections.defaultdict(list)
    for d, v in ser.items():
        if v["rel"] in (0, 1): clim[int(d[5:7])].append(v["ndvi"])
    res[f"ornl_{key}"] = {"dates_s": t_dates, "subset_calls": calls, "subset_s": round(time.time() - t, 1), "n_composites": len(ser), "last": max(ser),
                          "ornl_header": hdr, "our_cell_ll_x": X0 + i * CELL, "field_cover_frac_of_pixel": round(cov, 3),
                          "monthly_mean_good": {m: round(sum(v) / len(v), 3) for m, v in sorted(clim.items())}, "series": ser}
    print(key, {k: v for k, v in res[f"ornl_{key}"].items() if k != "series"})
json.dump(res, open("out_modis_mixed.json", "w"), indent=1)
