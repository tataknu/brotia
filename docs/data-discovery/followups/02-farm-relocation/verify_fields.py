"""Verify each selected field polygon (keyless):
 1. Sentinel-2 L2A NDVI via Planetary Computer data API item/statistics, one clear scene Jan-Feb 2026 + one Jul-Aug 2026
    (single call per scene with two expressions: SCL-masked NDVI and clear flag; -1000 DN offset when s2:processing_baseline >= 04.00).
 2. MODIS 250 m pixel count on the real MOD13Q1 sinusoidal grid (pixel centres inside polygon).
 3. Geodesic area.
Usage: python verify_fields.py sel.json out_dir
"""
import sys, json, time, requests, rasterio, numpy as np
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
from rasterio.windows import from_bounds
from pyproj import Geod
from shapely.geometry import shape

SEL, OUT = sys.argv[1], sys.argv[2]
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
STATS = "https://planetarycomputer.microsoft.com/api/data/v1/item/statistics"
CLEAR = "((SCL==4)|(SCL==5)|(SCL==6))"
geod = Geod(ellps="WGS84")
log = []

def s2_search(geom, start, end):
    t = time.time()
    r = requests.post(STAC, json={"collections": ["sentinel-2-l2a"], "intersects": geom, "datetime": f"{start}/{end}",
                                  "query": {"eo:cloud_cover": {"lt": 40}}, "sortby": [{"field": "eo:cloud_cover", "direction": "asc"}],
                                  "limit": 20}, timeout=60)
    log.append({"call": "stac_search", "status": r.status_code, "s": round(time.time()-t, 2)})
    r.raise_for_status()
    return r.json()["features"]

def s2_stats(item, geom):
    base = item["properties"].get("s2:processing_baseline", "00.00")
    off = 2000 if float(base) >= 4.0 else 0  # (B08-1000)+(B04-1000)
    expr = f"where({CLEAR},(B08-B04)/(B08+B04-{off}),0);where({CLEAR},1,0)"
    t = time.time()
    r = requests.post(STATS, params={"collection": "sentinel-2-l2a", "item": item["id"], "expression": expr,
                                     "asset_as_band": "true", "max_size": 1024}, json={"type": "Feature", "properties": {}, "geometry": geom}, timeout=90)
    dt = round(time.time()-t, 2)
    log.append({"call": "item_statistics", "item": item["id"], "status": r.status_code, "s": dt})
    if r.status_code != 200:
        return {"item": item["id"], "status": r.status_code, "err": r.text[:200]}
    st = list(r.json()["properties"]["statistics"].values())
    ndvi_sum, clear_mean, cnt = st[0]["sum"], st[1]["mean"], st[0]["count"]
    n_clear = clear_mean * cnt
    return {"item": item["id"], "date": item["properties"]["datetime"][:10], "baseline": base, "dn_offset_applied": off // 2,
            "scene_cloud_pct": round(item["properties"]["eo:cloud_cover"], 1), "status": 200, "s": dt, "px": int(cnt),
            "clear_frac": round(clear_mean, 3), "ndvi": round(ndvi_sum / n_clear, 3) if n_clear > 0 else None}

def best_scene(geom, start, end, need=0.9, tries=6):
    tried = []
    for it in s2_search(geom, start, end)[:tries]:
        res = s2_stats(it, geom); tried.append({k: res.get(k) for k in ("date", "clear_frac", "status")})
        if res.get("status") == 200 and res["clear_frac"] >= need:
            res["tried"] = tried; return res
        time.sleep(0.3)
    return {"status": "no_clear_scene", "tried": tried}

# MODIS sinusoidal grid from one live MOD13Q1 COG (header only)
tok = requests.get("https://planetarycomputer.microsoft.com/api/sas/v1/token/modiseuwest/modis-061-cogs", timeout=30).json()["token"]
mod = requests.post(STAC, json={"collections": ["modis-13Q1-061"], "intersects": {"type": "Point", "coordinates": [-62.9, -17.3]},
                                "sortby": [{"field": "datetime", "direction": "desc"}], "limit": 1}, timeout=60).json()["features"][0]
with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"), rasterio.open(mod["assets"]["250m_16_days_NDVI"]["href"] + "?" + tok) as ds:
    MCRS, MTR, MSHAPE = ds.crs, ds.transform, ds.shape
print("MODIS grid from", mod["id"], "res", MTR.a, flush=True)

def modis_pixels(geom):
    g = transform_geom("EPSG:4326", MCRS, geom)
    xs = [p[0] for p in g["coordinates"][0]]; ys = [p[1] for p in g["coordinates"][0]]
    w = from_bounds(min(xs)-500, min(ys)-500, max(xs)+500, max(ys)+500, MTR).round_offsets().round_lengths()
    tr = rasterio.windows.transform(w, MTR)
    centres = int((~geometry_mask([g], out_shape=(w.height, w.width), transform=tr, all_touched=False)).sum())
    # fully-inside pixels: erode by testing all 4 corners -> use shapely
    from shapely.geometry import box
    poly = shape(g); full = 0
    for r in range(w.height):
        for c in range(w.width):
            x0, y0 = tr * (c, r); x1, y1 = tr * (c+1, r+1)
            if poly.contains(box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))): full += 1
    return centres, full

sel = json.load(open(SEL)); rows = []
for rec in sel:
    g = rec["polygon"]
    area = abs(geod.geometry_area_perimeter(shape(g))[0]) / 1e4
    cen, full = modis_pixels(g)
    # soy/maize/rice peak is Feb: try the least-cloudy clear scene in Feb first, then late Jan, then early Jan
    for a0, b0 in (("2026-02-01", "2026-02-28"), ("2026-01-15", "2026-01-31"), ("2026-01-01", "2026-01-14")):
        summer = best_scene(g, a0, b0, tries=4)
        if summer.get("status") == 200: break
    winter = best_scene(g, "2026-07-01", "2026-08-31")
    rec.update(area_ha=round(area, 1), modis_px_centres=cen, modis_px_full=full, s2_janfeb=summer, s2_julaug=winter)
    a, b = summer.get("ndvi"), winter.get("ndvi")
    rec["ndvi_amplitude"] = round(abs(a - b), 3) if a is not None and b is not None else None
    print(rec["name"], rec["status"], area, cen, full, a, summer.get("date"), b, winter.get("date"), flush=True)
json.dump(sel, open(f"{OUT}/fields_verified.json", "w"), indent=1)
json.dump(log, open(f"{OUT}/api_log.json", "w"), indent=1)
