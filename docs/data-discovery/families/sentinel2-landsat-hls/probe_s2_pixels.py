"""Probe 2: read SCL + B04/B08/B11 windows for one farm polygon, last 60 days,
from Planetary Computer (anonymous SAS signing) and Element84 Earth Search (no auth).
Computes SCL-masked mean NDVI/NDMI and per-scene runtime; compares raw DN across catalogs
(to settle the processing-baseline 04.00 +1000 DN offset question).
"""
import json, sys, time, datetime as dt
import requests
import planetary_computer as pc
from s2lib import s2_polygon_stats

FARM = {"name": "Estancia Los Tajibos", "lon": -62.52, "lat": -16.86}
HALF = 0.005
BBOX = [FARM["lon"] - HALF, FARM["lat"] - HALF, FARM["lon"] + HALF, FARM["lat"] + HALF]
DT = "2026-09-07T00:00:00Z/2026-11-06T23:59:59Z"


def search(url, coll):
    r = requests.post(url, json={"collections": [coll], "bbox": BBOX, "datetime": DT, "limit": 100}, timeout=60)
    r.raise_for_status()
    return sorted(r.json()["features"], key=lambda f: f["properties"]["datetime"])


def baseline_offset(props):
    pb = props.get("s2:processing_baseline", "00.00")
    return 1000 if float(pb) >= 4.0 else 0


rows = []
# --- Planetary Computer
feats = search("https://planetarycomputer.microsoft.com/api/stac/v1/search", "sentinel-2-l2a")
for f in feats:
    signed = pc.sign(f)  # anonymous SAS token, no account
    a = signed["assets"]
    hrefs = {"red": a["B04"]["href"], "nir": a["B08"]["href"], "swir16": a["B11"]["href"], "scl": a["SCL"]["href"]}
    try:
        st = s2_polygon_stats(hrefs, BBOX, dn_offset=baseline_offset(f["properties"]))
    except Exception as e:
        st = {"error": repr(e)[:200]}
    row = {"src": "PC", "date": f["properties"]["datetime"][:10], "id": f["id"], "scene_cloud": f["properties"].get("eo:cloud_cover"),
           "pb": f["properties"].get("s2:processing_baseline"), **st}
    rows.append(row); print(json.dumps({k: v for k, v in row.items() if k != "scl_counts"})); sys.stdout.flush()

# --- Earth Search collection-1 (offset-harmonised per raster:bands)
feats = search("https://earth-search.aws.element84.com/v1/search", "sentinel-2-c1-l2a")
for f in feats:
    a = f["assets"]
    hrefs = {"red": a["red"]["href"], "nir": a["nir"]["href"], "swir16": a["swir16"]["href"], "scl": a["scl"]["href"]}
    try:
        # c1-l2a: DN includes +1000 for all baselines; raster:bands says scale 1e-4 offset -0.1
        st = s2_polygon_stats(hrefs, BBOX, dn_offset=1000)
    except Exception as e:
        st = {"error": repr(e)[:200]}
    row = {"src": "ES-c1", "date": f["properties"]["datetime"][:10], "id": f["id"], "scene_cloud": f["properties"].get("eo:cloud_cover"), **st}
    rows.append(row); print(json.dumps({k: v for k, v in row.items() if k != "scl_counts"})); sys.stdout.flush()

# --- Earth Search legacy sentinel-2-l2a: 3 scenes, DN comparison only
feats = [f for f in search("https://earth-search.aws.element84.com/v1/search", "sentinel-2-l2a") if f["properties"]["eo:cloud_cover"] < 40][:3]
for f in feats:
    a = f["assets"]
    hrefs = {"red": a["red"]["href"], "nir": a["nir"]["href"], "swir16": a["swir16"]["href"], "scl": a["scl"]["href"]}
    try:
        st = s2_polygon_stats(hrefs, BBOX, dn_offset=0)
    except Exception as e:
        st = {"error": repr(e)[:200]}
    row = {"src": "ES-legacy(dn_offset=0)", "date": f["properties"]["datetime"][:10], "id": f["id"],
           "boa_offset_applied": f["properties"].get("earthsearch:boa_offset_applied"), **st}
    rows.append(row); print(json.dumps({k: v for k, v in row.items() if k != "scl_counts"})); sys.stdout.flush()

json.dump(rows, open(__file__.replace("probe_s2_pixels.py", "out_s2_pixels.json"), "w"), indent=1)
