# Frost, heat and hail signals: data discovery

- **Family key:** `frost-heat-hail`
- **Probed:** 2026-11-06/07 (all probes were keyless; no account was created)
- **Scripts:** `probe_*.py` in this folder. Small outputs are in `samples/`.
- **Python:** the project `.venv` has no netCDF, HDF5 or raster reader. The GLM, LST and
  CHIRTS probes ran in a scratch venv with `h5py`, `rasterio` and `pystac-client`. The service
  will need `h5py` and `rasterio`.

## TL;DR

1. **Lowland frost never reaches 0 °C in reanalysis.**
   - ERA5 and ERA5-Land, 1991–2026, at the wheat farm (Pailón), at Los Tajibos and at Viru Viru
     (SLVR): no day has Tmin ≤ 2 °C. The absolute minimum is 3.9–6.6 °C (lowest on 2021-07-01).
   - The SLVR station (GHCN-D) has two readings ≤ 3 °C (2002-06-24/26, 0.5–1.0 °C). Both are almost
     certainly bad data: clear-sky MODIS night LST was 12–15 °C and ERA5-Land Tmin was 12.3 °C.
   - Against the station, reanalysis is **2.0–2.6 °C too warm on the coldest nights**. This is an upper
     bound: the coldest-2 % set includes the two suspect 2002 station nights.
   - So ADR-0001's `frostC = 0 °C` would essentially never fire. Use a cold-night percentile, or an
     adjusted absolute threshold, instead (see Decision candidates).
2. **Rank agreement is good, which suits Suyana's "compare with own history".** Reanalysis flags 77–78 %
   of the station's coldest 5 % of nights. Percentiles work even where the absolute values are biased.
3. **ERA5-Land is too cool on hot days; use ERA5 or CHIRTS-ERA5 for heat.**

   | Source | Bias on the hottest station days (SLVR) |
   |---|---|
   | ERA5-Land | −3.1 °C |
   | ERA5 | −1.9 °C |
   | CHIRTS-ERA5 | −1.1 °C |

   - At Los Tajibos, the 13-month heat-stress total above 35 °C is 168 degree-hours with ERA5 and
     40 with ERA5-Land.
   - 2023 shows up clearly as the extreme heat year: 74–75 ERA5 days ≥ 35 °C, against a mean of
     about 30 a year.
4. **MODIS night LST (1 km) is a useful corroborator, not a frost detector.**
   - During the 2021-06-30 / 07-01 surazo, Aqua night LST was **0.8–4.5 °C across all 12 farms**,
     while ERA5 Tmin was 3.9–4.4 °C.
   - Clear sky on cold nights is only about 50 % (20 of 40 SLVR cold nights). The June 2023 cold
     snap was fully cloud-covered.
   - Where it is clear, LST runs a median **+4.9 °C** above station Tmin, because the 01:30 overpass
     comes hours before the dawn minimum.
5. **The hail environment is keyless but short.** Open-Meteo historical-forecast (GFS) gives hourly CAPE,
   lifted index and freezing level **from 2021-03-23 only**.
   - A 30-year CAPE history needs ERA5 from the CDS (free signup).
   - It is also keyless in the ARCO-ERA5 Zarr store, but chunks are 2 MB per global hour, so point
     series are impractical.
6. **GOES-19 GLM lightning works keyless and confirms real convection.**
   - Storm night 2026-01-04: 12–25 quality-0 flashes per 20-s file over the portfolio at 03–05 UTC.
     This matches the overnight hail cycle reported in the literature.
   - The model's "heaviest rain" day (2026-02-25) had **zero flashes**.
   - Volume is the catch: about 180 files and 66–108 MB per hour, roughly 1.7 GB a day. Use GLM
     event-driven only.
7. **Hail stays low-confidence, as in ADR-0001 D4.**
   - The published climatologies put the South American hail maximum in central Argentina
     (28–36°S). Santa Cruz (about 17°S) is on the northern fringe; I found no source calling it a
     hotspot.
   - Bolivian hail-loss reports mostly concern Andean valleys: 9,034 ha nationally by 2024-04-12
     (MDRyT via the press).
   - So hail = favourable environment + realised convection + an unexplained NDVI drop.

## What I probed

