"""MODIS LST_Night (Terra ~22:30, Aqua ~01:30 local) at the SLVR pixel vs GHCN-D station TMIN on the 40 coldest station nights 2000-2025.
Gives: clear-sky availability on cold nights, and LST_Night - TMIN offset (frost-proxy calibration)."""
import requests, io, time, rasterio, json, pandas as pd, datetime as dt
from rasterio.warp import transform
OUT = "/Users/cristian/Documents/projects/energhack/docs/data-discovery/families/frost-heat-hail/samples/"
LON, LAT = -63.14, -17.64
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
st = pd.read_csv(io.StringIO(requests.get("https://www.ncei.noaa.gov/data/global-historical-climatology-network-daily/access/BLM00085244.csv", timeout=120).text), usecols=["DATE", "TMIN"], parse_dates=["DATE"])
st["TMIN"] /= 10; st = st[(st.DATE >= "2000-03-01")].dropna().nsmallest(40, "TMIN")
tok = requests.get("https://planetarycomputer.microsoft.com/api/sas/v1/token/modiseuwest/modis-061-cogs", timeout=60).json()["token"]
rows = []
for _, s in st.sort_values("DATE").iterrows():
    d = s.DATE.date()
    # the station TMIN for date d is the morning of d; Terra night pass of d-1 (~22:30) and Aqua pass of d (~01:30 local = 05:30 UTC of d) bracket it.
    body = {"collections": ["modis-11A1-061"], "intersects": {"type": "Point", "coordinates": [LON, LAT]},
            "datetime": f"{d - dt.timedelta(days=1)}/{d}", "limit": 10}
    for attempt in range(3):
        r = requests.post(f"{STAC}/search", json=body, timeout=60)
        if r.status_code == 200: break
        time.sleep(30)
    items = r.json().get("features", [])
    rec = dict(date=str(d), station_tmin=s.TMIN)
    for it in items:
        sat = it["id"][:3]; day = it["properties"]["start_datetime"][:10]
        key = f"{sat}_{'d-1' if day != str(d) else 'd'}"
        with rasterio.open(it["assets"]["LST_Night_1km"]["href"] + "?" + tok) as ds:
            xs, ys = transform("EPSG:4326", ds.crs, [LON], [LAT]); rr, cc = ds.index(xs[0], ys[0])
            v = int(ds.read(1, window=((rr, rr + 1), (cc, cc + 1)))[0, 0])
        rec[key] = round(v * 0.02 - 273.15, 1) if v else None
    rows.append(rec); print(rec)
df = pd.DataFrame(rows); df.to_csv(OUT + "slvr_cold_nights_station_vs_modis_lst.csv", index=False)
# Overpass closest to the dawn minimum: Aqua night pass of day d (~01:30 local), then Terra of d-1 (~22:30)
df["lst_best"] = df.get("MYD_d").combine_first(df.get("MOD_d-1")) if "MYD_d" in df else df.get("MOD_d-1")
ok = df.dropna(subset=["lst_best"])
print("\nclear-sky availability on 40 coldest nights: %d/%d" % (len(ok), len(df)))
print("LST_night - station TMIN: mean %.2f median %.2f min %.2f max %.2f" % ((ok.lst_best - ok.station_tmin).mean(), (ok.lst_best - ok.station_tmin).median(), (ok.lst_best - ok.station_tmin).min(), (ok.lst_best - ok.station_tmin).max()))
print("nights with LST_night <= 2 C:", (ok.lst_best <= 2).sum(), " <= 0 C:", (ok.lst_best <= 0).sum())
