"""Probe 4: Planetary Computer data API (TiTiler) server-side polygon statistics, no auth.
Masks with SCL inside the expression and applies the baseline>=04.00 DN offset (-1000).
NOTE: passing nodata=-9999 with where(...,-9999) returned HTTP 500; working pattern is
where(clear, index, 0) and masked_mean = sum / n_clear, with n_clear = clear_frac * count of the 10 m expression
(an SCL-only expression is evaluated at 20 m)."""
import requests, time, json
lon, lat, h = -62.52, -16.86, 0.005
geom = {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [[[lon-h, lat-h], [lon+h, lat-h], [lon+h, lat+h], [lon-h, lat+h], [lon-h, lat-h]]]}}
URL = "https://planetarycomputer.microsoft.com/api/data/v1/item/statistics"
CLEAR = "((SCL==4)|(SCL==5)|(SCL==6))"
EXPR = {
    "ndvi": f"where({CLEAR},(B08-B04)/(B08+B04-2000),0)",
    "ndmi": f"where({CLEAR},(B08-B11)/(B08+B11-2000),0)",
    "clear": f"where({CLEAR},1,0)",
}
items = ["S2A_MSIL2A_20261104T142041_R010_T20KNG_20261104T201103", "S2C_MSIL2A_20261102T141711_R010_T20KNG_20261102T174009",
         "S2C_MSIL2A_20261013T141711_R010_T20KNG_20261013T173704"]
out = []
for it in items:
    for name, ex in EXPR.items():
        t = time.time()
        r = requests.post(URL, params={"collection": "sentinel-2-l2a", "item": it, "expression": ex, "asset_as_band": "true",
                                        "max_size": 1024}, json=geom, timeout=60)
        dt_ = round(time.time() - t, 2)
        if r.status_code == 200:
            st = list(r.json()["properties"]["statistics"].values())[0]
            row = {"item": it[:24], "var": name, "status": 200, "s": dt_, "mean": round(st["mean"], 4), "sum": st["sum"], "count": st["count"]}
        else:
            row = {"item": it[:24], "var": name, "status": r.status_code, "s": dt_, "err": r.text[:200]}
        out.append(row); print(json.dumps(row))
# masked means
for it in items:
    rs = {r["var"]: r for r in out if r["item"] == it[:24] and r["status"] == 200}
    if len(rs) == 3:
        n_clear = rs["clear"]["mean"] * rs["ndvi"]["count"]  # SCL-only expr is evaluated on the 20 m grid; scale fraction to the 10 m count
        print(it[:24], "clear_frac", round(rs["clear"]["mean"], 3),
              "masked NDVI", round(rs["ndvi"]["sum"] / max(n_clear, 1), 4), "masked NDMI", round(rs["ndmi"]["sum"] / max(n_clear, 1), 4))
json.dump(out, open("out_pc_data_api.json", "w"), indent=1)
