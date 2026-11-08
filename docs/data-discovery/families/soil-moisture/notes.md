# Soil moisture and water balance — data discovery notes

Family key: `soil-moisture` · Date: 2026-11-06 · Probe farm: Estancia Los Tajibos (-16.86, -62.52); second farm: Arrocera Mineros (-17.20, -63.29).
All probe scripts and their raw outputs (`probe_*.py` / `probe_*.out`) are in this folder.

## TL;DR

- **Primary (root zone, daily):** ERA5-Land via Open-Meteo archive, `models=era5_land`, layers 0–7, 7–28, 28–100 cm (+ `soil_moisture_0_to_100cm_mean` daily). Keyless, 1950+, about 5 days latency (latest value 2026-11-01). A 30-year daily pull takes about 8 s and 400 KB.
- **Fallback 1 (derived, works with any rain + ETo source):** FAO-56 single bucket model, `S += P − Ks·Kc·ETo`. TAW comes from the SoilGrids `wv0033 − wv1500` layers (126 mm/m at Tajibos, 147 mm/m at Mineros). Daily r = 0.89 against ERA5-Land 0–100 cm; anomaly r = 0.83.
- **Fallback 2 (keyless, independent model):** NOAA CPC leaky-bucket monthly soil moisture (0.5°, 1948+, latest 2026-10) over the PSL OPeNDAP server.
- **Static soil properties:** ISRIC SoilGrids v2 REST (keyless, 250 m). Fetch once per farm and cache.
- **Best upgrade with a free instant signup:** SMAP L4 SPL4SMGP (9 km, 3-hourly, root zone, 2015+, latency about 2 days; NASA Earthdata login). C3S satellite soil moisture ICDR (CDS key, 1978+, surface only, latency about 1 week).
- **Demote:** NASA POWER GWETROOT (MERRA-2). It is keyless and convenient but disagrees with every other source (see below). **Validation only, not in the fallback chain.** A fallback that inverts the signal is worse than showing "no data".

## Discoveries other families need (cross-cutting)

1. **Open-Meteo `models=era5_land` returns all-null `precipitation_sum` and `et0_fao_evapotranspiration` as daily aggregates.** `models=era5` (0.25°) works. The gridded-precip and temp-eto families will hit this (probe_bucket.py history).
2. **Open-Meteo `best_match` silently splices models.** For the archive at this point, `best_match` = `ecmwf_ifs` (9 km grid at -16.837, -62.526) and runs to today. `era5_land` (grid -16.90, -62.50) stops 5 days earlier. Over Sep–Dec 2025, ERA5-Land minus IFS on 0–100 cm had a mean of +0.008 and an sd of 0.022 m³/m³. That is about a quarter of the year-to-year spread for the same window (about 0.08). **Wrappers must always pass `models=` explicitly. Never build a baseline on `best_match`.**
3. **The Open-Meteo minutely rate limit is real.** One 30-year hourly pull of 4 variables, then 4 small calls, returned HTTP 429 "Minutely API request limit exceeded". For 12 farms × several variables × 30 years, the DuckDB cache in ADR-0002 is required, not optional. Prefer `daily=` aggregates over `hourly=` because they are much lighter. The Open-Meteo free tier is **non-commercial (CC-BY 4.0 data, fair use)**: fine for the hackathon, but a bank product needs the paid tier or direct Copernicus CDS ERA5-Land.
4. **Window-boundary artefact.** Tajibos 2026: ERA5-Land root zone is at the **87th pct** for Oct 7–Nov 1 while ERA5 rain in the same window is at the **10th pct**. The cause is 58 mm of rain on Oct 5–6, just before the window (0–100 cm jumped from 0.368 to 0.405 overnight). October's total rain was at the 63rd pct. Soil moisture integrates rain that fell before the window. The formula spec should align windows or show antecedent rain, or the "WHY" panel will contradict itself.
5. **SoilGrids:** each call took 6–13 s. ISRIC asks for a low request rate (fair use, about 5 calls/min). The `wv0033` (field capacity, 33 kPa) and `wv1500` (wilting point) layers give AWC directly, so no pedotransfer function is needed. The Saxton–Rawls 2006 PTF from sand, clay and SOC agreed within 4 mm (122 vs 126 mm). Unit trap: `wv*` values / 1000 = m³/m³; clay, sand and silt / 10 = %; soc / 10 = g/kg.

