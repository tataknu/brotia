# MODIS / VIIRS / long-record NDVI — data discovery notes

Family key: `modis-viirs-ndvi` · Probed 2026-11-06 (local evening, EST) · Sample farms: Estancia Los
Tajibos (-62.52, -16.86, tile h12v10), Arrocera Mineros (-63.29, -17.20, tile h11v10).

## TL;DR

1. **MODIS 250 m NDVI still updates (live-checked).** The newest Terra MOD13Q1 composite is
   `A2026289`. It starts 2026-10-16 and ends 2026-10-31, and LP DAAC published it on 2026-11-03.
   That is about 3 days after the composite window closes and about 21 days after it starts.
   This matches the "about 3 weeks" in ADR-0002 D3. History goes back to 2000-02-18 (614 Terra
   composites over the farms).
2. **MODIS ends within the product's life (not checked live).** NASA plans to stop Terra MODIS
   science data around Jan or Feb 2027 and Aqua MODIS around Sep 2027. Both satellites are
   drifting off their designed orbits. **We need VIIRS continuity in the design now.**
3. **VIIRS VI v002 is current but needs a free login.** VNP13A1, VJ113A1 and VJ213A1 v002
   (500 m, 16-day) are on LP DAAC. Their newest composites start 2026-10-24 and 2026-10-16.
   Downloads need an Earthdata login (free, instant email signup): the data link returns 302 to
   `urs.earthdata.nasa.gov`. **No keyless VIIRS VI path is current:**
   - ORNL serves VNP13A1 only up to 2024-05-24 and has no VJ1;
   - Planetary Computer has no VIIRS VI collection.
4. **Recommended primary: Planetary Computer `modis-13Q1-061`.** It needs no key: you get an
   anonymous SAS token and read cloud-optimised GeoTIFF (COG) windows. One window read covers the
   whole 12-farm portfolio on one tile, in 1.3–4.6 s per band per composite. PC runs about one
   composite behind LP DAAC.
5. **Recommended fallback: ORNL DAAC subset REST API (keyless).** It returns NDVI, pixel
   reliability and VI Quality as JSON pixel windows. It is slower (3–18 s per call) and allows at
   most 10 composites per call. Its Aqua (MYD13Q1) feed lags LP DAAC by one month.

## Probes run (all keyless)

| # | What | Request | Result |
|---|---|---|---|
| 1 | ORNL product list | `GET https://modis.ornl.gov/rst/api/v1/products` | 200; 46 products → `products.json` |
| 2 | ORNL dates per product @ Los Tajibos | `GET /rst/api/v1/{product}/dates?latitude=-16.86&longitude=-62.52` | Results in the table below; files `*.dates.json` |
| 3 | ORNL subset, 10 composites, km=1 | `GET /rst/api/v1/MOD13Q1/subset?latitude=-16.86&longitude=-62.52&band=250m_16_days_NDVI&startDate=A2026145&endDate=A2026289&kmAboveBelow=1&kmLeftRight=1` | 200, **8.8 s** for NDVI, 3.2 s for pixel_reliability, 3.4 s for VI_Quality; 9×9 px, cellsize 231.656 m, scale 0.0001 → `sample_MOD13Q1_10dates_km1.json` |
| 4 | ORNL subset, 11 composites | same, startDate=A2026129 | **400** `"Subset time period A2026129 to A2026289 exceeds maximum subset tiles support of 10."` (rejected in 0.5 s) |
| 5 | ORNL wet-season pixel reliability @ Arrocera Mineros | `MOD13Q1 … band=250m_16_days_pixel_reliability, A2026001–A2026081` and the same for 2024 | 200, 16–18 s for 6 composites. Fully clouded composites (all 81 px = 3): 2026-03-06, 2024-01-01, 2024-03-05. Partly clouded (10 of 81 px cloudy): 2026-01-17 |
| 6 | NASA CMR newest granule (keyless search) | `GET https://cmr.earthdata.nasa.gov/search/granules.json?short_name=…&version=…&bounding_box=-63.3,-17.8,-62.4,-16.8&sort_key=-start_date&page_size=1` | 0.1–4 s; results in the table below. Script `probe_cmr.py` |
| 7 | LP DAAC download auth | GET the VNP13A1 v002 `.h5` data link | **302 → urs.earthdata.nasa.gov/oauth** (Earthdata login required) |
| 8 | Planetary Computer STAC search (anonymous) | `POST https://planetarycomputer.microsoft.com/api/stac/v1/search` {collections, intersects point, sortby datetime desc} | 200, 0.4–0.5 s. 13Q1 newest = MYD A2026281 (2026-10-08), MOD A2026273 (2026-09-30). 43A4 newest = 2026-10-28. `viirs-13A1` and `noaa-cdr-ndvi` collections do not exist |
| 9 | PC SAS token | `GET /api/sas/v1/token/modiseuwest/modis-061-cogs` | 200 in 0.7 s, no auth, expires in about 1 h. **Note:** `/token/modis-13Q1-061` also returns a token, but that token gives **403** on the blob. Use the storage-account/container token |
| 10 | PC COG window read, one farm | rasterio windowed read, ±1 km | 9×9 px in 1.4 s for NDVI, 0.4 s for pixel_reliability. Script `probe_pc_cog.py` |
| 11 | PC COG window, whole portfolio bbox | bbox -63.35,-17.80,-62.42,-16.80 | h11v10 window 480×310 px, h12v10 window 480×273 px; **1.3–4.6 s per read**. Mean NDVI 2026-09-30 = 0.56–0.64; 2001-10-16 = 0.68. Script `probe_pc_portfolio_window.py` |
| 12 | AppEEARS product list | `GET https://appeears.earthdatacloud.nasa.gov/api/product` (no auth) | 200 in 0.36 s; 193 products. Includes MOD/MYD13Q1.061, MOD/MYD09Q1.061, MCD43A4.061, VNP13A1.002, VJ113A1.002, VJ213A1.002 (all marked "Present") |
| 13 | NOAA CDR NDVI (NCEI HTTPS) | `GET https://www.ncei.noaa.gov/data/land-normalized-difference-vegetation-index/access/2026/` | 200. Newest file `VIIRS-Land_v001_JP113C1_NOAA-20_20261102_c20261104…nc`, i.e. data date 2026-11-02, made 2 days later. History starts at `AVHRR-Land_v005_AVH13C1_NOAA-07_19810624`. **65.8 MB per daily global file**, above our 20 MB limit, so we did not download it. THREDDS catalog `ncei.noaa.gov/thredds/catalog/cdr/ndvi/` returned 503 after 60 s (twice), so OPeNDAP subsetting is unverified |

