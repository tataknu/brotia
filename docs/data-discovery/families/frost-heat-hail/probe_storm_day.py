"""Find recent convective days at Los Tajibos via Open-Meteo historical-forecast (GFS/best-match: hourly precip, CAPE, LI, freezing level),
then verify lightning with GOES-19 GLM by sampling 20-s LCFA files over the storm hours (keyless). Output: storm-day table + GLM counts."""
import requests, re, h5py, io, time, json, pandas as pd, numpy as np, datetime as dt
OUT = "/Users/cristian/Documents/projects/energhack/docs/data-discovery/families/frost-heat-hail/samples/"
LAT, LON = -16.86, -62.52
r = requests.get("https://historical-forecast-api.open-meteo.com/v1/forecast", params=dict(latitude=LAT, longitude=LON, start_date="2025-10-01", end_date="2026-11-05",
     hourly="precipitation,cape,lifted_index,freezing_level_height,wind_gusts_10m", timezone="UTC"), timeout=120)
h = pd.DataFrame(r.json()["hourly"]); h["time"] = pd.to_datetime(h.time); print("hist-forecast", r.status_code, len(h), "last non-null cape", h.dropna(subset=["cape"]).time.max())
h["date"] = h.time.dt.date
d = h.groupby("date").agg(p=("precipitation", "sum"), pmax=("precipitation", "max"), cape=("cape", "max"), li=("lifted_index", "min"), fzl=("freezing_level_height", "min"), gust=("wind_gusts_10m", "max"))
top = d.sort_values("pmax", ascending=False).head(8); print(top.round(1).to_string())
d.round(1).to_csv(OUT + "los_tajibos_daily_convective_env_2025-10_2026-11.csv")
B = "https://noaa-goes19.s3.amazonaws.com/"; BOX = (LON - 0.25, LAT - 0.25, LON + 0.25, LAT + 0.25)  # ~27 km half-width
def count(key):
    c = requests.get(B + key, timeout=60).content; f = h5py.File(io.BytesIO(c), "r")
    def g(n):
        a = f[n][:].astype(float); at = f[n].attrs
        return a * float(at["scale_factor"][0]) + float(at["add_offset"][0]) if "scale_factor" in at else a
    la, lo = g("flash_lat"), g("flash_lon"); q = f["flash_quality_flag"][:]
    m = (lo >= BOX[0]) & (lo <= BOX[2]) & (la >= BOX[1]) & (la <= BOX[3]) & (q == 0)
    return int(m.sum()), len(c)
res = []
for date in list(top.index[:2]):
    hrs = h[(h.date == date)].sort_values("precipitation", ascending=False).time.dt.hour.tolist()[:3]
    for hh in hrs:
        t = dt.datetime.combine(date, dt.time(hh)); prefix = f"GLM-L2-LCFA/{t.year}/{t.timetuple().tm_yday:03d}/{hh:02d}/"
        keys = re.findall(r"<Key>(.*?)</Key>", requests.get(B, params={"list-type": "2", "prefix": prefix}, timeout=60).text)
        sample = keys[::30]  # 6 x 20-s files per hour (~3 MB)
        cnt = [count(k) for k in sample]
        rec = dict(date=str(date), hour_utc=hh, files_in_hour=len(keys), sampled=len(sample), flashes_in_box=[c for c, _ in cnt], MB=round(sum(b for _, b in cnt) / 1e6, 1),
                   model_precip_mm=float(h[(h.time == t)].precipitation.iloc[0]))
        res.append(rec); print(rec)
json.dump(res, open(OUT + "glm_storm_check.json", "w"), indent=1)