## Decisions ready for an ADR (one line each)

| # | Decision | Evidence | Consequence |
|---|---|---|---|
| SM-1 | Root-zone soil moisture = ERA5-Land 0–100 cm (daily mean) from Open-Meteo, `models=era5_land`; percentile against the same calendar window, 1996–2025 | Keyless, 1950+, 5-day latency, 30-year pull in 8 s; flags the 2023 drought (7th pct) and 2024 (0th pct) at Tajibos | "Data as of" for soil = ERA5-Land last date (about today − 5 d), not today |
| SM-2 | Do not splice IFS/best_match into the percentile series; optionally show the last 5 days as "estimated" | Bias sd 0.022 vs signal spread ~0.08 | One model per baseline; provenance carries the model name |
| SM-3 | Fallback = FAO-56 bucket (P − Ks·Kc·ETo, TAW from SoilGrids, p = 0.5) | r = 0.89 daily, 0.83 anomaly vs ERA5-Land; 2023 → 0th pct, 2024 → 7th pct | Only independent of Open-Meteo *soil*; still depends on the rain/ETo source (partly circular) |
| SM-4 | TAW per farm from SoilGrids `wv0033 − wv1500` over 0–100 cm, cached once | 126 mm (Tajibos), 147 mm (Mineros) | Also enables a crop-specific Kc bucket later |
| SM-5 | NASA POWER GWETROOT is validation-only | 30-day anomaly r = 0.38 vs ERA5-Land; 2026 0th pct vs 87th; 2024 52nd vs 0th | Not in the default fallback chain |
| SM-6 | Satellite surface products (ESA CCI, C3S, CLMS SWI, SMAP L3) are validation or a separate "topsoil" signal, not root zone | They measure about the top 5 cm | Formulas need root zone, so these are not primary |

## What I probed (live, 2026-11-06)

