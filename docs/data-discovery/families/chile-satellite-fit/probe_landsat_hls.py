"""Probe: 30 m long-baseline options at the Requinoa cherry field and the Temuco cereal site (PC STAC, no auth).
Counts items per platform-era and per calendar month with scene cloud < 30 %, history start, latest item.
Also: one server-side Landsat NDVI over the cherry field (QA_PIXEL clear-bit mask) to prove the access path.
Output: out_landsat_hls.json"""
import json, time, collections, requests
from pystac_client import Client
cat = Client.open("https://planetarycomputer.microsoft.com/api/stac/v1")
PTS = {"requinoa_cherry_field": (-70.7947, -34.3178), "temuco_cereal": (-72.6047, -38.6973)}
out = {}
for name, (lon, lat) in PTS.items():
    pt = {"type": "Point", "coordinates": [lon, lat]}
    rec = {}
    for col, rng in [("landsat-c2-l2", "1984-01-01/2026-11-07"), ("hls2-s30", "2015-01-01/2026-11-07"), ("hls2-l30", "2013-01-01/2026-11-07")]:
        t = time.time()
        its = list(cat.search(collections=[col], intersects=pt, datetime=rng, max_items=5000).items())
        s = round(time.time() - t, 1)
        dates = sorted(i.datetime.date().isoformat() for i in its)
        plat = collections.Counter(i.properties.get("platform") for i in its)
        clear_year = collections.Counter(i.datetime.year for i in its if (i.properties.get("eo:cloud_cover") or 100) < 30)
        cal = collections.defaultdict(int); yrs = set()
        for i in its:
            if 2000 <= i.datetime.year <= 2025 and (i.properties.get("eo:cloud_cover") or 100) < 30:
                cal[i.datetime.month] += 1; yrs.add(i.datetime.year)
        rec[col] = {"n_items": len(its), "search_s": s, "first": dates[0] if dates else None, "last": dates[-1] if dates else None,
                    "platforms": dict(plat), "lt30cc_per_year": dict(sorted(clear_year.items())),
                    "lt30cc_per_calendar_month_2000_2025_mean": {m: round(c / max(1, len(yrs)), 1) for m, c in sorted(cal.items())}}
        print(name, col, {k: v for k, v in rec[col].items() if k not in ("lt30cc_per_year",)})
    out[name] = rec
# one Landsat NDVI over the cherry field, server-side (QA_PIXEL bit 6 = clear; SR scale 2.75e-5, offset -0.2)
f = json.load(open("field_requinoa_cherry.geojson"))
its = list(cat.search(collections=["landsat-c2-l2"], intersects=f["geometry"], datetime="2026-01-01/2026-03-31", query={"eo:cloud_cover": {"lt": 10}}, max_items=3).items())
if its:
    it = its[0]
    ex = "where((qa_pixel/64)%2>=1,((nir08*0.0000275-0.2)-(red*0.0000275-0.2))/((nir08*0.0000275-0.2)+(red*0.0000275-0.2)),0);where((qa_pixel/64)%2>=1,1,0)"
    t = time.time()
    r = requests.post("https://planetarycomputer.microsoft.com/api/data/v1/item/statistics", params={"collection": "landsat-c2-l2", "item": it.id, "expression": ex,
                      "asset_as_band": "true", "max_size": 1024}, json=f, timeout=90)
    if r.status_code == 200:
        v = list(r.json()["properties"]["statistics"].values())
        out["landsat_field_ndvi_test"] = {"item": it.id, "http": 200, "s": round(time.time() - t, 2), "clear_px": v[1]["sum"], "ndvi": round(v[0]["sum"] / max(1, v[1]["sum"]), 3)}
    else:
        out["landsat_field_ndvi_test"] = {"item": it.id, "http": r.status_code, "err": r.text[:200]}
    print(out["landsat_field_ndvi_test"])
json.dump(out, open("out_landsat_hls.json", "w"), indent=1)