| # | Source / endpoint | Result (status, latency, excerpt) | Latest value | History start |
|---|---|---|---|---|
| 1 | Open-Meteo archive, `models=era5_land`, hourly T2m, Los Tajibos, 2025-10-01 → 2026-11-06 | 200, 0.56 s, 9,648 h, grid (−16.90, −62.50) at 246 m; Tmin 10.4, Tmax 37.3; frost hours ≤ 0 °C: 0; degree-hours > 35 °C: 39.7 | 2026-11-01T19:00 local (~5 d) | 1950 |
| 2 | Same, `models=era5`, `hourly=temperature_2m,cape` | 200, 0.53 s; Tmax 38.6; degree-hours > 35 °C: 168.5; **`cape` all null** | 2026-11-01T19:00 | 1950 verified (1950-01-01 values returned); 1940 per Open-Meteo docs, not probed |
| 3 | Open-Meteo archive, `cape` with `era5` / default / `ecmwf_ifs` | 200 but 0 values. **The archive API has no CAPE.** | – | – |
| 4 | Open-Meteo **historical-forecast** API, `hourly=cape,lifted_index` (`probe_cape_paths.py`, `probe_cape_start.py`) | 200, 0.4–0.6 s. 2022-01-01: CAPE 1,760, LI −3.0. Bisected: best_match = `gfs_seamless` → values from **2021-03-23**. `ecmwf_ifs025` and `icon_seamless` have no CAPE here. The API rejects dates before 2016-01-01 and returns nulls for 2016–2021-03. | 2026-11-05 23 UTC (forecast to 11-22) | **2021-03-23** |
| 5 | Open-Meteo forecast API, `hourly=temperature_2m,cape,lifted_index,freezing_level_height,precipitation,showers`, `past_days=7` | 200, 0.44 s; CAPE up to 3,600; freezing level about 5,100 m | now + 7 d | – |
| 6 | Open-Meteo archive, daily Tmin/Tmax 1991–2026 × 3 sites × 2 models (`probe_climatology.py` → `samples/frost_heat_annual_counts_1991_2026.csv`) | 200, 0.7–3.7 s per 35-year pull. **429 "Minutely API request limit exceeded"** without pacing; works with a 70 s sleep. Results in the table below. | 2026-10-31 (daily) | 1991 (requested) |
| 7 | GHCN-D `BLM00085244` (SLVR), NCEI CSV | 200, 0.68 s, 1.9 MB. Abs min 0.5 °C (2002-06-26, suspect). Since 1991, ≤ 3 °C twice; Tmax ≥ 35 °C on 25.6 d/yr; abs max 41.5 °C | 2025-08-24 (frozen; see `global-stations`) | 1984 |
| 8 | Station vs reanalysis at SLVR, n = 5,212 days (`probe_station_bias.py`) | ERA5-Land Tmin bias +0.68 overall, **+2.58 on the coldest 2 %** (an upper bound: includes the two suspect 2002 nights), r = 0.938; Tmax −2.85 overall, −3.13 on the hottest 2 %. ERA5 Tmin +0.82 / **+2.01**, r = 0.950; Tmax −1.45 / −1.87. Coldest-5 % hit rate 0.77 / 0.78 | – | – |
| 9 | Planetary Computer STAC `modis-11A1-061` (keyless; SAS token from `/api/sas/v1/token/modiseuwest/modis-061-cogs`) | Collection 200, 0.49 s; search 200, 1.2 s; COG 1-px read 1.2–3 s. Assets include LST_Day_1km, LST_Night_1km, QC_*, view time. The collection token `/token/modis-11A1-061` and `/sign` both gave **403 / 429**: use the container token. | **2026-11-04** (Terra and Aqua; ~2–3 d) | **2000-02-24** (Terra); Aqua 2002-07 |
| 10 | PC MOD/MYD11A1 at Pailón, recent 8 days | Night LST 21.9–25.0 °C on clear nights; **10 of 16 night passes cloudy** (QC = 2) | 2026-11-04 | – |
| 11 | PC MYD11A1 night LST at all 12 farms, cold events (`probe_lst_events.py`) | 2021-06-30: 11 of 12 clear, 1.6–4.1 °C. **2021-07-01: 12 of 12 clear, 0.8–4.5 °C** (Okinawa Uno 0.8, Brecha 8 1.2, Pailón 1.3). June 2023 cold snap, 06-13 to 06-16: 0–1 of 12 clear; 06-17/18 clear at 9–15 °C | – | – |
| 12 | PC MODIS night LST at the SLVR pixel vs station Tmin, 40 coldest station nights since 2000 (`probe_lst_vs_station.py`) | Clear on 20 of 40. LST − Tmin: median **+4.85 °C**, range −2.9 to +14.1. No LST ≤ 2 °C at SLVR | – | – |
| 13 | ORNL DAAC MODIS REST | First try 502/504 (60 s timeouts). Retry: **MOD11A1/MYD11A1 "not found"**: ORNL serves only 8-day LST. MYD11A2 200, 1.6 s, 2002-07-04 → 2026-09-22. VNP21A2 2012-01-25 → **2024-04-22 (stopped)** | MYD11A2 2026-09-22 | 2002 |
| 14 | NASA CMR granule search (keyless metadata) | VNP21A1N v002: 2026-11-02; VJ121A1N v002: 2026-11-04; MOD11A1 061: 2026-11-05. **Download needs an Earthdata login** (free signup) | 2026-11-04/05 | VNP 2012 |
| 15 | GOES-19 public S3 `noaa-goes19` (keyless) | Root listing 200, 0.25 s. Products present: GLM-L2-LCFA, ABI-L2-DSIF (stability indices), ACHAF (cloud-top height), ACMF, LSTF (hourly LST), CMIPF, … | GLM file 2026-311 05 UTC (~1 h) | GOES-19 from 2024; GOES-16 archive GLM 2018–2025, DSIF 2019–2025, LSTF 2017–2025 |
| 16 | GLM LCFA file parse (h5py) | 200, 0.2 s per 20-s file, 0.38–0.62 MB. Fields: `flash_lat`, `flash_lon`, `flash_energy` (J), `flash_area`, `flash_quality_flag`, group/event arrays. A random 20-s slice on 2026-11-05 had 380–1,115 flashes over the full disk, 0 in the bbox | – | – |
| 17 | GLM storm check (`probe_storm_day.py`, `probe_glm_daycurve.py`) | 2026-01-04 (DOY 004), 1 file per hour, portfolio bbox: **03 UTC 12, 04 UTC 25, 05 UTC 15** flashes per 20 s (≈ 2–4.5 k per hour); all other hours 0. 2026-02-25 (model max 31.8 mm/h): 0 in every hour. 2026-04-15: 1 flash | – | – |
| 18 | Open-Meteo historical-forecast daily convective summary at Los Tajibos, 2025-10 → 2026-11 → `samples/los_tajibos_daily_convective_env_2025-10_2026-11.csv` | Top days by max hourly rain: 2026-02-25 (CAPE 2,600, LI −2.8), 2026-04-15 (CAPE 2,610, LI −7.1), 2026-01-04 (CAPE 2,410, LI −4.0, gust 51 km/h) | 2026-11-05 | 2021-03-23 |
| 19 | NASA POWER hourly T2M (point, MERRA-2 based) | 200, 0.54 s, 840 of 888 valid h | 2026-11-04 23 h LST | hourly 2001; daily 1981 |
| 20 | NASA POWER daily T2M_MIN/MAX 1981 → | 200, 0.92 s. Abs min 2.1 °C on 1996-06-30 at Pailón; 2021-06-30: 3.5, 2021-07-01: 5.1 | 2026-11-04 | 1981-01-01 |
| 21 | CHC **CHIRTS-ERA5** `data.chc.ucsb.edu/experimental/CHIRTS-ERA5/` (keyless HTTP; Tmax, Tmin, HI, WBGT, VPD; daily, pentad, monthly) | Listing 200, 0.23 s. Daily GeoTIFF is 26 MB, strip layout (1 × 7,200 blocks), but range reads work: **1 px in 0.6–0.9 s**. Pailón Tmin 2021-07-01 5.12; Tmax 2023-10-10 36.5 | **2026-11-01** (~6 d) | **1980** |
| 22 | CHIRTS-ERA5 vs SLVR station, 25 hottest and 25 coldest days since 2005 (`probe_chirts_vs_station.py`) | Tmax bias **−1.06** (median −0.73); Tmin bias **+3.56** (median +3.49). **CHC returns 429 on bursts**: pace about 2 s | – | – |
| 23 | Old CHC paths `products/CHIRTSdaily/`, `products/CHIRTS-ERA5/` | 404 (moved to `experimental/`) | – | – |
| 24 | ARCO-ERA5 `gs://gcp-public-data-arco-era5/ar/full_37-1h-0p25deg-chunk-1.zarr-v3` (keyless HTTPS) | `.zarray` 200: CAPE shape (1,323,648 h, 721, 1,440), **chunks (1, 721, 1,440)**, about 1.98 MB each. `.zattrs`: ERA5 to 2026-06-30, ERA5T to **2026-10-31** | 2026-10-31 | 1940-01-01 |

