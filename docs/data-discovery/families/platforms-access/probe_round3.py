"""Round-3: PC Data API polygon NDVI stats (offset-corrected), S2 offset metadata, ClimateSERV CHIRPS job."""
import json, time, requests
from pathlib import Path
LON, LAT = -62.52, -16.86
OUT = Path(__file__).with_name("probe_results_round3.json")
res = {}
def t(key, fn):
    t0 = time.time()
    try: out = fn()
    except Exception as e: out = {"error": repr(e)[:300]}
    out["latency_s"] = round(time.time()-t0, 2); res[key] = out; print(key, json.dumps(out)[:900])
PCD = "https://planetarycomputer.microsoft.com/api/data/v1"
ITEM = "S2C_MSIL2A_20261102T141711_R010_T20KNG_20261102T174009"
poly = {"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[LON-0.005,LAT-0.005],[LON+0.005,LAT-0.005],[LON+0.005,LAT+0.005],[LON-0.005,LAT+0.005],[LON-0.005,LAT-0.005]]]}}
def stats(expr):
    r = requests.post(f"{PCD}/item/statistics", params={"collection":"sentinel-2-l2a","item":ITEM,"expression":expr,"asset_as_band":"true"}, json=poly, timeout=120)
    try:
        s = r.json()["properties"]["statistics"]; k = list(s)[0]
        return {"status": r.status_code, "mean": round(s[k]["mean"],4), "std": round(s[k]["std"],4), "count": s[k]["count"], "valid_percent": s[k].get("valid_percent")}
    except Exception: return {"status": r.status_code, "body": r.text[:300]}
t("pc_stats_ndvi_raw", lambda: stats("(B08-B04)/(B08+B04)"))
t("pc_stats_ndvi_offset_corrected", lambda: stats("((B08-1000)-(B04-1000))/((B08-1000)+(B04-1000))"))
t("pc_stats_ndmi_offset_corrected", lambda: stats("((B08-1000)-(B11-1000))/((B08-1000)+(B11-1000))"))
def s2meta():
    it = requests.get(f"https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a/items/{ITEM}", timeout=60).json()
    p = it["properties"]
    return {"s2:processing_baseline": p.get("s2:processing_baseline"), "boa_add_offset_in_props": {k:v for k,v in p.items() if "offset" in k.lower()},
            "B04_raster_bands": it["assets"]["B04"].get("raster:bands")}
t("pc_s2_offset_meta", s2meta)
def esmeta():
    it = requests.get("https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a/items/S2C_T20KNG_20261102T142455_L2A", timeout=60).json()
    return {"B04_raster_bands": it["assets"]["red"].get("raster:bands"), "baseline": it["properties"].get("s2:processing_baseline")}
t("es_c1_offset_meta", esmeta)

# ClimateSERV: CHIRPS (datatype 0) daily average over small polygon around farm
CS = "https://climateserv.servirglobal.net/api"
geom = json.dumps({"type":"Polygon","coordinates":poly["geometry"]["coordinates"]})
def climateserv():
    r = requests.get(f"{CS}/submitDataRequest/", params={"datatype":0,"begintime":"10/01/2026","endtime":"11/06/2026","intervaltype":0,"operationtype":5,"geometry":geom,"isZip_CurrentDataType":"false"}, timeout=60)
    jid = r.json()[0] if r.headers.get("content-type","").startswith("application/json") else r.text.strip('[]"\n ')
    prog = None
    for _ in range(30):
        p = requests.get(f"{CS}/getDataRequestProgress/", params={"id":jid}, timeout=60).text
        prog = p
        if "100" in p: break
        time.sleep(3)
    d = requests.get(f"{CS}/getDataFromRequest/", params={"id":jid}, timeout=60).json()
    rows = d.get("data", [])
    return {"submit_status": r.status_code, "job": str(jid)[:40], "progress": prog[:20], "n": len(rows), "first": rows[:1], "last": rows[-2:]}
t("climateserv_chirps_job", climateserv)
OUT.write_text(json.dumps(res, indent=1))
