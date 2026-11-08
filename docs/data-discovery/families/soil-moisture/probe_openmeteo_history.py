"""Probe a 30-year daily ERA5-Land root-zone soil moisture pull (baseline feasibility) + ecmwf_ifs archive."""
import time, requests, pandas as pd
LAT, LON = -16.86, -62.52
t=time.time()
r=requests.get("https://archive-api.open-meteo.com/v1/archive", params=dict(latitude=LAT, longitude=LON,
  start_date="1996-01-01", end_date="2026-11-06", models="era5_land",
  daily="soil_moisture_0_to_7cm_mean,soil_moisture_7_to_28cm_mean,soil_moisture_28_to_100cm_mean,soil_moisture_0_to_100cm_mean"), timeout=120)
print("30y daily era5_land:", r.status_code, f"{time.time()-t:.1f}s", len(r.content), "bytes")
j=r.json()
if r.status_code!=200: print(j)
else:
  d=pd.DataFrame(j["daily"]); d["time"]=pd.to_datetime(d["time"]); d=d.set_index("time")
  print(d.dropna().tail(3)); print("last non-null:", d.dropna().index.max(), "rows:", len(d), "nulls:", d.isna().sum().to_dict())
  # Same-time-of-year percentile for Oct 7 - Nov 1 window
  s=d["soil_moisture_0_to_100cm_mean"]
  win=s[(s.index.month==10)&(s.index.day>=7) | (s.index.month==11)&(s.index.day<=1)]
  by=win.groupby(win.index.year).mean()
  cur=by.loc[2026]; pct=(by.drop(2026)<cur).mean()*100
  print("Oct7-Nov1 0-100cm mean by year (last 8):", by.tail(8).round(3).to_dict())
  print(f"2026 window mean={cur:.3f} percentile vs 1996-2025 = {pct:.0f}")
  # Check 2023 drought
  print("2023 window:", round(by.loc[2023],3), "pct:", round((by.drop([2023,2026])<by.loc[2023]).mean()*100))
  d.to_csv("sample_era5land_0_100_tajibos_daily.csv.gz", compression="gzip")
# ecmwf_ifs model in archive?
for m in ["ecmwf_ifs","era5","era5_seamless","era5_ensemble"]:
  t=time.time()
  r=requests.get("https://archive-api.open-meteo.com/v1/archive", params=dict(latitude=LAT, longitude=LON,
    start_date="2026-10-25", end_date="2026-11-06", models=m, daily="soil_moisture_0_to_100cm_mean"), timeout=60)
  j=r.json()
  if r.status_code==200:
    v=[(a,b) for a,b in zip(j["daily"]["time"], j["daily"][list(j["daily"])[1]]) if b is not None]
    print(m, r.status_code, f"{time.time()-t:.1f}s", "grid", j["latitude"], j["longitude"], "last:", v[-1] if v else None)
  else: print(m, r.status_code, j)
