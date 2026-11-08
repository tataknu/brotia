"""Probe ClimateSERV (SERVIR) polygon time-series API. No key needed.

Usage: python probe_climateserv.py <datatype> <MM/DD/YYYY begin> <MM/DD/YYYY end> [lon lat]
Prints job id, progress polling, number of values, first/last values, and season total.
"""
import json, sys, time
import requests

BASE = "https://climateserv.servirglobal.net/api"
dt = int(sys.argv[1]); b = sys.argv[2]; e = sys.argv[3]
lon = float(sys.argv[4]) if len(sys.argv) > 4 else -62.52
lat = float(sys.argv[5]) if len(sys.argv) > 5 else -16.86
d = 0.025  # ~half a CHIRPS pixel each side -> tiny box around the farm
poly = {"type": "Polygon", "coordinates": [[[lon-d, lat-d], [lon+d, lat-d], [lon+d, lat+d], [lon-d, lat+d], [lon-d, lat-d]]]}
params = {"datatype": dt, "begintime": b, "endtime": e, "intervaltype": 0,
          "operationtype": 5, "geometry": json.dumps(poly), "isZip_CurrentDataType": "false"}
t0 = time.time()
r = requests.get(f"{BASE}/submitDataRequest/", params=params, timeout=60)
print("submit", r.status_code, r.text[:200])
job = r.json()[0] if r.text.startswith("[") else r.json()
for _ in range(90):
    p = requests.get(f"{BASE}/getDataRequestProgress/", params={"id": job}, timeout=30).json()
    pv = p[0] if isinstance(p, list) else p
    if float(pv) >= 100 or float(pv) < 0:
        break
    time.sleep(2)
print("progress", pv, f"{time.time()-t0:.1f}s")
out = requests.get(f"{BASE}/getDataFromRequest/", params={"id": job}, timeout=60).json()
data = out.get("data", out) if isinstance(out, dict) else out
vals = [(x["date"], x["value"]) for x in data]
print("n", len(vals), "first", vals[:2], "last", vals[-3:])
nums = []
for _, v in vals:
    v = v.get("avg") if isinstance(v, dict) else v
    if v is not None and float(v) > -9000:
        nums.append(float(v))
print("valid", len(nums), "total_mm", round(sum(nums), 1))
