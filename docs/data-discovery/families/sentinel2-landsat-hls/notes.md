# Family: Sentinel-2, Landsat and HLS current imagery (10–30 m)

Probed on 2026-11-06. Sample polygon: a 0.01° x 0.01° square (~1.1 km x 1.1 km, about 120 ha)
around **Estancia Los Tajibos** (-62.52, -16.86, MGRS tile 20KNG). A second farm,
**Arrocera Mineros** (-63.29, -17.20), was used for the clear-sky statistics. It sits where tiles
20KMG and 20KMF overlap. No accounts, keys or credentials were used.

## Bottom line

- **Primary for NDVI and NDMI: Sentinel-2 L2A on Microsoft Planetary Computer (PC).**
  - STAC search needs no auth. The anonymous SAS token is fetched automatically by
    `planetary_computer.sign`.
  - The PC **data API** (TiTiler `/api/data/v1/item/statistics`) computes the SCL-masked polygon
    NDVI and NDMI on the server in about 0.6 s per call. Reading the COG windows ourselves takes
    7–10 s per scene.
- **Fallback: Element84 Earth Search, collection `sentinel-2-c1-l2a`.** Its COGs sit in a public
  S3 bucket over plain HTTPS, with no signing or token at all. It returned the same raw pixel
  values and the same NDVI as PC, scene for scene.
- **30 m gap-filler: HLS v2.0 (S30 + L30)** through PC `hls2-*`, read with the anonymous SAS
  token. Its Fmask cloud mask is stricter than SCL and caught haze that SCL missed. Landsat C2 L2
  on PC is the long-history 30 m option, with data back to 1984.
- **CDSE (Copernicus Data Space Ecosystem)** has good metadata, but every data path (download,
  Sentinel Hub Statistical API, openEO) needs a free account. It does not work keyless.
- **Clear-sky reality for Santa Cruz:**
  - Rainy season (Dec–Mar): **about 2 usable observations per month** per farm.
  - Dry season (Jun–Sep): **about 6–7 per month**.
  - The longest gap between usable observations is **30–42 days**, and it falls in Nov–Jan.
  - The rainy season needs compositing (monthly median or max), carry-forward with a "last clear
    observation" date, and HLS Landsat to fill gaps.

## What was probed (all live, 2026-11-06)

### 1. STAC search, last 60 days over the Tajibos polygon (`probe_stac_search.py` → `out_stac_search.json`)

| Catalog / collection | HTTP | Latency | Items in 60 d | Latest | History start at farm | Notes |
|---|---|---|---|---|---|---|
| PC `sentinel-2-l2a` | 200 | 0.76 s | 19 | 2026-11-04 | 2015-10-21 | tile 20KNG, S2A, S2B and S2C all active; one duplicate (2026-09-18 processed twice) |
| PC `landsat-c2-l2` | 200 | 0.66 s | 7 | 2026-10-28 | 1984-04-07 | WRS-2 path/row 230/072, Landsat 8 + 9 |
| PC `hls2-l30` | 200 | 0.48 s | 4 | 2026-10-20 | 2017-08-24 (collection says 2020+) | PC's copy is partial and lags LP DAAC |
| PC `hls2-s30` | 200 | 0.48 s | 11 | 2026-11-02 | 2020-01-13 | 11 items, against 19 raw S2 scenes |
| Earth Search `sentinel-2-l2a` (legacy) | 200 | 0.36 s | 19 | 2026-11-04 | 2017-01-03 | `earthsearch:boa_offset_applied=true` |
| Earth Search `sentinel-2-c1-l2a` | 200 | 0.37 s | 19 | 2026-11-04 | 2018-02-07 (as returned by the sort) | Collection-1 reprocessing |
| Earth Search `landsat-c2-l2` | 200 | 0.29 s | 7 | 2026-10-28 | 1984-04-07 | assets are `s3://usgs-landsat` (requester-pays) |
| CDSE STAC `sentinel-2-l2a` | 200 | 1.67 s | 19 | 2026-11-04 | 2015-10-01 | assets are `s3://eodata` .jp2, or an OData https link that needs a token |
| NASA CMR-STAC LPCLOUD `HLSL30_2.0` | 200 | 0.49 s | 6 | 2026-10-20 | 2013-04-23 | assets are protected (Earthdata login) |
| NASA CMR-STAC LPCLOUD `HLSS30_2.0` | 200 | 0.78 s | 13 | 2026-11-04 | 2016-02-08 | assets are protected; about 2 days latency |
| USGS LandsatLook STAC `landsat-c2l2-sr` | 200 | 0.36 s | 7 | 2026-10-28 | 1984-04-07 | assets need an ERS login |

