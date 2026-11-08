"""Keyless availability/latency probes for compute & access platforms.

Run: /Users/cristian/Documents/projects/energhack/.venv/bin/python probe_platforms.py
Writes probe_results.json next to this file. No credentials are used anywhere.
"""
import json
import time
from pathlib import Path

import requests

OUT = Path(__file__).with_name("probe_results.json")
FARM = ("Estancia Los Tajibos", -62.52, -16.86)
FARM2 = ("Arrocera Mineros", -63.29, -17.20)
LON, LAT = FARM[1], FARM[2]
BBOX = [LON - 0.01, LAT - 0.01, LON + 0.01, LAT + 0.01]
UA = {"User-Agent": "energhack-data-discovery/0.1 (hackathon research)"}

results = {}


def probe(key, method, url, excerpt=None, **kw):
    t0 = time.time()
    try:
        r = requests.request(method, url, headers={**UA, **kw.pop("headers", {})}, timeout=60, **kw)
        dt = round(time.time() - t0, 2)
        rec = {"url": url, "status": r.status_code, "latency_s": dt, "bytes": len(r.content)}
        try:
            body = r.json()
        except Exception:
            body = r.text
        if excerpt:
            try:
                rec["excerpt"] = excerpt(body)
            except Exception as e:  # noqa
                rec["excerpt_error"] = repr(e)[:200]
        else:
            rec["excerpt"] = (body if isinstance(body, str) else json.dumps(body))[:300]
    except Exception as e:
        rec = {"url": url, "error": repr(e)[:300], "latency_s": round(time.time() - t0, 2)}
    results[key] = rec
    print(key, json.dumps(rec)[:600])
    return rec


def stac_items(body):
    feats = body.get("features", [])
    return {
        "n": len(feats),
        "ids": [f["id"] for f in feats[:3]],
        "datetimes": [f["properties"].get("datetime") for f in feats[:3]],
        "cloud": [f["properties"].get("eo:cloud_cover") for f in feats[:3]],
        "asset_sample": (list(feats[0]["assets"].keys())[:6] if feats else None),
        "href_sample": (feats[0]["assets"].get("B08", feats[0]["assets"].get("nir", {})).get("href", "")[:120] if feats else None),
    }


def stac_search(url, collection, dt, limit=3, sortdesc=True, extra=None):
    body = {"collections": [collection], "bbox": BBOX, "datetime": dt, "limit": limit}
    if sortdesc:
        body["sortby"] = [{"field": "properties.datetime", "direction": "desc"}]
    if extra:
        body.update(extra)
    return body


# ---------------- Microsoft Planetary Computer ----------------
PC = "https://planetarycomputer.microsoft.com/api/stac/v1"
probe("pc_landing", "GET", PC, lambda b: {"title": b.get("title"), "conformsTo_n": len(b.get("conformsTo", []))})
probe("pc_collections_count", "GET", PC + "/collections",
      lambda b: {"n": len(b["collections"]),
                 "has": {c: any(x["id"] == c for x in b["collections"]) for c in
                         ["sentinel-2-l2a", "modis-13Q1-061", "modis-09A1-061", "era5-pds", "landsat-c2-l2",
                          "sentinel-1-rtc", "esa-worldcover", "jrc-gsw", "nasadem", "cop-dem-glo-30",
                          "terraclimate", "daymet-daily-na", "io-lulc-annual-v02", "modis-11A1-061",
                          "modis-64A1-061", "chloris-biomass", "gpm-imerg-hhr", "hls2-l30", "hls2-s30",
                          "noaa-cdr-sea-surface-temperature-whoi"]}})
probe("pc_s2_latest", "POST", PC + "/search", stac_items,
      json=stac_search(PC, "sentinel-2-l2a", "2026-09-01/2026-11-07"))
probe("pc_s2_earliest", "POST", PC + "/search", stac_items,
      json={"collections": ["sentinel-2-l2a"], "bbox": BBOX, "limit": 1,
            "sortby": [{"field": "properties.datetime", "direction": "asc"}]})
probe("pc_modis13q1_latest", "POST", PC + "/search", stac_items,
      json=stac_search(PC, "modis-13Q1-061", "2026-06-01/2026-11-07"))
probe("pc_modis13q1_earliest", "POST", PC + "/search", stac_items,
      json={"collections": ["modis-13Q1-061"], "bbox": BBOX, "limit": 1,
            "sortby": [{"field": "properties.datetime", "direction": "asc"}]})