| Source | Call | Result |
|---|---|---|
| Open-Meteo archive ERA5-Land | `archive-api.open-meteo.com/v1/archive?models=era5_land&hourly=soil_moisture_0_to_7cm…100_to_255cm` | 200, 0.4–8 s; units m³/m³; last non-null **2026-11-01** (about 5 days); 1950-01-01 returns data (0.491 at 28–100 cm); 30-year daily of 4 layers in 7.6 s / 417 KB, 5 nulls in 11,268 days |
| Open-Meteo daily aggregates | `daily=soil_moisture_0_to_100cm_mean,…` | 200, 0.5 s. Daily means exist for 0–7, 7–28, 28–100 and **0–100 cm** |
| Open-Meteo model variants | era5_land / era5 / era5_seamless / ecmwf_ifs / best_match | era5* last 2026-11-01; ecmwf_ifs and best_match last 2026-11-06 (0.376) |
| Open-Meteo forecast API | `api.open-meteo.com/v1/forecast?past_days=10&hourly=soil_moisture_0_to_1cm…27_to_81cm` | 200, 0.18 s; different layer set (0–1, 1–3, 3–9, 9–27, 27–81 cm), runs to tomorrow. Only for nowcast or forecast, not baselines |
| ISRIC SoilGrids v2 | `rest.isric.org/soilgrids/v2.0/properties/query` (clay, sand, silt, soc, bdod, wv0010, wv0033, wv1500 × 5 depths) | 200, 6–13 s, 5 KB. Tajibos: clay 28–37 %, sand 42–47 %, FC ≈ 0.29, WP 0.13–0.18 → TAW 126 mm/m. Mineros: TAW 147 mm/m. Sample: `sample_soilgrids_tajibos.json` |
| Bucket vs ERA5-Land | probe_bucket.py (ERA5 P + ETo 1996–2026, TAW 126, Kc 1, p 0.5) | Daily r 0.886, Spearman 0.889, 30-day anomaly r 0.833. Oct 7–Nov 1 pct: 2023 0/7, 2024 7/0, 2025 21/17, 2026 87/87 (bucket/ERA5-Land) |
| NASA POWER | `power.larc.nasa.gov/api/temporal/daily/point?parameters=GWETROOT,GWETTOP,GWETPROF` | 200, 0.5–0.7 s; fraction 0–1; latest **2026-11-03**; history 1981-01-01. Anomaly r vs ERA5-Land 0.38; window pct 2023 17, 2024 52, 2025 59, 2026 0. Its rain disagrees with ERA5 too (2024: 126 vs 56 mm) |
| NOAA CPC soil moisture | PSL THREDDS OPeNDAP `Datasets/cpcsoil/soilw.mon.mean.nc` | 200, 0.2–1.3 s; monthly mm (0–1.6 m bucket), 0.5°; **1948-01 → 2026-10**. Tajibos cell (-16.75, 297.25): May–Oct 2026 = 423, 384, 334, 313, 271, 299 mm. Oct 2026 pct 60, Oct 2023 pct 14 |
| ESA CCI SM v09.2 COMBINED | CEDA `dap.ceda.ac.uk/neodc/esacci/soil_moisture/data/daily_files/COMBINED/v09.2/` | Directory 200. Daily global netCDF is **1.4–1.8 MB** (downloaded in 2.4 s). Read with rasterio: **0.166 m³/m³** at Tajibos on 2024-11-01, 0.240 at Mineros. Coverage 1978 → **2024-12-31** (no 2025/26 in the CDR) |
| C3S satellite soil moisture (ICDR) | CDS catalogue `api/catalogue/v1/collections/satellite-soil-moisture` | 200. Temporal extent 1978-11-01 → **2026-10-31**, CC-BY-4.0. Download needs a CDS key (not tested) |
| CDS ERA5-Land | catalogue `reanalysis-era5-land` | Extent 1950 → 2026-11-01 (matches Open-Meteo) |
| CLMS Soil Water Index global 12.5 km (ASCAT) v4 | CDSE STAC `stac.dataspace.copernicus.eu/v1/search` | 200, 0.4–1 s. Daily COG 2007-01-01 → latest item **2026-09-15** (7 weeks old: a real lag or late indexing). Assets are `s3://eodata/...`, so a CDSE account is needed. T-values SWI001…SWI100 = deeper with larger T. The old `globalland.vito.be` manifests refused the connection |
| CLMS SSM 1 km (Sentinel-1) | CDSE STAC | Only `clms_ssm_europe_1km` exists. **No global or Bolivia 1 km product.** Reject |
| SMAP L4 SPL4SMGP v008 | NASA CMR `granules.json?point=…` | 200, 0.2 s. 2015-03-31 → **2026-11-04** (about 2 days). Data needs Earthdata login (NSIDC host refused the connection; data now in Earthdata Cloud). Also on AppEEARS (product list is public) |
| SMAP L3 SPL3SMP / SPL3SMP_E | CMR | 2015-03-31 → 2026-11-05 (surface only) |
| GLDAS Noah 2.1 3-hourly / monthly | GES DISC directory + CMR | Listing public. Latest **2026-07-31** (3-hourly) and 2026-07 (monthly): about 3 months. Files 302 to URS login |
| GLDAS CLSM 2.2 daily (GRACE-DA) | CMR | 2003-02 → 2026-08-31 (about 2 months). Root zone and profile |
| FLDAS Noah global monthly 0.1° | GES DISC + CMR | 1982-01 → **2026-09**. Covers Latin America through the global domain. File needs URS login (302) |
| GES DISC Hydrology Data Rods | timeseries.cgi | Redirects to an alert: "will be discontinued". Do not depend on it |
| TerraClimate soil | UIdaho THREDDS `TERRACLIMATE_ALL/data/TerraClimate_soil_2025.nc` | 200, 0.7 s. Monthly 4 km, mm (scale 0.1). Tajibos 2025: Jan 51, Mar 83, Oct 10.7, Dec 25.5 mm. Latest year file is **2025** (annual release, so up to about 15 months lag) |
| HWSD v2 | FAO S3 `HWSD2_RASTER.zip` | HEAD 200, 22.4 MB (plus DB 9.3 MB). Not downloaded (over the size cap) |
| NASA GIBS WMTS | GetCapabilities | 200. Lists soil-moisture *imagery* layers (AMSR, SMAP, CYGNSS). Images, not values. Map tiles only |
| GLEAM v4 | gleam.eu | Homepage 200. Data comes by registration (SFTP), 0.1°, 1980–2023+. Not tested |

