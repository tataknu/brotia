# Family: Compute and access platforms (`platforms-access`)

Probed on 2026-11-07 (UTC). Sample farm: **Estancia Los Tajibos**, at (-62.52, -16.86). It sits in Sentinel-2 tile 20KNG and MODIS tile h12v10.
No credentials were used anywhere. All raw results are next to this file:

- `probe_platforms.py` writes `probe_results.json`.
- `probe_round2.py` to `probe_round5.py` write `probe_results_round{2,3,4,5}.json`. Round 5 is the SCL cloud-screening recipe.

## TL;DR

1. **Hackathon path (keyless, verified today).** Everything below is verified live without credentials.

   | Need | Source | What the probe showed |
   |---|---|---|
   | Sentinel-2 + MODIS catalogue | **Planetary Computer (PC) STAC** | Responds in about 0.4 s. |
   | Server-side polygon statistics | **PC Data API** (`/item/statistics`, `/item/point`) | Mean NDVI/NDMI over a farm polygon in 0.5–0.6 s, with no rasterio and no local raster stack. |
   | Long weather baseline | **NASA POWER** | Daily since 1981, latest 2026-11-03. |
   | Recent weather | **Open-Meteo** | ERA5 since 1940; `best_match` gives values up to today. |
   | Rain | **ClimateSERV** CHIRPS jobs | Polygon average in about 6 s; data runs to 2026-09-30. |
   | Granule discovery and latency checks | **NASA CMR** | Keyless. |

2. **Most important correctness finding (affects other families).** PC `sentinel-2-l2a` items with processing baseline 04.00 or later (all data since 25 Jan 2022) carry the **+1000 DN BOA offset**. PC publishes **no** `raster:bands` offset metadata for it.
   - On the same pixels, raw NDVI is **0.539** and offset-corrected NDVI is **0.794**.
   - Earth Search `sentinel-2-c1-l2a` does publish it: `scale 0.0001, offset -0.1`.
   - If the wrapper misses this, the MODIS-to-S2 cross-calibration in ADR-0002 D4 is wrong. Every product image dated after Jan 2022 would also read about 0.25 NDVI low.
3. **Licence risks to flag to the team and Suyana:**
   - **Open-Meteo free API is non-commercial only.** The terms have no carve-out for prototypes or evaluation. Commercial use of the Historical API needs **API Professional, about €99/month**. Standard (€29/month) does not include historical data.
   - **Planetary Computer runs under "Supplemental Terms for Previews":** no SLA, possible egress rate limiting, and "not for anything mission critical to you or your business operations".
   - **Google Earth Engine:** a company counts as commercial. The noncommercial tiers became quota-limited on 2026-04-27.
4. **Licence-clean options for a Suyana product.** All of these are free with commercial use allowed:
   - NASA POWER, CMR, AppEEARS, Harmony and Earthdata (free instant Earthdata Login);
   - ClimateSERV;
   - Copernicus Data Space Ecosystem (CDSE) free tier;
   - Copernicus CDS (ERA5, CC-BY 4.0; free account plus a per-dataset licence click);
   - ARCO-ERA5 on Google Cloud Storage (GCS) (keyless Zarr);
   - AWS Open Data (Earth Search COGs, NSF-NCAR ERA5, the Open-Meteo `.om` bucket under CC-BY 4.0).

## Probe results (live, 2026-11-07)