### Newest dates found (as of 2026-11-06)

| Product | ORNL (keyless JSON) | LP DAAC via CMR | Planetary Computer | History start |
|---|---|---|---|---|
| MOD13Q1 v061 (Terra 250 m 16-day) | 2026-10-16 | 2026-10-16 (published 11-03) | 2026-09-30 | 2000-02-18 |
| MYD13Q1 v061 (Aqua 250 m 16-day) | **2026-09-06 (lags)** | 2026-10-08 (published 10-27) | 2026-10-08 | 2002-07-04 |
| MOD09Q1 / MYD09Q1 (8-day 250 m reflectance) | not served ("Product MOD09Q1 not found") | 2026-10-24 | MOD 2026-10-16 | 2000-02-18 |
| MOD09A1 / MYD09A1 (8-day 500 m) | 2026-10-24 | – | – | 2000-02-18 / 2002-07-04 |
| MCD43A4 v061 (NBAR daily 500 m) | **"No MCD43A4 data available for -16.86 -62.52"** | 2026-10-29 | 2026-10-28 | 2000-02-16 |
| MCD15A2H (LAI/FPAR 8-day) | 2026-10-24 | – | MYD 2026-10-24 | 2002-07-04 |
| VNP13A1 (S-NPP VIIRS 500 m 16-day) | 2024-05-24 (presumably v001; ORNL shows no version; stopped) | **v002 2026-10-24** (login) | none | 2012-01-17 |
| VJ113A1 v002 (NOAA-20) | not served | 2026-10-16 (login) | none | 2018-01-01 |
| VJ213A1 v002 (NOAA-21) | not served | 2026-10-16 (login) | none | 2023-02-10 |
| VNP43IA4 / VJ143IA4 v002 (VIIRS NBAR 500 m daily) | – | 2026-10-30 / 2026-10-28 (login) | none | 2012 |
| MCD12Q1 / MCD12Q2 (land cover, phenology, yearly) | 2001–2025 | – | – | 2001 |
| MCD64A1 (burned area) | 2026-08-01 | – | – | 2000-11 |
| NOAA CDR NDVI (AVHRR→VIIRS, 0.05°, daily) | – | – | none | 1981-06-24; newest 2026-11-02 |

Composite dates are **start dates**. A 16-day composite covers [start, start+15]. The pixel's real
observation day is in band `composite_day_of_the_year`. Terra composites start on DOY 1, 17, 33, …
and Aqua composites on DOY 9, 25, …. Together they give an 8-day series.

