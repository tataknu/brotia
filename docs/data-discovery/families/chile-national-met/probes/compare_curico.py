"""Three-source daily comparison at Curico (DMC 340031 General Freire Ad., 2.4 km from test site).

Sources: DMC station (keyless annual-table scrape), CR2MET v2.5_best (keyless byte-range NetCDF),
ERA5-Land via Open-Meteo archive (keyless, models=era5_land).
Needs netCDF4 + numpy + pandas + requests. Writes curico_2023_2024_three_source.csv.
"""
import os, sys, time, json
import numpy as np, pandas as pd, requests, netCDF4
sys.path.insert(0, os.path.dirname(__file__))
from dmc_annual import fetch_year

LON, LAT, CODE = -71.24, -34.98, 340031
HERE = os.path.dirname(os.path.abspath(__file__))
YEARS = (2023, 2024)

# --- DMC station
dmc = {}
for p, k in [("aguaCaidaAnual", "pr"), ("temperaturaMaximaAnual", "tmax"), ("temperaturaMinimaAnual", "tmin")]:
    dmc[k] = pd.concat([fetch_year(p, CODE, y) for y in YEARS])
dmc = pd.DataFrame(dmc).add_prefix("dmc_")

# --- CR2MET v2.5_best, point read via HTTP byte ranges
B = "https://ftp.cr2.cl/download/cr2met/v2.5_best"
rows = []
for y in YEARS:
    for m in range(1, 13):
        rec = {}
        for var, path, names in [("pr", f"pr/v2.5_best_day/CR2MET_pr_v2.5_best_day_{y}_{m:02d}_005deg.nc", ["pr"]),
                                 ("txn", f"txn/v2.5_best_day/CR2MET_tmin_tmax_v2.5_best_day_{y}_{m:02d}_005deg.nc", ["tmax", "tmin"])]:
            t0 = time.time()
            ds = netCDF4.Dataset(f"{B}/{path}#mode=bytes")
            lat, lon = ds["lat"][:], ds["lon"][:]
            i, j = int(np.abs(lat - LAT).argmin()), int(np.abs(lon - LON).argmin())
            dates = netCDF4.num2date(ds["time"][:], ds["time"].units, only_use_cftime_datetimes=False)
            for n in names:
                v = ds[n]
                vals = v[:, i, j] if v.ndim == 3 else v[i, j][None]
                for d, x in zip(dates, np.ma.filled(vals.astype(float), np.nan)):
                    rec.setdefault(pd.Timestamp(d.year, d.month, d.day), {})[f"cr2_{n}"] = x
            ver = getattr(ds, "cr2met_version", "?")
            ds.close()
        for d, r in rec.items():
            r["cr2_version"] = ver
            rows.append({"date": d, **r})
        print(y, m, "cr2 ok", ver, round(time.time() - t0, 1), "s", flush=True)
cr2 = pd.DataFrame(rows).groupby("date").first()

cache = os.path.join(HERE, "_cache_dmc_cr2.csv")
dmc.join(cr2, how="outer").to_csv(cache)

# --- NASA POWER (MERRA-2 based), keyless point API
pw = requests.get("https://power.larc.nasa.gov/api/temporal/daily/point", params=dict(
    parameters="PRECTOTCORR,T2M_MAX,T2M_MIN", community="AG", longitude=LON, latitude=LAT,
    start="20230101", end="20241231", format="JSON"), timeout=120).json()["properties"]["parameter"]
power = pd.DataFrame({"pow_pr": pw["PRECTOTCORR"], "pow_tmax": pw["T2M_MAX"], "pow_tmin": pw["T2M_MIN"]})
power.index = pd.to_datetime(power.index, format="%Y%m%d"); power = power.where(power > -900)

# --- ERA5-Land via Open-Meteo (may hit the shared daily quota -> 429; then column is left empty)
era = pd.DataFrame(columns=["era_pr", "era_tmax", "era_tmin"])
r = requests.get("https://archive-api.open-meteo.com/v1/archive", params=dict(
    latitude=LAT, longitude=LON, start_date="2023-01-01", end_date="2024-12-31",
    daily="precipitation_sum,temperature_2m_max,temperature_2m_min", models="era5_land",
    timezone="America/Santiago"), timeout=60)
if r.status_code != 200:
    print("Open-Meteo ERA5-Land unavailable:", r.status_code, r.text[:120])
else:
  j = r.json()
  era = pd.DataFrame({"era_pr": j["daily"]["precipitation_sum"], "era_tmax": j["daily"]["temperature_2m_max"],
                    "era_tmin": j["daily"]["temperature_2m_min"]}, index=pd.to_datetime(j["daily"]["time"]))
  print("open-meteo grid elev", j.get("elevation"), "lat/lon", j.get("latitude"), j.get("longitude"))

df = dmc.join(cr2, how="outer").join(power, how="outer").join(era, how="outer")
df.index.name = "date"
df.round(2).to_csv(os.path.join(HERE, "curico_2023_2024_three_source.csv"))
print(df.describe().round(2).T)