## Recommended primary and fallback per variable

| Variable | Primary | Fallback chain | Baseline / validation |
|---|---|---|---|
| Root-zone soil moisture (daily, percentile) | ERA5-Land 0–100 cm, Open-Meteo `models=era5_land` | 1) FAO-56 bucket (Open-Meteo ERA5 P + ETo, SoilGrids TAW) → 2) NOAA CPC monthly (OPeNDAP) → else show "no data" | SMAP L4 (with Earthdata signup), FLDAS monthly, TerraClimate; NASA POWER GWETROOT validation-only |
| Surface/topsoil SM (0–7 cm) | ERA5-Land 0–7 cm (same call) | C3S ICDR COMBINED (CDS key) → CLMS SWI001 (CDSE account) | ESA CCI v09.2 (CEDA keyless, 1978–2024) to validate the 2023–24 backtest from satellite |
| Soil water-holding capacity (TAW/AWC) | SoilGrids `wv0033 − wv1500`, 0–100 cm | Saxton–Rawls PTF from SoilGrids sand/clay/SOC → HWSD v2 AWC classes | — |
| Water-balance deficit (mm) | Bucket model output (S/TAW, days with Ks < 1 = water-stress days) | — | ERA5-Land percentile |

## Notable alternatives (not probed in depth)

- **NASA-USDA Enhanced SMAP (10 km, GEE `NASA_USDA/HSL/SMAP10KM_soil_moisture`)** is GEE-only (needs a Google account / Cloud project) and appears superseded by `NASA/SMAP/SPL4SMGP` in GEE. Not used (verified = false).
- **Crop-CASMA (USDA/GMU)** covers CONUS only (web search, not probed). Reject.
- **ISMN in-situ network:** dataviewer reachable (200). No Bolivian stations confirmed (verified = false). Treat in-situ validation as unavailable.
- **SENAMHI Bolivia:** no public gridded soil-moisture product found. Spanish-language searches returned only Peru's SENAMHI agro-stations.
- **GLEAM v4:** root-zone SM plus evaporative stress. Good for a research baseline. Registration plus SFTP; release lag about a year.

## Open risks

1. **Model dependence:** soil-moisture percentiles depend on the model. For Oct 2026, ERA5-Land gives 87, CPC 60, POWER 0. All sources agree on the 2023 drought (ERA5-Land 7, bucket 0, CPC 14, POWER 17). For 2024, ERA5-Land (0) and the bucket (7) agree; POWER (52) does not. Show a confidence label when the fallback and the primary disagree.
2. **Coarse resolution:** ERA5-Land is 0.1° (about 9–11 km), so farms in the same cell get the same value. Neighbouring farms in Okinawa and Cuatro Cañadas will look identical. NDVI/NDMI must carry the field-level signal. The bucket model with per-farm SoilGrids TAW adds a small per-farm difference.
3. **Absolute values are not comparable across sources:** ERA5-Land uses its own soil texture (Tajibos 0–100 cm ≈ 0.32–0.46 m³/m³, while SoilGrids FC ≈ 0.29). Use only percentiles or the bucket's S/TAW; never compare θ to SoilGrids FC/WP.
4. **Latency:** ERA5-Land is about 5 days behind. The "data as of" label must show it. Gap-filling with IFS changes the distribution (risk SM-2).
5. **Licensing:** Open-Meteo free = non-commercial. CDS ERA5-Land and C3S are CC-BY-4.0 with a free key. SoilGrids is CC-BY-4.0. CPC and NASA products are public domain.
6. **The bucket fallback is not independent** of the precip/ETo family. If Open-Meteo is fully down, the bucket must run on the other families' fallback rain (CHIRPS etc.) and ETo.
7. **CLMS SWI's latest STAC item is 7 weeks old.** It is unclear whether this is a production lag or late indexing.
