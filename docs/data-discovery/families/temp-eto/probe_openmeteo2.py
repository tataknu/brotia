import requests, pandas as pd, time
LAT, LON = -16.86, -62.52
daily="temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration"
for model in ["era5_land","era5","era5_seamless","best_match"]:
    r=requests.get("https://archive-api.open-meteo.com/v1/archive",params=dict(latitude=LAT,longitude=LON,start_date="1950-01-01",end_date="2026-11-06",daily=daily,models=model,timezone="America/La_Paz"),timeout=120)
    d=pd.DataFrame(r.json()["daily"]).set_index("time")
    fv={c:d[c].first_valid_index() for c in d}
    lv={c:d[c].last_valid_index() for c in d}
    nn=d.loc["1995-01-01":].isna().sum().to_dict()
    print(model, "first_valid",fv,"last_valid",lv,"nulls_since1995",nn)
    if model=="era5_land": d.to_csv("sample_era5land_LosTajibos_daily.csv.tmp")
