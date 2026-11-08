"""Planetary Computer STAC (keyless; SAS token per storage container): MODIS LST MOD11A1/MYD11A1 v061.
Reads 1 km LST_Night/LST_Day at a farm via COG windowed reads. Compares a cold-surge night (2021-07-01) with ordinary nights."""
import requests, time, rasterio, json
from rasterio.warp import transform
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
OUT = "/Users/cristian/Documents/projects/energhack/docs/data-discovery/families/frost-heat-hail/samples/"
LON, LAT = -62.68, -17.56   # Agricola Pailon Norte (wheat)
tok = requests.get("https://planetarycomputer.microsoft.com/api/sas/v1/token/modiseuwest/modis-061-cogs", timeout=60).json()["token"]
def search(dt_range, limit=50):
    body = {"collections": ["modis-11A1-061"], "intersects": {"type": "Point", "coordinates": [LON, LAT]},
            "datetime": dt_range, "limit": limit, "sortby": [{"field": "datetime", "direction": "desc"}]}
    t = time.time(); r = requests.post(f"{STAC}/search", json=body, timeout=60); return r.json()["features"], round(time.time()-t, 2)
def px(it, band):
    with rasterio.open(it["assets"][band]["href"] + "?" + tok) as ds:
        xs, ys = transform("EPSG:4326", ds.crs, [LON], [LAT]); r_, c_ = ds.index(xs[0], ys[0])
        return int(ds.read(1, window=((r_, r_+1), (c_, c_+1)))[0, 0])
rows = []
for label, rng in [("recent", "2026-10-28/2026-11-07"), ("surazo-2021", "2021-06-28/2021-07-04"), ("jun-2002 (station 0.5C)", "2002-06-24/2002-06-27")]:
    items, dt = search(rng); print(label, "search", dt, "s, n=", len(items))
    for it in sorted(items, key=lambda i: i["id"]):
        t = time.time(); n = px(it, "LST_Night_1km"); d = px(it, "LST_Day_1km"); qn = px(it, "QC_Night")
        row = dict(window=label, id=it["id"].split(".h")[0], date=it["properties"]["start_datetime"][:10],
                   lst_night_C=round(n * 0.02 - 273.15, 1) if n else None, lst_day_C=round(d * 0.02 - 273.15, 1) if d else None,
                   qc_night=qn, read_s=round(time.time()-t, 2))
        rows.append(row); print("  ", row)
json.dump(rows, open(OUT + "pc_modis_lst_pailon.json", "w"), indent=1)
