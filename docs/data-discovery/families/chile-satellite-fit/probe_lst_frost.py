"""Probe: MODIS daily night LST (MOD11A1 Terra ~22:30, MYD11A1 Aqua ~01:30 local solar) as a frost proxy vs
station Tmin at Curicó (GHCN-D CI000085629, valley floor, -71.233,-34.967) and vs ERA5 (Open-Meteo archive) Tmin.
Frost seasons May-Oct 2023 and May-Oct 2024. All keyless:
  - LST: Planetary Computer STAC modis-11A1-061 + data API /item/point (server-side pixel read)
  - Tmin: NCEI Access Data Service daily-summaries
  - ERA5: archive-api.open-meteo.com (models=era5 and era5_land)
LST pairs with the station Tmin of the same night: Terra 22:30 of day D and Aqua 01:30 of day D are matched with Tmin of
date D (GHCN Tmin is the 24 h minimum ending at the observation hour, typically morning of D) - approximate, documented.
Output: out_lst_frost.json"""
import json, time, datetime as dt, concurrent.futures as cf
import numpy as np, requests
from pystac_client import Client
LON, LAT = -71.233, -34.967
SEASONS = [("2023-05-01", "2023-10-31"), ("2024-05-01", "2024-10-31")]
cat = Client.open("https://planetarycomputer.microsoft.com/api/stac/v1")
PT = f"https://planetarycomputer.microsoft.com/api/data/v1/item/point/{LON},{LAT}"
out = {"site": "Curico GHCN CI000085629", "lonlat": [LON, LAT]}
# --- station
t = time.time()
r = requests.get("https://www.ncei.noaa.gov/access/services/data/v1", params={"dataset": "daily-summaries", "stations": "CI000085629",
                 "startDate": "2023-05-01", "endDate": "2025-12-31", "dataTypes": "TMIN,TMAX", "format": "json", "units": "metric"}, timeout=90)
st = {d["DATE"]: float(d["TMIN"]) for d in r.json() if "TMIN" in d}
out["ncei"] = {"http": r.status_code, "s": round(time.time() - t, 2), "n_tmin": len(st), "last_date": max(st)}
print("ncei", out["ncei"])
# --- ERA5 via open-meteo
era = {}
for model in ["era5", "era5_land"]:
    t = time.time()
    r = requests.get("https://archive-api.open-meteo.com/v1/archive", params={"latitude": LAT, "longitude": LON, "start_date": "2023-05-01", "end_date": "2024-10-31",
                     "daily": "temperature_2m_min", "models": model, "timezone": "America/Santiago"}, timeout=90)
    j = r.json()
    if "daily" not in j:  # e.g. {"error":true,"reason":"Daily API request limit exceeded..."}
        era[model] = {}; out[f"openmeteo_{model}"] = {"http": r.status_code, "error": j.get("reason")}; print(model, out[f"openmeteo_{model}"]); continue
    era[model] = dict(zip(j["daily"]["time"], j["daily"]["temperature_2m_min"]))
    out[f"openmeteo_{model}"] = {"http": r.status_code, "s": round(time.time() - t, 2), "grid_elev": j.get("elevation"), "lat": j.get("latitude"), "lon": j.get("longitude")}
    print(model, out[f"openmeteo_{model}"])
# --- LST
items = []
for a, b in SEASONS:
    items += list(cat.search(collections=["modis-11A1-061"], intersects={"type": "Point", "coordinates": [LON, LAT]}, datetime=f"{a}/{b}", max_items=2000).items())
def pt(it):
    for k in range(3):
        try:
            r = requests.get(PT, params={"collection": "modis-11A1-061", "item": it.id, "assets": ["LST_Night_1km", "QC_Night"]}, timeout=60)
            if r.status_code == 200: return r.json()["values"]
        except Exception: pass
        time.sleep(1 + k)
    return None
t = time.time()
with cf.ThreadPoolExecutor(8) as ex: vals = list(ex.map(pt, items))
out["lst"] = {"n_items": len(items), "s": round(time.time() - t, 1), "errors": sum(v is None for v in vals)}
rows = []
for it, v in zip(items, vals):
    if not v: continue
    d = (it.properties.get("start_datetime") or it.properties["datetime"])[:10]; sat = it.id[:3]
    lst = v[0] * 0.02 - 273.15 if v[0] > 0 else None
    rows.append({"date": d, "sat": sat, "lst_c": None if lst is None else round(lst, 2), "qc": int(v[1]), "tmin": st.get(d), "era5": era["era5"].get(d), "era5_land": era["era5_land"].get(d)})
valid = [x for x in rows if x["lst_c"] is not None and x["tmin"] is not None]
out["lst"]["valid_frac"] = {s: round(sum(1 for x in rows if x["sat"] == s and x["lst_c"] is not None) / max(1, sum(1 for x in rows if x["sat"] == s)), 2) for s in ("MOD", "MYD")}
def cmp(xs, ys):
    xs, ys = np.array(xs), np.array(ys)
    return {"n": int(len(xs)), "bias_c": round(float(np.mean(xs - ys)), 2), "rmse_c": round(float(np.sqrt(np.mean((xs - ys) ** 2))), 2), "r": round(float(np.corrcoef(xs, ys)[0, 1]), 3)}
res = {}
for s in ("MOD", "MYD"):
    v = [x for x in valid if x["sat"] == s]
    res[f"{s}_LSTnight_vs_station_tmin"] = cmp([x["lst_c"] for x in v], [x["tmin"] for x in v])
    # frost detection: station Tmin <= 0 C; LST threshold chosen = best single threshold
    obs = np.array([x["tmin"] <= 0 for x in v]); l = np.array([x["lst_c"] for x in v])
    best = None
    for th in np.arange(-6, 3.1, 0.5):
        pred = l <= th; tp = int((pred & obs).sum()); fp = int((pred & ~obs).sum()); fn = int((~pred & obs).sum())
        f1 = 2 * tp / max(1, 2 * tp + fp + fn)
        if best is None or f1 > best["f1"]: best = {"lst_threshold_c": float(th), "tp": tp, "fp": fp, "fn": fn, "f1": round(f1, 2)}
    res[f"{s}_frost_detection"] = {"station_frost_nights_in_valid": int(obs.sum()), **best}
allst = [(d, t_) for d, t_ in st.items() if any(a <= d <= b for a, b in SEASONS)]
frost_days = [d for d, t_ in allst if t_ <= 0]
res["station_frost_days_total"] = len(frost_days)
res["station_frost_days_with_any_valid_lst"] = len({x["date"] for x in valid if x["tmin"] <= 0})
for m in ("era5", "era5_land"):
    v = [(era[m][d], t_) for d, t_ in allst if era[m].get(d) is not None]
    if not v: continue
    res[f"{m}_tmin_vs_station"] = cmp([a for a, _ in v], [b for _, b in v])
    res[f"{m}_frost_days"] = sum(1 for a, _ in v if a <= 0)
out["results"] = res
out["sample_rows"] = sorted(rows, key=lambda x: (x["date"], x["sat"]))[:12]
json.dump({**out, "rows": rows}, open("out_lst_frost.json", "w"), indent=1)
print(json.dumps(out["lst"]), "\n", json.dumps(res, indent=1))
