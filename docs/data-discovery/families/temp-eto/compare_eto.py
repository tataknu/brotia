"""Compare daily ETo for one farm (Estancia Los Tajibos -16.86,-62.52):
  A) Open-Meteo et0_fao_evapotranspiration (ERA5 via archive, hourly FAO-56 summed)
  B) our own daily FAO-56 PM from NASA POWER inputs (own implementation)
  C) refet.Daily (ASCE std short crop == FAO-56 grass) on POWER inputs (library cross-check)
  D) our FAO-56 on Open-Meteo daily inputs (checks their implementation vs daily-step)
Periods: Oct 2026 (the asked month) and calendar 2023 (drought year, more stats)."""
import requests, numpy as np, pandas as pd, math
LAT, LON = -16.86, -62.52

def fao56_daily(tmax, tmin, rs, u2, ea, pres_kpa, doy, lat_deg, elev_m):
    """FAO-56 eq. 6 daily grass reference ET (mm/day). rs MJ/m2/d, u2 m/s at 2 m, ea kPa."""
    tmean=(tmax+tmin)/2
    es=(0.6108*np.exp(17.27*tmax/(tmax+237.3))+0.6108*np.exp(17.27*tmin/(tmin+237.3)))/2
    delta=4098*(0.6108*np.exp(17.27*tmean/(tmean+237.3)))/(tmean+237.3)**2
    gamma=0.000665*pres_kpa
    phi=math.radians(lat_deg); dr=1+0.033*np.cos(2*np.pi*doy/365); dec=0.409*np.sin(2*np.pi*doy/365-1.39)
    ws=np.arccos(-np.tan(phi)*np.tan(dec))
    ra=24*60/np.pi*0.0820*dr*(ws*np.sin(phi)*np.sin(dec)+np.cos(phi)*np.cos(dec)*np.sin(ws))
    rso=(0.75+2e-5*elev_m)*ra
    rns=0.77*rs
    sb=4.903e-9
    rnl=sb*(((tmax+273.16)**4+(tmin+273.16)**4)/2)*(0.34-0.14*np.sqrt(ea))*(1.35*np.clip(rs/rso,0.25,1.0)-0.35)
    rn=rns-rnl
    return (0.408*delta*rn+gamma*900/(tmean+273)*u2*(es-ea))/(delta+gamma*(1+0.34*u2))

def ea_from_td(td): return 0.6108*np.exp(17.27*td/(td+237.3))

def power(start,end):
    r=requests.get("https://power.larc.nasa.gov/api/temporal/daily/point",params=dict(
        parameters="T2M_MAX,T2M_MIN,T2MDEW,RH2M,WS2M,ALLSKY_SFC_SW_DWN,PS",community="AG",longitude=LON,latitude=LAT,start=start,end=end,format="JSON"),timeout=120)
    j=r.json(); df=pd.DataFrame(j["properties"]["parameter"]).replace(-999.0,np.nan)
    df.index=pd.to_datetime(df.index,format="%Y%m%d"); elev=j["geometry"]["coordinates"][2]
    return df, elev

def om(start,end,model):
    import time
    for _k in range(4):
      r=requests.get("https://archive-api.open-meteo.com/v1/archive",params=dict(latitude=LAT,longitude=LON,start_date=start,end_date=end,
        daily="temperature_2m_max,temperature_2m_min,dew_point_2m_mean,wind_speed_10m_mean,shortwave_radiation_sum,surface_pressure_mean,et0_fao_evapotranspiration",
          wind_speed_unit="ms",models=model,timezone="America/La_Paz"),timeout=120)
      if r.status_code==200: break
      time.sleep(65)
    j=r.json()
    if "daily" not in j: raise SystemExit(f"open-meteo error {r.status_code} {j}")
    df=pd.DataFrame(j["daily"]); df.index=pd.to_datetime(df.pop("time")); return df, j["elevation"]

import refet
rows=[]
for label,(s,e) in {"2026-10":("2026-10-01","2026-10-31"),"2023":("2023-01-01","2023-12-31")}.items():
    p,pel=power(s.replace("-",""),e.replace("-",""))
    o,oel=om(s,e,"era5_seamless")
    doy=p.index.day_of_year.values
    B=fao56_daily(p.T2M_MAX,p.T2M_MIN,p.ALLSKY_SFC_SW_DWN,p.WS2M,ea_from_td(p.T2MDEW),p.PS,doy,LAT,pel)
    C=refet.Daily(tmin=p.T2M_MIN.values,tmax=p.T2M_MAX.values,ea=ea_from_td(p.T2MDEW).values,rs=p.ALLSKY_SFC_SW_DWN.values,
        uz=p.WS2M.values,zw=2,elev=pel,lat=LAT,doy=doy,method="asce",input_units={"lat":"deg"}).eto()
    u2=o.wind_speed_10m_mean*4.87/np.log(67.8*10-5.42)
    D=fao56_daily(o.temperature_2m_max,o.temperature_2m_min,o.shortwave_radiation_sum,u2,ea_from_td(o.dew_point_2m_mean),o.surface_pressure_mean/10,o.index.day_of_year.values,LAT,oel)
    df=pd.DataFrame({"A_openmeteo_era5":o.et0_fao_evapotranspiration,"B_ours_power":B,"C_refet_power":C,"D_ours_om_inputs":D,
        "power_tmax":p.T2M_MAX,"om_tmax":o.temperature_2m_max,"power_tmin":p.T2M_MIN,"om_tmin":o.temperature_2m_min,
        "power_rs":p.ALLSKY_SFC_SW_DWN,"om_rs":o.shortwave_radiation_sum,"power_u2":p.WS2M,"om_u2":u2,"power_td":p.T2MDEW,"om_td":o.dew_point_2m_mean}).round(2)
    if label=="2026-10": df.to_csv("sample_eto_compare_tajibos_2026-10.csv")
    v=df.dropna()
    def stats(a,b):
        d=v[a]-v[b]; return dict(n=len(v),mean_a=round(v[a].mean(),2),mean_b=round(v[b].mean(),2),bias=round(d.mean(),2),mae=round(d.abs().mean(),2),r=round(v[a].corr(v[b]),3))
    print(f"\n=== {label} ===")
    for a,b in [("A_openmeteo_era5","B_ours_power"),("B_ours_power","C_refet_power"),("A_openmeteo_era5","D_ours_om_inputs"),("power_tmax","om_tmax"),("power_tmin","om_tmin"),("power_rs","om_rs"),("power_u2","om_u2"),("power_td","om_td")]:
        print(f"{a:18s} vs {b:18s}",stats(a,b))
    print("monthly sums mm:",v[["A_openmeteo_era5","B_ours_power","C_refet_power","D_ours_om_inputs"]].resample("MS").sum().round(0).to_string() if label=="2023" else v[["A_openmeteo_era5","B_ours_power","C_refet_power","D_ours_om_inputs"]].sum().round(1).to_dict())