### QA-masked farm aggregation on real data (`aggregate_demo.py`, Los Tajibos 9×9 window)

```
2026-05-25 good=81/81 median NDVI 0.788
2026-07-12 good=81/81 median 0.793
2026-08-13 good=81/81 median 0.681
2026-09-14 good=81/81 median 0.649
2026-09-30 good=60/81 (21 px cloud, reliability=3) median 0.725
2026-10-16 good=81/81 median 0.801
```
Dry-season NDVI near 0.79 at a "soy" coordinate means a winter crop, pasture or woody cover
inside the 1 km window. **Check the crop mask and polygon before trusting a 250 m pixel as
"the field".**

## Assessment per source

- **Planetary Computer `modis-13Q1-061` (+ `modis-09Q1-061`, `modis-43A4-061`, `modis-15A2H-061`).**
  - Access: no key; STAC search, anonymous SAS token per storage container, COG windowed reads
    with rasterio (already in `.venv`). Licence: NASA open data.
  - Assets: NDVI, EVI, VI_Quality, pixel_reliability, composite DOY, reflectances, angles.
  - Downside: about one composite (~8–16 days) behind LP DAAC. A token lasts about 1 h, so
    refresh it.
  - **Fit: primary for the baseline and the MODIS current value.**
- **ORNL DAAC MODIS/VIIRS Global Subset REST API.**
  - Access: no key; JSON with all pixels in the window and a header (xllcorner, yllcorner,
    cellsize, nrows, ncols, scale).
  - Limits: ≤10 composites per call; `kmAboveBelow` / `kmLeftRight` (km=1 gives 9×9 px at 250 m).
    Latency 3–18 s per call per band.
  - Gaps: MOD13Q1 is current, but MYD13Q1 lags by one month, VIIRS VI stops in 2024, and there is
    no MCD43A4 for Bolivia.
  - Full history: 62 calls per band per farm, so about 2–6 h for 12 farms × 2 bands run one after
    another.
  - **Fit: fallback, plus a simple health check.**
- **NASA CMR.**
  - Search needs no key and is fast (0.1–4 s). It is the authoritative "what is newest" check.
  - Data download needs Earthdata login.
  - **Fit: health check and latency monitor** (compare its newest date with the cache).
- **AppEEARS.**
  - Free Earthdata login (instant signup). The product list is public (verified).
  - Async point or area requests return per-pixel CSV or GeoTIFF with QA decoded. It is the only
    easy path to VIIRS v002 VI and NBAR, plus MODIS, in one API.
  - Jobs are queued and take minutes to hours, so it suits a nightly or one-off baseline
    prefetch, not live requests.
  - Not tested end-to-end (needs login). **Fit: VIIRS continuity path (fallback after MODIS ends).**
- **LP DAAC direct (earthaccess / HTTPS).**
  - Free Earthdata login. Whole HDF/HDF5 tiles of about 5–80 MB each.
  - **Fit: alternative to AppEEARS for VIIRS v002.** Not tested (login).
- **NOAA CDR NDVI (AVHRR 1981–2013 → VIIRS since 2014), 0.05° daily.**
  - No key. Latency about 2–4 days. 66 MB global file per day.
  - About 5 km per cell is far too coarse for a field, and the AVHRR-to-VIIRS sensor change adds a
    break in the record.
  - **Fit: baseline-only, for regional "is this a drought year since 1981" context.** Not core.
- **Google Earth Engine (`MODIS/061/MOD13Q1`, `NOAA/VIIRS/001/VNP13A1`, etc.).**
  - Needs a Google Cloud project and an Earth Engine account (non-commercial use is free but needs
    registration).
  - Very convenient for zonal stats across the full history.
  - Not verified (no account). **Fit: fallback / analysis only.** Avoid it as a runtime dependency.
- **eMODIS (USGS EROS).**
  - Produced for CONUS, Alaska, Central America, Africa and Central Asia, but not South America
    (from the USGS page; not probed).
  - **Fit: reject.**
- **MANVI (MAIAC nadir-adjusted EVI/NDVI for South America, Zenodo).**
  - A research product with a static archive. **Fit: reject for runtime;** maybe use for
    validation.

## Recommendations

### Variable: NDVI long-record baseline (same composite each year)
- **Primary:** PC `modis-13Q1-061`, Terra MOD13Q1 250 m from 2000 (≥25 seasons).
  - Fetch one window per tile per composite over the portfolio bbox (two tiles: farms west of
    about -62.75° are in **h11v10**, east of it in **h12v10**).
  - Store per-farm aggregates in DuckDB.
