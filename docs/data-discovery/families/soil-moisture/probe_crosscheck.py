"""Cross-check: NASA POWER GWETROOT (MERRA-2) vs ERA5-Land same-window percentiles (Tajibos); second farm (Arrocera Mineros) SoilGrids + Open-Meteo."""
import requests, time, pandas as pd, numpy as np
def win(s): w=s[((s.index.month==10)&(s.index.day>=7))|((s.index.month==11)&(s.index.day<=1))]; return w.groupby(w.index.year).mean()
t=time.time()
r=requests.get("https://power.larc.nasa.gov/api/temporal/daily/point", params=dict(parameters="GWETROOT", community="AG",
    latitude=-16.86, longitude=-62.52, start="19960101", end="20261106", format="JSON"), timeout=120)
print("POWER 30y GWETROOT:", r.status_code, f"{time.time()-t:.1f}s", len(r.content), "bytes")
g=pd.Series(r.json()["properties"]["parameter"]["GWETROOT"]); g.index=pd.DatetimeIndex(pd.to_datetime(g.index).values.astype("datetime64[ns]")); g=g.replace(-999,np.nan).dropna()
era=pd.read_csv("sample_era5land_0_100_tajibos_daily.csv.gz"); era=pd.Series(era["soil_moisture_0_to_100cm_mean"].values, index=pd.DatetimeIndex(pd.to_datetime(era["time"]).values.astype("datetime64[ns]")))
j=pd.concat([g.rename("power"), era.rename("era5l")],axis=1).dropna()
m=j.rolling(30).mean().dropna(); an=m-m.groupby(m.index.day_of_year).transform("mean")
print("POWER vs ERA5-Land daily r=%.3f, 30-day anomaly r=%.3f, last POWER date=%s" % (j.power.corr(j.era5l), an.power.corr(an.era5l), g.index.max().date()))
bp, be = win(g), win(era)
for y in [2023,2024,2025,2026]:
    base=[x for x in bp.index if x not in (y,2026)]
    print(y, "POWER pct=%.0f"%((bp.loc[base]<bp.loc[y]).mean()*100), "ERA5L pct=%.0f"%((be.loc[base]<be.loc[y]).mean()*100))
# second farm
LAT, LON = -17.20, -63.29
props=["clay","sand","soc","wv0033","wv1500"]; depths=["0-5cm","5-15cm","15-30cm","30-60cm","60-100cm"]
time.sleep(13)
t=time.time(); r=requests.get("https://rest.isric.org/soilgrids/v2.0/properties/query", params=[("lon",LON),("lat",LAT)]+[("property",p) for p in props]+[("depth",d) for d in depths]+[("value","mean")], timeout=90)
print("SoilGrids Mineros:", r.status_code, f"{time.time()-t:.1f}s")
if r.ok:
    th={"0-5cm":50,"5-15cm":100,"15-30cm":150,"30-60cm":300,"60-100cm":400}; L={l["name"]:{d["label"]:d["values"]["mean"] for d in l["depths"]} for l in r.json()["properties"]["layers"]}
    taw=sum((L["wv0033"][k]-L["wv1500"][k])/1000*th[k] for k in depths if L["wv0033"][k] is not None)
    print("  clay%:",{k:v/10 for k,v in L["clay"].items()}, " TAW 0-100cm (wv0033-wv1500) = %.0f mm"%taw)
t=time.time(); r=requests.get("https://archive-api.open-meteo.com/v1/archive", params=dict(latitude=LAT, longitude=LON, start_date="2026-10-25", end_date="2026-11-06", models="era5_land", daily="soil_moisture_0_to_100cm_mean"), timeout=60)
jj=r.json(); v=[(a,b) for a,b in zip(jj["daily"]["time"], jj["daily"]["soil_moisture_0_to_100cm_mean"]) if b is not None]
print("Open-Meteo Mineros era5_land:", r.status_code, f"{time.time()-t:.1f}s grid=({jj['latitude']},{jj['longitude']}) last={v[-1]}")
