#!/bin/sh
# Probe 3: no-auth access to asset hrefs for each source (HEAD/range GET, first 16 KB only).
p() { echo "== $1"; curl -s -o /dev/null -r 0-16383 -w "status=%{http_code} time=%{time_total}s bytes=%{size_download} final=%{url_effective}\n" -L --max-redirs 3 "$2"; }
# HLS on LP DAAC (Earthdata Cloud, protected bucket)
p "LPDAAC HLSL30 B04 (https, no login)" "https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/HLSL30.020/HLS.L30.T20KNG.2026293T141021.v2.0/HLS.L30.T20KNG.2026293T141021.v2.0.B04.tif"
# HLS on PC: unsigned vs signed
p "PC hls2 B04 unsigned" "https://hls2euwest.blob.core.windows.net/hls2/L30/20/K/NG/2026/10/20/HLS.L30.T20KNG.2026293T141021.v2.0/HLS.L30.T20KNG.2026293T141021.v2.0.B04.tif"
TOK=$(curl -s https://planetarycomputer.microsoft.com/api/sas/v1/token/hls2euwest/hls2 | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
p "PC hls2 B04 signed (anonymous SAS; token not stored)" "https://hls2euwest.blob.core.windows.net/hls2/L30/20/K/NG/2026/10/20/HLS.L30.T20KNG.2026293T141021.v2.0/HLS.L30.T20KNG.2026293T141021.v2.0.B04.tif?$TOK"
# Landsat
p "USGS landsatlook /data SR_B4 (no login)" "https://landsatlook.usgs.gov/data/collection02/level-2/standard/oli-tirs/2026/230/072/LC09_L2SP_230072_20261028_20261031_02_T2/LC09_L2SP_230072_20261028_20261031_02_T2_SR_B4.TIF"
p "AWS usgs-landsat requester-pays (unsigned https)" "https://usgs-landsat.s3.us-west-2.amazonaws.com/collection02/level-2/standard/oli-tirs/2026/230/072/LC09_L2SP_230072_20261028_20261031_02_T2/LC09_L2SP_230072_20261028_20261031_02_T2_SR_B4.TIF"
p "PC landsat-c2 SR_B4 unsigned" "https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/2026/230/072/LC09_L2SP_230072_20261028_20261031_02_T2/LC09_L2SP_230072_20261028_20261031_02_T2_SR_B4.TIF"
# CDSE
p "CDSE odata https asset (no token)" "https://download.dataspace.copernicus.eu/odata/v1/Products(b771437f-f754-47dd-81ff-c7e9e4a14ea7)/\$value"
p "CDSE Sentinel Hub WMS (no instance)" "https://sh.dataspace.copernicus.eu/ogc/wms/"
p "CDSE openEO capabilities" "https://openeo.dataspace.copernicus.eu/openeo/1.2/"
p "CDSE statistical API (no token)" "https://sh.dataspace.copernicus.eu/api/v1/statistics"
# Earth Search
p "ES c1 B04 (public S3 https)" "https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com/sentinel-2-c1-l2a/20/K/NG/2026/11/S2A_T20KNG_20261104T142519_L2A/B04.tif"
# PC data API (titiler) statistics endpoint, no auth
p "PC data API item info" "https://planetarycomputer.microsoft.com/api/data/v1/item/info?collection=sentinel-2-l2a&item=S2A_MSIL2A_20261104T142041_R010_T20KNG_20261104T201103"
