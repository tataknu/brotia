"""JRC Global Surface Water (occurrence, recurrence, seasonality, max extent) at each sample farm.
Path A: Planetary Computer STAC collection 'jrc-gsw' (COG, anonymous SAS).
Path B: direct Google Cloud Storage GeoTIFF tile (public), windowed read via /vsicurl."""
import time, json, numpy as np, rasterio, planetary_computer as pc, pystac_client
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds
FARMS = {"Estancia Los Tajibos": (-62.52, -16.86), "Agropecuaria Brecha 8": (-62.7, -16.97),
 "Colonia Cuatro Canadas Lote 7": (-62.47, -17.3), "Hacienda El Cusi": (-62.55, -17.38),
 "Agricola Pailon Norte": (-62.68, -17.56), "Granja Las Londras": (-62.76, -17.74),
 "Finca Okinawa Dos": (-62.85, -17.18), "Parcela Okinawa Uno": (-62.93, -17.27),
 "Arrocera Mineros": (-63.29, -17.2), "Canaveral San Antonio": (-63.21, -17.29),
 "Agricola Warnes Sur": (-63.08, -17.56), "Estancia Mineros Norte": (-63.18, -17.03)}
out = {"pc": {}, "gcs": {}}
t = time.time()
cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)
coll = cat.get_collection("jrc-gsw")
print("collection", coll.id, coll.extent.temporal.intervals, coll.license)
items = list(cat.search(collections=["jrc-gsw"], intersects={"type": "Point", "coordinates": [-62.9, -17.3]}).items())
print("items", [i.id for i in items], "assets", sorted(items[0].assets.keys()), "search_s", round(time.time() - t, 2))
it = items[0]
def stats(href, bb):
    with rasterio.open(href) as src:
        b = transform_bounds("EPSG:4326", src.crs, *bb)
        a = src.read(1, window=from_bounds(*b, src.transform)).astype(float)
        return a, src.res
for name, (lon, lat) in FARMS.items():
    bb = (lon - 0.01, lat - 0.01, lon + 0.01, lat + 0.01)   # ~2 km box
    rec = {}
    for asset in ("occurrence", "recurrence", "extent", "seasonality"):
        if asset not in it.assets: continue
        a, res = stats(it.assets[asset].href, bb)
        valid = a[(a >= 0) & (a <= 100)] if asset in ("occurrence", "recurrence") else a[(a >= 0) & (a < 255)]
        if asset == "occurrence":
            rec["occ_mean_pct"] = round(float(valid.mean()), 2) if valid.size else None
            rec["occ_px_gt0_frac"] = round(float((valid > 0).mean()), 4) if valid.size else None
        elif asset == "extent":
            rec["ever_water_frac"] = round(float((a == 1).mean()), 4)
        elif asset == "recurrence":
            rec["recurrence_max"] = int(valid.max()) if valid.size else None
        elif asset == "seasonality":
            rec["seasonal_px"] = int(((a > 0) & (a < 12)).sum())
    out["pc"][name] = rec
    print(name, rec, flush=True)
# Path B: GCS direct tile (70W_10S covers lon -70..-60, lat -10..-20)
href = "https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/occurrence_70W_10Sv1_4_2021.tif"
t = time.time()
try:
    with rasterio.open(href) as src:
        print("GCS tile", src.profile.get("blockxsize"), src.profile.get("tiled"), src.res, src.bounds)
    a, res = stats(href, (-63.30, -17.21, -63.28, -17.19))
    out["gcs"] = {"status": "ok", "read_s": round(time.time() - t, 2), "occ_mean_mineros": round(float(a[a <= 100].mean()), 2)}
except Exception as e:
    out["gcs"] = {"status": "error", "err": str(e)[:200]}
print("GCS", out["gcs"])
json.dump(out, open(__file__.replace(".py", "_result.json"), "w"), indent=1)