probe("pc_era5_collection", "GET", PC + "/collections/era5-pds",
      lambda b: {"extent": b.get("extent", {}).get("temporal"), "deprecated": b.get("deprecated"),
                 "msft:short_description": b.get("msft:short_description")})
probe("pc_sas_token_s2", "GET", "https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-2-l2a",
      lambda b: {"has_token": bool(b.get("token")), "expiry": b.get("msft:expiry")})
probe("pc_data_api_conformance", "GET", "https://planetarycomputer.microsoft.com/api/data/v1/", lambda b: str(b)[:200])

# ---------------- Element84 Earth Search (AWS) ----------------
ES = "https://earth-search.aws.element84.com/v1"
probe("es_landing", "GET", ES, lambda b: {"title": b.get("title"), "stac_version": b.get("stac_version")})
probe("es_collections", "GET", ES + "/collections", lambda b: [c["id"] for c in b["collections"]])
probe("es_s2_latest", "POST", ES + "/search", stac_items,
      json=stac_search(ES, "sentinel-2-l2a", "2026-09-01/2026-11-07"))

# ---------------- Copernicus Data Space Ecosystem ----------------
probe("cdse_stac_landing", "GET", "https://stac.dataspace.copernicus.eu/v1/",
      lambda b: {"title": b.get("title"), "stac_version": b.get("stac_version")})
probe("cdse_stac_s2_latest", "POST", "https://stac.dataspace.copernicus.eu/v1/search", stac_items,
      json={"collections": ["sentinel-2-l2a"], "bbox": BBOX, "datetime": "2026-09-01T00:00:00Z/2026-11-07T23:59:59Z", "limit": 3,
            "sortby": [{"field": "properties.datetime", "direction": "desc"}]})
probe("cdse_odata_s2", "GET",
      "https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$filter=Collection/Name%20eq%20'SENTINEL-2'%20and%20"
      f"OData.CSC.Intersects(area=geography'SRID=4326;POINT({LON} {LAT})')%20and%20ContentDate/Start%20gt%202026-10-01T00:00:00.000Z"
      "&$orderby=ContentDate/Start%20desc&$top=3",
      lambda b: [(p["Name"], p["ContentDate"]["Start"]) for p in b.get("value", [])])
probe("cdse_openeo_caps", "GET", "https://openeo.dataspace.copernicus.eu/openeo/1.2/",
      lambda b: {"api_version": b.get("api_version"), "backend_version": b.get("backend_version"),
                 "title": b.get("title"), "n_endpoints": len(b.get("endpoints", []))})
probe("cdse_openeo_collections", "GET", "https://openeo.dataspace.copernicus.eu/openeo/1.2/collections",
      lambda b: {"n": len(b["collections"]), "ids": [c["id"] for c in b["collections"]][:40]})
probe("cdse_openeo_jobs_noauth", "GET", "https://openeo.dataspace.copernicus.eu/openeo/1.2/jobs", lambda b: str(b)[:200])

# ---------------- NASA Earthdata ----------------
probe("cmr_mod13q1_latest", "GET",
      "https://cmr.earthdata.nasa.gov/search/granules.json",
      lambda b: [(e["title"], e["time_start"]) for e in b["feed"]["entry"]],
      params={"short_name": "MOD13Q1", "version": "061", "point": f"{LON},{LAT}", "sort_key": "-start_date", "page_size": 3})
probe("cmr_mod13q1_earliest", "GET",
      "https://cmr.earthdata.nasa.gov/search/granules.json",
      lambda b: [(e["title"], e["time_start"]) for e in b["feed"]["entry"]],
      params={"short_name": "MOD13Q1", "version": "061", "point": f"{LON},{LAT}", "sort_key": "start_date", "page_size": 1})
probe("cmr_vnp13a1_latest", "GET",
      "https://cmr.earthdata.nasa.gov/search/granules.json",
      lambda b: [(e["title"], e["time_start"]) for e in b["feed"]["entry"]],
      params={"short_name": "VNP13A1", "point": f"{LON},{LAT}", "sort_key": "-start_date", "page_size": 2})
probe("cmr_smap_l4_latest", "GET",
      "https://cmr.earthdata.nasa.gov/search/granules.json",
      lambda b: [(e["title"], e["time_start"]) for e in b["feed"]["entry"]],
      params={"short_name": "SPL4SMGP", "sort_key": "-start_date", "page_size": 2})