**Latency observed:**
- **Sentinel-2:** the scene acquired 2026-11-04 at 14:20 UTC was in PC and Earth Search by about
  20:00–21:40 UTC the same day, so **under 8 hours**. As of 2026-11-06 the newest scene is 2 days
  old. With three satellites the revisit over 20KNG is about 3 days.
- **Landsat L2:** the 2026-10-28 scene was processed on 2026-10-31, about 3 days.
- **HLS:** LP DAAC S30 is about 2 days behind. NASA states 1.7–3 days, with a 6-hour
  low-latency product planned for 2027.

### 2. Pixel reads, client side (`probe_s2_pixels.py` + `s2lib.py` → `out_s2_pixels.json`)

**Method:**
- Read the SCL, B04, B08 and B11 window for the polygon from each COG over HTTP range requests,
  using rasterio 1.5.2 with GDAL 3.12.
- Clear pixels are SCL classes {4 vegetation, 5 bare soil, 6 water}.
- Compute the masked mean NDVI and NDMI.

**Results:** 19 PC scenes and 19 Earth Search c1 scenes, plus 3 legacy Earth Search scenes. Every
read succeeded.

**Runtime per scene (4 bands, about 120 ha, read from macOS):**
- **PC:** 6.4–11.5 s, median about 7.7 s.
- **Earth Search c1:** 3.2–13.7 s.
- Each read pulls whole internal COG blocks, so the cost depends on network round-trips, not on
  polygon size.

**Sample masked means (PC = Earth Search c1, to 3 decimal places):**

| Date | Tile cloud % | Polygon clear frac | NDVI | NDMI |
|---|---|---|---|---|
| 2026-09-25 | 5.6 | 1.00 | 0.672 | 0.134 |
| 2026-09-28 | 2.7 | 1.00 | 0.664 | 0.127 |
| 2026-10-08 | 39.7 | 0.79 | 0.631 | 0.159 |
| 2026-10-23 | 51.9 | 0.42 | 0.770 | 0.251 |
| 2026-11-02 | 15.8 | 1.00 | 0.797 | 0.269 |
| 2026-11-04 | 35.5 | 0.70 | 0.718 | 0.241 |
| 2026-09-15 | 62.3 | 0.99 (**haze SCL missed**) | 0.428 | 0.059 |

**DN offset (important for the ADR-0002 cross-calibration):**
- Processing baseline ≥ 04.00 (ESA, from 2022-01-25) adds +1000 to L2A DN.
  - **PC** raw DN includes the +1000. Subtract 1000 when `s2:processing_baseline >= 04.00`;
    older PC items are not offset (ESA rule; **unverified** live, because only 2026 scenes with baselines 05.12 and 05.13 were read).
  - **Earth Search c1** includes the +1000. This was verified only on 2026 scenes; the claim that it holds for every
    date after Collection-1 reprocessing is **unverified**. Use the
    `raster:bands` values: scale 1e-4, offset -0.1.
  - **Earth Search legacy** has the offset already removed: its DN equal PC DN minus 1000
    exactly, and `earthsearch:boa_offset_applied=true`. Its `raster:bands` still declares
    offset -0.1, which is **wrong for these items**. Applying it would subtract the offset
    twice.
