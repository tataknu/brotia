"""Probe: ESA WorldCover 2021 (10 m) land cover inside each 50 ha test polygon, via PC STAC + data API (no auth).
Purpose: check whether the given test coordinates actually sit on cropland/orchards, and how a global
land-cover map labels Chilean orchards (tree cover vs cropland)."""
import json, time, requests
from pystac_client import Client
from sites import SITES, poly
WC = {10: "tree", 20: "shrub", 30: "grass", 40: "cropland", 50: "built", 60: "bare", 70: "snow", 80: "water", 90: "wetland", 95: "mangrove", 100: "moss"}
cat = Client.open("https://planetarycomputer.microsoft.com/api/stac/v1")
STATS = "https://planetarycomputer.microsoft.com/api/data/v1/item/statistics"
out = {}
for name, crop, lon, lat in SITES:
    g = poly(lon, lat)
    items = list(cat.search(collections=["esa-worldcover"], intersects=g, max_items=10).items())
    it = [i for i in items if "2021" in i.id] or items
    it = it[0]
    t = time.time()
    r = requests.post(STATS, params={"collection": "esa-worldcover", "item": it.id, "assets": "map", "categorical": "true", "max_size": 1024},
                      json={"type": "Feature", "properties": {}, "geometry": g}, timeout=60)
    dt = round(time.time() - t, 2)
    if r.status_code != 200:
        out[name] = {"status": r.status_code, "err": r.text[:200]}; print(name, out[name]); continue
    h = r.json()["properties"]["statistics"]["map_b1"]["histogram"]
    tot = sum(h[0])
    frac = {WC.get(int(v), str(v)): round(c / tot, 2) for c, v in zip(h[0], h[1]) if c}
    out[name] = {"crop": crop, "item": it.id, "status": 200, "s": dt, "frac": dict(sorted(frac.items(), key=lambda x: -x[1]))}
    print(name, crop, out[name]["frac"], dt)
json.dump(out, open("out_worldcover.json", "w"), indent=1)
