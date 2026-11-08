"""Find a working no-key CAPE history path (Open-Meteo archive variants, historical-forecast API)."""
import requests, time
lat, lon = -16.86, -62.52
tests = [
 ("archive era5 cape", "https://archive-api.open-meteo.com/v1/archive", dict(models="era5", hourly="cape", start_date="2024-01-01", end_date="2024-01-03")),
 ("archive default cape", "https://archive-api.open-meteo.com/v1/archive", dict(hourly="cape", start_date="2024-01-01", end_date="2024-01-03")),
 ("archive ecmwf_ifs cape", "https://archive-api.open-meteo.com/v1/archive", dict(models="ecmwf_ifs", hourly="cape", start_date="2024-01-01", end_date="2024-01-03")),
 ("hist-forecast cape 2022", "https://historical-forecast-api.open-meteo.com/v1/forecast", dict(hourly="cape,lifted_index", start_date="2022-01-01", end_date="2022-01-02")),
 ("hist-forecast cape 2024", "https://historical-forecast-api.open-meteo.com/v1/forecast", dict(hourly="cape,lifted_index", start_date="2024-01-01", end_date="2024-01-02")),
 ("hist-forecast cape recent", "https://historical-forecast-api.open-meteo.com/v1/forecast", dict(hourly="cape,lifted_index", start_date="2026-10-25", end_date="2026-11-06")),
 ("hist-forecast gfs cape 2021", "https://historical-forecast-api.open-meteo.com/v1/forecast", dict(models="gfs_seamless", hourly="cape", start_date="2021-06-01", end_date="2021-06-02")),
]
for name, url, p in tests:
    p.update(latitude=lat, longitude=lon)
    t = time.time(); r = requests.get(url, params=p, timeout=60); dt = round(time.time()-t, 2)
    try:
        j = r.json(); h = j.get("hourly", {})
        vals = {k: [x for x in v if x is not None][:4] for k, v in h.items() if k != "time"}
        nn = {k: sum(x is not None for x in v) for k, v in h.items() if k != "time"}
        print(name, r.status_code, dt, nn, vals, j.get("reason", ""))
    except Exception as e:
        print(name, r.status_code, dt, r.text[:200])
