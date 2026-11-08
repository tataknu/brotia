"""Round-2 keyless probes: Earth Search search, PC Data API server-side NDVI, Open-Meteo gap, IRI, ORNL."""
import json, time, requests
from pathlib import Path
LON, LAT = -62.52, -16.86
BBOX = [LON-0.01, LAT-0.01, LON+0.01, LAT+0.01]
OUT = Path(__file__).with_name("probe_results_round2.json")
res = {}
def t(key, fn):
    t0 = time.time()
    try:
        out = fn()
    except Exception as e:
        out = {"error": repr(e)[:300]}
    out["latency_s"] = round(time.time()-t0, 2)
    res[key] = out; print(key, json.dumps(out)[:900])

ES = "https://earth-search.aws.element84.com/v1"
def es(coll):
    r = requests.post(ES+"/search", json={"collections":[coll],"bbox":BBOX,"datetime":"2026-09-01T00:00:00Z/2026-11-07T23:59:59Z","limit":3,
        "sortby":[{"field":"properties.datetime","direction":"desc"}]}, timeout=60)
    b = r.json()
    if r.status_code != 200: return {"status": r.status_code, "body": str(b)[:300]}
    f = b["features"]
    return {"status": r.status_code, "ids":[x["id"] for x in f], "dt":[x["properties"]["datetime"] for x in f],
            "red_href": f[0]["assets"].get("red",{}).get("href") if f else None}
t("es_s2_c1_latest", lambda: es("sentinel-2-c1-l2a"))
t("es_s2_l2a_latest", lambda: es("sentinel-2-l2a"))
t("es_s2_c1_earliest", lambda: (lambda b: {"dt":[x["properties"]["datetime"] for x in b["features"]]})(requests.post(ES+"/search", json={"collections":["sentinel-2-c1-l2a"],"bbox":BBOX,"limit":1,"sortby":[{"field":"properties.datetime","direction":"asc"}]}, timeout=60).json()))

# PC Data API: server-side point value + polygon statistics for NDVI expression on latest clear-ish S2 item
PCD = "https://planetarycomputer.microsoft.com/api/data/v1"
ITEM = "S2C_MSIL2A_20261102T141711_R010_T20KNG_20261102T174009"
def pc_point():
    r = requests.get(f"{PCD}/item/point/{LON},{LAT}", params={"collection":"sentinel-2-l2a","item":ITEM,"assets":["B04","B08","SCL"]}, timeout=60)
    return {"status": r.status_code, "body": r.text[:400]}
t("pc_data_point_s2", pc_point)
poly = {"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[LON-0.005,LAT-0.005],[LON+0.005,LAT-0.005],[LON+0.005,LAT+0.005],[LON-0.005,LAT+0.005],[LON-0.005,LAT-0.005]]]}}
def pc_stats():
    r = requests.post(f"{PCD}/item/statistics", params={"collection":"sentinel-2-l2a","item":ITEM,"expression":"(B08_b1-B04_b1)/(B08_b1+B04_b1)","asset_as_band":"true"}, json=poly, timeout=90)
    try:
        b = r.json(); s = b["properties"]["statistics"]; k = list(s)[0]
        return {"status": r.status_code, "band": k, "mean": s[k]["mean"], "count": s[k]["count"], "min": s[k]["min"], "max": s[k]["max"]}
    except Exception:
        return {"status": r.status_code, "body": r.text[:400]}
t("pc_data_stats_s2_ndvi", pc_stats)
def pc_modis_point():
    r = requests.get(f"{PCD}/item/point/{LON},{LAT}", params={"collection":"modis-13Q1-061","item":"MOD13Q1.A2026273.h12v10.061.2026289235043","assets":["250m_16_days_NDVI"]}, timeout=60)
    return {"status": r.status_code, "body": r.text[:300]}
t("pc_data_point_modis", pc_modis_point)

# Open-Meteo: archive best_match latest, historical-forecast API, forecast past_days=92
def om(url, **p):
    r = requests.get(url, params={"latitude":LAT,"longitude":LON,"daily":"precipitation_sum,et0_fao_evapotranspiration","timezone":"America/La_Paz",**p}, timeout=60)
    b = r.json(); d = b["daily"]
    nn = [x for x,v in zip(d["time"], d["precipitation_sum"]) if v is not None]
    return {"status": r.status_code, "first": d["time"][0], "last_nonnull": nn[-1] if nn else None, "n": len(d["time"])}
t("om_archive_bestmatch", lambda: om("https://archive-api.open-meteo.com/v1/archive", start_date="2026-10-20", end_date="2026-11-07"))
t("om_historical_forecast", lambda: om("https://historical-forecast-api.open-meteo.com/v1/forecast", start_date="2026-10-20", end_date="2026-11-07"))
t("om_forecast_past92", lambda: om("https://api.open-meteo.com/v1/forecast", past_days=92, forecast_days=1))

# IRI DL: confirm login wall
def iri():
    r = requests.get("https://iridl.ldeo.columbia.edu/SOURCES/.UCSB/.CHIRPS/.v2p0/", timeout=30, allow_redirects=True)
    return {"status": r.status_code, "final_url": r.url, "login_wall": "sign" in r.text.lower() and "in" in r.text.lower()}
t("iri_dl_login", iri)

# ORNL MODIS subset, single composite, longer timeout
def ornl():
    r = requests.get("https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset", params={"latitude":LAT,"longitude":LON,"band":"250m_16_days_NDVI","startDate":"A2026273","endDate":"A2026289","kmAboveBelow":0,"kmLeftRight":0}, headers={"Accept":"application/json"}, timeout=180)
    b = r.json(); s = b.get("subset", [])
    return {"status": r.status_code, "rows": [(x["calendar_date"], x["data"]) for x in s]}
t("ornl_modis_subset_retry", ornl)
OUT.write_text(json.dumps(res, indent=1))