### Annual frost and heat counts (ERA5-Land / ERA5 via Open-Meteo, 1991 → 2026-10-31)

| Site | Model | Abs Tmin (date) | Years with Tmin ≤ 2 °C | Mean days/yr Tmax ≥ 35 °C | Days ≥ 35 °C in 2023 / 2024 / 2025 |
|---|---|---|---|---|---|
| Pailón Norte (wheat) | ERA5-Land | 5.1 (1994-06-27) | none | 11.5 | 51 / 39 / 24 |
| Pailón Norte | ERA5 | 4.4 (2021-07-01) | none | 30.7 | 75 / 75 / 51 |
| Viru Viru SLVR | ERA5-Land | 5.3 (2010-07-19) | none | 4.2 | 29 / 22 / 7 |
| Viru Viru SLVR | ERA5 | 5.1 (2010-07-19) | none | 15.7 | 50 / 47 / 20 |
| Los Tajibos | ERA5-Land | 6.6 (2021-07-01) | none | 13.1 | 51 / 48 / 16 |
| Los Tajibos | ERA5 | 3.9 (2021-07-01) | none | 30.4 | 74 / 82 / 41 |

The station (SLVR) has Tmax ≥ 35 °C on 25.6 days a year, which agrees better with ERA5 than with
ERA5-Land.

