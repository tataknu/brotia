"""Probe 6: pixel reads for Landsat C2 L2 and HLS v2.0 (S30 + L30) on Planetary Computer
(anonymous SAS), for the same farm polygon, last 60 days. Bit-mask cloud QA, not SCL.
Landsat C2 L2 SR: reflectance = DN*2.75e-5 - 0.2 ; QA_PIXEL bits: 1 dilated cloud, 2 cirrus, 3 cloud, 4 shadow, 5 snow, 7 water
HLS v2.0: reflectance = DN*1e-4 ; Fmask bits: 1 cloud, 2 adjacent, 3 shadow, 4 snow/ice, 5 water, 6-7 aerosol level
"""
import json, time
import numpy as np, rasterio, requests
import planetary_computer as pc
from rasterio.enums import Resampling
from s2lib import GDAL_ENV, utm_bounds, read_window

lon, lat, H = -62.52, -16.86, 0.005
BBOX = [lon-H, lat-H, lon+H, lat+H]
DT = "2026-09-07T00:00:00Z/2026-11-06T23:59:59Z"


def search(coll):
    r = requests.post("https://planetarycomputer.microsoft.com/api/stac/v1/search",
                      json={"collections": [coll], "bbox": BBOX, "datetime": DT, "limit": 100}, timeout=60)
    return sorted(r.json()["features"], key=lambda f: f["properties"]["datetime"])


def stats(red, nir, swir, clear):
    with np.errstate(divide="ignore", invalid="ignore"):
        ndvi = (nir - red) / (nir + red); ndmi = (nir - swir) / (nir + swir)
    if clear.sum() == 0:
        return {}
    return {"ndvi_mean": round(float(np.nanmean(ndvi[clear])), 4), "ndmi_mean": round(float(np.nanmean(ndmi[clear])), 4)}


rows = []
for coll, keys in [("landsat-c2-l2", ("red", "nir08", "swir16", "qa_pixel")), ("hls2-s30", ("B04", "B08", "B11", "Fmask")),
                   ("hls2-l30", ("B04", "B05", "B06", "Fmask"))]:
    feats = search(coll)
    for f in feats:
        t0 = time.time()
        s = pc.sign(f)
        a = s["assets"]
        try:
            epsg = f["properties"].get("proj:epsg") or 32620
            if coll.startswith("landsat"):
                epsg = f["properties"].get("proj:epsg", 32620)
            b = utm_bounds(BBOX, epsg)
            with rasterio.Env(**GDAL_ENV):
                red = read_window(a[keys[0]]["href"], b).astype("float32")
                nir = read_window(a[keys[1]]["href"], b, out_shape=red.shape).astype("float32")
                sw = read_window(a[keys[2]]["href"], b, out_shape=red.shape).astype("float32")
                qa = read_window(a[keys[3]]["href"], b, out_shape=red.shape).astype("uint16")
            if coll.startswith("landsat"):
                valid = red > 0
                bad = (qa & (1 << 1 | 1 << 2 | 1 << 3 | 1 << 4 | 1 << 5)) > 0
                red, nir, sw = (x * 2.75e-5 - 0.2 for x in (red, nir, sw))
            else:
                valid = (red != -9999) & (red != 0) & (qa != 255)
                bad = (qa & (1 << 1 | 1 << 2 | 1 << 3 | 1 << 4)) > 0
                red, nir, sw = (x * 1e-4 for x in (red, nir, sw))
            clear = valid & ~bad
            row = {"coll": coll, "date": f["properties"]["datetime"][:10], "id": f["id"], "epsg": epsg,
                   "platform": f["properties"].get("platform"), "scene_cloud": f["properties"].get("eo:cloud_cover"),
                   "clear_frac": round(float(clear.sum()) / max(int(valid.sum()), 1), 3), **stats(red, nir, sw, clear),
                   "runtime_s": round(time.time() - t0, 2)}
        except Exception as e:
            row = {"coll": coll, "id": f["id"], "error": repr(e)[:200]}
        rows.append(row); print(json.dumps(row))
json.dump(rows, open("out_landsat_hls_pixels.json", "w"), indent=1)
