"""Validate gridded Tmax/Tmin against NOAA GSOD Viru Viru (SLVR, 852440) for 2023 and Jan-Aug 2025."""
import requests, pandas as pd, numpy as np, time, io
LAT, LON = -17.645, -63.135
def gsod(y):
    r=requests.get(f"https://www.ncei.noaa.gov/data/global-summary-of-the-day/access/{y}/85244099999.csv",timeout=60)
    g=pd.read_csv(io.StringIO(r.text)); g.index=pd.to_datetime(g.DATE)
    tx=g.MAX.where(g.MAX<9999); tn=g.MIN.where(g.MIN<9999)
    return pd.DataFrame({"st_tmax":(tx-32)*5/9,"st_tmin":(tn-32)*5/9,"st_flag_max":g.MAX_ATTRIBUTES})
def om(model,s,e):
    for k in range(4):
        r=requests.get("https://archive-api.open-meteo.com/v1/archive",params=dict(latitude=LAT,longitude=LON,start_date=s,end_date=e,daily="temperature_2m_max,temperature_2m_min",models=model,timezone="America/La_Paz"),timeout=120)
        if r.status_code==200: break
        print("retry",model,r.status_code,r.text[:100]); time.sleep(65)
    d=pd.DataFrame(r.json()["daily"]); d.index=pd.to_datetime(d.pop("time")); return d.rename(columns={"temperature_2m_max":f"{model}_tmax","temperature_2m_min":f"{model}_tmin"})
def power(s,e):
    r=requests.get("https://power.larc.nasa.gov/api/temporal/daily/point",params=dict(parameters="T2M_MAX,T2M_MIN",community="AG",longitude=LON,latitude=LAT,start=s.replace("-",""),end=e.replace("-",""),format="JSON"),timeout=120)
    d=pd.DataFrame(r.json()["properties"]["parameter"]).replace(-999.0,np.nan); d.index=pd.to_datetime(d.index,format="%Y%m%d")
    return d.rename(columns={"T2M_MAX":"power_tmax","T2M_MIN":"power_tmin"})
for (s,e) in [("2023-01-01","2023-12-31"),("2025-01-01","2025-08-23")]:
    st=pd.concat([gsod(int(s[:4]))])
    parts=[st,power(s,e)]
    for m in ["era5","era5_land","best_match"]:
        parts.append(om(m,s,e)); time.sleep(3)
    df=pd.concat(parts,axis=1).loc[s:e]
    print(f"\n=== SLVR {s}..{e}  station days with tmax: {df.st_tmax.notna().sum()} ===")
    for src in ["power","era5","era5_land","best_match"]:
        for v in ["tmax","tmin"]:
            x=df[[f"st_{v}",f"{src}_{v}"]].dropna(); d=x.iloc[:,1]-x.iloc[:,0]
            print(f"{src:10s} {v}: n={len(x)} bias={d.mean():+.2f} MAE={d.abs().mean():.2f} r={x.corr().iloc[0,1]:.3f}")
    # heat days >=35 count agreement
    for src in ["st","power","era5","era5_land"]:
        print(f"  days tmax>=35 {src}: {(df[f'{src}_tmax']>=35).sum()}   days tmin<=5 {src}: {(df[f'{src}_tmin']<=5).sum()}")
