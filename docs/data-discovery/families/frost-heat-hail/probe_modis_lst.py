# NOTE: ORNL serves no daily LST (MOD11A1/MYD11A1 'not found'; only 8-day MOD11A2/MYD11A2/MOD21A2/VNP21A2). Kept as a record of the 502/504 outage. See notes.md rows 13 and 9 (PC is the working daily path).
"""Probe ORNL DAAC MODIS/VIIRS Web Service (keyless REST) for LST day/night at a farm."""
import requests, time, json
B = "https://modis.ornl.gov/rst/api/v1/"
H = {"Accept": "application/json"}
lat, lon = -17.56, -62.68  # Agricola Pailon Norte (wheat)
def get(path, **p):
    t = time.time(); r = requests.get(B + path, params=p, headers=H, timeout=120); return r, round(time.time()-t, 2)
for prod in ["MOD11A1", "MYD11A1", "MOD11A2", "MOD21A1N", "VNP21A1N", "VNP21A1D"]:
    r, dt = get(f"{prod}/dates", latitude=lat, longitude=lon)
    try:
        ds = r.json()["dates"]; print(prod, "dates", r.status_code, dt, "n=", len(ds), "first=", ds[0]["calendar_date"], "last=", ds[-1]["calendar_date"])
    except Exception as e:
        print(prod, r.status_code, dt, r.text[:150])
r, dt = get("MOD11A1/bands"); print("MOD11A1 bands", r.status_code, [b["band"] for b in r.json()["bands"]])
# fetch subset for a cold-surge window: late June 2025 & recent; ORNL max 10 dates per call
out = {}
for prod, band in [("MYD11A1", "LST_Night_1km"), ("MOD11A1", "LST_Night_1km"), ("MOD11A1", "LST_Day_1km")]:
    r, dt = get(f"{prod}/subset", latitude=lat, longitude=lon, band=band, startDate="A2026290", endDate="A2026299", kmAboveBelow=0, kmLeftRight=0)
    j = r.json(); s = j.get("subset", [])
    vals = [(x["calendar_date"], x["data"][0] * j.get("scale", 0.02) if x["data"][0] not in (0,) else None) for x in s]
    print(prod, band, r.status_code, dt, "scale", j.get("scale"), [(d, round(v - 273.15, 1) if v else None) for d, v in vals])
    out[f"{prod}_{band}"] = j
json.dump(out, open("samples/ornl_modis_lst_subset.json", "w"))