## Sources found but not probed live

These are all `verified_live = false`.

- **IMERG 30-min (GPM, 0.1°).** Needs an Earthdata login (free, instant) at GES DISC, or a PPS NRT
  registration. A keyless daily IMERG V07 Early/Late is available through ClimateSERV (probed by
  `gridded-precip`). Max 30-min intensity is a good hail and convective-burst proxy, but not keyless.
- **ERA5 single levels via the Copernicus CDS** (CAPE, CIN, K-index, total totals, 0–6 km shear from
  u/v at levels). Free instant ECMWF account plus licence acceptance; server-side area subsetting
  makes a 30-year CAPE point series small. This is the right path for a long CAPE baseline.
- **GOES ABI-L2-DSIF** (derived stability indices: CAPE, LI, K, TT, Showalter; full disk, hourly,
  about 3.6 MB). Listed only. Clear-sky only, so it is blind exactly where storms are; context only.
- **GOES ABI-L2-LSTF** hourly 2 km clear-sky LST (0.7 MB per hour; GOES-16 2017–2025, GOES-19
  2024 →). Listed only. Could catch the pre-dawn minimum, which MODIS 01:30 misses. A notable
  alternative frost corroborator; it needs geostationary-projection pixel math.
- **Overshooting-top detection.** No operational OT product is in the NOAA buckets. You would derive it
  from ABI band 13 (CMIPF) cold-ring / brightness-temperature thresholds (≤ 215 K). Too heavy for v1.
- **Hail climatologies** (literature only): Cecil & Blankenship 2012 (AMSR-E); Bang & Cecil 2019
  (GPM GMI); Bruick, Rasmussen & Cecil 2019, MWR 147(12) (subtropical South America, 10–30 storms a
  year in central Argentina, overnight cycle, mean max CAPE on hail days about 3,400 J/kg vs about
  2,400 J/kg on null days); Zipser et al. 2006 / Rasmussen & Houze 2011 (TRMM extreme convection).
  None publishes a ready Santa Cruz grid we could ingest keyless.
- **VIIRS LST VNP21A1N / VJ121A1N** (750 m). Current per CMR; LP DAAC download needs an Earthdata login.
- **Sentinel-3 SLSTR LST** (1 km, daily, 2016 →). Copernicus Data Space (free signup). Not probed.
- **ESSL / ESWD** hail reports: Europe only; reject.
- **Post-event NDVI drop (hail damage evidence).** Sentinel-2 L2A via Planetary Computer (access probed
  by the `sentinel2-landsat-hls` family). The method is below. I found no dated, located lowland
  hail event in the press to test it on.

## Indicators I recommend

All indicators are lightweight and defensible.

### Frost

The crops at risk are winter crops: wheat, sunflower, sorghum and chia, mainly June–August around
heading and flowering. Late soy and maize are also exposed.

1. **`frost_coldnight_pct`** (primary).
   - Per night, ERA5 hourly T2m (Open-Meteo archive, `models=era5`) gives Tmin, then the percentile
     against the farm's own nights in a ±15-day window over 30 years.
   - Driver text: "coldest night for this date in 1 of 30 years".
