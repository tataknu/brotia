"""Sentinel-2 NDVI over the exact MOD13Q1 pixel footprint (and a 3x3-pixel box) for cross-calibration.

Keyless: Earth Search v1 STAC `sentinel-2-c1-l2a` (AWS open COGs). Reads only red/nir/scl windows.
The MODIS pixel is computed on the sinusoidal grid (R=6371007.181 m, 231.656358 m cells), the
same cell ORNL returns for km=0. Scale/offset from each asset's raster:bands (c1: 1e-4, -0.1).
Output: sample_s2_on_modis_pixel_<farm>.json  (one row per scene, small)
"""
import json, math, sys, time, pathlib
import numpy as np, requests, rasterio
from rasterio.windows import from_bounds
from pyproj import Transformer

HERE = pathlib.Path(__file__).parent
FARMS = {"tajibos": ("Estancia Los Tajibos", -62.52, -16.86), "cuatrocanadas": ("Colonia Cuatro Canadas Lote 7", -62.47, -17.3)}
R, CELL, X0, Y0 = 6371007.181, 231.656358263889, -20015109.354, 10007554.677
SIN = "+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs"
ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", AWS_NO_SIGN_REQUEST="YES", GDAL_HTTP_MAX_RETRY="3",
           CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif")
CLEAR = (4, 5)  # vegetation, bare soil (fields; water excluded)

def modis_cell(lon, lat, n=0):
    x = R * math.radians(lon) * math.cos(math.radians(lat)); y = R * math.radians(lat)
    col = math.floor((x - X0) / CELL); row = math.floor((Y0 - y) / CELL)
    xs = X0 + (col - n) * CELL, X0 + (col + 1 + n) * CELL
    ys = Y0 - (row + 1 + n) * CELL, Y0 - (row - n) * CELL
    return xs, ys

def utm_bounds(lon, lat, n, epsg):
    xs, ys = modis_cell(lon, lat, n)
    tr = Transformer.from_crs(SIN, f"EPSG:{epsg}", always_xy=True)
    px, py = tr.transform([xs[0], xs[1], xs[0], xs[1]], [ys[0], ys[0], ys[1], ys[1]])
    return min(px), min(py), max(px), max(py)  # note: sinusoidal cell is a slight parallelogram

def read(href, b, shape=None):
    with rasterio.open(href) as ds:
        return ds.read(1, window=from_bounds(*b, transform=ds.transform), out_shape=shape, boundless=True, fill_value=0)

def main():
    key = sys.argv[1] if len(sys.argv) > 1 else "tajibos"
    name, lon, lat = FARMS[key]
    body = {"collections": ["sentinel-2-c1-l2a"], "intersects": {"type": "Point", "coordinates": [lon, lat]},
            "datetime": "2021-07-01T00:00:00Z/2026-11-07T00:00:00Z", "limit": 200,
            "query": {"eo:cloud_cover": {"lt": 60}}}
    t = time.time(); r = requests.post("https://earth-search.aws.element84.com/v1/search", json=body, timeout=60)
    feats = r.json()["features"]
    while True:
        nxt = [l for l in r.json().get("links", []) if l.get("rel") == "next"]
        if not nxt: break
        r = requests.post(nxt[0]["href"], json=nxt[0].get("body", body), timeout=60); feats += r.json()["features"]
    print(f"STAC {len(feats)} scenes (cc<60) in {time.time()-t:.1f}s", flush=True)
    def one(f):
        p, a = f["properties"], f["assets"]
        epsg = p.get("proj:epsg") or int(str(p.get("proj:code", "EPSG:32720")).split(":")[1])
        row = {"date": p["datetime"][:10], "id": f["id"], "cc": round(p["eo:cloud_cover"], 1)}
        t = time.time()
        try:
            with rasterio.Env(**ENV):
                for n in (0, 1):
                    b = utm_bounds(lon, lat, n, epsg)
                    red = read(a["red"]["href"], b).astype("float32"); sh = red.shape
                    nir = read(a["nir"]["href"], b, sh).astype("float32")
                    scl = read(a["scl"]["href"], b, sh)  # 20 m resampled to 10 m grid (nearest)
                    rb, nb = a["red"]["raster:bands"][0], a["nir"]["raster:bands"][0]
                    rr = red * rb.get("scale", 1e-4) + rb.get("offset", 0); nn = nir * nb.get("scale", 1e-4) + nb.get("offset", 0)
                    ok = np.isin(scl, CLEAR) & (red > 0) & (nir > 0)
                    ndvi = (nn - rr) / (nn + rr)
                    row[f"clear{n}"] = round(float(ok.mean()), 3); row[f"px{n}"] = int(ok.size)
                    row[f"ndvi{n}"] = round(float(np.nanmean(ndvi[ok])), 4) if ok.sum() else None
            row["s"] = round(time.time() - t, 2)
        except Exception as e:
            row["err"] = repr(e)[:120]
        print(row, flush=True)
        return row
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(8) as ex:
        rows = sorted(ex.map(one, feats), key=lambda r: r["date"])
    json.dump({"farm": name, "lon": lon, "lat": lat, "modis_cell_sin": modis_cell(lon, lat), "rows": rows},
              open(HERE / f"sample_s2_on_modis_pixel_{key}.json", "w"))

if __name__ == "__main__":
    main()
