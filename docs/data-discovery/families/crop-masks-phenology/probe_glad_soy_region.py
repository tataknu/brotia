"""Soy fraction of the sample-farm region (-63.35..-62.40, -17.80..-16.80) per GLAD year, to sanity-check year convention / gaps."""
import time, rasterio
from rasterio.windows import from_bounds
env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MULTIRANGE="YES")
with rasterio.Env(**env):
    for y in range(2015, 2025):
        t = time.time()
        with rasterio.open(f"/vsicurl/https://glad.umd.edu/projects/AnnualClassMapsV1/SouthAmerica_Soybean_{y}.tif") as ds:
            a = ds.read(1, window=from_bounds(-63.35, -17.80, -62.40, -16.80, ds.transform))
        print(y, a.shape, "soy frac %.3f" % (a == 1).mean(), "soy km2 %.0f" % ((a == 1).sum() * 0.0007), "%.1fs" % (time.time()-t))
