"""Read a ~1 km x 1 km window of Sentinel-1 RTC (Planetary Computer, anonymous SAS token) over two farms
for recent and 2024 wet-season dates. Reports mean VV/VH backscatter (dB) and 'open water' fraction
(VV < -18 dB and VH < -24 dB, a common threshold rule). No account or key used."""
import time, json, numpy as np, rasterio, planetary_computer as pc, pystac_client
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds
FARMS = {"Cuatro Canadas L7 (soy)": (-62.47, -17.3), "Arrocera Mineros (rice)": (-63.29, -17.2)}
cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)
out = {}
for name, (lon, lat) in FARMS.items():
    bb = (lon - 0.005, lat - 0.005, lon + 0.005, lat + 0.005)
    rows = []
    for dt in ["2026-08-01/2026-11-06", "2024-01-01/2024-04-30", "2025-01-01/2025-04-30"]:
        items = list(cat.search(collections=["sentinel-1-rtc"], bbox=bb, datetime=dt).items())
        items.sort(key=lambda i: i.datetime)
        for it in items[-6:] if dt.startswith("2026") else items[::3]:
            rec = {"date": it.datetime.date().isoformat(), "platform": it.properties.get("platform")}
            for pol in ("vv", "vh"):
                if pol not in it.assets: continue
                t = time.time()
                with rasterio.open(it.assets[pol].href) as src:
                    b = transform_bounds("EPSG:4326", src.crs, *bb)
                    a = src.read(1, window=from_bounds(*b, src.transform)).astype(float)
                    a[(a <= 0) | ~np.isfinite(a)] = np.nan
                    db = 10 * np.log10(a)
                    rec[pol + "_db"] = round(float(np.nanmean(db)), 2)
                    rec[pol + "_px"] = int(np.isfinite(db).sum())
                    rec[pol + "_res_m"] = round(src.res[0], 1)
                    rec[pol + "_read_s"] = round(time.time() - t, 2)
                    if pol == "vv": vv = db
                    else: vh = db
            if "vh_db" in rec:
                rec["water_frac"] = round(float(np.nanmean((vv < -18) & (vh < -24))), 3)
            rows.append(rec); print(name, rec, flush=True)
    out[name] = rows
json.dump(out, open(__file__.replace(".py", "_result.json"), "w"), indent=1)
