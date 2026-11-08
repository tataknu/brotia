"""Which Open-Meteo archive models carry soil moisture, their grids and latest dates; consistency era5_land vs best_match."""
import time, requests
LAT, LON = -16.86, -62.52
U="https://archive-api.open-meteo.com/v1/archive"
for m in ["era5_land","era5","era5_seamless","ecmwf_ifs","best_match"]:
    t=time.time()
    r=requests.get(U, params=dict(latitude=LAT, longitude=LON, start_date="2026-10-20", end_date="2026-11-06", models=m,
                                  daily="soil_moisture_0_to_100cm_mean,soil_moisture_0_to_7cm_mean"), timeout=60)
    j=r.json()
    if r.ok:
        d=j["daily"]; v=[(a,b) for a,b in zip(d["time"], d["soil_moisture_0_to_100cm_mean"]) if b is not None]
        print(f"{m:14s} HTTP {r.status_code} {time.time()-t:.2f}s grid=({j['latitude']:.3f},{j['longitude']:.3f}) last={v[-1] if v else None} n={len(v)}")
    else: print(m, r.status_code, j)
    time.sleep(2)
# consistency over a past season: era5_land vs best_match for 2025-09..2025-12
out={}
for m in ["era5_land","best_match"]:
    r=requests.get(U, params=dict(latitude=LAT, longitude=LON, start_date="2025-09-01", end_date="2025-12-31", models=m,
                                  daily="soil_moisture_0_to_100cm_mean"), timeout=60)
    out[m]=r.json()["daily"]["soil_moisture_0_to_100cm_mean"]; time.sleep(2)
import statistics as st
diff=[a-b for a,b in zip(out["era5_land"],out["best_match"]) if a is not None and b is not None]
print("era5_land - best_match 0-100cm, Sep-Dec 2025: mean diff=%.3f  sd=%.3f  n=%d"%(st.mean(diff), st.pstdev(diff), len(diff)))
