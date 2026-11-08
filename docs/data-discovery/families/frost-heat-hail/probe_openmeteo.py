"""Probe Open-Meteo archive (ERA5 / ERA5-Land) + forecast hourly T2m and CAPE for a farm."""
import time, json, requests, sys
FARM = ("Estancia Los Tajibos", -62.52, -16.86)
OUT = "/Users/cristian/Documents/projects/energhack/docs/data-discovery/families/frost-heat-hail/samples/"
def get(url, params):
    t = time.time(); r = requests.get(url, params=params, timeout=60)
    return r, round(time.time() - t, 2)
name, lon, lat = FARM
res = {}
# 1. ERA5-Land hourly T2m (archive) -- last ~13 months
for model in ["era5_land", "era5"]:
    p = dict(latitude=lat, longitude=lon, start_date="2025-10-01", end_date="2026-11-06",
             hourly="temperature_2m,cape" if model=="era5" else "temperature_2m",
             models=model, timezone="America/La_Paz")
    r, dt = get("https://archive-api.open-meteo.com/v1/archive", p)
    j = r.json()
    h = j.get("hourly", {})
    T = h.get("temperature_2m", []); times = h.get("time", [])
    last_idx = max([i for i, v in enumerate(T) if v is not None], default=None)
    info = dict(status=r.status_code, latency_s=dt, n=len(T),
                last_valid=times[last_idx] if last_idx is not None else None,
                tmin=min(v for v in T if v is not None), tmax=max(v for v in T if v is not None),
                grid=(j.get("latitude"), j.get("longitude"), j.get("elevation")))
    if model == "era5":
        C = h.get("cape", [])
        cv = [v for v in C if v is not None]
        li = max([i for i, v in enumerate(C) if v is not None], default=None)
        info.update(cape_n=len(cv), cape_max=max(cv) if cv else None, cape_last=times[li] if li is not None else None)
    frost_h = sum(1 for v in T if v is not None and v <= 0)
    heat_h = sum(max(0, v - 35) for v in T if v is not None)
    info.update(frost_hours_le0=frost_h, heat_degree_hours_gt35=round(heat_h, 1))
    res[model] = info
    print(model, json.dumps(info))
# 2. History start check: 1950 ERA5 / ERA5-Land
for model in ["era5_land", "era5"]:
    p = dict(latitude=lat, longitude=lon, start_date="1950-01-01", end_date="1950-01-02",
             hourly="temperature_2m", models=model)
    r, dt = get("https://archive-api.open-meteo.com/v1/archive", p)
    T = r.json().get("hourly", {}).get("temperature_2m", [])
    print("history", model, r.status_code, dt, T[:3])
# 3. Forecast API: hourly T2m, CAPE, lifted index, freezing level, past 7 days + 7 fc
p = dict(latitude=lat, longitude=lon, hourly="temperature_2m,cape,lifted_index,freezing_level_height,precipitation,showers",
         past_days=7, forecast_days=7, timezone="America/La_Paz")
r, dt = get("https://api.open-meteo.com/v1/forecast", p)
j = r.json(); h = j.get("hourly", {})
print("forecast", r.status_code, dt, {k: (len(v), [x for x in v if x is not None][:3]) for k, v in h.items() if k != "time"})
print("forecast cape max", max([x for x in h.get("cape", []) if x is not None] or [None]))
json.dump({"probe": res, "forecast_excerpt": {k: v[:24] for k, v in h.items()}}, open(OUT + "openmeteo_probe.json", "w"), indent=1)
