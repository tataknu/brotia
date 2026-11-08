"""Round-4: openEO S2 collection presence, PC SCL-masked stats, ES old-collection start, Open-Meteo bucket object sizes, OPeNDAP auth."""
import json, time, re, requests
from pathlib import Path
LON, LAT = -62.52, -16.86
BBOX = [LON-0.01, LAT-0.01, LON+0.01, LAT+0.01]
OUT = Path(__file__).with_name("probe_results_round4.json"); res = {}
def t(key, fn):
    t0 = time.time()
    try: out = fn()
    except Exception as e: out = {"error": repr(e)[:300]}
    out["latency_s"] = round(time.time()-t0, 2); res[key] = out; print(key, json.dumps(out)[:800])
def oe():
    c = requests.get("https://openeo.dataspace.copernicus.eu/openeo/1.2/collections", timeout=60).json()["collections"]
    ids = [x["id"] for x in c]
    return {"SENTINEL2_L2A": "SENTINEL2_L2A" in ids, "matches": [i for i in ids if re.search("SENTINEL2|ERA5|AGERA|MODIS|LANDSAT|SMAP|GLOBAL_LAND|CGLS|NDVI|WORLDCEREAL", i)][:40]}
t("openeo_collections_s2", oe)
PCD = "https://planetarycomputer.microsoft.com/api/data/v1"
ITEM = "S2C_MSIL2A_20261102T141711_R010_T20KNG_20261102T174009"
poly = {"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[LON-0.005,LAT-0.005],[LON+0.005,LAT-0.005],[LON+0.005,LAT+0.005],[LON-0.005,LAT+0.005],[LON-0.005,LAT-0.005]]]}}
def masked():
    expr = "where((SCL==4)|(SCL==5),((B08-1000)-(B04-1000))/((B08-1000)+(B04-1000)),-9999)"
    r = requests.post(f"{PCD}/item/statistics", params={"collection":"sentinel-2-l2a","item":ITEM,"expression":expr,"asset_as_band":"true","nodata":-9999}, json=poly, timeout=120)
    try:
        s = r.json()["properties"]["statistics"]; k = list(s)[0]
        return {"status": r.status_code, "mean": round(s[k]["mean"],4), "count": s[k]["count"], "valid_percent": s[k].get("valid_percent")}
    except Exception: return {"status": r.status_code, "body": r.text[:300]}
t("pc_stats_ndvi_scl_masked", masked)
# cloudy item 2026-10-28 (100% cloud) to see mask effect
def masked_cloudy():
    expr = "where((SCL==4)|(SCL==5),((B08-1000)-(B04-1000))/((B08-1000)+(B04-1000)),-9999)"
    r = requests.post(f"{PCD}/item/statistics", params={"collection":"sentinel-2-l2a","item":"S2B_MSIL2A_20261028T141709_R010_T20KNG_20261028T211119","expression":expr,"asset_as_band":"true","nodata":-9999}, json=poly, timeout=120)
    try:
        s = r.json()["properties"]["statistics"]; k = list(s)[0]
        return {"status": r.status_code, "mean": s[k]["mean"], "count": s[k]["count"], "valid_percent": s[k].get("valid_percent")}
    except Exception: return {"status": r.status_code, "body": r.text[:300]}
t("pc_stats_ndvi_scl_masked_cloudy", masked_cloudy)
def es_old_start():
    b = requests.post("https://earth-search.aws.element84.com/v1/search", json={"collections":["sentinel-2-l2a"],"bbox":BBOX,"limit":1,"sortby":[{"field":"properties.datetime","direction":"asc"}]}, timeout=60).json()
    return {"dt": [x["properties"]["datetime"] for x in b["features"]]}
t("es_s2_l2a_old_earliest", es_old_start)
def om_bucket():
    out = {}
    for pre in ["data/copernicus_era5/precipitation/", "data/copernicus_era5_land/temperature_2m/"]:
        x = requests.get("https://openmeteo.s3.amazonaws.com/", params={"list-type":"2","prefix":pre,"max-keys":"400"}, timeout=60).text
        keys = re.findall(r"<Key>([^<]*)</Key>", x); sizes = [int(s) for s in re.findall(r"<Size>(\d+)</Size>", x)]
        out[pre] = {"n_listed": len(keys), "first_keys": keys[:3], "last_keys": keys[-3:], "median_MB": round(sorted(sizes)[len(sizes)//2]/1e6,1) if sizes else None, "max_MB": round(max(sizes)/1e6,1) if sizes else None, "truncated": "<IsTruncated>true" in x}
    return out
t("openmeteo_bucket_sizes", om_bucket)
def opendap():
    r = requests.head("https://gpm1.gesdisc.eosdis.nasa.gov/opendap/GPM_L3/GPM_3IMERGDL.07/2026/11/3B-DAY-L.MS.MRG.3IMERG.20261105-S000000-E235959.V07C.nc4.dap.nc4", timeout=60, allow_redirects=False)
    return {"status": r.status_code, "location": r.headers.get("Location","")[:120]}
t("gesdisc_opendap_imerg_head", opendap)
def registry():
    r = requests.get("https://raw.githubusercontent.com/awslabs/open-data-registry/main/datasets/open-meteo.yaml", timeout=30)
    if r.status_code != 200:
        r = requests.get("https://registry.opendata.aws/open-meteo/", timeout=30)
    txt = r.text
    m = re.search(r"License:?\s*(.{0,200})", txt, re.I)
    return {"status": r.status_code, "url": r.url, "license_excerpt": m.group(1)[:200] if m else txt[:200]}
t("aws_registry_openmeteo", registry)
OUT.write_text(json.dumps(res, indent=1))
