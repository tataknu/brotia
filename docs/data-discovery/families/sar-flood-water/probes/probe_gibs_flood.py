"""NASA GIBS (keyless) WMS GetMap of LANCE MODIS/VIIRS Combined Flood (2-day) over Santa Cruz farm belt.
Decodes PNG palette colours to count pixels per class. Dates: 2025-12-18 (Pirai flood) and latest."""
import requests, io, time, numpy as np
from rasterio.io import MemoryFile
BB = "-17.9,-63.7,-16.6,-62.3"  # WMS 1.3.0 EPSG:4326 axis order lat,lon
for layer in ["MODIS_Combined_Flood_2-Day", "VIIRS_Combined_Flood_2-Day"]:
    for date in ["2025-12-18", "2025-12-20", "2026-11-05"]:
        t = time.time()
        r = requests.get("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi", params={
            "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.3.0", "LAYERS": layer, "CRS": "EPSG:4326",
            "BBOX": BB, "WIDTH": 560, "HEIGHT": 520, "FORMAT": "image/png", "TIME": date, "TRANSPARENT": "TRUE"}, timeout=60)
        dt = round(time.time() - t, 2)
        if r.headers.get("content-type", "").startswith("image"):
            with MemoryFile(r.content) as m, m.open() as ds: arr = ds.read()
            im = (np.vstack([arr, np.full(arr.shape[1:], 255, arr.dtype)[None]]) if arr.shape[0] == 3 else arr).reshape(arr.shape[0] if arr.shape[0] == 4 else 4, -1).T if arr.shape[0] != 1 else np.stack([arr[0]]*3 + [np.where(arr[0] > 0, 255, 0)], -1).reshape(-1, 4)
            cols, cnt = np.unique(im[im[:, 3] > 0], axis=0, return_counts=True)
            top = sorted(zip(cnt.tolist(), [tuple(c) for c in cols.tolist()]), reverse=True)[:5]
            print(layer, date, r.status_code, dt, "s, opaque px colours:", top)
        else:
            print(layer, date, r.status_code, dt, r.text[:200])
