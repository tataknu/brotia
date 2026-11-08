# Family: temperature, reference ET (ETo), actual ET (`temp-eto`)

Probed 2026-11-06/07 from a laptop: Python and requests, rasterio over `/vsicurl` for COGs, and refet in a scratch venv.
No accounts, keys or credentials were used. Sample farm: **Estancia Los Tajibos (-62.52, -16.86)**.
Validation point: **Viru Viru airport (SLVR, -63.135, -17.645)**, with NOAA GSOD station 852440.
Every number below comes from a script in this folder; its `.out` file holds the raw output.

> Note: `probe_core.py`, `probe_chirts.py` and `sample_power_daily_tajibos.csv` were written into this
> folder by another, concurrent process. They were not used in this report.

## Key lesson for every family
**Comparing a current window from one model or stream against a baseline built from another manufactures
anomalies.** We found this twice: NASA POWER's switch from MERRA-2 to GEOS-IT about 2026-10-01, and Open-Meteo `best_match`
switching to IFS. The baseline and the current value must come from the same homogeneous stream.

## TL;DR

| Variable | Primary | Fallback | Last resort / baseline-only |
|---|---|---|---|
| Tmax / Tmin daily | **Open-Meteo archive `models=era5`** (0.25°, 1950 verified, 1940 per docs not verified, to about T-6 d, keyless) | NASA POWER T2M_MAX/MIN (MERRA-2 part only) | CHIRTS-ERA5 (0.05°, best absolute accuracy, slow access) |
| ETo daily (FAO-56) | **Open-Meteo `et0_fao_evapotranspiration`, `models=era5`** (use as-is) | Compute FAO-56 ourselves with `refet` on POWER inputs, with **u2 derived from WS10M**, labelled "estimated" | Hargreaves-Samani from ERA5 Tmax/Tmin; WaPOR v3 L1-RET-E (daily, 2018+) |
| Actual ET | **FAO WaPOR v3 L1-AETI-D** (300 m, dekadal, 2018 to 2026-10-D3, keyless COGs, global) | MODIS MOD16A2GF (baseline 2000-2025) plus MOD16A2 (current, about 3 weeks latency) via ORNL REST | SSEBop v6.1 (FEWS NET, 2012+, 136 MB global zips); TerraClimate AET (monthly, 1958-2025, baseline-only) |
| LST (heat context) | MODIS MOD11A2 via ORNL (1 km, 8-day, 2000 to 2026-10-24) | MYD11A2 | — |

Recommendation on "compute ETo ourselves?": **No, not for the primary path.** Open-Meteo's ET0 is a genuine
FAO-56 Penman-Monteith (computed hourly, then summed). Recomputing it daily from the same ERA5 inputs gives
r = 0.99 and MAE 0.2 mm/d, and the archive is consistent from 1940 to today. **Yes, for the fallback path:** keep
a `refet`-based FAO-56 in the service. It matches my hand-coded FAO-56 to 0.01 mm/d. `pyeto` is not on PyPI
(GitHub-only, unmaintained), so we should not depend on it.

## Probe results

### 1. Open-Meteo Historical API (ERA5 / ERA5-Land / IFS), keyless (`probe_openmeteo*.py`)
- `archive-api.open-meteo.com/v1/archive`: HTTP 200, about 0.43 s. A 30-year daily pull for one point (3 vars) took 0.7 s and 440 KB.
- Latest non-null date by model, queried 2026-11-06:
  - `era5`, `era5_land`, `era5_seamless`: **2026-10-31** (about 6 days latency).
  - `best_match`: 2026-11-06, because it fills the gap with ECMWF IFS.
- History start: `era5` and `era5_land` have valid values from 1950-01-01 (verified). The 1940 request returned HTTP 200, but its values were not checked. ERA5 starts in 1940 according to Open-Meteo's docs (not verified).
- **No keyless actual ET on the ERA5 grid:** `hourly=evapotranspiration` with `models=era5` returned all-null for Oct 2023 (`probe_misc.out`). That is why WaPOR is the primary source for actual ET.
- **`era5_land` returns `et0_fao_evapotranspiration` = null for every day.** Use `era5` or `era5_seamless` for ET0.
- `best_match` uses the 9 km IFS grid (cell -16.84, -62.53) for recent years and ERA5/ERA5-Land before that. **The record is
  not homogeneous**, so do not build percentiles from it.
