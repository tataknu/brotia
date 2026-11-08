"""Fetch a multi-year single-pixel MOD13Q1 NDVI + pixel_reliability series from ORNL (keyless).

ORNL caps a subset call at 10 composites, so we chunk. km=0 -> 1 pixel (231.66 m).
Writes sample_mod13q1_<farm>_<start>_<end>.json (small) and prints per-call status/latency.
Usage: python fetch_ornl_series.py [farm_key] [start_yyyy-mm-dd]
"""
import json, sys, time, pathlib
import requests

HERE = pathlib.Path(__file__).parent
BASE = "https://modis.ornl.gov/rst/api/v1"
FARMS = {
    "tajibos": ("Estancia Los Tajibos", -62.52, -16.86),
    "warnes": ("Agricola Warnes Sur", -63.08, -17.56),
    "cuatrocanadas": ("Colonia Cuatro Canadas Lote 7", -62.47, -17.3),
}
BANDS = ["250m_16_days_NDVI", "250m_16_days_pixel_reliability", "250m_16_days_composite_day_of_the_year"]

def main():
    key = sys.argv[1] if len(sys.argv) > 1 else "tajibos"
    start = sys.argv[2] if len(sys.argv) > 2 else "2021-07-01"
    name, lon, lat = FARMS[key]
    # reuse the date list the modis family already downloaded (same tile h12v10)
    dates = json.load(open(HERE.parent / "modis-viirs-ndvi" / "MOD13Q1.dates.json"))["dates"]
    dates = [d for d in dates if d["calendar_date"] >= start]
    chunks = [dates[i:i + 10] for i in range(0, len(dates), 10)]
    out = {"farm": name, "lon": lon, "lat": lat, "product": "MOD13Q1.061", "source": BASE, "series": {}}
    log = []
    for band in BANDS:
        for ch in chunks:
            params = dict(latitude=lat, longitude=lon, band=band, startDate=ch[0]["modis_date"],
                          endDate=ch[-1]["modis_date"], kmAboveBelow=0, kmLeftRight=0)
            for attempt in range(3):
                t = time.time()
                r = requests.get(f"{BASE}/MOD13Q1/subset", params=params,
                                 headers={"Accept": "application/json"}, timeout=120)
                dt = time.time() - t
                if r.status_code == 200:
                    break
                time.sleep(3)
            log.append((band[13:], ch[0]["calendar_date"], ch[-1]["calendar_date"], r.status_code, round(dt, 2)))
            print(*log[-1], flush=True)
            if r.status_code != 200:
                print(r.text[:200]); continue
            for s in r.json()["subset"]:
                out["series"].setdefault(s["calendar_date"], {})[band[13:]] = s["data"][0]
            time.sleep(0.5)
    out["calls"] = log
    fn = HERE / f"sample_mod13q1_{key}_{dates[0]['calendar_date']}_{dates[-1]['calendar_date']}.json"
    json.dump(out, open(fn, "w"), indent=0)
    print("wrote", fn, len(out["series"]), "composites")

if __name__ == "__main__":
    main()
