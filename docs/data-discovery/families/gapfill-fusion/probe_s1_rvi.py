"""Read Sentinel-1 RTC VV/VH (gamma0, linear power) over one MODIS-cell-sized box at a cropland farm and compute
RVI = 4*VH/(VV+VH) for the last ~6 months of scenes. Keyless: PC anonymous SAS token (no account)."""
import time, requests, numpy as np, rasterio
from rasterio.windows import from_bounds
from pyproj import Transformer
LON, LAT = -62.47, -17.30  # Colonia Cuatro Canadas Lote 7 (MCD12Q1 cropland)
t = time.time(); tok = requests.get("https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-1-rtc", timeout=30)
print("SAS token:", tok.status_code, f"{time.time()-t:.1f}s", "(token length", len(tok.json().get("token", "")), ")")
token = tok.json()["token"]
r = requests.post("https://planetarycomputer.microsoft.com/api/stac/v1/search", json={"collections": ["sentinel-1-rtc"],
    "intersects": {"type": "Point", "coordinates": [LON, LAT]}, "datetime": "2026-05-01T00:00:00Z/2026-11-07T00:00:00Z", "limit": 50}, timeout=60)
feats = sorted(r.json()["features"], key=lambda f: f["properties"]["datetime"])
print("scenes:", len(feats))
with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
    for f in feats[-8:]:
        t = time.time(); out = {}
        for pol in ("vv", "vh"):
            href = f["assets"][pol]["href"] + "?" + token
            with rasterio.open(href) as ds:
                tr = Transformer.from_crs(4326, ds.crs, always_xy=True); x, y = tr.transform(LON, LAT)
                a = ds.read(1, window=from_bounds(x - 115, y - 115, x + 115, y + 115, ds.transform)).astype("float32")
                a = a[(a > 0) & np.isfinite(a)]; out[pol] = float(np.mean(a)) if a.size else np.nan
        rvi = 4 * out["vh"] / (out["vv"] + out["vh"])
        print(f"{f['properties']['datetime'][:10]} {f['properties']['platform']:12s} VV={10*np.log10(out['vv']):6.2f} dB VH={10*np.log10(out['vh']):6.2f} dB RVI={rvi:.3f}  {time.time()-t:.1f}s")
