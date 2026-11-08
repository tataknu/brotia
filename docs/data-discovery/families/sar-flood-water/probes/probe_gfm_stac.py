"""Copernicus GFM (Global Flood Monitoring, Sentinel-1 based, 20 m) via EODC public STAC (no key).
Search items over farms for (a) latest, (b) Dec 2025 Pirai flood; read flood/water pixels in a window."""
import requests, time, json, numpy as np, rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds
STAC = "https://stac.eodc.eu/api/v1"
c = requests.get(f"{STAC}/collections/GFM", timeout=30).json()
print("extent", c["extent"]["temporal"], "license", c.get("license"))
print("item_assets", list(c.get("item_assets", {}).keys()))
out = {}
for label, pt, dt in [("latest_cuatro_canadas", [-62.47, -17.3], "2026-09-01T00:00:00Z/2026-11-07T23:59:59Z"),
                      ("dec2025_warnes_aoi", [-63.17, -17.45], "2025-12-10T00:00:00Z/2025-12-31T23:59:59Z"),
                      ("history_start", [-62.47, -17.3], "2014-10-01T00:00:00Z/2016-12-31T23:59:59Z")]:
    t = time.time()
    r = requests.post(f"{STAC}/search", json={"collections": ["GFM"], "intersects": {"type": "Point", "coordinates": pt},
                                               "datetime": dt, "limit": 100}, timeout=60)
    fs = r.json().get("features", [])
    fs.sort(key=lambda f: f["properties"]["datetime"])
    out[label] = {"status": r.status_code, "latency_s": round(time.time() - t, 2), "n": len(fs),
                  "dates": [f["properties"]["datetime"][:10] for f in fs][-10:] if label != "history_start" else [f["properties"]["datetime"][:10] for f in fs][:5]}
    if fs:
        out[label]["assets"] = sorted(fs[-1]["assets"].keys())
        out[label]["sample_href"] = next(iter(fs[-1]["assets"].values()))["href"][:160]
    print(label, json.dumps(out[label]))
    # try reading the ensemble_flood_extent asset window
    for f in fs[-3:] if label == "dec2025_warnes_aoi" else fs[-1:]:
        for key in ("ensemble_flood_extent", "ensemble_water_extent", "reference_water_mask"):
            a = f["assets"].get(key)
            if not a: continue
            try:
                t = time.time()
                with rasterio.open(a["href"]) as src:
                    lon, lat = pt; bb = (lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05)
                    b = transform_bounds("EPSG:4326", src.crs, *bb)
                    arr = src.read(1, window=from_bounds(*b, src.transform))
                    vals, cnt = np.unique(arr, return_counts=True)
                    print("   ", f["properties"]["datetime"][:10], key, "res", src.res, "vals", dict(zip(vals.tolist(), cnt.tolist())), round(time.time() - t, 2), "s")
            except Exception as e:
                print("   read error", key, str(e)[:150])
json.dump(out, open(__file__.replace(".py", "_result.json"), "w"), indent=1)
