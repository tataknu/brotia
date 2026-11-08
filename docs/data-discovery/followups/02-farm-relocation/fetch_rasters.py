"""Fetch small regional windows (keyless) for the farm-relocation search.
Region = farms bbox + ~10 km. Saves GeoTIFF clips to OUT dir (scratchpad, not committed).
Sources: MapBiomas Bolivia 2024 (source.coop mirror), GLAD/UMD SA soybean 2021-2023, ESA WorldCover 2021 (PC), JRC GSW occurrence (PC)."""
import sys, time, os, json, requests, rasterio, numpy as np
from rasterio.windows import from_bounds
from rasterio.warp import transform_bounds
import planetary_computer as pc, pystac_client
OUT = sys.argv[1]
BB = (-63.42, -17.86, -62.34, -16.74)
env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MULTIRANGE="YES",
           GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES", VSI_CACHE="TRUE")
log = {}
def clip(name, href):
    t = time.time()
    with rasterio.Env(**env), rasterio.open(href) as ds:
        b = transform_bounds("EPSG:4326", ds.crs, *BB) if ds.crs.to_epsg() != 4326 else BB
        w = from_bounds(*b, ds.transform).round_offsets().round_lengths()
        w = w.intersection(rasterio.windows.Window(0, 0, ds.width, ds.height))  # crop to tile, else transform is shifted
        a = ds.read(1, window=w); tr = ds.window_transform(w)
        prof = dict(driver="GTiff", height=a.shape[0], width=a.shape[1], count=1, dtype=a.dtype, crs=ds.crs, transform=tr, compress="deflate")
    with rasterio.open(os.path.join(OUT, name + ".tif"), "w", **prof) as d: d.write(a, 1)
    vals, cnt = np.unique(a, return_counts=True)
    log[name] = {"href": href.split("?")[0], "shape": a.shape, "res": [tr.a, tr.e], "s": round(time.time()-t, 1),
                 "values": {int(v): int(c) for v, c in zip(vals, cnt) if c > a.size*0.001}}
    print(name, json.dumps(log[name]), flush=True)
clip("mapbiomas2024", "/vsicurl/https://data.source.coop/tristangruppwri/mapbiomas/mapbiomas-bolivia/mapbiomas_bolivia_2024/mapbiomas_bolivia_2024.tif")
for y in (2021, 2022, 2023):
    clip(f"gladsoy{y}", f"/vsicurl/https://glad.umd.edu/projects/AnnualClassMapsV1/SouthAmerica_Soybean_{y}.tif")
cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)
it = [i for i in cat.search(collections=["esa-worldcover"], bbox=BB).items() if i.properties.get("start_datetime","").startswith("2021")]
print("worldcover 2021 items", [i.id for i in it])
for k, i in enumerate(it): clip(f"worldcover2021_{k}", i.assets["map"].href)
it = list(cat.search(collections=["jrc-gsw"], bbox=BB).items())
print("jrc items", [i.id for i in it])
for k, i in enumerate(it): clip(f"jrcocc_{k}", i.assets["occurrence"].href)
json.dump(log, open(os.path.join(OUT, "fetch_log.json"), "w"), indent=1, default=str)
