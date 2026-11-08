"""MODIS LST_Night (PC, keyless) over all 12 farms during documented cold events: mid-June 2023 (reported crop frost/snow in Santa Cruz) and the 2021-06-30 surazo.
One COG window per tile per date covers the portfolio (tiles h11v10 / h12v10)."""
import requests, rasterio, json, numpy as np
from rasterio.warp import transform
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
OUT = "/Users/cristian/Documents/projects/energhack/docs/data-discovery/families/frost-heat-hail/samples/"
FARMS = [("Estancia Los Tajibos", -62.52, -16.86), ("Agropecuaria Brecha 8", -62.7, -16.97), ("Colonia Cuatro Canadas Lote 7", -62.47, -17.3), ("Hacienda El Cusi", -62.55, -17.38),
         ("Agricola Pailon Norte", -62.68, -17.56), ("Granja Las Londras", -62.76, -17.74), ("Finca Okinawa Dos", -62.85, -17.18), ("Parcela Okinawa Uno", -62.93, -17.27),
         ("Arrocera Mineros", -63.29, -17.2), ("Canaveral San Antonio", -63.21, -17.29), ("Agricola Warnes Sur", -63.08, -17.56), ("Estancia Mineros Norte", -63.18, -17.03)]
tok = requests.get("https://planetarycomputer.microsoft.com/api/sas/v1/token/modiseuwest/modis-061-cogs", timeout=60).json()["token"]
res = {}
for rng in ["2023-06-13/2023-06-20", "2021-06-29/2021-07-02"]:
    body = {"collections": ["modis-11A1-061"], "bbox": [-63.35, -17.8, -62.42, -16.8], "datetime": rng, "limit": 100}
    for attempt in range(4):
        try:
            items = requests.post(f"{STAC}/search", json=body, timeout=90).json()["features"]; break
        except Exception as e:
            print("retry", attempt, e.__class__.__name__); import time; time.sleep(20)
    items = [i for i in items if i["id"].startswith("MYD")]
    for it in sorted(items, key=lambda i: i["id"]):
        day = it["properties"]["start_datetime"][:10]
        with rasterio.open(it["assets"]["LST_Night_1km"]["href"] + "?" + tok) as ds:
            for name, lon, lat in FARMS:
                xs, ys = transform("EPSG:4326", ds.crs, [lon], [lat]); r, c = ds.index(xs[0], ys[0])
                if not (0 <= r < ds.height and 0 <= c < ds.width): continue
                v = int(ds.read(1, window=((r, r + 1), (c, c + 1)))[0, 0])
                res.setdefault(day, {})[name] = round(v * 0.02 - 273.15, 1) if v else None
for day in sorted(res):
    vals = [v for v in res[day].values() if v is not None]
    print(day, "farms clear %d/12" % len(vals), "min %.1f" % min(vals) if vals else "", {k[:14]: v for k, v in res[day].items()})
json.dump(res, open(OUT + "modis_lst_night_aqua_cold_events_12farms.json", "w"), indent=1)
