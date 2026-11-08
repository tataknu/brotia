"""IMERG V07 Late (ClimateSERV datatype 226) daily 2000-06..latest for one farm, 10-year chunks -> CSV. No key."""
import sys, csv, json, time, requests
from probe_climateserv_multi import BASE, box
lon, lat, name = float(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
rows = []
for b, e in [("06/01/2000", "12/31/2009"), ("01/01/2010", "12/31/2019"), ("01/01/2020", "11/06/2026")]:
    t0 = time.time()
    p = {"datatype": 226, "begintime": b, "endtime": e, "intervaltype": 0, "operationtype": 5, "geometry": json.dumps(box(lon, lat, 0.05)), "isZip_CurrentDataType": "false"}
    job = requests.get(f"{BASE}/submitDataRequest/", params=p, timeout=60).json()[0]
    while True:
        pv = requests.get(f"{BASE}/getDataRequestProgress/", params={"id": job}, timeout=30).json(); pv = float(pv[0] if isinstance(pv, list) else pv)
        if pv >= 100 or pv < 0: break
        time.sleep(2)
    data = requests.get(f"{BASE}/getDataFromRequest/", params={"id": job}, timeout=120).json().get("data", [])
    for x in data:
        m, d, y = x["date"].split("/"); rows.append((f"{y}-{m}-{d}", round(float(x["value"]["avg"]), 3)))
    print(b, e, len(data), f"{time.time()-t0:.1f}s", flush=True)
rows.sort()
with open(f"sample_imergL_cs_{name}.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["date", "precip_mm"]); w.writerows(rows)
print("rows", len(rows), rows[0], rows[-1])
