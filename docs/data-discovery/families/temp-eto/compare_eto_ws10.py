# NOTE: importing compare_eto re-runs its network probes (Open-Meteo + POWER) on import.
"""2023 rerun: POWER FAO-56 with u2 derived from WS10M (FAO-56 eq.47) instead of WS2M; vs Open-Meteo ERA5 ET0.
Also Hargreaves-Samani (temps only) from ERA5 Tmax/Tmin as last-resort fallback."""
import requests,pandas as pd,numpy as np,time,math,refet
from compare_eto import fao56_daily, ea_from_td, LAT, LON
r=requests.get("https://power.larc.nasa.gov/api/temporal/daily/point",params=dict(parameters="T2M_MAX,T2M_MIN,T2MDEW,WS2M,WS10M,ALLSKY_SFC_SW_DWN,PS",community="AG",longitude=LON,latitude=LAT,start="20230101",end="20231231",format="JSON"),timeout=120)
j=r.json(); p=pd.DataFrame(j["properties"]["parameter"]).replace(-999.0,np.nan); p.index=pd.to_datetime(p.index,format="%Y%m%d"); elev=j["geometry"]["coordinates"][2]
for k in range(4):
    o=requests.get("https://archive-api.open-meteo.com/v1/archive",params=dict(latitude=LAT,longitude=LON,start_date="2023-01-01",end_date="2023-12-31",daily="temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration",models="era5",timezone="America/La_Paz"),timeout=120)
    if o.status_code==200: break
    time.sleep(65)
o=pd.DataFrame(o.json()["daily"]); o.index=pd.to_datetime(o.pop("time"))
doy=p.index.day_of_year.values
u2_eq47=p.WS10M*4.87/np.log(67.8*10-5.42)
B2=fao56_daily(p.T2M_MAX,p.T2M_MIN,p.ALLSKY_SFC_SW_DWN,u2_eq47,ea_from_td(p.T2MDEW),p.PS,doy,LAT,elev)
B1=fao56_daily(p.T2M_MAX,p.T2M_MIN,p.ALLSKY_SFC_SW_DWN,p.WS2M,ea_from_td(p.T2MDEW),p.PS,doy,LAT,elev)
C2=refet.Daily(tmin=p.T2M_MIN.values,tmax=p.T2M_MAX.values,ea=ea_from_td(p.T2MDEW).values,rs=p.ALLSKY_SFC_SW_DWN.values,uz=p.WS10M.values,zw=10,elev=elev,lat=LAT,doy=doy,method="asce",input_units={"lat":"deg"}).eto()
# Hargreaves-Samani on ERA5 temps
phi=math.radians(LAT); dr=1+0.033*np.cos(2*np.pi*doy/365); dec=0.409*np.sin(2*np.pi*doy/365-1.39); ws=np.arccos(-np.tan(phi)*np.tan(dec))
ra=24*60/np.pi*0.0820*dr*(ws*np.sin(phi)*np.sin(dec)+np.cos(phi)*np.cos(dec)*np.sin(ws))
tx,tn=o.temperature_2m_max.values,o.temperature_2m_min.values
HS=0.0023*0.408*ra*((tx+tn)/2+17.8)*np.sqrt(np.clip(tx-tn,0,None))
A=o.et0_fao_evapotranspiration
df=pd.DataFrame({"A_om_era5":A,"B1_power_ws2m":B1,"B2_power_ws10m_eq47":B2,"C2_refet_ws10m":C2,"HS_era5temps":HS},index=p.index)
v=df.dropna()
for c in df.columns[1:]:
    d=v[c]-v.A_om_era5; print(f"{c:22s} vs A: mean={v[c].mean():.2f} A={v.A_om_era5.mean():.2f} bias={d.mean():+.2f} MAE={d.abs().mean():.2f} r={v[c].corr(v.A_om_era5):.3f} annual={v[c].sum():.0f} vs {v.A_om_era5.sum():.0f}")
print("u2_eq47 mean",round(u2_eq47.mean(),2),"WS2M mean",round(p.WS2M.mean(),2))
# anomaly agreement: monthly percent of mean
m=v.resample("MS").sum(); print((m.div(m.mean())*100).round(0).to_string())
