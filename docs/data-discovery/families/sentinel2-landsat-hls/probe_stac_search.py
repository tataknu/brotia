"""Probe 1: STAC search over a sample farm for the last 60 days on every candidate catalog.

No credentials used. Records HTTP status/latency, scene count, cloud %, latest date.
Run: .venv/bin/python probe_stac_search.py
"""
import json, time, datetime as dt
import requests

FARM = {"name": "Estancia Los Tajibos", "lon": -62.52, "lat": -16.86}
HALF = 0.005  # ~1.1 km square (~120 ha) around the point
BBOX = [FARM["lon"] - HALF, FARM["lat"] - HALF, FARM["lon"] + HALF, FARM["lat"] + HALF]
TODAY = dt.date(2026, 11, 6)
START = TODAY - dt.timedelta(days=60)
DT = f"{START.isoformat()}T00:00:00Z/{TODAY.isoformat()}T23:59:59Z"

CATALOGS = [
    ("PC sentinel-2-l2a", "https://planetarycomputer.microsoft.com/api/stac/v1/search", "sentinel-2-l2a"),
    ("PC landsat-c2-l2", "https://planetarycomputer.microsoft.com/api/stac/v1/search", "landsat-c2-l2"),
    ("PC hls2-l30", "https://planetarycomputer.microsoft.com/api/stac/v1/search", "hls2-l30"),
    ("PC hls2-s30", "https://planetarycomputer.microsoft.com/api/stac/v1/search", "hls2-s30"),
    ("EarthSearch sentinel-2-l2a", "https://earth-search.aws.element84.com/v1/search", "sentinel-2-l2a"),
    ("EarthSearch sentinel-2-c1-l2a", "https://earth-search.aws.element84.com/v1/search", "sentinel-2-c1-l2a"),
    ("EarthSearch landsat-c2-l2", "https://earth-search.aws.element84.com/v1/search", "landsat-c2-l2"),
    ("CDSE sentinel-2-l2a", "https://stac.dataspace.copernicus.eu/v1/search", "sentinel-2-l2a"),
    ("CMR-STAC LPCLOUD HLSL30_2.0", "https://cmr.earthdata.nasa.gov/stac/LPCLOUD/search", "HLSL30_2.0"),
    ("CMR-STAC LPCLOUD HLSS30_2.0", "https://cmr.earthdata.nasa.gov/stac/LPCLOUD/search", "HLSS30_2.0"),
    ("USGS landsatlook landsat-c2l2-sr", "https://landsatlook.usgs.gov/stac-server/search", "landsat-c2l2-sr"),
]


def search(url, coll):
    body = {"collections": [coll], "bbox": BBOX, "datetime": DT, "limit": 100}
    t = time.time()
    r = requests.post(url, json=body, timeout=60)
    lat = time.time() - t
    out = {"status": r.status_code, "latency_s": round(lat, 2)}
    if r.status_code != 200:
        # CMR-STAC also supports GET
        t = time.time()
        r = requests.get(url, params={"collections": coll, "bbox": ",".join(map(str, BBOX)), "datetime": DT, "limit": 100}, timeout=60)
        out.update({"get_status": r.status_code, "get_latency_s": round(time.time() - t, 2)})
        if r.status_code != 200:
            out["excerpt"] = r.text[:200]
            return out
    js = r.json()
    feats = js.get("features", [])
    clouds = [f["properties"].get("eo:cloud_cover") for f in feats]
    dates = sorted(f["properties"].get("datetime", "")[:10] for f in feats)
    out.update({
        "n_items": len(feats),
        "matched": js.get("numberMatched") or js.get("context", {}).get("matched"),
        "latest": dates[-1] if dates else None,
        "earliest_in_window": dates[0] if dates else None,
        "cloud_cover": [round(c, 1) if isinstance(c, (int, float)) else c for c in clouds],
        "first_id": feats[0]["id"] if feats else None,
        "tiles": sorted({f["properties"].get("s2:mgrs_tile") or f["properties"].get("grid:code") or f["properties"].get("landsat:wrs_path", "") for f in feats}),
        "asset_keys": sorted(feats[0]["assets"].keys())[:40] if feats else [],
        "sample_href": next(iter([a["href"] for k, a in feats[0]["assets"].items() if k in ("B04", "red", "B4", "B04_10m")]), None) if feats else None,
    })
    return out


def history_start(url, coll):
    body = {"collections": [coll], "bbox": BBOX, "limit": 1, "sortby": [{"field": "properties.datetime", "direction": "asc"}]}
    try:
        r = requests.post(url, json=body, timeout=60)
        if r.status_code == 200 and r.json().get("features"):
            return r.json()["features"][0]["properties"]["datetime"][:10]
        return f"sortby unsupported ({r.status_code})"
    except Exception as e:
        return f"err {e}"


if __name__ == "__main__":
    res = {}
    for name, url, coll in CATALOGS:
        try:
            res[name] = search(url, coll)
            res[name]["history_start_at_farm"] = history_start(url, coll)
        except Exception as e:
            res[name] = {"error": repr(e)}
        print(name, json.dumps({k: v for k, v in res[name].items() if k not in ("asset_keys",)}, default=str))
    json.dump({"farm": FARM, "bbox": BBOX, "datetime": DT, "results": res},
              open(__file__.replace("probe_stac_search.py", "out_stac_search.json"), "w"), indent=1, default=str)
