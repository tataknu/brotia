"""MapBiomas Bolivia (30 m, annual) - third-party COG mirror on source.coop (CC-BY-SA-4.0, no key).
Official GCS bucket (storage.googleapis.com/mapbiomas-public/...) returned 403 to anonymous callers on 2026-11-07,
so we test the mirror: STAC items -> COG href -> window read class mix around each farm."""
import json, time, collections, requests, rasterio
from rasterio.windows import from_bounds
FARMS = [("Estancia Los Tajibos","soy",-62.52,-16.86),("Agropecuaria Brecha 8","maize",-62.70,-16.97),
 ("Colonia Cuatro Canadas Lote 7","soy",-62.47,-17.30),("Hacienda El Cusi","sorghum",-62.55,-17.38),
 ("Agricola Pailon Norte","wheat",-62.68,-17.56),("Granja Las Londras","sunflower",-62.76,-17.74),
 ("Finca Okinawa Dos","maize",-62.85,-17.18),("Parcela Okinawa Uno","soy",-62.93,-17.27),
 ("Arrocera Mineros","rice",-63.29,-17.20),("Canaveral San Antonio","sugarcane",-63.21,-17.29),
 ("Agricola Warnes Sur","soy",-63.08,-17.56),("Estancia Mineros Norte","soy",-63.18,-17.03)]
LEG = {3:"forest",4:"open_forest",6:"flooded_forest",11:"flooded_grass",12:"grass",15:"pasture",18:"agri",21:"mosaic",
       24:"urban",25:"other_anthropic",33:"river_lake",39:"soy",40:"flooded_rice",72:"other_crops",66:"scrub",23:"sand"}
B = "https://data.source.coop/tristangruppwri/mapbiomas/mapbiomas-bolivia"
env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif")
out = {}
for y in range(2019, 2025):
    it = requests.get(f"{B}/mapbiomas_bolivia_{y}/mapbiomas_bolivia_{y}.json", timeout=30).json()
    href = next(iter(it["assets"].values()))["href"]
    if not href.startswith("http"): href = f"{B}/mapbiomas_bolivia_{y}/" + href.lstrip("./")
    h = requests.head(href, timeout=30, allow_redirects=True)
    print(y, "asset", href, "HEAD", h.status_code, h.headers.get("Content-Length"))
    if h.status_code != 200: continue
    t = time.time()
    with rasterio.Env(**env), rasterio.open("/vsicurl/" + href) as ds:
        for name, crop, lon, lat in FARMS:
            a = ds.read(1, window=from_bounds(lon-0.0045, lat-0.0045, lon+0.0045, lat+0.0045, ds.transform))
            c = collections.Counter(a.ravel().tolist()); n = sum(c.values())
            out.setdefault(f"{name} ({crop})", {})[y] = {LEG.get(k, k): round(v/n, 2) for k, v in c.most_common(3)}
    print(y, "12 windows %.1fs" % (time.time()-t))
for k, v in out.items(): print(k, v)
json.dump(out, open("probe_mapbiomas_sourcecoop.json", "w"), indent=1)