- **Fallback:** ORNL subset API, MOD13Q1 at the farm point, with `km` sized to the polygon.
- **Baseline-only context:** NOAA CDR NDVI (1981+, 5 km).

### Variable: NDVI current state (MODIS scale)
- **Primary:** MOD13Q1 plus MYD13Q1, merged into an 8-day series (Terra and Aqua are offset by
  8 days).
  - Use the newest composite from LP DAAC.
  - It reaches PC about one composite later, so in practice fetch from PC and show the date "as of".
- **Fallback:** ORNL (MOD only; its MYD feed lags).
- Sentinel-2 (other family) stays the 10 m "current" layer, per ADR-0002 D4.

### Variable: NDVI after MODIS ends (2027) — continuity
- **Primary:** VIIRS VNP13A1 / VJ113A1 / VJ213A1 v002 (500 m, 16-day) through AppEEARS or LP DAAC.
  This needs one free Earthdata account on the server, as an environment variable, and is a team
  decision.
- Cross-calibrate VIIRS to MOD13Q1 over 2018–2026 per farm (linear fit, as in the S2→MODIS plan).
  The VIIRS baseline alone starts in 2012, which gives about 14 seasons.
- **Fallback:** keep the MODIS 2000–2026 baseline frozen. Compare Sentinel-2 or HLS current values
  (cross-calibrated) against it.

### Optional: sun-angle-normalised reflectance
- MCD43A4 NBAR, daily 500 m, from PC `modis-43A4-061`; newest 2026-10-28.
- Use it to compute NDVI and NDMI (bands 2 and 6) in a way that is robust to Terra/Aqua orbit
  drift.
- It is also a 500 m NDMI-like moisture index source going back to 2000. NDMI from MOD09A1 is
  another option.

### How to aggregate pixels to a farm polygon
1. Reproject the farm polygon to MODIS sinusoidal:
   `+proj=sinu +R=6371007.181 +nadgrids=@null +wktext +units=m`.
   ORNL headers use the same grid (`xllcorner`, `yllcorner`, cellsize 231.656358 m).
2. Size the window from the polygon's extent (ORNL `kmAboveBelow` / `kmLeftRight` = ceil(half
   extent in km) + 1, or a COG window from the bounds). Do not always use km=1.
3. Keep the pixels whose **centre** is inside the polygon (or ≥50 % area overlap for small fields).
   If none qualify, use the nearest pixel and flag `mixed_pixel=true`.
4. Field value per composite = **median** of the good pixels (robust to edge mixing). Also record
   n_good / n_total.
5. Mark the composite **missing** if n_good / n_total < 0.5. Do not interpolate NDVI for anomaly
   scoring. For display only, carry the last good value with a "stale" flag.
6. Date each value by the median `composite_day_of_the_year` of its good pixels, not by the
   composite start date.

### QA masking
- `pixel_reliability` ∈ {0 good, 1 marginal} → keep. Drop 2 (snow), 3 (cloud) and −1 (fill).
- Strict mode, from `VI_Quality` bits: drop bits 2–5 (VI usefulness) ≥ 12, bit 8 (adjacent cloud),
  bit 10 (mixed clouds) and bit 15 (possible shadow). Optionally drop bits 6–7 (aerosol) = 3
  (high). Logic in `aggregate_demo.py`.
