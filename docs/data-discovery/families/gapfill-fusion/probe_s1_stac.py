"""Count Sentinel-1 scenes over a farm on Planetary Computer STAC (keyless search).

Reports scenes per collection over the last 13 months and per year 2019-2026 to infer revisit
(S1B failed 2021-12-23; S1C entered operations 2025). No asset download.
"""
import time, collections, requests

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
PT = {"type": "Point", "coordinates": [-62.52, -16.86]}  # Estancia Los Tajibos

def search(coll, dt):
    feats, body, url = [], {"collections": [coll], "intersects": PT, "datetime": dt, "limit": 250}, STAC
    t = time.time()
    while True:
        r = requests.post(url, json=body, timeout=60)
        r.raise_for_status(); j = r.json(); feats += j["features"]
        nxt = [l for l in j.get("links", []) if l.get("rel") == "next"]
        if not nxt: break
        body = nxt[0].get("body", body); url = nxt[0]["href"]
    return feats, time.time() - t

for coll in ["sentinel-1-rtc", "sentinel-1-grd"]:
    f, dt = search(coll, "2025-10-01T00:00:00Z/2026-11-07T00:00:00Z")
    days = sorted({x["properties"]["datetime"][:10] for x in f})
    plat = collections.Counter(x["properties"].get("platform") for x in f)
    orbit = collections.Counter(x["properties"].get("sat:orbit_state") for x in f)
    gaps = [ (a, b) for a, b in zip(days, days[1:])]
    import datetime as D
    g = [(D.date.fromisoformat(b) - D.date.fromisoformat(a)).days for a, b in gaps]
    print(f"{coll}: {len(f)} items, {len(days)} distinct days, {dt:.1f}s, platforms={dict(plat)}, orbit={dict(orbit)}")
    if days:
        print(f"  first={days[0]} last={days[-1]} median gap={sorted(g)[len(g)//2] if g else None} max gap={max(g) if g else None}")
        print("  sample props:", {k: f[0]["properties"].get(k) for k in ("sar:polarizations", "sar:instrument_mode", "sat:relative_orbit", "s1:processing_level") })
        print("  assets:", list(f[0]["assets"])[:8])
f, dt = None, None
for yr in range(2019, 2027):
    f, dt = search("sentinel-1-rtc", f"{yr}-01-01T00:00:00Z/{yr}-12-31T23:59:59Z")
    days = {x["properties"]["datetime"][:10] for x in f}
    plat = collections.Counter(x["properties"].get("platform") for x in f)
    print(yr, "rtc distinct days:", len(days), dict(plat), f"{dt:.1f}s")
