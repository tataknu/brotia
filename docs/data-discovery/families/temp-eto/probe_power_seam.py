"""Locate POWER MERRA-2 -> near-real-time (GEOS) seam and its effect on Tmax vs ERA5 (Open-Meteo)."""
import requests,pandas as pd,numpy as np,time
LAT,LON=-16.86,-62.52
r=requests.get("https://power.larc.nasa.gov/api/temporal/daily/point",params=dict(parameters="WS2M,WS10M,T2M_MAX,T2M_MIN,RH2M",community="AG",longitude=LON,latitude=LAT,start="20250101",end="20261106",format="JSON"),timeout=120)
j=r.json(); p=pd.DataFrame(j["properties"]["parameter"]).replace(-999.0,np.nan); p.index=pd.to_datetime(p.index,format="%Y%m%d")
print("header sources:", j.get("header",{}).get("sources"), "| messages:", j.get("messages"))
print(p.loc["2026-09-20":"2026-10-08"].to_string())
for k in range(4):
    o=requests.get("https://archive-api.open-meteo.com/v1/archive",params=dict(latitude=LAT,longitude=LON,start_date="2025-01-01",end_date="2026-10-31",daily="temperature_2m_max,temperature_2m_min",models="era5",timezone="America/La_Paz"),timeout=120)
    if o.status_code==200: break
    time.sleep(65)
o=pd.DataFrame(o.json()["daily"]); o.index=pd.to_datetime(o.pop("time"))
d=pd.DataFrame({"dTmax":p.T2M_MAX-o.temperature_2m_max,"dTmin":p.T2M_MIN-o.temperature_2m_min,"ws2m":p.WS2M}).dropna()
print("monthly POWER-ERA5 bias:"); print(d.resample("MS").mean().round(2).to_string())