- Get this wrong and NDVI is biased low (the denominator grows by 2000). This hits hardest on
  bright or dry fields.

### 3. Server-side statistics on the PC data API (`probe_pc_data_api.py` → `out_pc_data_api.json`)

- **Call:** `POST https://planetarycomputer.microsoft.com/api/data/v1/item/statistics?collection=sentinel-2-l2a&item=<id>&expression=...&asset_as_band=true&max_size=1024`
  with a GeoJSON Feature body. No auth.
- **Expressions that work** (numexpr syntax):
  - NDVI: `where(((SCL==4)|(SCL==5)|(SCL==6)),(B08-B04)/(B08+B04-2000),0)`
  - NDMI: `where(((SCL==4)|(SCL==5)|(SCL==6)),(B08-B11)/(B08+B11-2000),0)`
  - Clear mask: `where(...,1,0)`
- **Masked mean** = `sum / (clear_mean x count_10m)`. An expression that uses only SCL is
  evaluated on the 20 m grid, so its count is 3,025 pixels, not 11,990.
- **Gotcha:** adding `nodata=-9999` to the call returned HTTP 500.
- **Results:** 0.3–0.9 s per call. NDVI on 11-04 was 0.7125 against 0.7184 client side; NDVI on
  11-02 was 0.794 against 0.797. Agreement is within 0.006.
- **SCL categorical histogram:** `assets=SCL&categorical=true` returns class counts in about
  0.5 s. This is the cheapest clear-sky check.

### 4. Clear observations per month (`probe_clear_obs.py` → `out_clear_obs.json`)

**Method:**
- Window: 24 months, 2024-11 to 2026-10. Search with pystac-client, which handles pagination.
- **Tajibos:** 195 items over 194 dates. **Mineros:** 737 items over 316 dates, from two tiles
  and two relative orbits.
- One SCL histogram per item through the data API. With 4 threads and no errors, this took 27 s
  for Tajibos and 86 s for Mineros.
- Duplicates are removed per date, keeping the best clear fraction.

**Average per month:**

| Season | Farm | S2 acquisition dates | polygon ≥50 % clear | ≥80 % clear | tile `eo:cloud_cover`<30 |
|---|---|---|---|---|---|
| Rainy Dec–Mar | Tajibos | 6.9 | **2.1** | 1.4 | 0.4 |
| Rainy Dec–Mar | Mineros | 12.5 | **2.5** | 2.0 | 1.8 |
| Dry Jun–Sep | Tajibos | 8.9 | **5.6** | 5.5 | 5.1 |
| Dry Jun–Sep | Mineros | 13.4 | **7.4** | 6.8 | 4.8 |
| Transition (Apr–May, Oct–Nov) | Tajibos / Mineros | 8.5 / 13.6 | 2.9 / 4.6 | 2.4 / 3.6 | 1.9 / 2.2 |

- **Months with 0–1 usable observations:** Dec-2025 at Mineros had 0, Jan-2025 at Mineros had 1,
  and Jun-2025 at Tajibos had 1.
- **Longest gaps between ≥50 %-clear dates:**
  - Tajibos: 35 days (2025-10-23 → 11-27), 33 days (Jun–Jul 2025), 30 days (Dec 2024–Jan 2025).
  - Mineros: 42 days (2025-11-25 → 2026-01-06).
- **Design lesson:** filter by the polygon's own SCL, not by the tile's `eo:cloud_cover`.
  - A tile-level cut at <30 % keeps only 0.4 scenes per month at Tajibos in the rainy season.
  - Example kept by the polygon test: 2026-09-15 had 62 % tile cloud and was 99 % clear over
    the farm.
  - Example rejected by it: 2026-10-05 had 66 % tile cloud and 0 % clear over the farm.

### 5. Landsat C2 L2 and HLS pixel reads on PC (`probe_landsat_hls_pixels.py` → `out_landsat_hls_pixels.json`)

