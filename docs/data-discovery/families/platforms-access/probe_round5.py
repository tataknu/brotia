"""Round-5: PC Data API SCL class histogram (cloud screening) + boolean-masked NDVI, plus GES DISC OPeNDAP metadata."""
import json, time, requests
from pathlib import Path
LON, LAT = -62.52, -16.86
PCD = "https://planetarycomputer.microsoft.com/api/data/v1"
OUT = Path(__file__).with_name("probe_results_round5.json"); res = {}
poly = {"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[LON-0.005,LAT-0.005],[LON+0.005,LAT-0.005],[LON+0.005,LAT+0.005],[LON-0.005,LAT+0.005],[LON-0.005,LAT-0.005]]]}}
EXPR = "((B08-1000)-(B04-1000))/((B08-1000)+(B04-1000))*((SCL==4)|(SCL==5))"
for item in ["S2C_MSIL2A_20261102T141711_R010_T20KNG_20261102T174009", "S2B_MSIL2A_20261028T141709_R010_T20KNG_20261028T211119"]:
    t0 = time.time()
    r = requests.post(f"{PCD}/item/statistics", params={"collection":"sentinel-2-l2a","item":item,"assets":"SCL","categorical":"true"}, json=poly, timeout=120)
    s = r.json()["properties"]["statistics"]; k = list(s)[0]; h = s[k]["histogram"]
    scl = {"status": r.status_code, "latency_s": round(time.time()-t0, 2), "classes": dict(zip([str(int(c)) for c in h[1]], h[0]))}
    t0 = time.time()
    r2 = requests.post(f"{PCD}/item/statistics", params={"collection":"sentinel-2-l2a","item":item,"expression":EXPR,"asset_as_band":"true"}, json=poly, timeout=120)
    s2 = r2.json()["properties"]["statistics"]; k2 = list(s2)[0]
    res[item] = {"scl_categorical": scl, "masked_multiply_ndvi": {"status": r2.status_code, "latency_s": round(time.time()-t0, 2), "mean": round(s2[k2]["mean"], 4), "count": s2[k2]["count"]}}
    print(item, json.dumps(res[item]))
r = requests.get("https://gpm1.gesdisc.eosdis.nasa.gov/opendap/GPM_L3/GPM_3IMERGDL.07/2026/11/3B-DAY-L.MS.MRG.3IMERG.20261105-S000000-E235959.V07C.nc4.dmr.xml", timeout=60, allow_redirects=False)
res["gesdisc_opendap_dmr"] = {"status": r.status_code, "bytes": len(r.content)}; print(res["gesdisc_opendap_dmr"])
OUT.write_text(json.dumps(res, indent=1))