- Forecast API with `past_days=10`: HTTP 200, 0.09 s. It returns Tmax, Tmin and ET0 up to today (2026-11-06: 34.7 / 23.7 °C,
  ET0 6.5 mm). Useful only as a labelled "estimated" tail.
- **Rate limits (verified):** HTTP 429 "Minutely API request limit exceeded" after about 5-6 consecutive multi-decade
  pulls. Open-Meteo weights a request by its length and number of variables, so a 77-year pull costs hundreds of "calls"
  against the limit of 600 per minute. The hourly cap (5k) and daily cap (10k) are not verified.
  Backfilling 12 farms × 30 y needs pacing (about one long pull every 10-15 s) and must land in the DuckDB cache.
  At 0.25°, several of the 12 farms share an ERA5 cell, so deduplicate requests by grid cell (this also means
  neighbouring farms get identical weather anomalies).
- Response header `X-RateLimit-Limit: 600`. Licence: CC-BY 4.0 (data: Copernicus ERA5).

### 2. NASA POWER daily point API, keyless (`probe_power.py`, `probe_power_wind.py`, `probe_power_seam.py`)
- `power.larc.nasa.gov/api/temporal/daily/point?community=AG`: HTTP 200, about 1.5 s. A 1981-2026 CSV for 5 vars took 1.5 s and 640 KB.
- History: temperature, RH and wind from 1981-01-01. CERES radiation (ALLSKY_SFC_SW_DWN) from **1984-01-01**.
- Latency: T2M, RH and wind to 2026-11-03 (3 days); radiation to 2026-11-02 (4 days).
- **Defect 1: WS2M is unusable for ETo.** Annual mean WS2M is 0.24-0.29 m/s for every year 1981-2025, while WS10M is
  about 1.5 m/s. That ratio (0.18) is far below the log-law ratio of 0.75 (FAO-56 eq. 47), and below FAO's own floor of
  u2 = 0.5. FAO-56 on WS2M therefore underestimates ETo by about 24 % (2023: 1295 vs 1701 mm/yr).
- **Defect 2: there is a stream seam inside our display window.** The header lists `MERRA2, GEOSIT`. From about
  **2026-10-01** the near-real-time GEOS-IT stream takes over:
  - WS2M jumps from about 0.3 to 2.4-4.1 m/s;
  - WS10M doubles;
  - the monthly Tmin bias against ERA5 moves from about -0.5 to +1.8 °C, and the Tmax bias reaches +2.4 °C.
  A POWER-based ETo or temperature series would therefore show a **false "current anomaly"** in the last weeks.
  If POWER is used at all, set `as_of` to the end of MERRA-2, not the end of GEOS-IT.

### 3. ETo comparison for one farm (`compare_eto.py`, `compare_eto_ws10.py`, `sample_eto_compare_tajibos_2026-10.csv`)
All four ETo variants in mm/day, Tajibos. Model for "A": the first three rows use Open-Meteo `era5_seamless` (2023 mean 4.69); the WS10M and Hargreaves rows use `era5` (2023 mean 4.66). Both are the same ERA5 ET0; the small difference comes from grid snapping.

| Comparison | Period | mean A | mean B | bias | MAE | r |
|---|---|---|---|---|---|---|
| A Open-Meteo ERA5 ET0 vs B our FAO-56 on POWER (WS2M) | 2026-10 | 4.32 | 5.36 | -1.04 | 1.11 | 0.87 |
| same | 2023 | 4.69 | 3.55 | +1.14 | 1.23 | 0.82 |
| our FAO-56 vs `refet` (same POWER inputs) | 2023 | 3.55 | 3.54 | 0.01 | 0.01 | 1.00 |
| A vs our FAO-56 on Open-Meteo's own daily inputs | 2023 | 4.69 | 4.83 | -0.14 | 0.21 | 0.99 |
| **POWER FAO-56 with u2 from WS10M (eq. 47) vs A** | 2023 | 4.24 | 4.66 | -0.42 | 0.58 | **0.94** |
| Hargreaves-Samani (ERA5 temps) vs A | 2023 | 4.43 | 4.66 | -0.24 | 0.77 | 0.81 |

