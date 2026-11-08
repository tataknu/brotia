"""Probe: Sentinel-2 L2A (Planetary Computer, no auth) clear-sky availability and SCL-masked NDVI/NDMI
over a 50 ha square for a Chilean site, 2021-11-01 .. 2026-11-06.
One server-side call per item (PC data API / TiTiler statistics, 4 expressions -> 4 bands on the same 10 m grid):
  b1 clear mask (SCL in 4,5,6), b2 NDVI*clear, b3 NDMI*clear, b4 data mask (SCL>0).
masked mean = sum(b2)/sum(b1). DN offset: -1000 per band when s2:processing_baseline >= 04.00.
Dedup: one record per acquisition date (keep the item with most clear pixels).
Usage: python probe_s2_chile.py <site_key> <lon> <lat> | <site_key> <field.geojson>   -> out_s2_<site_key>.json"""
import sys, json, time, collections, datetime as dt, concurrent.futures as cf
import requests
from pystac_client import Client
from sites import poly
key = sys.argv[1]
if sys.argv[2].endswith(".geojson"):  # real field polygon (e.g. CIREN catastro parcel)
    g = json.load(open(sys.argv[2]))["geometry"]
    xs = [p[0] for p in g["coordinates"][0]]; ys = [p[1] for p in g["coordinates"][0]]
    lon, lat = sum(xs) / len(xs), sum(ys) / len(ys)
else:
    lon, lat = float(sys.argv[2]), float(sys.argv[3]); g = None
START, END = "2021-11-01", "2026-11-06"
STATS = "https://planetarycomputer.microsoft.com/api/data/v1/item/statistics"
C = "((SCL==4)|(SCL==5)|(SCL==6))"
def expr(baseline):
    o = 2000 if baseline >= "04.00" else 0
    return (f"where({C},1,0);where({C},(B08-B04)/(B08+B04-{o}),0);"
            f"where({C},(B08-B11)/(B08+B11-{o}),0);where(SCL>0,1,0)")
g = g or poly(lon, lat)
cat = Client.open("https://planetarycomputer.microsoft.com/api/stac/v1")
t0 = time.time()
items = list(cat.search(collections=["sentinel-2-l2a"], intersects=g, datetime=f"{START}/{END}", max_items=5000).items())
t_search = round(time.time() - t0, 1)
def stats(it):
    for a in range(4):
        try:
            r = requests.post(STATS, params={"collection": "sentinel-2-l2a", "item": it.id, "expression": expr(it.properties.get("s2:processing_baseline", "00")),
                                             "asset_as_band": "true", "max_size": 1024}, json={"type": "Feature", "properties": {}, "geometry": g}, timeout=90)
            if r.status_code == 200:
                v = list(r.json()["properties"]["statistics"].values())
                return {"clear": v[0]["sum"], "ndvi_sum": v[1]["sum"], "ndmi_sum": v[2]["sum"], "data": v[3]["sum"], "n": v[0]["count"]}
            last = r.status_code
        except Exception as e:
            last = repr(e)[:60]
        time.sleep(2 * (a + 1))
    return {"error": last}
t0 = time.time()
with cf.ThreadPoolExecutor(6) as ex:
    res = list(ex.map(stats, items))
t_stats = round(time.time() - t0, 1)
per_date, errors = {}, 0
for it, s in zip(items, res):
    if "error" in s: errors += 1; continue
    if s["data"] < 0.5 * s["n"]: continue
    d = it.datetime.date().isoformat()
    cfrac = s["clear"] / s["data"]
    rec = {"clear_frac": round(cfrac, 3), "tile": it.properties.get("s2:mgrs_tile"), "tile_cc": round(it.properties.get("eo:cloud_cover", -1), 1),
           "baseline": it.properties.get("s2:processing_baseline")}
    if s["clear"] > 0:
        rec["ndvi"] = round(s["ndvi_sum"] / s["clear"], 4); rec["ndmi"] = round(s["ndmi_sum"] / s["clear"], 4)
    if d not in per_date or rec["clear_frac"] > per_date[d]["clear_frac"]:
        per_date[d] = rec
monthly = collections.OrderedDict()
for d in sorted(per_date):
    r = per_date[d]; m = monthly.setdefault(d[:7], {"dates": 0, "clear50": 0, "clear80": 0, "ndvi80": []})
    m["dates"] += 1; m["clear50"] += r["clear_frac"] >= 0.5; m["clear80"] += r["clear_frac"] >= 0.8
    if r["clear_frac"] >= 0.8: m["ndvi80"].append(r["ndvi"])
for m in monthly.values():
    v = sorted(m.pop("ndvi80")); m["ndvi_median80"] = v[len(v) // 2] if v else None
cd = [d for d in sorted(per_date) if per_date[d]["clear_frac"] >= 0.5]
gaps = sorted(((dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days, a, b) for a, b in zip(cd, cd[1:]))[::-1][:5]
# calendar-month climatology of usable observations
clim = collections.defaultdict(list)
for m, v in monthly.items():
    if "2021-11" <= m <= "2026-10": clim[int(m[5:])].append(v["clear50"])
out = {"site": key, "lonlat": [lon, lat], "window": [START, END], "n_items": len(items), "unique_dates": len(per_date), "errors": errors,
       "tiles": dict(collections.Counter(i.properties.get("s2:mgrs_tile") for i in items)), "search_s": t_search, "stats_s": t_stats,
       "first_item": min(i.datetime for i in items).date().isoformat(), "last_item": max(i.datetime for i in items).date().isoformat(),
       "clear50_per_calendar_month_mean": {k: round(sum(v) / len(v), 1) for k, v in sorted(clim.items())},
       "max_gaps_days": gaps, "monthly": monthly, "per_date": per_date}
json.dump(out, open(f"out_s2_{key}.json", "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k not in ("monthly", "per_date")}))
