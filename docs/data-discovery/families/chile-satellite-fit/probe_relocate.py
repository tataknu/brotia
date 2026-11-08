"""Most test coordinates are town centres (WorldCover says >90 % built-up). For each site, read the
WorldCover 2021 10 m map in a ~16 km box (client-side COG window, PC anonymous SAS token) and find the
nearest 50 ha window that is agricultural: built < 3 %, and
  orchards/vines: (cropland + tree + grass) >= 0.9 with cropland+tree >= 0.6
  annual crops:   cropland >= 0.7
Output: out_relocated_sites.json  (proposed field-centre coordinates; crop type NOT verified)."""
import json, math
import numpy as np, rasterio, planetary_computer as pc
from rasterio.windows import from_bounds
from pystac_client import Client
from sites import SITES
cat = Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)
ANNUAL = {"rice", "maize/wheat", "wheat/oats", "potato"}
R = 0.08  # half box in degrees (~8-9 km)
out = {}
for name, crop, lon, lat in SITES:
    box = [lon - R, lat - R, lon + R, lat + R]
    items = [i for i in cat.search(collections=["esa-worldcover"], bbox=box, max_items=20).items() if "2021" in i.id]
    # mosaic only first tile (sites are not near 3-degree tile edges except check)
    it = items[0]
    with rasterio.open(it.assets["map"].href) as ds:
        win = from_bounds(*box, transform=ds.transform)
        a = ds.read(1, window=win, boundless=True, fill_value=0)
        tr = ds.window_transform(win)
    px = abs(tr.a)  # deg
    # 50 ha square -> ~707 m side
    ny = int(round(707 / 111320 / px)); nx = int(round(707 / (111320 * math.cos(math.radians(lat))) / px))
    def frac(cls):
        m = np.isin(a, cls).astype("float32")
        c = m.cumsum(0).cumsum(1)
        c = np.pad(c, ((1, 0), (1, 0)))
        s = c[ny:, nx:] - c[:-ny, nx:] - c[ny:, :-nx] + c[:-ny, :-nx]
        return s / (ny * nx)
    built = frac([50]); crop_f = frac([40]); tree = frac([10]); grass = frac([30])
    if crop in ANNUAL:
        ok = (built < 0.03) & (crop_f >= 0.7)
    else:
        ok = (built < 0.03) & ((crop_f + tree + grass) >= 0.9) & ((crop_f + tree) >= 0.6)
    yy, xx = np.nonzero(ok[::5, ::5]); yy *= 5; xx *= 5
    if len(yy) == 0:
        out[name] = {"crop": crop, "found": False}; print(name, "none"); continue
    cy = tr.f + (yy + ny / 2) * tr.e; cx = tr.c + (xx + nx / 2) * tr.a
    d = np.hypot((cx - lon) * 111.32 * math.cos(math.radians(lat)), (cy - lat) * 111.32)
    k = int(np.argmin(d))
    rec = {"crop": crop, "found": True, "orig": [lon, lat], "new": [round(float(cx[k]), 4), round(float(cy[k]), 4)], "dist_km": round(float(d[k]), 2),
           "frac": {"cropland": round(float(crop_f[yy[k], xx[k]]), 2), "tree": round(float(tree[yy[k], xx[k]]), 2), "grass": round(float(grass[yy[k], xx[k]]), 2), "built": round(float(built[yy[k], xx[k]]), 3)},
           "n_candidate_windows": int(len(yy))}
    out[name] = rec; print(name, rec)
json.dump(out, open("out_relocated_sites.json", "w"), indent=1)