- **The October 2026 row sits on the POWER seam and is not a valid fallback assessment. Use the 2023 rows.**
- The sign of the bias flips between periods (−1.04 in Oct 2026, +1.14 in 2023). That flip is the seam, not FAO-56 methodology.
- With the wind fixed, POWER-based ETo is a usable fallback (r 0.94). The residual bias of −9 % comes from POWER's
  lower radiation (−1.1 MJ/m²/d against ERA5) and its noisier Tmax.
- Cross-checks against other sources:
  - WaPOR v3 L1-RET-M for Oct 2023: 210 mm, against 206 mm from Open-Meteo ERA5.
  - TerraClimate PET for Oct 2025: 172 mm.

### 4. Temperature validation at SLVR against GSOD station (`validate_temp_slvr.py`)
Daily, 365 days of 2023 plus 235 days of 2025.

| Source | Tmax bias / MAE / r (2023) | Tmin bias / MAE / r (2023) | Tmax MAE 2025 |
|---|---|---|---|
| **Open-Meteo `era5`** | -1.46 / **1.63** / 0.90 | +0.63 / **0.82** / **0.97** | 1.72 |
| `era5_land` | **-2.58** / 2.70 / 0.90 | +0.14 / 0.90 / 0.94 | 3.06 |
| `best_match` | -2.68 / 2.78 / 0.89 | -0.20 / 0.98 / 0.94 | 3.20 |
| NASA POWER (MERRA-2) | -0.35 / 2.57 / 0.81 | +0.78 / 1.64 / 0.85 | 2.05 |
| CHIRTS-ERA5 (13 days only, monthly sample) | -0.48 / 0.78 / 0.98 | +1.22 / 1.37 / 0.96 | — |

- **ERA5-Land has a cold Tmax bias of about 2.6-3 °C in the lowlands.** In this family's analysis it should not be used for
  temperature. (The soil-moisture family may still want ERA5-Land for soil moisture.)
- **Days with Tmax ≥ 35 °C at SLVR in 2023:**

  | Source | Days |
  |---|---|
  | Station | 77 |
  | POWER | 97 |
  | ERA5 | 50 |
  | ERA5-Land | 29 |

  ADR-0001's fixed `heatC = 35` therefore depends on the source by a factor of about 3.
- **Days with Tmin ≤ 5 °C at SLVR:** 0 in 2023 and 0 in Jan-Aug 2025. A 0 °C frost threshold is close to a null signal
  for these lowland farms.
- **The GSOD feed for Bolivian stations ends on 2025-08-24.** The NOAA ISD history file also lists "end 20250824", so
  there is no station truth for 2026 from NOAA. This is a validation risk; see the global-stations and bolivia-national families.
- CHIRTS likely assimilates station data, possibly including SLVR, so its validation against SLVR is not fully independent.

### 5. CHIRTS-ERA5 (CHC UCSB), keyless HTTP (`probe_chirts_era5.py`)
- `data.chc.ucsb.edu/experimental/CHIRTS-ERA5/{tmax,tmin}/tifs/daily/YYYY/`: daily, 0.05°, from **1980**, latest file
  **2026-11-01** (about 5 days latency, last-modified 2026-11-06). Also available as netcdf daily, pentad and monthly; plus HI, WBGT and VPD.
- Sample: Tajibos Tmax on 2026-11-01 = 29.8 °C.
- Access cost:
  - each file is a 27 MB global, strip-organised GeoTIFF, **not a COG**;
  - a point read over HTTP ranges takes about 3.6 s per file;
  - the server throttles with **HTTP 429** after a few requests.
  A 30-year backfill for one point would take about 22k reads, which is only feasible as a slow offline job.
- Per its README, CHIRTS-ERA5 is **daily ERA5 with a monthly mean and variance correction** toward the CHIRTS 1983-2016
  climatology. That mapping is monotonic within a month, so **percentile anomalies are almost identical to raw ERA5**.
  CHIRTS adds value only where absolute °C thresholds matter (heat ≥ 35 °C display, frost).

