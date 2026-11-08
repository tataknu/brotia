"""Full-history (2000-) single-pixel MOD13Q1 series from Planetary Computer COGs (anonymous SAS token, keyless).

Used because ORNL slowed to ~27 s/call (10 composites/call cap -> ~3 h for 26 y x 3 bands).
Reads the 1 pixel containing the point for NDVI, pixel_reliability, composite_day_of_the_year;
8 threads. Output has the same shape as fetch_ornl_series.py so exp_smooth.py can read it.
"""
import sys, json, time, pathlib, requests, rasterio
from concurrent.futures import ThreadPoolExecutor
from pyproj import Transformer
H = pathlib.Path(__file__).parent
FARMS = {"cuatrocanadas": ("Colonia Cuatro Canadas Lote 7", -62.47, -17.3), "tajibos": ("Estancia Los Tajibos", -62.52, -16.86)}
key = sys.argv[1] if len(sys.argv) > 1 else "cuatrocanadas"; name, lon, lat = FARMS[key]
S = "https://planetarycomputer.microsoft.com/api/stac/v1"
tok = requests.get("https://planetarycomputer.microsoft.com/api/sas/v1/token/modiseuwest/modis-061-cogs", timeout=30).json()["token"]
feats, body, url = [], {"collections": ["modis-13Q1-061"], "intersects": {"type": "Point", "coordinates": [lon, lat]},
                         "datetime": "2000-01-01T00:00:00Z/2026-11-07T00:00:00Z", "limit": 250}, f"{S}/search"
t = time.time()
while True:
    j = requests.post(url, json=body, timeout=60).json(); feats += j["features"]
    nx = [l for l in j.get("links", []) if l.get("rel") == "next"]
    if not nx: break
    url, body = nx[0]["href"], nx[0].get("body", body)
feats = [f for f in feats if f["id"].startswith("MOD13Q1")]  # Terra only (MYD is a separate option)
print(f"STAC: {len(feats)} Terra composites in {time.time()-t:.1f}s", flush=True)
BANDS = ["250m_16_days_NDVI", "250m_16_days_pixel_reliability", "250m_16_days_composite_day_of_the_year"]

def one(f):
    out = {"calendar_date": f["properties"].get("start_datetime", f["properties"]["datetime"])[:10]}
    for b in BANDS:
        for attempt in range(3):
            try:
                with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
                    with rasterio.open(f["assets"][b]["href"] + "?" + tok) as ds:
                        x, y = Transformer.from_crs(4326, ds.crs, always_xy=True).transform(lon, lat)
                        out[b[13:]] = int(next(ds.sample([(x, y)]))[0])
                break
            except Exception as e:
                out["err"] = repr(e)[:80]; time.sleep(2)
    return out

t = time.time()
with ThreadPoolExecutor(8) as ex: rows = list(ex.map(one, feats))
print(f"read {len(rows)} composites x {len(BANDS)} bands in {time.time()-t:.0f}s; errors={sum('err' in r for r in rows)}")
series = {r["calendar_date"]: {k: v for k, v in r.items() if k not in ("calendar_date", "err")} for r in rows}
series = dict(sorted(series.items()))
fn = H / f"sample_mod13q1_pc_{key}_{min(series)}_{max(series)}.json"
json.dump({"farm": name, "lon": lon, "lat": lat, "product": "MOD13Q1.061", "source": "Planetary Computer modis-13Q1-061 COG", "series": series}, open(fn, "w"))
print("wrote", fn.name, len(series))
