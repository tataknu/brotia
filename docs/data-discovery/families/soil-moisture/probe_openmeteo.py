"""Probe Open-Meteo soil moisture (ERA5-Land archive + forecast/past_days) for one farm."""
import time, json, requests
LAT, LON = -16.86, -62.52  # Estancia Los Tajibos
vars_ = "soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,soil_moisture_28_to_100cm,soil_moisture_100_to_255cm"
def probe(name, url, params):
    t=time.time(); r=requests.get(url, params=params, timeout=60); dt=time.time()-t
    print(f"== {name}: HTTP {r.status_code} {dt:.2f}s  bytes={len(r.content)}")
    j=r.json()
    if r.status_code!=200: print(j); return j
    print("  lat/lon/elev:", j.get("latitude"), j.get("longitude"), j.get("elevation"), "units:", j.get("hourly_units") or j.get("daily_units"))
    blk=j.get("hourly") or j.get("daily")
    times=blk["time"]; k=[x for x in blk if x!="time"]
    # last non-null
    for key in k:
        vals=blk[key]; idx=[i for i,v in enumerate(vals) if v is not None]
        if idx: print(f"  {key}: first={times[idx[0]]} {vals[idx[0]]}  last_non_null={times[idx[-1]]} {vals[idx[-1]]}  n={len(idx)}/{len(vals)}")
        else: print(f"  {key}: all null")
    return j
# 1. ERA5-Land archive, recent window to find latency
probe("archive ERA5-Land recent", "https://archive-api.open-meteo.com/v1/archive",
      dict(latitude=LAT, longitude=LON, start_date="2026-10-15", end_date="2026-11-06", hourly=vars_, models="era5_land"))
# 2. archive default (best_match / ERA5 + ERA5-Land)
probe("archive best_match recent", "https://archive-api.open-meteo.com/v1/archive",
      dict(latitude=LAT, longitude=LON, start_date="2026-10-15", end_date="2026-11-06", hourly=vars_))
# 3. Daily aggregate support?
probe("archive daily soil (mean)", "https://archive-api.open-meteo.com/v1/archive",
      dict(latitude=LAT, longitude=LON, start_date="2026-10-01", end_date="2026-11-06",
           daily="soil_moisture_0_to_7cm_mean,soil_moisture_7_to_28cm_mean,soil_moisture_28_to_100cm_mean,soil_moisture_0_to_100cm_mean"))
# 4. history start
probe("archive 1950 start", "https://archive-api.open-meteo.com/v1/archive",
      dict(latitude=LAT, longitude=LON, start_date="1950-01-01", end_date="1950-01-02", hourly="soil_moisture_28_to_100cm", models="era5_land"))
# 5. forecast API past_days (IFS/GFS) for near-real-time gap fill
probe("forecast past_days=10", "https://api.open-meteo.com/v1/forecast",
      dict(latitude=LAT, longitude=LON, past_days=10, forecast_days=1, hourly="soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm,soil_moisture_9_to_27cm,soil_moisture_27_to_81cm"))