### 6. FAO WaPOR v3, keyless catalogue and public COGs (`probe_wapor.py`, `probe_wapor_series.py`)
- Catalogue: `data.apps.fao.org/gismgr/api/v2/catalog/workspaces/WAPOR-3/mapsets` (HTTP 200, 0.23 s, paged, 42 mapsets).
- Files: COGs on `storage.googleapis.com/fao-gismgr-wapor-3-data/...`.
- **Coverage question answered from the data: L1 is global in v3.** COG bounds are -180..180 / -90..90, and the Santa Cruz
  farms return valid values. L2 (100 m) is national-only and does not cover Bolivia.
- L1 products at Tajibos:

  | Product | Resolution | Coverage | Sample value (scale 0.1) |
  |---|---|---|---|
  | L1-AETI-D | 300 m, dekadal | 2018-01-D1 to **2026-10-D3** | 4.7 mm/d |
  | L1-AETI-M | monthly | to 2026-10 | 126.7 mm |
  | L1-RET-E | 0.25 × 0.3125°, **daily** | 2018-01-01 to **2026-11-05** | 3.4 mm/d on 2026-11-05 |
  | L1-NPP-D | dekadal | — | 3.24 gC/m²/d |

  Also available: T, E, I and RSM (relative soil moisture), at dekadal steps.
- October AETI at Tajibos, 2018-2026 (mm): 61, 96, 102, 95, 79, 80, 76, 100, 127.
- **History is short: 2018 onward, so 8 seasons.** That is fine for a z-score with an sd floor, but weak for percentiles.
- WaPOR L1-RET-E against the Open-Meteo forecast for 2026-10-26 to 2026-11-05: same pattern, with WaPOR higher on cloudy days.
- Licence: CC-BY 4.0 (FAO).

### 7. MODIS MOD16A2 / MOD16A2GF (actual ET) and MOD11A2 (LST), via ORNL DAAC REST, keyless (`probe_modis_et_lst.py`)
- Dates per product:

  | Product | Composites | Start | Latest |
  |---|---|---|---|
  | MOD16A2GF | 1196 | 2000-01-01 | **2025-12-27** (annual reprocessing, so current season is not covered) |
  | MOD16A2 (not gap-filled) | — | 2021-01-01 on ORNL | **2026-10-16** (about 3 weeks latency) |
  | MOD11A2 | — | 2000-02-18 | 2026-10-24 |
  | MYD11A2 | — | — | 2026-09-22 |

- Sample values:
  - MOD16A2, Oct 2026: 23.9, 15.1 and 41.0 mm per 8 days. These are noisy.
  - MOD11A2 day LST, Oct 2026: 29.2, 28.7 and 31.1 °C.
- Each request took 1.3-3.2 s.
- Splicing GF (baseline) with non-GF (current) adds an inhomogeneity. Treat it as a fallback only.

### 8. SSEBop v6.1 (USGS FEWS NET), keyless HTTP listing
- `edcintl.cr.usgs.gov/downloads/sciweb1/shared/fews/web/global/{dekadal,monthly}/etav61/downloads/...`:
  - dekadal from d2012021 to **d2026103** (2026 October dekad 3);
  - monthly m202610, last-modified 2026-11-02.
  - Older lines: `eta/` (to 2021) and `etav5/` (to 2022).
- Each file is a **global 136 MB zip**. It was not downloaded because it exceeds the 20 MB probe limit, so no values were
  verified. It is usable only as an offline job that crops to Bolivia.

### 9. TerraClimate (U. Idaho THREDDS NCSS), keyless, CORS `*` (`probe_terraclimate.out`)
- Per-year files `TERRACLIMATE_ALL/data/TerraClimate_{pet,aet,tmax}_YYYY.nc`. A point CSV with `temporal=all` takes about 0.9 s.
- Values are raw integers with **scale 0.1** (PET Oct 2025 = 1721 → 172 mm).
- Coverage: 1958 to **2025-12**. The 2026 file returns 404 because the dataset is updated once a year.
- Gotcha: the aggregated `agg_terraclimate_*` NCSS endpoint returned an empty body for 2024-2026 ranges.
- Role: baseline cross-check only (about 4 km, monthly).

