"""Was Aug-Oct 2026 anomalously wet (explaining ERA5-Land 87th pct soil with 10th pct window rain)? Monthly percentiles vs 1996-2025."""
import requests, pandas as pd
r=requests.get("https://archive-api.open-meteo.com/v1/archive", params=dict(latitude=-16.86, longitude=-62.52, start_date="1996-01-01", end_date="2026-11-01", models="era5", daily="precipitation_sum"), timeout=120)
e=pd.Series(r.json()["daily"]["precipitation_sum"], index=pd.DatetimeIndex(pd.to_datetime(r.json()["daily"]["time"]).values.astype("datetime64[ns]"))).dropna()
era=pd.read_csv("sample_era5land_0_100_tajibos_daily.csv.gz"); s=pd.Series(era["soil_moisture_0_to_100cm_mean"].values, index=pd.DatetimeIndex(pd.to_datetime(era["time"]).values.astype("datetime64[ns]"))).dropna()
R=e.resample("MS").sum(); S=s.resample("MS").mean()
for m in ["2026-07","2026-08","2026-09","2026-10"]:
    mo=int(m[-2:]); rb=R[(R.index.month==mo)&(R.index.year<2026)]; sb=S[(S.index.month==mo)&(S.index.year<2026)]
    rv=R.loc[m].iloc[0]; sv=S.loc[m].iloc[0]
    print(f"{m}: ERA5 rain {rv:.0f} mm (clim {rb.mean():.0f}, pct {(rb<rv).mean()*100:.0f}) | ERA5-Land 0-100cm {sv:.3f} (clim {sb.mean():.3f}, pct {(sb<sv).mean()*100:.0f})")
print("ERA5-Land daily 0-100cm 2026-09-20..10-20:", s.loc["2026-09-20":"2026-10-20"].round(3).tolist())
print("ERA5 daily rain 2026-09-20..10-20:", e.loc["2026-09-20":"2026-10-20"].round(0).tolist())