- The Santa Cruz wet season (Dec–Mar) produces fully clouded composites. Live evidence:
  2026-03-06, 2024-01-01 and 2024-03-05 at Mineros were 81/81 cloud. **Expect 20–40 % of
  wet-season baseline years to be missing** (estimate, not measured) for a given composite. Hence:
  - widen the baseline with the target composite ±1 (and Aqua's offset composites);
  - keep the sd floor from ADR-0002 D5;
  - require ≥8 valid baseline years, otherwise label the NDVI z-score "low confidence".

### Same-time-of-year matching
- Match on **composite DOY** (A2026289 ↔ A2025289 ↔ … ↔ A2000289). The composite periods are
  fixed each year, so the match is exact and needs no interpolation. The leap-year shift is at
  most one day.
- Baseline sample for target composite d in year Y: good farm values at composites {d−16, d, d+16}
  in every year ≠ Y (Terra), plus optionally Aqua at d±8. z = (x − mean) / max(sd, sd_floor).

### Cost and caching
Full Terra history over all farms is 614 composites × 2 tiles × 2 bands (NDVI + reliability), about
2,500 COG window reads of roughly 300 KB each at 1.3–4.6 s per read. That is about 1.5–3 h one
read at a time, or about 15–25 min with 8 parallel workers. It is a **one-time prefetch** at
service bootstrap, cached in DuckDB, followed by an incremental fetch of the newest composites.
**Do not compute baselines per request.** A farm not yet prefetched falls back to ORNL for its
point window (about 62 calls per band, so minutes).

## Open risks

1. **MODIS end of life.**
   - Terra science stop is expected around Jan or Feb 2027 and Aqua around Sep 2027 (from NASA
     pages, not verified live; sources disagree on exact dates).
   - The live feed was still current on 2026-11-06.
   - One web result says the instruments were to shut down on 2026-08-26. **Our live data
     disproves this:** MOD13Q1 A2026289 was published 2026-11-03 and MCD43A4 runs to 2026-10-29.
     Trust the live CMR check over news pages.
   - Show "data as of" as the composite **end** date (A2026289 → 2026-10-31), not its start date.
     Otherwise the UI looks 15 days staler than the data is.
   - The baseline stays valid, but the *current* MODIS value ends within months. We need a VIIRS
     v002 path, which needs an Earthdata login.
2. **Orbit drift.** Terra and Aqua are drifting, so overpass times change and so do sun and view
   angles. This can bias recent NDVI against a 2000–2020 baseline. Mitigations:
   - prefer MCD43A4 NBAR-derived NDVI for the most recent years;
   - or check whether recent z-scores of 2023–2026 non-drought years are centred on 0.
3. **No keyless VIIRS VI.** ORNL VNP13A1 stops in 2024-05, and PC has no VIIRS. Continuity needs
   a team decision on one free Earthdata account.
4. **Partial ORNL coverage.** MYD13Q1 lags a month, MCD43A4 is missing for Bolivia, and the old
   VIIRS v001 has stopped. Do not use ORNL as the only source.
5. **PC lags about one composite behind LP DAAC.** SAS tokens expire after about 1 h. The token
   endpoint is per storage container (`modiseuwest/modis-061-cogs`); the collection-level token
   returns 403.
6. **250 m pixels on small or narrow fields.** The rice at Mineros, the sugarcane and the
   smallholder colonies (Okinawa, Cuatro Cañadas lots) will have few pure pixels. Rely on the crop
   mask family and the Sentinel-2 layer. Show `n_good_pixels` in provenance.
7. **Land-use change in the baseline.** Much of Santa Cruz was cleared after 2000 (forest →
   soy). A 2000–2005 baseline over a field that was forest then is invalid. Restrict the baseline
   to years when MCD12Q1 says the pixel was cropland (yearly, 2001–2025, on ORNL), or start each
   farm's baseline at its first cropland year.
8. **Double cropping.** Summer soy and winter wheat/sorghum/sunflower in one year produce two NDVI
   peaks. Same-composite matching handles this naturally, but rotations between years (e.g. maize
   vs soy) widen the sd.
9. **Cloud gaps in the wet season** (see QA). Missing composites in Jan–Mar are normal. The UI
   should say "no clear view" and not drop the score to 0.
10. **NOAA CDR file size.** It cannot be fetched per request (66 MB per day). OPeNDAP subsetting
    is unverified.

## Files in this folder
- `notes.md` — this report
- `probe_ornl.py`, `probe_ornl_limits.py` — ORNL subset probes (latency, 10-date limit)
- `probe_cmr.py` — keyless CMR newest/earliest granule per product
- `probe_pc_stac.py`, `probe_pc_cog.py`, `probe_pc_portfolio_window.py` — Planetary Computer STAC,
  SAS token and COG window reads
- `aggregate_demo.py` — QA-mask and median aggregation on the real ORNL sample
- `products.json`, `*.dates.json` — ORNL product list and full composite date lists at Los Tajibos
- `sample_MOD13Q1_subset.json`, `sample_MOD13Q1_10dates_km1.json` — real 9×9 px windows (NDVI,
  reliability, VI Quality)

Sources (web, not probed):
[NASA Earthdata — transition from MODIS to VIIRS](https://www.earthdata.nasa.gov/data/alerts-outages/transition-from-modis-viirs),
[LAADS DAAC — MODIS to VIIRS transition](https://ladsweb.modaps.eosdis.nasa.gov/learn/modis-to-viirs-transition/),
[USGS eMODIS NDVI data dictionary](https://www.usgs.gov/centers/eros/science/emodis-ndvi-data-dictionary).
