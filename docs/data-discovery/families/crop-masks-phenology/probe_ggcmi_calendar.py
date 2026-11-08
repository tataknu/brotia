"""GGCMI Phase 3 crop calendar (Jaegermeyr et al. 2021, 0.5 deg, CC-BY-4.0, Zenodo 5062513, ~100 kB/crop NetCDF, no key).
Reads planting_day / maturity_day / growing_season_length at farm cells for the crops we need."""
import os, time, datetime as dt, requests, rasterio
FARMS = {"Cuatro Canadas (-62.47,-17.30)": (-62.47, -17.30), "Okinawa (-62.85,-17.18)": (-62.85, -17.18),
         "Mineros (-63.29,-17.20)": (-63.29, -17.20)}
CROPS = ["soy_rf", "mai_rf", "sor_rf", "sun_rf", "swh_rf", "wwh_rf", "ri1_rf", "ri2_rf", "sgc_rf", "pot_rf"]
CACHE = os.environ.get("GGCMI_CACHE", "/private/tmp/claude-501/-Users-cristian-Documents-projects-energhack/6f879383-e961-442e-bad1-17fb20564051/scratchpad/ggcmi")
os.makedirs(CACHE, exist_ok=True)
doy = lambda d: (dt.date(2001, 1, 1) + dt.timedelta(days=int(d) - 1)).strftime("%d-%b")
for c in CROPS:
    fn = f"{c}_ggcmi_crop_calendar_phase3_v1.01.nc4"; p = os.path.join(CACHE, fn)
    if not os.path.exists(p):
        t = time.time(); r = requests.get(f"https://zenodo.org/api/records/5062513/files/{fn}/content", timeout=60)
        open(p, "wb").write(r.content); print(f"GET {fn} HTTP {r.status_code} {len(r.content)/1e3:.0f} kB {time.time()-t:.1f}s")
    vals = {}
    for var in ["planting_day", "maturity_day", "growing_season_length"]:
        with rasterio.open(f'netcdf:"{p}":{var}') as ds:
            for name, (lon, lat) in FARMS.items():
                row, col = ds.index(lon, lat)
                vals.setdefault(name, {})[var] = float(ds.read(1, window=((row, row+1), (col, col+1)))[0, 0])
    for name, v in vals.items():
        ok = 0 < v["planting_day"] < 367
        print(f"{c:7s} {name:32s} plant {doy(v['planting_day']) if ok else v['planting_day']:>7}  maturity {doy(v['maturity_day']) if ok else v['maturity_day']:>7}  len {v['growing_season_length']:.0f} d")
