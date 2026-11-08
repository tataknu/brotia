"""Tiny reusable helpers for polygon NDVI/NDMI from STAC COGs (no auth).

Reads only the window covering the polygon from each COG via HTTP range requests.
"""
import time
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from rasterio.enums import Resampling
from pyproj import Transformer

GDAL_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF,.tiff",
    GDAL_HTTP_MULTIPLEX="YES",
    GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES",
    GDAL_HTTP_MAX_RETRY="3",
    GDAL_HTTP_RETRY_DELAY="1",
    VSI_CACHE="TRUE",
    AWS_NO_SIGN_REQUEST="YES",
)

# Sentinel-2 SCL classes: 0 nodata,1 saturated,2 dark/topo shadow,3 cloud shadow,4 vegetation,
# 5 bare soil,6 water,7 unclassified,8 cloud med,9 cloud high,10 thin cirrus,11 snow
SCL_CLEAR = (4, 5, 6)


def utm_bounds(bbox_ll, epsg):
    tr = Transformer.from_crs(4326, epsg, always_xy=True)
    xs, ys = tr.transform([bbox_ll[0], bbox_ll[2], bbox_ll[0], bbox_ll[2]], [bbox_ll[1], bbox_ll[1], bbox_ll[3], bbox_ll[3]])
    return min(xs), min(ys), max(xs), max(ys)


def read_window(href, bounds, out_shape=None, resampling=Resampling.nearest):
    with rasterio.open(href) as ds:
        win = from_bounds(*bounds, transform=ds.transform)
        arr = ds.read(1, window=win, out_shape=out_shape, resampling=resampling, boundless=True, fill_value=0)
    return arr


def s2_polygon_stats(hrefs, bbox_ll, epsg=32720, dn_offset=0, scale=1e-4):
    """hrefs: dict red,nir,swir16,scl -> url. dn_offset: subtract (e.g. 1000 for PC baseline>=04.00).
    Returns dict with clear fraction, mean NDVI/NDMI over clear pixels, timings."""
    t0 = time.time()
    b = utm_bounds(bbox_ll, epsg)
    with rasterio.Env(**GDAL_ENV):
        red = read_window(hrefs["red"], b).astype("float32")
        shape = red.shape
        nir = read_window(hrefs["nir"], b, out_shape=shape).astype("float32")
        swir = read_window(hrefs["swir16"], b, out_shape=shape, resampling=Resampling.bilinear).astype("float32")
        scl = read_window(hrefs["scl"], b, out_shape=shape)
    valid_data = (red > 0) & (nir > 0)
    clear = np.isin(scl, SCL_CLEAR) & valid_data
    n_data = int(valid_data.sum())
    out = {"pixels": int(red.size), "data_px": n_data,
           "clear_frac": round(float(clear.sum()) / max(n_data, 1), 3),
           "scl_counts": {int(k): int(v) for k, v in zip(*np.unique(scl, return_counts=True))},
           "raw_red_median": float(np.median(red[valid_data])) if n_data else None,
           "raw_nir_median": float(np.median(nir[valid_data])) if n_data else None}
    r = (red - dn_offset) * scale
    n = (nir - dn_offset) * scale
    s = (swir - dn_offset) * scale
    with np.errstate(divide="ignore", invalid="ignore"):
        ndvi = (n - r) / (n + r)
        ndmi = (n - s) / (n + s)
    if clear.sum() > 0:
        out["ndvi_mean"] = round(float(np.nanmean(ndvi[clear])), 4)
        out["ndmi_mean"] = round(float(np.nanmean(ndmi[clear])), 4)
        out["ndvi_p10_p90"] = [round(float(x), 3) for x in np.nanpercentile(ndvi[clear], [10, 90])]
    out["runtime_s"] = round(time.time() - t0, 2)
    return out
