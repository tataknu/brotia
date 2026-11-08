"""Sentinel-1 STAC probes: Planetary Computer sentinel-1-rtc / sentinel-1-grd and Earth Search sentinel-1-grd,
over farm Colonia Cuatro Canadas Lote 7 (-62.47,-17.3). Prints scene count, latest date, orbit, platform, assets."""
import requests, time, json
PT = {"type": "Point", "coordinates": [-62.47, -17.3]}
out = {}
def search(url, coll, dt, limit=50):
    t = time.time()
    body = {"collections": [coll], "intersects": PT, "datetime": dt, "limit": limit}
    r = requests.post(url, json=body, timeout=60)
    lat = round(time.time() - t, 2)
    if r.status_code != 200:
        return dict(status=r.status_code, latency_s=lat, body=r.text[:300])
    feats = r.json()["features"]
    feats.sort(key=lambda f: f["properties"]["datetime"], reverse=True)
    return dict(status=200, latency_s=lat, n=len(feats),
                scenes=[(f["properties"]["datetime"][:19], f["properties"].get("platform"),
                         f["properties"].get("sat:orbit_state"), f["properties"].get("sat:relative_orbit"),
                         f["properties"].get("sar:polarizations")) for f in feats[:12]],
                assets=sorted(feats[0]["assets"].keys()) if feats else [])
PC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
ES = "https://earth-search.aws.element84.com/v1/search"
out["pc_rtc_recent"] = search(PC, "sentinel-1-rtc", "2026-08-01/2026-11-06")
out["pc_grd_recent"] = search(PC, "sentinel-1-grd", "2026-08-01/2026-11-06")
out["pc_rtc_2024_floodseason"] = search(PC, "sentinel-1-rtc", "2024-01-01/2024-04-30", 100)
out["pc_rtc_earliest"] = search(PC, "sentinel-1-rtc", "2014-01-01/2016-12-31", 100)
out["es_grd_recent"] = search(ES, "sentinel-1-grd", "2026-08-01/2026-11-06")
for k, v in out.items():
    print(k, json.dumps({kk: vv for kk, vv in v.items() if kk != "scenes"}))
    for s in v.get("scenes", [])[:12]: print("   ", s)
json.dump(out, open(__file__.replace(".py", "_result.json"), "w"), indent=1)
