"""CHIRTS-ERA5 Tmax/Tmin at SLVR vs GHCN-D station on the 25 hottest / 25 coldest station days since 2005 (compare with ERA5 extremes bias in probe_station_bias.py)."""
import requests, io, rasterio, pandas as pd, time
from rasterio.env import Env
B = "https://data.chc.ucsb.edu/experimental/CHIRTS-ERA5/"; LON, LAT = -63.14, -17.64
OUT = "/Users/cristian/Documents/projects/energhack/docs/data-discovery/families/frost-heat-hail/samples/"
st = pd.read_csv(io.StringIO(requests.get("https://www.ncei.noaa.gov/data/global-historical-climatology-network-daily/access/BLM00085244.csv", timeout=120).text), usecols=["DATE", "TMAX", "TMIN"], parse_dates=["DATE"])
st[["TMAX", "TMIN"]] /= 10; st = st[st.DATE >= "2005-01-01"]
rows = []
with Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
    for var, sel in [("Tmax", st.dropna(subset=["TMAX"]).nlargest(25, "TMAX")), ("Tmin", st.dropna(subset=["TMIN"]).nsmallest(25, "TMIN"))]:
        for _, s in sel.iterrows():
            d = s.DATE; url = f"/vsicurl/{B}{var.lower()}/tifs/daily/{d.year}/CHIRTS-ERA5.daily_{var}.{d:%Y.%m.%d}.tif"
            v = None
            for attempt in range(4):  # CHC returns 429 on bursts: pace ~2 s and back off
                try:
                    with rasterio.open(url) as ds:
                        r, c = ds.index(LON, LAT); v = float(ds.read(1, window=((r, r + 1), (c, c + 1)))[0, 0])
                    break
                except Exception as e:
                    time.sleep(15 * (attempt + 1))
            time.sleep(2)
            rows.append(dict(var=var, date=str(d.date()), station=s.TMAX if var == "Tmax" else s.TMIN, chirts_era5=round(v, 2) if v is not None else None))
df = pd.DataFrame(rows); df["bias"] = df.chirts_era5 - df.station; df.to_csv(OUT + "slvr_extremes_station_vs_chirts_era5.csv", index=False)
print(df.groupby("var").bias.describe().round(2).to_string())
print(df.to_string())
