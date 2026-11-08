"""Probe GLAD/UMD South America annual soybean maps (30 m) via HTTP range reads (no key).
Reads a small window around each sample farm for several years; reports soy fraction in 1 km box."""
import time, json, sys
import rasterio
from rasterio.windows import from_bounds
FARMS = [("Estancia Los Tajibos","soy",-62.52,-16.86),("Agropecuaria Brecha 8","maize",-62.70,-16.97),
 ("Colonia Cuatro Canadas Lote 7","soy",-62.47,-17.30),("Hacienda El Cusi","sorghum",-62.55,-17.38),
 ("Agricola Pailon Norte","wheat",-62.68,-17.56),("Granja Las Londras","sunflower",-62.76,-17.74),
 ("Finca Okinawa Dos","maize",-62.85,-17.18),("Parcela Okinawa Uno","soy",-62.93,-17.27),
 ("Arrocera Mineros","rice",-63.29,-17.20),("Canaveral San Antonio","sugarcane",-63.21,-17.29),
 ("Agricola Warnes Sur","soy",-63.08,-17.56),("Estancia Mineros Norte","soy",-63.18,-17.03)]
years = [int(y) for y in sys.argv[1:]] or [2024]
env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MULTIRANGE="YES")
out = {}
with rasterio.Env(**env):
    for y in years:
        url = f"/vsicurl/https://glad.umd.edu/projects/AnnualClassMapsV1/SouthAmerica_Soybean_{y}.tif"
        t = time.time()
        with rasterio.open(url) as ds:
            if y == years[0]:
                print("profile:", ds.profile.get("driver"), ds.crs, ds.res, ds.width, ds.height, ds.dtypes, "blocks", ds.block_shapes, "overviews", ds.overviews(1), "nodata", ds.nodata)
            for name, crop, lon, lat in FARMS:
                d = 0.0045  # ~500 m half-width
                w = from_bounds(lon-d, lat-d, lon+d, lat+d, ds.transform)
                a = ds.read(1, window=w)
                vals, = [sorted(set(a.ravel().tolist()))]
                frac = float((a == 1).mean()) if a.size else None
                out.setdefault(name, {})[y] = round(frac, 3)
        print(y, "read 12 windows in %.1fs" % (time.time()-t), "values seen e.g.", vals[:6])
print(json.dumps(out, indent=1))
