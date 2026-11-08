"""Derived root-zone indicator: FAO-56-style single bucket (rain - Kc*ETo, TAW from SoilGrids) vs ERA5-Land 0-100cm.
Inputs: Open-Meteo archive ERA5 (0.25 deg; era5_land returns null precip/ET0 daily on Open-Meteo) daily precip + ET0 (1996-2026) for Estancia Los Tajibos; TAW=126 mm (SoilGrids wv0033-wv1500 0-100 cm).
Kc fixed at 1.0 (crop-agnostic, 'reference' bucket) to keep it a pure climate indicator. Same-time-of-year percentiles."""
import requests, time, pandas as pd, numpy as np
LAT, LON, TAW = -16.86, -62.52, 126.0
t=time.time()
r=requests.get("https://archive-api.open-meteo.com/v1/archive", params=dict(latitude=LAT, longitude=LON, start_date="1996-01-01",
    end_date="2026-11-06", models="era5", daily="precipitation_sum,et0_fao_evapotranspiration"), timeout=120)
print("Open-Meteo 30y precip+ET0:", r.status_code, f"{time.time()-t:.1f}s", len(r.content), "bytes")
d=pd.DataFrame(r.json()["daily"]); d["time"]=pd.to_datetime(d["time"]); d=d.set_index("time").dropna()
S=TAW*0.5; out=[]
for p,e in zip(d.precipitation_sum, d.et0_fao_evapotranspiration):
    ks=min(1.0, S/(0.5*TAW))          # FAO-56 stress coefficient, p=0.5 (RAW = 50% of TAW)
    S=min(TAW, max(0.0, S + p - ks*1.0*e))
    out.append(S)
d["bucket_frac"]=np.array(out)/TAW
era=pd.read_csv("sample_era5land_0_100_tajibos_daily.csv.gz"); era=pd.Series(era["soil_moisture_0_to_100cm_mean"].values, index=pd.DatetimeIndex(pd.to_datetime(era["time"]).values.astype("datetime64[ns]"))); d.index=pd.DatetimeIndex(d.index.values.astype("datetime64[ns]"))
j=d.join(era.rename("era5l_0_100"), how="inner").dropna()
print("daily Pearson r (bucket vs ERA5-Land 0-100):", round(j.bucket_frac.corr(j.era5l_0_100),3), " Spearman:", round(j.bucket_frac.rank().corr(j.era5l_0_100.rank()),3))
# 30-day mean anomaly correlation (remove day-of-year climatology)
m=j.rolling(30).mean().dropna(); doy=m.index.day_of_year
an=m - m.groupby(doy).transform("mean")
print("30-day anomaly r:", round(an.bucket_frac.corr(an.era5l_0_100),3))
# Percentile of Oct 7-Nov 1 window per year for both
def win(s): w=s[((s.index.month==10)&(s.index.day>=7))|((s.index.month==11)&(s.index.day<=1))]; return w.groupby(w.index.year).mean()
b, e = win(j.bucket_frac), win(j.era5l_0_100)
for y in [2023, 2024, 2025, 2026]:
    base=[x for x in b.index if x!=y and x<2026]
    print(y, "bucket pct=%.0f" % ((b.loc[base]<b.loc[y]).mean()*100), " era5l pct=%.0f" % ((e.loc[base]<e.loc[y]).mean()*100))
print("last date:", j.index.max().date(), "bucket_frac=%.2f" % j.bucket_frac.iloc[-1])