2. **`frost_risk_hours`** (ADR-0001 count, recalibrated).
   - Hours with ERA5 T2m ≤ **5 °C**. Given the +2.0–2.6 °C warm bias on cold nights, that is about
     2.5–3 °C screen level, a classic radiative ground-frost risk.
   - Report as a percentile against the same window.
   - Confidence is higher inside the crop's sensitive window from the calendar.
3. **`frost_lst_corroboration`**.
   - MYD11A1 LST_Night (01:30) ≤ 2 °C, or ≤ the farm pixel's own p5 for the window, raises the
     confidence of a cold-night flag. MOD11A1 (22:30) is the backup.
   - When cloudy, say "satellite: no clear view".
   - 2021-07-01 would have fired on all 12 farms.

### Heat

The sensitive stages are soy and maize flowering and grain fill, wheat grain fill (≥ 30–32 °C), and
sunflower anthesis.

1. **`heat_degree_hours_35`**: Σ max(0, T2m − 35 °C) over the last N days from ERA5 hourly
   (not ERA5-Land), as a percentile against the same window.
2. **`heat_days_35`**: count of days with Tmax ≥ 35 °C (ADR-0001 `heatC`), as a percentile.
   - A bias-corrected absolute version comes from CHIRTS-ERA5 Tmax (−1.1 °C bias), keyless, 0.05°.
3. Optional: **CHIRTS-ERA5 WBGT / heat index** for labour or livestock heat. Out of scope for crops.

### Hail

Low confidence. ADR-0001 D4 stays.

1. **`hail_env_day`** (environment).
   - Daily max CAPE ≥ the farm's own p90 for October–March, **and** min lifted index ≤ −3.
   - Source: Open-Meteo historical-forecast (GFS), keyless, baseline from 2021-03.
   - Disclose the short baseline. Upgrade to ERA5 CDS CAPE (1991 →) when someone signs up.
2. **`convection_confirmed`** (realised).
   - On `hail_env_day` dates only, fetch GOES-19 GLM LCFA, one 20-s file every 10 minutes for
     15–12 UTC (about 50 MB), and count quality-0 flashes within 25 km.
   - A daily IMERG heavy-rain day (ClimateSERV) is the keyless alternative.
   - Run this as an offline batch into DuckDB, not on the request path.
3. **`hail_damage_evidence`** (from ADR-0001).
   - Sentinel-2 NDVI from the last clear scene up to 10 days before to the first clear scene up to
     10 days after drops by ≥ 0.15, or its z-score drops by ≥ 1.5.
   - Exclude these causes: no frost night in the window, not inside the harvest/maturity window from
     the crop calendar, not a gradual drought decline (a 30-day slope test).
   - Label "possible hail".
   - MODIS LST_Day jump or NDMI drop can be added as supporting evidence.

## Decision candidates (for a future data ADR)

| Variable | Primary | Fallback | Baseline | Why | Consequences |
|---|---|---|---|---|---|
| Hourly T2m for frost and heat | **Open-Meteo archive `models=era5`** (0.25°, 1950 → verified, ~5 d latency, keyless) + Open-Meteo forecast `best_match` for the last 5 days ("estimated") | NASA POWER hourly (MERRA-2, 2001 →, keyless); ERA5-Land only for Tmin | 30 y (1996–2025) same ±15-day window | Best rank agreement with the station (r 0.95); smaller hot-day bias than ERA5-Land | Absolute values are biased (+2 °C cold nights, −1.9 °C hot days): use percentiles. Open-Meteo free tier is non-commercial; minutely limit is hit by 35-year pulls (pace them; cache in DuckDB) |
| Daily Tmax / Tmin (counts) | ERA5 daily via Open-Meteo | **CHIRTS-ERA5** (0.05°, 1980 →, ~6 d, keyless) for Tmax / heat; NASA POWER daily (1981 →) | 30 y | CHIRTS-ERA5 has the smallest hot-day bias (−1.1 °C) | CHIRTS-ERA5 Tmin is poor on cold nights (+3.6 °C). Strip GeoTIFFs: one range read per date; CHC 429s on bursts |
| Frost corroboration (1 km) | **PC `modis-11A1-061` LST_Night** (Aqua 01:30, Terra 22:30), 2000 →, ~2–3 d | ORNL MYD11A2 8-day (keyless REST); VIIRS VNP21A1N (Earthdata login) | 2003 → (Aqua) same-window pixel percentiles | Showed the 2021 surazo at all 12 farms, 1 km farm-to-farm detail | About 50 % cloud gaps on cold nights; LST is not air temperature (+4.9 °C median offset). Never a standalone trigger |
| Convective instability (CAPE, LI, freezing level) | **Open-Meteo historical-forecast** (GFS, hourly, keyless) | ERA5 CAPE via CDS (free signup, 1940 →); ARCO-ERA5 Zarr only for event spot-checks | Only 2021-03 → (about 5 seasons) | Only keyless point CAPE history | Short baseline: label the p90 "since 2021". CDS signup unlocks 30 y |
| Lightning (realised convection) | **GOES-19 GLM L2 LCFA** on `noaa-goes19` (keyless, ~1 h latency; GOES-16 archive 2018–2025) | IMERG daily heavy rain (ClimateSERV, keyless) | Same-season flash-day counts (2018 →) | Distinguishes real storms from model rain (2026-02-25 had 0 flashes) | 1.7 GB a day at full rate: event-driven sampling only; needs `h5py` |
| Hail damage | Sentinel-2 NDVI drop (PC) with exclusion rules | MODIS MOD13Q1/MOD09 drop | Pre/post event | Only direct evidence of damage | No validation event found in the lowlands; low confidence |