probe("cmr_imerg_late_latest", "GET",
      "https://cmr.earthdata.nasa.gov/search/granules.json",
      lambda b: [(e["title"], e["time_start"]) for e in b["feed"]["entry"]],
      params={"short_name": "GPM_3IMERGDL", "sort_key": "-start_date", "page_size": 2})
probe("cmr_stac_lpcloud", "GET", "https://cmr.earthdata.nasa.gov/stac/LPCLOUD",
      lambda b: {"title": b.get("title"), "n_links": len(b.get("links", []))})
probe("appeears_products", "GET", "https://appeears.earthdatacloud.nasa.gov/api/product",
      lambda b: {"n": len(b), "has_MOD13Q1.061": any(p.get("ProductAndVersion") == "MOD13Q1.061" for p in b),
                 "has_SPL4SMGP": [p["ProductAndVersion"] for p in b if "SPL4" in p.get("ProductAndVersion", "")][:3]})
probe("appeears_task_noauth", "GET", "https://appeears.earthdatacloud.nasa.gov/api/task", lambda b: str(b)[:200])
probe("harmony_root", "GET", "https://harmony.earthdata.nasa.gov/versions", lambda b: str(b)[:200])
probe("ornl_modis_subset", "GET",
      "https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset",
      lambda b: {"n": len(b.get("subset", [])),
                 "first": (b["subset"][0]["calendar_date"], b["subset"][0]["band"], b["subset"][0]["data"][:1]) if b.get("subset") else None,
                 "last": (b["subset"][-1]["calendar_date"], b["subset"][-1]["band"], b["subset"][-1]["data"][:1]) if b.get("subset") else None},
      params={"latitude": LAT, "longitude": LON, "band": "250m_16_days_NDVI", "startDate": "A2026241", "endDate": "A2026310",
              "kmAboveBelow": 0, "kmLeftRight": 0},
      headers={"Accept": "application/json"})
probe("ornl_modis_dates", "GET", "https://modis.ornl.gov/rst/api/v1/MOD13Q1/dates",
      lambda b: {"n": len(b["dates"]), "first": b["dates"][0], "last": b["dates"][-1]},
      params={"latitude": LAT, "longitude": LON}, headers={"Accept": "application/json"})

# ---------------- Open-Meteo ----------------
probe("openmeteo_archive_era5", "GET", "https://archive-api.open-meteo.com/v1/archive",
      lambda b: {"days": len(b["daily"]["time"]), "first": b["daily"]["time"][0], "last": b["daily"]["time"][-1],
                 "last_nonnull_precip": max([t for t, v in zip(b["daily"]["time"], b["daily"]["precipitation_sum"]) if v is not None], default=None),
                 "sample": {k: b["daily"][k][-10] for k in b["daily"]}},
      params={"latitude": LAT, "longitude": LON, "start_date": "2026-10-01", "end_date": "2026-11-07",
              "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration,soil_moisture_28_to_100cm_mean",
              "models": "era5", "timezone": "America/La_Paz"})
probe("openmeteo_archive_1940", "GET", "https://archive-api.open-meteo.com/v1/archive",
      lambda b: {"first": b["daily"]["time"][0], "val": b["daily"]["precipitation_sum"][:3]},
      params={"latitude": LAT, "longitude": LON, "start_date": "1940-01-01", "end_date": "1940-01-03",
              "daily": "precipitation_sum", "models": "era5"})
probe("openmeteo_forecast_pastdays", "GET", "https://api.open-meteo.com/v1/forecast",
      lambda b: {"first": b["daily"]["time"][0], "last": b["daily"]["time"][-1],
                 "today": dict(zip(b["daily"].keys(), [b["daily"][k][7] for k in b["daily"]]))},
      params={"latitude": LAT, "longitude": LON, "past_days": 7, "forecast_days": 3,
              "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration",
              "timezone": "America/La_Paz"})
probe("openmeteo_customer_noauth", "GET", "https://customer-archive-api.open-meteo.com/v1/archive",
      lambda b: str(b)[:200],
      params={"latitude": LAT, "longitude": LON, "start_date": "2026-10-01", "end_date": "2026-10-02", "daily": "precipitation_sum"})

