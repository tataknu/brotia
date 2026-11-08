"""ClimateSERV multi-probe: season totals, latest available date, long-history pull. No key.
Datatypes: 0 CHIRPS, 90 CHIRP, 26 IMERG Late 1-day, 91 IMERG Early 1-day, 32 CHIRPS-GEFS precip, 31 CHIRPS-GEFS anom."""
import json, sys, time, requests
BASE = "https://climateserv.servirglobal.net/api"
def box(lon, lat, d=0.025):
    return {"type": "Polygon", "coordinates": [[[lon-d, lat-d], [lon+d, lat-d], [lon+d, lat+d], [lon-d, lat+d], [lon-d, lat-d]]]}
def run(dt, b, e, lon=-62.52, lat=-16.86, op=5):
    t0 = time.time()
    p = {"datatype": dt, "begintime": b, "endtime": e, "intervaltype": 0, "operationtype": op,
         "geometry": json.dumps(box(lon, lat)), "isZip_CurrentDataType": "false"}
    r = requests.get(f"{BASE}/submitDataRequest/", params=p, timeout=60)
    if r.status_code != 200: return {"dt": dt, "status": r.status_code, "err": r.text[:200]}
    job = r.json()[0]
    for _ in range(300):
        pv = requests.get(f"{BASE}/getDataRequestProgress/", params={"id": job}, timeout=30).json()
        pv = float(pv[0] if isinstance(pv, list) else pv)
        if pv >= 100 or pv < 0: break
        time.sleep(2)
    out = requests.get(f"{BASE}/getDataFromRequest/", params={"id": job}, timeout=120).json()
    data = out.get("data", []) if isinstance(out, dict) else out
    vals = []
    for x in data:
        v = x["value"]; v = v.get("avg", v.get("max")) if isinstance(v, dict) else v
        if v is not None and float(v) > -9000: vals.append((x["date"], float(v)))
    return {"dt": dt, "progress": pv, "secs": round(time.time()-t0, 1), "n": len(data), "valid": len(vals),
            "first": vals[:1], "last": vals[-2:], "total_mm": round(sum(v for _, v in vals), 1)}
if __name__ == "__main__":
    dt = int(sys.argv[1]); b, e = sys.argv[2], sys.argv[3]
    lon = float(sys.argv[4]) if len(sys.argv) > 4 else -62.52; lat = float(sys.argv[5]) if len(sys.argv) > 5 else -16.86
    print(json.dumps(run(dt, b, e, lon, lat)))