**Threshold change to flag.** ADR-0001 D3 `frostC = 0 °C` (Tmin) will not trigger from reanalysis in
the Santa Cruz lowlands. The proposal is either:
- relative (Tmin ≤ the farm's own p5 for the window), or
- ERA5-calibrated: ERA5 Tmin ≤ 5 °C ≈ screen 2.5–3 °C ≈ ground frost.

`heatC = 35 °C` is fine with ERA5 or CHIRTS-ERA5, but not with ERA5-Land.

## Open risks

- **Station quality.** GHCN-D SLVR stops at 2025-08 and has spurious cold readings (2002-06-24/26).
  The bias numbers depend on one airport station 11–109 km from the farms.
- **Frost is rare in the lowlands.** Strong cold-surge nights (station ≤ about 4 °C, or ERA5 ≤ about 4.5 °C)
  happen about 1–2 times a decade (1994-06, 1996-06, 2021-07). None is a confirmed screen-level frost.
  A frost signal will mostly be zero. Make sure the UI shows "no cold-stress" rather than looking
  broken. Damage reports blend drought with frost: in 2024, 98 % of losses were drought.
- **The cloudy-cold-surge blind spot** (June 2023) for MODIS. ERA5 hourly must carry those nights.
- **Open-Meteo licence and limits.** The free API is for non-commercial use. A bank-facing product would
  need the paid API or self-hosting the ERA5 data. 429s appear after a few 35-year pulls in a
  minute.
- **CAPE baseline is only about 5 seasons** without CDS signup. GFS CAPE is a forecast-model analysis,
  not ERA5, so the series may be inhomogeneous.
- **Hail-hotspot claim is unsupported.** The literature puts the South American hail maximum in
  Argentina, not Santa Cruz. Present hail as "possible hail (low confidence)".
- **GLM volume and parsing.** Each 20-s file must be downloaded whole; there is no gridded GLM product in
  the bucket. A gridded GLM (GHRC) needs an Earthdata login.
- **Service rate limits.**
  - PC SAS: the collection token gives 403; `/sign` gave 429; use the container token. Tokens last
    about 1 h.
  - CHC 429s burst reads.
  - ORNL was intermittently 502/504.
- **Network flakiness during probes.** There was a transient DNS failure to PC, so wrappers need retries
  and the DuckDB cache.

## Sources (web)

- Bruick, Rasmussen & Cecil 2019, *Subtropical South American Hailstorm Characteristics and
  Environments*, MWR: https://pmc.ncbi.nlm.nih.gov/articles/PMC7241597
- Bang & Cecil, GPM passive-microwave hail climatology: https://ntrs.nasa.gov/api/citations/20190033913/downloads/20190033913.pdf
- 2024 losses (drought 98 %, frost; San Julián, Cuatro Cañadas, Pailón): https://eju.tv/?p=4278455
- 9,034 ha hail nationally by 2024-04-12: https://www.potatopro.com/es/node/157671
- June 2023 cold snap in Santa Cruz (sorghum, soy, wheat): https://bolivianthoughts.com/2023/06/17/bolivia-cold-snap-brings-rare-snow-to-tropical-farm-region-la-ola-de-frio-en-bolivia-trae-inusual-nieve-a-la-region-agricola-tropical
- CHIRTS-ERA5 readme: https://data.chc.ucsb.edu/experimental/CHIRTS-ERA5/aaa.readme.txt
