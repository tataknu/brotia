"""Bisect the start of CAPE history in Open-Meteo historical-forecast API (default best-match vs gfs_seamless)."""
import requests, time
for model in [None, "gfs_seamless", "ecmwf_ifs025", "icon_seamless"]:
    for d in ["2016-01-05", "2018-01-05", "2021-03-23", "2021-06-01", "2021-09-01", "2021-12-01", "2022-01-01"]:
        p = dict(latitude=-16.86, longitude=-62.52, hourly="cape", start_date=d, end_date=d)
        if model: p["models"] = model
        r = requests.get("https://historical-forecast-api.open-meteo.com/v1/forecast", params=p, timeout=60); j = r.json()
        v = j.get("hourly", {}).get("cape", [])
        print(model or "best_match", d, r.status_code, sum(x is not None for x in v), [x for x in v if x is not None][:3], j.get("reason", "")[:80])
        time.sleep(1.5)
