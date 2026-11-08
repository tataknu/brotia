"""Pull full CHIRPS daily history (1981..latest) for one farm from ClimateSERV in 10-year chunks -> CSV."""
import sys, csv, json
from probe_climateserv_multi import BASE, box
import requests, time
lon, lat, name = float(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
chunks = [("01/01/1981","12/31/1990"),("01/01/1991","12/31/2000"),("01/01/2001","12/31/2010"),("01/01/2011","12/31/2020"),("01/01/2021","09/30/2026")]
rows = []
for b, e in chunks:
    t0 = time.time()
    p = {"datatype": 0, "begintime": b, "endtime": e, "intervaltype": 0, "operationtype": 5,
         "geometry": json.dumps(box(lon, lat)), "isZip_CurrentDataType": "false"}
    job = requests.get(f"{BASE}/submitDataRequest/", params=p, timeout=60).json()[0]
    while True:
        pv = requests.get(f"{BASE}/getDataRequestProgress/", params={"id": job}, timeout=30).json()
        pv = float(pv[0] if isinstance(pv, list) else pv)
        if pv >= 100 or pv < 0: break
        time.sleep(2)
    data = requests.get(f"{BASE}/getDataFromRequest/", params={"id": job}, timeout=120).json().get("data", [])
    for x in data:
        m, d, y = x["date"].split("/"); rows.append((f"{y}-{m}-{d}", round(float(x["value"]["avg"]), 3)))
    print(b, e, len(data), f"{time.time()-t0:.1f}s", flush=True)
rows.sort()
with open(f"sample_chirps_cs_{name}.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["date", "precip_mm"]); w.writerows(rows)
print("rows", len(rows), rows[0], rows[-1])