**Setup:**
- Reads use the anonymous SAS token on PC.
- Masks are QA bit-masks (Landsat `qa_pixel`, HLS `Fmask`).
- Scaling: Landsat SR DN x 2.75e-5 − 0.2; HLS DN x 1e-4.
- Both are in **EPSG:32620** (northern-hemisphere UTM with negative northings), not 32720.

**Results:** 2.1–4.3 s per scene, since each read is fewer, smaller 256-pixel blocks.

| Date | Product | Clear | NDVI | NDMI |
|---|---|---|---|---|
| 2026-09-18 | Landsat 8 | 1.0 | 0.723 | 0.220 |
| 2026-09-18 | HLS L30 | 1.0 | 0.727 | 0.224 |
| 2026-10-20 | Landsat 8 | 1.0 | 0.815 | 0.366 |
| 2026-10-20 | HLS L30 | 1.0 | 0.819 | 0.370 |
| 2026-09-25 | HLS S30 | 1.0 | 0.716 | — |
| 2026-09-25 | Raw S2 | — | 0.672 | — |

- HLS S30 reads about 0.04 NDVI higher than raw S2 because HLS applies BRDF/bandpass
  harmonisation and I used B08. HLS recommends B8A as the NIR band for S30.
- **Fmask on S30 flagged 2026-09-15 as fully cloudy (clear 0.0).** SCL called it 99 % clear,
  which produced the suspicious NDVI of 0.43. Fmask is the better cloud and haze mask.

### 6. Access checks with no auth (`probe_access.sh` → `out_access.txt`)

| Path | Result |
|---|---|
| Earth Search c1 COG over https | **206 OK, open** |
| PC blob, unsigned | 409 (needs a SAS token) |
| PC blob, with anonymous SAS token | **206 OK**. The token comes from `/api/sas/v1/token/{account}/{container}`, has no account behind it, and lasts about 1 day. |
| LP DAAC HLS (`lp-prod-protected`) | 401, redirects to Earthdata Login (URS). An instant free signup would unlock it. |
| USGS LandsatLook `/data/` | Shows 200 but **lands on the ERS login page**, so it is gated. The ERS account is free. |
| AWS `usgs-landsat` over unsigned https | 403 (requester-pays; needs an AWS account and pays egress) |
| CDSE OData download | 401 (needs a token from a free CDSE account) |
| CDSE openEO capabilities | 200. Processing needs a free account; there is a free credit allowance. |
| CDSE Sentinel Hub Statistical API | 405 on GET (it is a POST endpoint). Needs an OAuth client from a free account. The free tier is reported as 10,000 processing units and 10,000 requests per month, 300 requests per minute (not verified). |

### Installed into `.venv`

`uv pip install rasterio pystac-client planetary-computer shapely numpy pyproj`. rasterio, pystac,
shapely, numpy and pyproj were already present. The new packages were planetary-computer 1.0.0
and its dependencies: pydantic 2.14.3, python-dotenv, pytz and packaging.

## Recommendations per variable

| Variable | Primary | Fallback | Baseline / history | Why |
|---|---|---|---|---|
| NDVI, current, polygon mean | PC Sentinel-2 L2A. Use the data API statistics with SCL masking; switch to client COG reads if the data API is down. | Earth Search `sentinel-2-c1-l2a` COGs (no auth at all) | MODIS MOD13Q1 (other family) cross-calibrated against S2. A same-date S2 baseline is possible from 2017 (about 9 seasons). | Under 8 h latency, 10 m, about 3-day revisit, and identical values on both hosts. |
| NDMI (B08/B11), current | Same as NDVI (B11 is 20 m and resampled) | Earth Search c1 | Landsat C2 L2 NDMI from 1984 (NIR/SWIR1) if an NDMI baseline is wanted | Same pipeline; one more band |
| Cloud-gap fill / rainy season | HLS v2.0 L30 + S30 on PC (anonymous SAS; Fmask) | Landsat C2 L2 on PC (`qa_pixel`) | Landsat back to 1984 | Adds about 2–4 Landsat looks per month; Fmask catches haze |
| Clear-sky flag ("data as of") | SCL categorical histogram per item through the data API | Client-side SCL window | — | About 0.5 s per scene, so 24 months for one farm takes about 30 s |
| Server-side alternative (if the team creates a free account) | CDSE Sentinel Hub Statistical API: per-polygon time series in one call, with masking | CDSE openEO | — | Fastest if a key is acceptable; out of the keyless rule |

