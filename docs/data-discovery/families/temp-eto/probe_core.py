import requests, time, json
LON, LAT = -62.52, -16.86  # Estancia Los Tajibos
def t(url, params=None, **kw):
    t0=time.time(); r=requests.get(url, params=params, timeout=90, **kw); dt=time.time()-t0
    print(f"{r.status_code} {dt:.2f}s {len(r.content)}B {r.url[:160]}")
    return r
# Open-Meteo archive (ERA5 / ERA5-Land)
r=t("https://archive-api.open-meteo.com/v1/archive", dict(latitude=LAT, longitude=LON, start_date="1991-01-01", end_date="2026-11-06",
    daily="temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration", timezone="America/La_Paz"))
d=r.json()["daily"]; 
import pandas as pd
df=pd.DataFrame(d); df=df.dropna(subset=["et0_fao_evapotranspiration"])
print("OM archive first", df.iloc[0].to_dict()); print("OM archive last", df.iloc[-1].to_dict()); print("rows", len(df))
# ERA5-Land explicitly
r=t("https://archive-api.open-meteo.com/v1/archive", dict(latitude=LAT, longitude=LON, start_date="2026-10-01", end_date="2026-11-06",
    daily="temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration", models="era5_land", timezone="America/La_Paz"))
df2=pd.DataFrame(r.json()["daily"]).dropna(); print("ERA5-Land last", df2.iloc[-1].to_dict() if len(df2) else None)
# NASA POWER daily ag
r=t("https://power.larc.nasa.gov/api/temporal/daily/point", dict(parameters="T2M_MAX,T2M_MIN,ALLSKY_SFC_SW_DWN,RH2M,WS2M,PS,T2MDEW,PRECTOTCORR",
    community="AG", longitude=LON, latitude=LAT, start="20260901", end="20261106", format="JSON"))
p=r.json(); pp=pd.DataFrame(p["properties"]["parameter"]); pp=pp.replace(-999, pd.NA)
print(pp.tail(12)); print("POWER header", p.get("header",{}).get("start"), p.get("header",{}).get("end"))
pp.to_csv("sample_power_daily_tajibos.csv")