### 10. Not probed live: signup or key needed (`verified = false` except where noted)
- **AgERA5 (Copernicus CDS)**
  - Verified via the keyless catalogue `cds.climate.copernicus.eu/api/catalogue/v1/collections/sis-agrometeorological-indicators`:
    HTTP 200, temporal extent **1979-01-01 to 2026-10-30** (about 7 days latency), CC-BY-4.0.
  - Downloads need a free, instant CDS account plus a personal API token and acceptance of the licence (not done).
  - It provides daily Tmax, Tmin, vapour pressure, wind, radiation and precipitation at 0.1°, but no ETo.
    ETo would still need `refet`.
  - It is the best candidate to replace ERA5 if we want 0.1° bias-corrected agrometeorology.
- **GLEAM v4.x (actual ET, root-zone soil moisture, 0.1°, daily, 1980+)**
  - Free, but registration on gleam.eu gives SFTP credentials.
  - Released yearly: v4.2 in January 2025, and the ICDC Hamburg mirror moved to v4.3 in June 2026 (web search).
    Current-season data is therefore not available. Baseline-only.
- **SENAMHI Bolivia station ETo**: literature confirms SENAMHI Santa Cruz daily records exist (1950-2000 in studies).
  Access is covered by the bolivia-national family.

## Decisions to record (for the product-owner / ADR phase)
1. **ETo primary = Open-Meteo `et0_fao_evapotranspiration` with `models=era5`, used as provided.**
   - Do not use `era5_land`, because its ET0 is null.
   - Do not use `best_match`, because its record is not homogeneous.
   - ETo fallback = `refet` daily FAO-56 on NASA POWER, with u2 from WS10M (FAO-56 eq. 47) and never WS2M. Label it "estimated".
   - Last resort = Hargreaves-Samani from Tmax/Tmin.
2. **Tmax/Tmin primary = Open-Meteo `models=era5`.**
   - Fallback = POWER T2M_MAX/MIN, using only the MERRA-2 period.
   - Absolute-°C refinement = CHIRTS-ERA5, as an offline baseline job only.
3. **Never stitch a different model's recent weeks onto a baseline.**
   - `as_of` = the last day of the baseline stream (ERA5 at about T-6 d).
   - The forecast-API `past_days` tail (IFS) may be shown only as an "estimated, provisional" segment and excluded from percentiles.
   - This applies even more strongly to POWER's GEOS-IT tail.
4. **ERA5T revisions:** the most recent 2-3 months of ERA5 are preliminary (ERA5T) and can be revised. The cache must
   refresh any rows newer than about 3 months (`verified = false`; standard ECMWF practice).
5. **Heat and frost counts must use each source's own distribution (percentiles), not fixed °C.** In 2023 the 35 °C
   heat-day count ranges from 29 to 97 depending on the source. Frost at 0 °C has not occurred at SLVR in the data
   checked, so the frost signal is close to null for these lowland farms. Raise this with the formula phase (ADR-0001 D3).
6. **Actual ET:**
   - primary = WaPOR v3 L1-AETI-D (300 m, dekadal, global, about 1 week latency, 2018+), as a z-score;
   - fallback = MODIS MOD16A2GF + MOD16A2 via ORNL;
   - baseline cross-check = SSEBop v6.1 and TerraClimate AET.
   - A useful derived signal is the evaporative stress ratio AETI/RET from WaPOR, where both come from the same system.
7. **Caching:** Open-Meteo weights long requests against its 600/min limit. Backfill must be paced and deduplicated
   by grid cell, then served from DuckDB.

## Open risks
- No NOAA station truth after 2025-08-24 for Bolivia, so live validation of the 2026 season needs SENAMHI data.
- ERA5's cold Tmax bias of about 1.5 °C. Percentile anomalies cancel it, but any absolute-°C display will understate heat.
- WaPOR's 8-year history is short for percentiles. MOD16A2 near-real-time is noisy.
- POWER's GEOS-IT seam has been characterised at one point only. The exact switch date may move as MERRA-2 catches up.
- CHC (CHIRTS) and Open-Meteo both throttle with HTTP 429; the server must back off and use its cache.
- Open-Meteo's free tier is for non-commercial use. A bank product would need the commercial plan or self-hosting
  (`verified = false`, from Open-Meteo's terms).