| Platform / endpoint | HTTP | Latency | Latest value at Los Tajibos | History start | Auth |
|---|---|---|---|---|---|
| PC STAC `/search` sentinel-2-l2a | 200 | 0.39 s | 2026-11-04 (S2A, cloud 35.5 %); 2026-11-02 (cloud 15.8 %) | 2015-10-21 | none |
| PC STAC modis-13Q1-061 | 200 | 0.48 s | **MYD13Q1 A2026281; MOD13Q1 A2026273** | 2000-02-18 (A2000049) | none |
| PC SAS token `/api/sas/v1/token/sentinel-2-l2a` | 200 | 0.35 s | token issued, expiry about 1 h | – | none (anonymous) |
| PC Data API `/item/point` S2 B04,B08,SCL | 200 | 0.68 s | [1371, 4910, SCL=4] | – | none |
| PC Data API `/item/statistics` NDVI (offset-corrected) over 1×1 km | 200 | 0.55 s | mean 0.794, sd 0.11, n = 11,990 px | – | none |
| PC Data API `/item/statistics` NDMI (B08/B11, corrected) | 200 | 0.60 s | mean 0.269 | – | none |
| PC Data API `/item/statistics` SCL `categorical=true` | 200 | 0.5–1.6 s | 11-02: {4: 3009, 5: 16} (clear); 10-28: {9: 3025} (cloud) | – | none |
| PC Data API `/item/point` MOD13Q1 NDVI | 200 | 0.49 s | 7382 (scaled ×0.0001 = 0.738), composite 2026-09-30 | – | none |
| PC `era5-pds` collection | 200 | 0.74 s | extent 1979– (open) | 1979 | none |
| Earth Search `sentinel-2-c1-l2a` | 200 | 0.16 s | 2026-11-04 | 2018-02-07 | none |
| Earth Search `sentinel-2-l2a` (legacy) | 200 | 0.28 s | 2026-11-04 | 2017-01-03 | none |
| CDSE STAC `/v1/search` sentinel-2-l2a | 200 | 0.73 s | 2026-11-04 (same granules as PC) | – | none |
| CDSE OData catalogue | 200 | 2.0 s | 2026-11-04 | – | none (download needs a token) |
| CDSE openEO capabilities and collections | 200 | 0.4 / 2.7 s | 138 collections incl. `SENTINEL2_L2A`, `CLMS_NDVI_*` | – | `/jobs`: **401** |
| NASA CMR granules MOD13Q1 | 200 | 0.38 s | **A2026289 (2026-10-16, produced 2026-11-03)** | 2000-02-18 | none |
| NASA CMR VNP13A1 (VIIRS) | 200 | 0.78 s | 2026-10-24 | – | none |
| NASA CMR SPL4SMGP (SMAP L4 soil moisture) | 200 | 0.25 s | 2026-11-04 21:00 | (2015) | none (download needs Earthdata Login) |
| NASA CMR GPM_3IMERGDL (IMERG Late daily) | 200 | 0.39 s | 2026-11-05 | – | none (download needs Earthdata Login) |
| CMR-STAC `/stac/LPCLOUD` | 200 | 1.24 s | – | – | none |
| AppEEARS `/api/product` | 200 | 0.44 s | 193 products incl. MOD13Q1.061, SPL4SMGP.008 | – | `/api/task`: **403** (needs Earthdata Login) |
| Harmony `/versions` | 200 | 0.64 s | services updated 2026-11-03 | – | jobs need Earthdata Login |
| GES DISC OPeNDAP `.dmr.xml` (IMERG) | 200 | – | metadata public | – | data needs Earthdata Login (not tested) |
| ORNL DAAC MODIS web service `/MOD13Q1/subset` | 200 | **37.9 s** (1st try timed out at 60 s) | 2026-10-16 NDVI = 8601 (0.86) | 2000-02-18 | none |
| Open-Meteo archive `models=era5` | 200 | 0.45 s | precip non-null to **2026-10-31** (about 7-day lag) | 1940-01-01 | none (free tier is non-commercial) |
| Open-Meteo archive `best_match` | 200 | 0.43 s | non-null to 2026-11-07 (blends in IFS) | 1940 | same |
| Open-Meteo forecast `past_days=92` | 200 | 0.10–0.45 s | 2026-11-07: Tmax 35.1 °C, ETo 6.58 mm | – | same |
| Open-Meteo `customer-archive-api` | 401 | 0.35 s | "API key required" | – | paid key |
| NASA POWER daily point (AG community) | 200 | 0.49 s | **2026-11-03**: P = 0.85 mm, Tmax = 38.1 °C, GWETROOT = 0.28 | 1981-01-01 | none |
| ClimateSERV CHIRPS (datatype 0), polygon average | 200 | about 6 s (submit, poll, fetch) | **2026-09-30** (20.98 mm) | 1981-01-01 | none |
| CDS catalogue ERA5 single levels | 200 | 0.46 s | extent to 2026-11-01, licence "CC-BY" | 1940 | `/retrieve/jobs`: **401** |
| CDS catalogue ERA5-Land | 200 | 0.36 s | to 2026-11-01 | 1950 | key |
| GCS ARCO-ERA5 `.zmetadata` (Zarr v3, 0.25°, hourly) | 200 | 0.11 s | valid_time_stop 2026-06-30 (final); **ERA5T to 2026-10-31** | 1940 | none |
| GEE STAC catalog (GCS) | 200 | 0.15 s | – | – | none (metadata only) |
| GEE REST assets | 401 | 0.13 s | "missing OAuth 2 credential" | – | Google Cloud project + OAuth/service account |
| AWS `sentinel-cogs` bucket list | 200 | 0.26 s | public listing works | – | none |
| AWS `nsf-ncar-era5` bucket list | 200 | 0.25 s | public | 1940 | none |
| AWS `openmeteo` bucket (Open-Meteo open data) | 200 | 0.29 s | `copernicus_era5/` and `copernicus_era5_land/` `.om` chunks; median file 105 MB, max 1.75 GB | 1940 / 1950 | none; registry licence CC-BY 4.0 |
| IRI Data Library CHIRPS | 200 | – | **redirects to `/auth/login`**: IRI DL now needs sign-in | – | login |

