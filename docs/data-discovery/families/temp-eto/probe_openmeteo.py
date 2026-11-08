"""Probe Open-Meteo archive (ERA5 / ERA5-Land) + forecast(past_days) for Tmax/Tmin/ET0 at a sample farm."""
import time, json, requests
LAT, LON = -16.86, -62.52  # Estancia Los Tajibos
def get(url, params):
    t=time.time(); r=requests.get(url, params=params, timeout=60); dt=time.time()-t
    return r, dt
daily="temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration,precipitation_sum,shortwave_radiation_sum"
out={}
for model in ["best_match","era5","era5_land","era5_seamless"]:
    r,dt=get("https://archive-api.open-meteo.com/v1/archive",dict(latitude=LAT,longitude=LON,start_date="2026-10-01",end_date="2026-11-06",daily=daily,models=model,timezone="America/La_Paz"))
    j=r.json()
    d=j.get("daily",{})
    times=d.get("time",[])
    # latest non-null
    last=None
    for i in range(len(times)-1,-1,-1):
        if d["temperature_2m_max"][i] is not None: last=(times[i],d["temperature_2m_max"][i],d["temperature_2m_min"][i],d["et0_fao_evapotranspiration"][i]);break
    out[model]=dict(status=r.status_code,latency_s=round(dt,2),grid=(j.get("latitude"),j.get("longitude"),j.get("elevation")),latest_nonnull=last,err=j.get("reason"))
    print(model,out[model])
# history start
r,dt=get("https://archive-api.open-meteo.com/v1/archive",dict(latitude=LAT,longitude=LON,start_date="1950-01-01",end_date="1950-01-03",daily=daily,models="era5_land",timezone="America/La_Paz"))
print("era5_land 1950:",r.status_code,round(dt,2),json.dumps(r.json())[:400])
r,dt=get("https://archive-api.open-meteo.com/v1/archive",dict(latitude=LAT,longitude=LON,start_date="1940-01-01",end_date="1940-01-03",daily=daily,models="era5",timezone="America/La_Paz"))
print("era5 1940:",r.status_code,round(dt,2),json.dumps(r.json())[:400])
# full 30y pull size/latency
r,dt=get("https://archive-api.open-meteo.com/v1/archive",dict(latitude=LAT,longitude=LON,start_date="1995-01-01",end_date="2026-11-06",daily=daily,models="era5_land",timezone="America/La_Paz"))
print("30y era5_land:",r.status_code,round(dt,2),"bytes",len(r.content), "n days",len(r.json()["daily"]["time"]))
# forecast API past_days -> fills latency gap
r,dt=get("https://api.open-meteo.com/v1/forecast",dict(latitude=LAT,longitude=LON,past_days=10,forecast_days=3,daily="temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration",timezone="America/La_Paz"))
j=r.json();print("forecast past_days:",r.status_code,round(dt,2),list(zip(j["daily"]["time"],j["daily"]["temperature_2m_max"],j["daily"]["temperature_2m_min"],j["daily"]["et0_fao_evapotranspiration"])))
print("headers:",{k:v for k,v in r.headers.items() if k.lower() in("access-control-allow-origin","x-ratelimit-limit")})
