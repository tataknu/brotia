"""MODIS MCD12Q2 land-surface phenology (500 m, yearly 2001-2025) via ORNL DAAC REST (no key).
Gets Greenup / Maturity / Senescence / Dormancy (cycle 1 and 2) + NumCycles at farm pixel; converts
days-since-1970 to dates. Also MCD12Q1 LC_Type1 (IGBP: 12 = croplands, 14 = crop/natural mosaic)."""
import json, sys, time, datetime as dt, requests
BASE = "https://modis.ornl.gov/rst/api/v1"
FARMS = {"Colonia Cuatro Canadas Lote 7": (-62.47, -17.30), "Finca Okinawa Dos": (-62.85, -17.18),
         "Estancia Los Tajibos": (-62.52, -16.86)}
BANDS = ["NumCycles", "Greenup.Num_Modes_01", "Maturity.Num_Modes_01", "Senescence.Num_Modes_01", "Dormancy.Num_Modes_01",
         "Greenup.Num_Modes_02", "Maturity.Num_Modes_02", "Senescence.Num_Modes_02", "Dormancy.Num_Modes_02",
         "EVI_Amplitude.Num_Modes_01", "QA_Overall.Num_Modes_01"]
import functools; print = functools.partial(print, flush=True)
def get(path, **p):
    t = time.time(); r = requests.get(f"{BASE}/{path}", params=p, headers={"Accept": "application/json"}, timeout=120)
    return r, time.time() - t
def d(v):
    return None if v is None or v >= 32767 or v <= 0 else (dt.date(1970, 1, 1) + dt.timedelta(days=int(v))).isoformat()
r, s = get("MCD12Q2/bands"); print("bands", r.status_code, "%.2fs" % s, [b["band"] for b in r.json()["bands"]][:30])
out = {}
for name, (lon, lat) in FARMS.items():
    rows = {}
    for start, end in [("A2015001", "A2024001"), ("A2025001", "A2025001")]:  # ORNL caps ~10 dates/request
        for band in BANDS:
            r, s = get("MCD12Q2/subset", latitude=lat, longitude=lon, band=band, startDate=start, endDate=end,
                       kmAboveBelow=0, kmLeftRight=0)
            if r.status_code != 200:
                print(name, band, r.status_code, r.text[:200]); continue
            for sub in r.json()["subset"]:
                v = sub["data"][0]
                rows.setdefault(sub["calendar_date"][:4], {})[band] = v if band.startswith(("Num", "EVI", "QA")) else d(v)
    r, s = get("MCD12Q1/subset", latitude=lat, longitude=lon, band="LC_Type1", startDate="A2015001", endDate="A2024001", kmAboveBelow=0, kmLeftRight=0)
    lc = {x["calendar_date"][:4]: x["data"][0] for x in r.json().get("subset", [])} if r.ok else r.status_code
    out[name] = {"phenology": rows, "MCD12Q1_LC_Type1": lc}
    print("==", name, "LC_Type1:", lc)
    for y, b in sorted(rows.items()):
        print(y, "cycles", b.get("NumCycles"), "| c1", b.get("Greenup.Num_Modes_01"), b.get("Maturity.Num_Modes_01"), b.get("Senescence.Num_Modes_01"),
              "| c2", b.get("Greenup.Num_Modes_02"), b.get("Maturity.Num_Modes_02"), b.get("Senescence.Num_Modes_02"), "| QA", b.get("QA_Overall.Num_Modes_01"))
json.dump(out, open("sample_mcd12q2_3farms.json", "w"), indent=1)
