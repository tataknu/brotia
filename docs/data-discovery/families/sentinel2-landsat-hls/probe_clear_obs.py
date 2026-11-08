"""Probe 5: how many clear Sentinel-2 observations per month does a farm polygon get?
24 months (2024-11 .. 2026-10), two farms in different MGRS tiles.
Per scene: SCL class histogram over the polygon via PC data API (server-side, no auth).
Clear frac = SCL in {4,5,6} / (pixels with SCL != 0). Dedup: one value per acquisition date (max).
"""
import json, time, collections, concurrent.futures as cf
import requests
from pystac_client import Client

FARMS = [("Estancia Los Tajibos", -62.52, -16.86), ("Arrocera Mineros", -63.29, -17.20)]
H = 0.005
STATS = "https://planetarycomputer.microsoft.com/api/data/v1/item/statistics"
cat = Client.open("https://planetarycomputer.microsoft.com/api/stac/v1")


def poly(lon, lat):
    return {"type": "Polygon", "coordinates": [[[lon-H, lat-H], [lon+H, lat-H], [lon+H, lat+H], [lon-H, lat+H], [lon-H, lat-H]]]}


def scl_hist(item_id, geom):
    for attempt in range(3):
        try:
            r = requests.post(STATS, params={"collection": "sentinel-2-l2a", "item": item_id, "assets": "SCL",
                                             "categorical": "true", "max_size": 1024},
                              json={"type": "Feature", "properties": {}, "geometry": geom}, timeout=60)
            if r.status_code == 200:
                h = r.json()["properties"]["statistics"]["SCL_b1"]["histogram"]
                return {int(v): int(c) for c, v in zip(h[0], h[1])}
            last = r.status_code
        except Exception as e:
            last = repr(e)[:80]
        time.sleep(2 * (attempt + 1))
    return {"error": last}


results = {}
for name, lon, lat in FARMS:
    g = poly(lon, lat)
    t0 = time.time()
    items = list(cat.search(collections=["sentinel-2-l2a"], intersects=g,
                            datetime="2024-11-01/2026-10-31", max_items=2000).items())
    t_search = time.time() - t0
    tiles = collections.Counter(i.properties.get("s2:mgrs_tile") for i in items)
    t0 = time.time()
    with cf.ThreadPoolExecutor(4) as ex:
        hists = list(ex.map(lambda it: scl_hist(it.id, g), items))
    t_stats = time.time() - t0
    per_date = {}
    errors = 0
    for it, h in zip(items, hists):
        d = it.datetime.date().isoformat()
        if "error" in h:
            errors += 1
            continue
        tot = sum(c for k, c in h.items() if k != 0)
        if tot == 0:
            continue  # polygon outside this granule's data footprint
        cf_ = sum(h.get(k, 0) for k in (4, 5, 6)) / tot
        rec = per_date.setdefault(d, {"clear_frac": 0, "scene_cloud": it.properties.get("eo:cloud_cover"), "n_items": 0})
        rec["n_items"] += 1
        if cf_ >= rec["clear_frac"]:
            rec["clear_frac"] = round(cf_, 3)
            rec["scene_cloud"] = it.properties.get("eo:cloud_cover")
    monthly = collections.OrderedDict()
    for d in sorted(per_date):
        m = d[:7]
        r = per_date[d]
        mm = monthly.setdefault(m, {"dates": 0, "clear50": 0, "clear80": 0, "tile_cc_lt30": 0})
        mm["dates"] += 1
        mm["clear50"] += r["clear_frac"] >= 0.5
        mm["clear80"] += r["clear_frac"] >= 0.8
        mm["tile_cc_lt30"] += (r["scene_cloud"] or 100) < 30
    # longest gap between clear (>=0.5) dates
    clear_dates = [d for d in sorted(per_date) if per_date[d]["clear_frac"] >= 0.5]
    import datetime as dt
    gaps = [((dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days, a, b) for a, b in zip(clear_dates, clear_dates[1:])]
    results[name] = {"lonlat": [lon, lat], "n_items": len(items), "tiles": dict(tiles), "unique_dates": len(per_date),
                     "stats_errors": errors, "search_s": round(t_search, 1), "stats_s": round(t_stats, 1),
                     "monthly": monthly, "max_gap_days": sorted(gaps, reverse=True)[:5], "per_date": per_date}
    print(name, json.dumps({k: v for k, v in results[name].items() if k not in ("per_date",)}, indent=0))

json.dump(results, open("out_clear_obs.json", "w"), indent=1)