**Suggested wrapper logic (for the phase-2 spec):**
1. Run the STAC search over the polygon bbox for the window.
2. Remove duplicates by acquisition date and tile, keeping the latest `s2:generation_time`.
3. Get the SCL histogram, then keep scenes whose polygon clear fraction is ≥ 0.5.
4. Compute masked NDVI and NDMI and apply the offset rule.
5. Reject haze outliers: blue band B02 mean > 0.08, or an NDVI drop > 0.2 from both neighbours
   within 10 days. Alternatively, cross-check against HLS Fmask.
6. Take the per-period median (dekad or month), with "last clear observation" provenance.
7. Cache everything in DuckDB. 12 farms x 13 months x about 10 scenes x 3 calls is about 4,700
   data-API calls, roughly 10 minutes the first time and incremental after that.

## Licences

- **Sentinel-2:** Copernicus free, full and open licence. Attribution: "Contains modified
  Copernicus Sentinel data [year]".
- **Landsat:** USGS, public domain.
- **HLS:** NASA open data, no restrictions; cite the DOI.
- **Hosts:** PC is subject to the Microsoft PC terms. Earth Search data is on the AWS Open Data
  Registry.

## Risks and open questions

1. **Rainy-season cloud.** Dec–Mar gives about 2 usable S2 looks per month, with gaps up to 42
   days. The NDVI z-score will often be "stale". The UI must show the date of the last clear
   observation, and the score should down-weight NDVI when the data is old. MODIS (16-day
   composite) and weather signals carry the rainy season.
2. **SCL misses thin haze and cirrus.** 2026-09-15 passed SCL as 99 % clear with NDVI 0.43, when
   the true value was about 0.67. An outlier filter is required, or HLS Fmask, or a
   separate cloud-probability mask such as s2cloudless. Whether PC offers one as an asset was not
   checked.
3. **The DN offset trap.** See section 2. The legacy Earth Search `raster:bands` metadata
   contradicts its own `boa_offset_applied` flag.
4. **Duplicate granules.** The same date can be processed twice (2026-09-18), and farms in tile
   or orbit overlaps appear in two tiles.
5. **The PC data API is a best-effort service** with undocumented rate limits. `max_size=1024`
   downsamples polygons larger than about 10 km per side; our farms are much smaller. The
   anonymous SAS tokens are rate-limited more tightly outside Azure West Europe, so keep calls
   at about 4 concurrent.
6. **Client-side COG reads are slow from outside the cloud** (7–10 s per scene from macOS). Do
   not run them synchronously in a request; prefetch, cache in DuckDB, and serve from the cache.
7. **Earth Search legacy `sentinel-2-l2a` versus `c1-l2a`.** Element84 is moving to c1; prefer
   c1. Its STAC sort gave a history start of 2018-02 at this farm, so confirm before relying on it
   for history.
8. **The PC HLS mirror is incomplete and late:** S30 from 2020, L30 partially from 2017, with
   missing dates. LP DAAC is complete but needs a free Earthdata login.
9. **Cross-calibration window.** S2 and MODIS overlap from 2017 (Earth Search c1) or late 2015
   (PC), which gives plenty of pairs. Remember that MOD13Q1 is a 16-day maximum-value composite,
   so compare it with a 16-day maximum of S2, not with single dates.
10. **Polygons.** Probes used a synthetic 120 ha square. Real field boundaries (and within-field
    crop masks) will change clear fractions and NDVI means.