### Latency notes that matter for ADR-0002 D3

- **MODIS through PC lags LP DAAC by one composite.**
  - CMR and ORNL show `MOD13Q1.A2026289` (starting 2026-10-16, produced 2026-11-03).
  - The newest PC MOD13Q1 is `A2026273`; the newest MYD13Q1 is `A2026281`.
  - So PC adds about 2 weeks on top of the about 3 weeks in the ADR.
  - Fix: use CMR (keyless) to *detect* the newest composite, and **use the Aqua+Terra pair (MOD + MYD)** to get an 8-day cadence.
- **Sentinel-2:** PC, Earth Search and CDSE all had the 2026-11-04 scene within 3 days. The ADR's 2–5 days holds.
- **ERA5 through Open-Meteo `models=era5`:** about 7 days lag. `best_match` / forecast `past_days` fill up to today with ECMWF IFS. That data must be tagged "estimated / model analysis" in provenance.
- **NASA POWER:** about 4 days lag.
- **CHIRPS final through ClimateSERV:** about 5–6 weeks lag (ends 2026-09-30). It is not usable for the last month, so another source has to cover that gap. Options: IMERG Late (1-day lag, Earthdata Login), CHIRPS-prelim, or Open-Meteo.

## Platform by platform

### Microsoft Planetary Computer (PC): STAC + Data API + SAS
- **Status in 2026:**
  - The **STAC API, Data API (TiTiler-pgSTAC) and SAS token API are alive and fast**.
  - The **Hub (JupyterHub compute) was retired on 2024-06-06** (GitHub discussion #347).
  - **Planetary Computer Pro** (Azure GeoCatalog, generally available) is the paid, private-catalogue successor.
  - On 2026-10-12/13 there was maintenance with traffic redirected for 21 collections (discussion #508); none of them are our core collections.
- **Collections we need are present:**
  - `sentinel-2-l2a`, `modis-13Q1-061`, `modis-09A1-061`, `modis-11A1-061` (LST), `modis-64A1-061` (burned area);
  - `landsat-c2-l2`, `hls2-l30` / `hls2-s30`, `sentinel-1-rtc`;
  - `esa-worldcover`, `io-lulc-annual-v02`, `jrc-gsw` (surface water), `cop-dem-glo-30`, `nasadem`;
  - `era5-pds`, `terraclimate`, `gpm-imerg-hhr`, `chloris-biomass`.
- **Auth:** none for STAC or the Data API. SAS tokens are issued anonymously and last about 1 h. The PC docs say "rate limiting may be put into place to limit the amount of egress". Whether a subscription key raises the limits comes from earlier PC docs and was not verified.
- **Killer feature for us:** `/api/data/v1/item/statistics` (POST a GeoJSON polygon, an `expression` and `asset_as_band=true`) gives the polygon mean NDVI/NDMI server-side. Combined with `categorical=true` on `SCL`, it gives the clear-pixel fraction. This makes per-farm Sentinel-2 time series in the FastAPI service possible **without rasterio/GDAL**.
  - Caveat: in our test, `where()` in the expression returned HTTP 500. Multiplying by a boolean mask works, but it puts zeros into the mean: the fully clouded 2026-10-28 scene gave a mean of exactly 0.0 (round 5).
  - Recommended recipe: (1) call SCL `categorical`; (2) keep the scene only if more than 80 % of pixels are class 4/5; (3) take the NDVI statistics.
- **Terms (from the search snippet; the terms page did not render for fetching, so `verified=false`):** "Supplemental Terms of Use for Microsoft Planetary Computer Previews". They say "You will not use the Previews for anything mission critical to you or your business operations", with no SLA and egress rate limiting. Each dataset's own licence applies (Sentinel and MODIS are open).
- **Verdict:** primary for the hackathon. For a sponsor product it is a risk: keep Earth Search or CDSE as hot fallbacks behind the same wrapper interface.
- **Python:** `pystac-client` 0.9.1 (2026-10-20); `planetary-computer` 1.0.0 (2023; stable, but its last release is old). Plain `requests` against the Data API is enough.

### Element84 Earth Search (AWS)
- STAC v1 at `earth-search.aws.element84.com/v1`. Collections:
  - `sentinel-2-c1-l2a`: Collection-1 reprocessing, COGs, offset metadata present, starts 2018-02-07 at our tile;
  - `sentinel-2-l2a`: legacy, starts 2017-01-03;
  - `sentinel-2-l1c`, `sentinel-1-grd`, `landsat-c2-l2`, `cop-dem-glo-30/90`.
- **No MODIS and no tiler/statistics API**: you read the COGs yourself with rasterio or GDAL `/vsicurl/`. The files are public `s3://` / `https://` with no signing.
- Licence: the Copernicus Sentinel data licence (free, commercial use OK). The service is free, best-effort, with no SLA.
- Plan to migrate legacy `sentinel-2-l2a` to `sentinel-2-c1-l2a` (Element84 issue #31).
- **Verdict:** fallback for Sentinel-2 (keyless, licence-clean). It needs `rasterio` in the service.

### Copernicus Data Space Ecosystem (CDSE): STAC, OData, openEO, Sentinel Hub
- STAC, the OData catalogue and the openEO capabilities and collections endpoints are keyless. Processing and download need a **free instant account** (the Copernicus General user type).
- **Quotas (documentation Quotas.html; numbers differ across sources, so this is `verified=false`):**
  - openEO: 10,000 credits per month, 2 concurrent jobs, 12 sync requests per minute.
  - Sentinel Hub APIs (Process / **Statistical**): 50,000 requests per month, 300 per minute (one secondary source says 10,000 requests and 10,000 PU per month).
  - S3 / OData: 12 TB per rolling 30 days, 4 connections, 20 MB/s each.
  - Quotas reset monthly.
- **Licence:** the Copernicus data licence is free and open, including commercial use. The free tier's terms do not forbid commercial use. Heavier use goes through paid or sponsored (Network of Resources) credits.
- **Product path:** the Sentinel Hub **Statistical API**, or openEO `aggregate_spatial` with the SCL cloud mask, returns per-polygon, cloud-masked NDVI/NDMI time series for a whole season in **one request**. These run server-side, are free for commercial use and are reproducible. Not tested (needs signup).
- openEO also exposes `CLMS_NDVI_GLOBAL_300M_10DAILY_V3` and `CLMS_NDVI_LTS_*`: Copernicus Global Land NDVI with a long-term statistics baseline, a candidate MODIS alternative.
- **Python:** `openeo` 0.54.0 (2026-10-28); `sentinelhub` 3.12.1 (2026-11-06).

### Google Earth Engine (GEE)
- REST without credentials returns **401**. You need a Google Cloud project registered for Earth Engine, plus OAuth or a **service account**. Service accounts work for server use in both noncommercial and commercial projects.
- **Noncommercial tiers (since 2026-04-27):**
  - Community: 150 EECU-hours per month;
  - Contributor: 1,000 EECU-hours per month, needs a billing account but EE usage is not charged;
  - Partner: about 100,000 EECU-hours per month, by application.
  - Projects that go over the quota enter "restricted mode" and are throttled.
  - Eligibility for the noncommercial tiers is verified. The student hackathon team could probably qualify; **Suyana, a company, cannot**.
- **Commercial plans:**
  - Limited: pay-as-you-go, no platform fee, no SLA;
  - Basic: $500/month;
  - Professional: $2,000/month;
  - EECU-hours cost $0.40 each up to 10,000 hours.
- **Verdict:** do not build the product on GEE. It has the best catalogue (CHIRPS, MODIS, ERA5-Land, SMAP, Dynamic World), but auth and licence friction plus a commercial cost make it a poor fit for a keyless v1. The GEE STAC catalogue on GCS is keyless and useful for *discovering* dataset IDs.
- **Python:** `earthengine-api` 1.7.51 (2026-11-02).

### NASA Earthdata: CMR, CMR-STAC, AppEEARS, Harmony, OPeNDAP, ORNL MODIS web service
- **CMR search is keyless and fast** (0.2–0.8 s). It is the best "what is the latest composite?" oracle for MODIS, VIIRS, SMAP and IMERG.
- **Downloads** (LP DAAC, NSIDC, GES DISC) need a **free, instant Earthdata Login (EDL)**: email signup, no institutional approval. EDL also covers AppEEARS (point/area time series, asynchronous, tokens valid 48 h) and Harmony (subsetting).
- The OPeNDAP metadata (`.dmr.xml`) is public, but the data path needs EDL.
- **ORNL DAAC MODIS/VIIRS web service** (`modis.ornl.gov/rst/api/v1`) is **keyless** and returns MOD13Q1 NDVI per pixel since 2000. It is **slow**: 38 s per call, and the first call timed out at 60 s. Use it as a keyless MODIS fallback, cached in DuckDB, never on the request path.
- **Licence:** the NASA open data policy has no restrictions on commercial use, but asks for attribution.
- **Python:** `earthaccess` 0.19.0 (2026-09-04).

### Open-Meteo
- Keyless free API: archive (ERA5 / ERA5-Land / IFS, 1940– and 1950–), forecast with `past_days` up to 92, and historical-forecast. Very fast (0.1–0.5 s). It supplies precipitation, Tmax/Tmin, **FAO-56 ETo** and soil moisture by layer (`soil_moisture_28_to_100cm_mean`) in one call.
- **Licence risk (RED):**
  - The free tier is **non-commercial**. Its terms list as commercial: ads, subscriptions, or "undisclosed commercial research". There is **no carve-out for prototypes or evaluation**.
  - Limits: 600 calls per minute, 5,000 per hour, 10,000 per day, 300,000 per month.
  - Commercial plans: **Standard €29/month** (1 M calls, *no historical API*); **Professional €99/month** (5 M calls, includes the Historical, Climate and Ensemble APIs); Enterprise is custom. The paid host `customer-archive-api.open-meteo.com` returns 401 without an `apikey`.
  - The data itself is **CC-BY 4.0**; the server code is AGPLv3.
- **Licence-clean upgrade path (`verified=false`):**
  - Open-Meteo mirrors its data on **AWS Open Data** (`s3://openmeteo`, registry licence CC-BY 4.0), including `data/copernicus_era5/*` and `data/copernicus_era5_land/*` as `.om` chunk files. The median file is about 105 MB and yearly files are up to 1.75 GB.
  - A self-hosted Open-Meteo Docker (AGPL) could serve the same API commercially for free. You would still need to sync a few variables, which is probably GBs of storage.
  - **Gap:** `copernicus_era5_land` has **no precipitation**. Rain would come from the 0.25° `copernicus_era5` prefix.
  - Not tested: the reader/server path or the storage size.
- **Hackathon stance:** fine for a student demo, but it must be disclosed. For anything Suyana deploys, budget €99/month or switch to the sources below.
- **Python:** `openmeteo-requests` 1.7.5.

### NASA POWER
- Keyless REST at `power.larc.nasa.gov/api/temporal/daily/point`, `community=AG`. Daily data since **1981** at about 0.5° × 0.625° (MERRA-2 and GEOS-IT; GEWEX/CERES for radiation). Latest value **2026-11-03**, about 4 days lag.
- Variables: `PRECTOTCORR`, `T2M_MAX`, `T2M_MIN`, `GWETROOT` (root-zone wetness 0–1), `GWETTOP`, `ALLSKY_SFC_SW_DWN`, `WS2M` and RH. These are everything FAO-56 ETo needs, if we compute it ourselves.
- No published global rate limit: the climatology endpoint allows 30 requests per minute, and the team monitors usage for equitable access. A `429` response exists.
- **Licence:** NASA open data, commercial use OK, attribution requested.
- **Verdict:** the **licence-clean primary weather baseline** for the product (45 years). It is coarse, but anomalies against the field's *own* history largely cancel the bias.

### SERVIR ClimateSERV
- Keyless job API: `submitDataRequest`, then `getDataRequestProgress`, then `getDataFromRequest`. The `climateserv` Python package (1.0.8, 2024) wraps it.
- **CHIRPS (datatype 0)** polygon average from 1981-01-01 to 2026-09-30, about 6 s per job.
- The help page also lists IMERG, eMODIS NDVI, SMAP and SMAP-Sentinel1 soil moisture, ESI (Evaporative Stress Index) and CHIRPS-GEFS forecasts. Datatype numbers for these were not resolved: our datatype-26 request returned 0 rows.
- **Licence:** a SERVIR / NASA-USAID public service, free; the underlying CHIRPS is public domain / CC-BY. Long-term funding of SERVIR is uncertain, so it is a fallback rather than the core.
- The **IRI Data Library** (the classic keyless CHIRPS point path) **now redirects to a login page**: it can no longer be used without an account.

### Copernicus Climate Data Store (CDS) and ECMWF data
- The catalogue is keyless (ERA5 1940 to 2026-11-01; ERA5-Land 1950 to 2026-11-01; licence "CC-BY"). Retrieval needs a free account, a personal access token and a **manual licence acceptance per dataset**. The `/retrieve/v1/jobs` endpoint returns 401.
- The queue can take minutes to hours. That is unsuitable on the request path, but fine for a nightly baseline build.
- `cdsapi` 0.7.7.
- **Keyless ERA5 mirrors:**
  - **Google ARCO-ERA5** (`gs://gcp-public-data-arco-era5`, Zarr v3, hourly 0.25°): final data to 2026-06-30, **ERA5T to 2026-10-31**, 0.11 s metadata.
  - **NSF-NCAR ERA5 on AWS** (`s3://nsf-ncar-era5`, NetCDF).
  - **PC `era5-pds`.**
  - These need `xarray` + `zarr` + `gcsfs` / `fsspec`. They are licence-clean (CC-BY 4.0, attribute Copernicus/ECMWF).

### AWS Open Data (summary)
- Public buckets probed with no signing: `sentinel-cogs` (behind Earth Search), `nsf-ncar-era5` and `openmeteo`.
- The Registry of Open Data lists per-dataset licences.
- Free egress for these sponsored datasets; best effort with no SLA.

## Licence and terms matrix

| Platform | Auth (hackathon) | OK for the hackathon demo | OK for a Suyana commercial product | Notes |
|---|---|---|---|---|
| Planetary Computer STAC + Data API | none | yes | **risky** (preview terms, "not mission critical", no SLA) | Data licences are open; the risk is the service, not the data. |
| Earth Search (AWS) | none | yes | yes (best effort) | Read COGs yourself. |
| CDSE (STAC, openEO, Sentinel Hub) | free instant signup | yes | yes (within free quota; paid beyond) | Best product path for S2 polygon statistics. |
| Google Earth Engine | Google Cloud project + OAuth / service account | maybe (noncommercial registration) | **paid** (Limited pay-as-you-go, or $500+/month) | Company equals commercial. |
| NASA CMR / CMR-STAC | none | yes | yes | Discovery only. |
| NASA AppEEARS / Harmony / OPeNDAP / LP DAAC | free instant Earthdata Login | yes | yes | Asynchronous jobs. |
| ORNL MODIS web service | none | yes (slow) | yes | Cache only. |
| Open-Meteo free API | none | yes, disclosed | **NO**: €99/month Professional, or self-host from the CC-BY S3 mirror | RED flag. |
| NASA POWER | none | yes | yes | Attribution. |
| ClimateSERV | none | yes | yes (no SLA) | CHIRPS final has about a 5-week lag. |
| Copernicus CDS | free account + licence click | yes | yes (CC-BY 4.0) | Slow queue. |
| ARCO-ERA5 (GCS) / NSF-NCAR ERA5 (AWS) | none | yes | yes (CC-BY 4.0) | Needs xarray/zarr. |
| IRI Data Library | login now | – | – | Not usable keyless any more. |

## Recommendations per variable (platform view)

The source families own the data choice. This table is the *access path* we recommend through the registry.

| Variable | Primary (hackathon, keyless) | Fallback | Product / licence-clean path |
|---|---|---|---|
| Precipitation daily | Open-Meteo archive (ERA5, best_match to today) | NASA POWER `PRECTOTCORR`; ClimateSERV CHIRPS (to −5 weeks) | NASA POWER + CHIRPS (ClimateSERV / CHC) + IMERG Late through Earthdata Login |
| Tmax / Tmin | Open-Meteo archive | NASA POWER `T2M_MAX` / `T2M_MIN` | NASA POWER, or ARCO-ERA5 |
| ETo (FAO-56) | Open-Meteo `et0_fao_evapotranspiration` | compute FAO-56 from NASA POWER (T, RH, wind, radiation) | compute from NASA POWER / ERA5 ourselves |
| Root-zone soil moisture | Open-Meteo `soil_moisture_28_to_100cm_mean` (ERA5-Land) | NASA POWER `GWETROOT` | SMAP L4 (Earthdata Login) / ERA5-Land through CDS or ARCO |
| NDVI baseline (MODIS) | PC STAC + Data API `/item/point` on MOD13Q1 + MYD13Q1 | ORNL MODIS web service (keyless, slow, cache) | AppEEARS point time series (Earthdata Login); CMR for latency detection |
| NDVI / NDMI current (S2 10 m) | PC Data API `/item/statistics` with the **−1000 offset** + SCL categorical | Earth Search `sentinel-2-c1-l2a` COGs + rasterio | CDSE Sentinel Hub Statistical API / openEO `aggregate_spatial` |
| Flood / surface water | PC `jrc-gsw` + `sentinel-1-rtc` | CDSE `SENTINEL1_GRD` | CDSE |
| Frost / heat | from Tmin / Tmax above | PC `modis-11A1-061` LST | – |
| Crop masks / land cover | PC `esa-worldcover`, `io-lulc-annual-v02` | CDSE openEO `ESA_WORLDCOVER_10M_*` | – |

## Open risks
1. **S2 BOA offset (+1000 DN) on PC since 2022-01-25.** Hardcode the correction when `s2:processing_baseline >= 04.00`. Without it, NDVI is biased about −0.25 and the MODIS cross-calibration fit is corrupted. Earth Search C1 exposes the offset in `raster:bands`. CDSE Sentinel Hub is said to harmonise it with `harmonizeValues=true` (from Sentinel Hub docs, not verified).
2. **Open-Meteo commercial licence**: see above. Flag it on the board and in the pitch: "free for research; €99/month or self-hosted for production".
3. **PC preview terms**: no SLA and anonymous SAS rate limiting. Keep Earth Search / CDSE wrappers ready and cache everything in DuckDB.
4. **MODIS on PC lags LP DAAC by one composite** (about 2 extra weeks). Use CMR for detection and AppEEARS / ORNL to fill.
5. **CHIRPS final latency** of about 5–6 weeks: rain for the last month must come from ERA5T/IFS (Open-Meteo), IMERG Late or CHIRPS-prelim, labelled "estimated".
6. **ORNL MODIS service** takes 38–60 s per call: never call it on the request path.
7. **ClimateSERV / SERVIR** depends on US funding; IRI DL is now behind a login. Do not make either a single point of failure.
8. **CDSE quota numbers** conflict between sources (10k vs 50k Sentinel Hub requests per month). Confirm in the dashboard after signup.
9. **The `planetary-computer` client** was last released in 2023. Prefer plain `requests` for the SAS / Data API calls.
10. **PC Data API**: a `where()` expression returned HTTP 500. Use the two-call SCL-histogram plus NDVI-statistics recipe; it is also slower per scene (about 2 calls × 0.5–1.6 s).
