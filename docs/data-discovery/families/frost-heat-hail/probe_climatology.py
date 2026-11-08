"""30+ year frost/heat climatology from Open-Meteo archive (ERA5-Land + ERA5) daily Tmin/Tmax; CAPE history start."""
import requests, time, pandas as pd
OUT = "/Users/cristian/Documents/projects/energhack/docs/data-discovery/families/frost-heat-hail/samples/"
# CAPE start: see probe_cape_start.py (GFS from 2021-03-23)
for y in []:  # was ["2015-06-01", "2016-01-05", "2017-01-05", "2019-01-05", "2021-01-05"]:
    r = requests.get("https://historical-forecast-api.open-meteo.com/v1/forecast", params=dict(latitude=-16.86, longitude=-62.52, hourly="cape", start_date=y, end_date=y), timeout=60)
    h = r.json().get("hourly", {}); print("cape", y, r.status_code, sum(x is not None for x in h.get("cape", [])), (h.get("cape") or [])[:4], r.json().get("reason", ""))
sites = {"Agricola Pailon Norte (wheat)": (-62.68, -17.56), "Viru Viru SLVR": (-63.14, -17.64), "Estancia Los Tajibos": (-62.52, -16.86)}
rows = []
for name, (lon, lat) in sites.items():
    for model in ["era5_land", "era5"]:
        t = time.time()
        r = requests.get("https://archive-api.open-meteo.com/v1/archive", params=dict(latitude=lat, longitude=lon,
            start_date="1991-01-01", end_date="2026-11-06", daily="temperature_2m_min,temperature_2m_max", models=model, timezone="America/La_Paz"), timeout=120)
        dt = round(time.time() - t, 2)
        if "daily" not in r.json(): print("ERR", r.status_code, r.text[:120]); time.sleep(70); continue
        time.sleep(70)  # Open-Meteo weights 35-y pulls heavily (429 minutely limit)
        d = pd.DataFrame(r.json()["daily"]); d["time"] = pd.to_datetime(d["time"]); d = d.dropna()
        d["y"] = d.time.dt.year
        g = d.groupby("y").agg(tmin_abs=("temperature_2m_min", "min"), tmax_abs=("temperature_2m_max", "max"),
            frost0=("temperature_2m_min", lambda s: (s <= 0).sum()), frost2=("temperature_2m_min", lambda s: (s <= 2).sum()),
            cold5=("temperature_2m_min", lambda s: (s <= 5).sum()), heat35=("temperature_2m_max", lambda s: (s >= 35).sum()),
            heat38=("temperature_2m_max", lambda s: (s >= 38).sum()))
        print(f"\n{name} {model} status={r.status_code} {dt}s rows={len(d)} last={d.time.max().date()} absmin={d.temperature_2m_min.min()} on {d.loc[d.temperature_2m_min.idxmin(),'time'].date()} absmax={d.temperature_2m_max.max()}")
        print("years w/ Tmin<=0:", list(g.index[g.frost0 > 0]), " years w/ Tmin<=2:", list(g.index[g.frost2 > 0]))
        print("mean days/yr Tmin<=5: %.1f  Tmax>=35: %.1f  Tmax>=38: %.1f" % (g.cold5.mean(), g.heat35.mean(), g.heat38.mean()))
        print(g.tail(4).to_string())
        g["site"] = name; g["model"] = model; rows.append(g.reset_index())
pd.concat(rows).to_csv(OUT + "frost_heat_annual_counts_1991_2026.csv", index=False)
