"""Probe ORNL DAAC MODIS/VIIRS Global Subset REST API (no auth).

Usage: ../../../../.venv/bin/python probe_ornl.py
Fetches a 1 km window (kmAboveBelow=1, kmLeftRight=1 -> 9x9 px at 250 m) of NDVI,
pixel reliability and VI Quality for a sample farm, latest N composites, and writes a
small JSON sample. Also times the calls.
"""
import json
import sys
import time

import requests

BASE = "https://modis.ornl.gov/rst/api/v1"
HDR = {"Accept": "application/json"}
FARM = {"name": "Estancia Los Tajibos", "lon": -62.52, "lat": -16.86}


def get(path, **params):
    t = time.time()
    r = requests.get(f"{BASE}/{path}", params=params, headers=HDR, timeout=120)
    dt = time.time() - t
    return r, dt


def subset(product, band, start, end, km=1):
    r, dt = get(
        f"{product}/subset",
        latitude=FARM["lat"], longitude=FARM["lon"], band=band,
        startDate=start, endDate=end, kmAboveBelow=km, kmLeftRight=km,
    )
    return r, dt


def main():
    product = sys.argv[1] if len(sys.argv) > 1 else "MOD13Q1"
    nlast = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    r, dt = get(f"{product}/dates", latitude=FARM["lat"], longitude=FARM["lon"])
    dates = r.json()["dates"]
    print(f"dates: {r.status_code} {dt:.2f}s n={len(dates)} first={dates[0]} last={dates[-1]}")
    last = dates[-nlast:]
    start, end = last[0]["modis_date"], last[-1]["modis_date"]
    out = {}
    pre = "250m_16_days_" if product.endswith("Q1") and product.startswith("M") else ""
    bands = {
        "MOD13Q1": ["250m_16_days_NDVI", "250m_16_days_pixel_reliability", "250m_16_days_VI_Quality",
                    "250m_16_days_composite_day_of_the_year"],
        "MYD13Q1": ["250m_16_days_NDVI", "250m_16_days_pixel_reliability"],
        "VNP13A1": ["500_m_16_days_NDVI", "500_m_16_days_pixel_reliability"],
    }[product]
    for b in bands:
        r, dt = subset(product, b, start, end)
        j = r.json() if r.status_code == 200 else {"error": r.text[:300]}
        print(f"subset {b}: {r.status_code} {dt:.2f}s")
        if r.status_code != 200:
            print(j)
            continue
        print("  header:", {k: j[k] for k in ("xllcorner", "yllcorner", "cellsize", "nrows", "ncols", "band")})
        for s in j["subset"]:
            print("  ", s["calendar_date"], "n=", len(s["data"]), "first9=", s["data"][:9])
        out[b] = j
    with open(f"sample_{product}_subset.json", "w") as f:
        json.dump(out, f)


if __name__ == "__main__":
    main()