# ---------------- NASA POWER ----------------
probe("power_daily_recent", "GET", "https://power.larc.nasa.gov/api/temporal/daily/point",
      lambda b: (lambda p: {k: (min(v), max(v), list(v.items())[-3:]) for k, v in
                            {kk: {d: x for d, x in vv.items() if x != -999} for kk, vv in p.items()}.items()})(b["properties"]["parameter"]),
      params={"parameters": "PRECTOTCORR,T2M_MAX,T2M_MIN,GWETROOT", "community": "AG", "longitude": LON, "latitude": LAT,
              "start": "20261001", "end": "20261107", "format": "JSON"})
probe("power_daily_1981", "GET", "https://power.larc.nasa.gov/api/temporal/daily/point",
      lambda b: {k: list(v.items())[:2] for k, v in b["properties"]["parameter"].items()},
      params={"parameters": "PRECTOTCORR,T2M_MAX", "community": "AG", "longitude": LON, "latitude": LAT,
              "start": "19810101", "end": "19810103", "format": "JSON"})

# ---------------- SERVIR ClimateSERV ----------------
probe("climateserv_root", "GET", "https://climateserv.servirglobal.net/", lambda b: str(b)[:150])
probe("climateserv_datatypes", "GET", "https://climateserv.servirglobal.net/api/getClimateScenarioInfo/", lambda b: str(b)[:300])

# ---------------- Copernicus CDS / ECMWF ----------------
probe("cds_catalogue_era5", "GET",
      "https://cds.climate.copernicus.eu/api/catalogue/v1/collections/reanalysis-era5-single-levels",
      lambda b: {"title": b.get("title"), "extent": b.get("extent", {}).get("temporal"), "licence_links": [l.get("title") for l in b.get("links", []) if l.get("rel") == "license"]})
probe("cds_catalogue_era5land", "GET",
      "https://cds.climate.copernicus.eu/api/catalogue/v1/collections/reanalysis-era5-land",
      lambda b: {"title": b.get("title"), "extent": b.get("extent", {}).get("temporal")})
probe("cds_retrieve_noauth", "GET", "https://cds.climate.copernicus.eu/api/retrieve/v1/jobs", lambda b: str(b)[:200])

# ---------------- Google: ARCO-ERA5 on GCS (public, keyless) and GEE catalog ----------------
probe("gcs_arco_era5_zmetadata", "GET",
      "https://storage.googleapis.com/gcp-public-data-arco-era5/ar/full_37-1h-0p25deg-chunk-1.zarr-v3/.zmetadata",
      lambda b: {"attrs": {k: v for k, v in b["metadata"][".zattrs"].items() if "valid" in k or "time" in k} if isinstance(b, dict) else str(b)[:200],
                 "n_keys": len(b.get("metadata", {}))})
probe("gee_stac_catalog", "GET", "https://storage.googleapis.com/earthengine-stac/catalog/catalog.json",
      lambda b: {"title": b.get("title"), "n_links": len(b.get("links", []))})
probe("gee_rest_noauth", "GET", "https://earthengine.googleapis.com/v1/projects/earthengine-public/assets/MODIS/061/MOD13Q1",
      lambda b: str(b)[:200])

# ---------------- AWS Open Data ----------------
probe("aws_sentinel_cogs_list", "GET", "https://sentinel-cogs.s3.us-west-2.amazonaws.com/?list-type=2&prefix=sentinel-s2-l2a-cogs/20/K/QA/2026/10/&max-keys=5",
      lambda b: b[:400])
probe("aws_nsf_ncar_era5_list", "GET", "https://nsf-ncar-era5.s3.amazonaws.com/?list-type=2&prefix=e5.oper.an.sfc/2026&max-keys=3&delimiter=/",
      lambda b: b[:400])
probe("aws_registry_chirps", "GET", "https://raw.githubusercontent.com/awslabs/open-data-registry/main/datasets/chirps.yaml",
      lambda b: b[:300])

# ---------------- IRI Data Library (keyless CHIRPS point extraction) ----------------
probe("iri_chirps_point", "GET",
      f"https://iridl.ldeo.columbia.edu/SOURCES/.UCSB/.CHIRPS/.v2p0/.daily-improved/.global/.0p05/.prcp/X/{LON}/VALUE/Y/{LAT}/VALUE/T/(1%20Oct%202026)/(7%20Nov%202026)/RANGEEDGES/T+exch+table-+text+text+skipanyNaN+-table+.csv",
      lambda b: b[-300:])

OUT.write_text(json.dumps(results, indent=1))
print("saved", OUT)
