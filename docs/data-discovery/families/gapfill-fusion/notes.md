# Gap-filling, smoothing and sensor fusion: methods (family `gapfill-fusion`)

Date: 2026-11-07. Scope: the **methods** that turn cloudy, noisy, multi-sensor data into clean
series and fair "same time of year" baselines for ADR-0002 (D4 cross-calibration, D5 anomaly
math). This family covers methods, not sources. Every number below comes from a script in this
folder, run on real data for the sample farms. Anything I did not run is marked *unverified*.

**How to reproduce.**
- Needs Python ≥ 3.11 with numpy, scipy, pandas, requests, rasterio, pyproj and climate_indices (statsmodels optional).
- The project `.venv` has no scipy, so the scripts fail there. I ran them from a scratch venv.
- Run them from this folder. `exp_*` scripts read only local samples. `fetch_*` and `probe_*` scripts hit the network.

## TL;DR

1. **Smoother: weighted Whittaker** (Eilers 2003). It is about 15 lines of `scipy.sparse`.
   - Run it on the real acquisition day (`composite_day_of_the_year`), not on the composite start date.
   - Weights from QA: `pixel_reliability` 0 → 1, 1 → 0.5, anything else → 0.
   - Use **λ = 50** on a daily grid. On the cropland pixel this had the best leave-out error (0.090 NDVI).
   - **Do not use the upper-envelope variant on cropland.** Harvest drops are real, and the envelope
     biased gap-fills by −0.025.
   - **Savitzky-Golay is an equally good fallback** (CV within 0.006).
   - **Harmonic/HANTS fails on cropland** (CV 0.146). The crop calendar shifts from year to year.
2. **Smoothing is not the main problem. Phenology timing is.** On the cropland pixel
   (Cuatro Cañadas, 26 y), the same-date NDVI standard deviation across years is **0.15–0.21**.
   The cause is that sowing dates move by weeks. The sd floor of 0.03 never binds. A single-date z
   jumps by ±0.7 between consecutive composites.
   **The 2023–24 drought still shows clearly.** z went from −1.4 to −3.4 in Dec 2023 – Feb 2024
   (Whittaker z −1.5 to −2.2). Recommendation: use the z of the **smoothed** curve, pooled
   over ±1 composite. Then show a 32-day mean z, or state persistence ("2 composites in a row below −1.5").
3. **As-of value: do not extrapolate.** When the latest composite is cloudy, the Whittaker edge
   extrapolation on cropland revises by RMS 0.11–0.15 NDVI. Holding the last good value revises
   by 0.078. Show that held value with a staleness flag ("estimated", per ADR-0002 D1.3).
4. **S2 → MODIS cross-calibration works with strict same-date pairing** (S2 within ±2 d of the MODIS pixel's acquisition day).
   - Cropland (Cuatro Cañadas), S2 averaged over the exact MOD13Q1 cell:
     `MODIS = 0.117 + 0.815·S2`, R² 0.945, RMSE 0.037, n = 30 in 5 years.
   - Savanna (Los Tajibos): `MODIS = 0.226 + 0.723·S2`, R² 0.90, n = 52, using the 3×3-cell box.
   - Pairing S2 with the *smoothed* MODIS curve gives biased slopes. Do not do that.
   - The slope is below 1 and the coefficients differ by land cover. Fit them per land-cover class,
     with the S2 footprint matched to the MODIS cells.
5. **Bias correction matters for absolute thresholds, not for percentiles.**
   - At Los Tajibos, ERA5 rain runs 31 % above CHIRPS on 30-day totals.
   - ERA5 has 37 % wet days against CHIRPS's 24 % (the drizzle problem).
   - ERA5 has 28 days with 72 h ≥ 120 mm in 1991–2026; CHIRPS has 2.
   - Quantile mapping ERA5 → CHIRPS fixes this: 23 % wet days, 4 flood days.
   - Percentiles against each product's own climatology cancel the mean bias. They still agree only
     moderately (r = 0.51, 78.5 % agreement on "dry < p20"). **Which product you pick matters more than the correction.**
6. **5 of the 12 sample farm points are not cropland** in MCD12Q1 (2020–2024): Los Tajibos,
   Brecha 8, Las Londras, San Antonio, Warnes Sur. Their NDVI baselines describe savanna or
   grassland. Move the points or polygons onto fields, or mask with a crop map, before the backtest.
7. **Skip for v1:** STARFM/ESTARFM/FSDAF (pixel fusion), kriging of stations (the nearest station is
   11–109 km away, 9 stations in total), and S1 RVI as a scored signal. Keep S1 as a cloud-free
   "something changed" cross-check, and only for the recent period. In 2022–24 it had only 13–25 scenes a year.

## What I ran (all keyless, no accounts)

| # | Probe / experiment | Script → output | Result |
|---|---|---|---|
| 1 | ORNL MOD13Q1 single pixel (km=0), NDVI + pixel_reliability + composite DOY, 2021-07 → 2026-10, 13 chunks × 3 bands | `fetch_ornl_series.py` → `sample_mod13q1_tajibos_2021-07-12_2026-10-16.json`, `fetch_ornl_series.out` | 39 calls, all 200 on the second run. **Latency 3.3–4.6 s per call at quiet times, 26–58 s under load.** The first run got one **502 Proxy Error**, and its retry did not recover. Latest composite **2026-10-16** (processing date not captured). 122 composites |
| 2 | ORNL full history attempt (2000–2026, Cuatro Cañadas) | `fetch_ornl_series_cuatrocanadas.out` | Aborted. 26–28 s per call × 174 calls ≈ 80 min. ORNL is not viable for bulk history pulls at request time |
| 3 | Planetary Computer `modis-13Q1-061` COG point sample, anonymous SAS token, 8 threads | `fetch_pc_mod13q1_series.py` → `sample_mod13q1_pc_cuatrocanadas_2000-02-18_2026-09-30.json` | 610 Terra items. **26 y × 3 bands in 174 s, 0 errors**. Latest 2026-09-30, one composite behind ORNL. **PC is missing 12 composites that ORNL has**: 2023-02-18, 2024-08-12, 2024-12-18, **2025-07-12 → 2025-11-01 (8 in a row)**, 2026-10-16 |
| 4 | MCD12Q1 LC_Type1 at all 12 farm points, 2020–2024, ORNL | `probe_landcover_farms.py` → `sample_mcd12q1_farms.json` | 12/12 returned 200 in 2.6–3.0 s. 7 cropland and 5 not cropland (see TL;DR 6) |
| 5 | Smoother comparison (WS λ 5/50/500/5000, WS + envelope, SG, SG-Chen, 3-harmonic), with 10-fold leave-out | `exp_smooth.py` → `exp_smooth_tajibos.out`, `exp_smooth_cuatrocanadas.out`, `exp_smooth_series_*.csv` | Tables in §1 |
| 6 | Near-real-time edge effect (as-of value against the final value) | `exp_nrt_edge.py` → `exp_nrt_edge.out` | §1.3 |
| 7 | NDVI same-date z: raw slot, raw ±1 slot, smoothed ±8 d | `exp_ndvi_zscore.py` → `exp_ndvi_zscore_cuatrocanadas.out` | §2 |
| 8 | Sentinel-2 L2A (Earth Search `sentinel-2-c1-l2a`, AWS open COGs, no auth) NDVI over the exact MOD13Q1 cell and a 3×3-cell box | `fetch_s2_modis_pixel.py` → `sample_s2_on_modis_pixel_*.json` | Tajibos (tile 20KNG): 214 scenes with cc < 60 since 2021-07, 153 with ≥ 80 % SCL-clear on the cell. Cuatro Cañadas (20KNF): 203 scenes, 141 clear. 0 read errors. About 4–15 s per scene for 6 window reads (8 threads) |
| 9 | S2 ↔ MODIS cross-calibration fits | `exp_crosscal.py` → `exp_crosscal_*.out` | §4 |
| 10 | DOY-window percentile (±0/7/15 d) and SPI-3 with `climate_indices` against hand-written scipy SPI | `exp_baseline_spi.py` → `exp_baseline_spi.out` | §5 |
| 11 | ERA5 against CHIRPS: bias, percentile agreement, quantile mapping | `exp_bias_percentile.py` → `exp_bias_percentile.out` | §6 |
| 12 | Sentinel-1 scene counts on PC STAC (`sentinel-1-rtc`, `sentinel-1-grd`) per year | `probe_s1_stac.py` → `probe_s1_stac.out` | §7 |
| 13 | Sentinel-1 RTC VV/VH window read and RVI at Cuatro Cañadas, PC anonymous SAS | `probe_s1_rvi.py` → `probe_s1_rvi.out` | Token 200 in 0.4 s. About 5 s per scene (2 reads). §7 |
| 14 | PyPI and install checks on Python 3.14 | — | `whittaker-eilers` 0.2.0 installs (binary wheel). **`vam.whittaker` 2.0.6 has no wheel for 3.14** (last release 2024-02). `climate-indices` 3.2.0 (2026-11-03) works. `pykrige` 1.7.3 installs |

Reused read-only, without re-downloading: other families' `MOD13Q1.dates.json`, the ERA5 12-farm
daily sample (gridded-precip), the CHIRPS ClimateSERV Tajibos daily sample, and the
farm-to-station distances (global-stations).

## 1. NDVI smoothing and gap-filling

All methods run on the real acquisition day of each pixel (`composite_day_of_the_year`). The
nominal composite date can be wrong by up to 15 days, and that matters at harvest.

**Cropland pixel, Colonia Cuatro Cañadas Lote 7, 2000–2026, 602 composites.**
- 13.8 % cloudy (`rel=3`) and 16.4 % marginal.
- **Cloud share by month: Dec 49 %, Feb–Mar 27–28 %, Jan 19 %, Nov 20 %.**
- So the missing data sits exactly at soy emergence and pod fill.

| method | roughness ↓ vs raw | leave-out RMSE | leave-out bias |
|---|---|---|---|
| WS λ=5 | 15 % | 0.096 | −0.001 |
| **WS λ=50** | 20 % | **0.090** | −0.003 |
| WS λ=500 | 30 % | 0.091 | −0.004 |
| WS λ=5000 | 48 % | 0.114 | −0.002 |
| WS λ=500 + upper envelope ×2 | 36 % | 0.103 | **−0.025** |
| SG (5, 2) after linear interpolation | 34 % | 0.095 | −0.003 |
| SG-Chen 2004 envelope | 39 % | 0.101 | −0.024 |
| 3-harmonic (HANTS-like, one pass) | 51 % | **0.146** | 0.001 |

**Woody-savanna pixel, Los Tajibos, 2021–2026, 122 composites.** 4.9 % cloudy.
- Roughness falls 40–62 %.
- Leave-out RMSE is 0.046–0.058 for every method.
- WS + envelope (0.0485) is fine here, because drops in a natural canopy are mostly cloud residue.

Interpretation:
- Raw roughness is 0.152 on cropland and 0.081 on savanna. Most of the cropland "noise" is real
  (double cropping, harvest), so heavy smoothing removes signal.
- λ between 50 and 500 is flat. **Pick 50.**
- Upper-envelope methods (Chen 2004, `ws2doptvp` expectiles) were built for natural vegetation.
  On cropland they fill harvest gaps too high.
- **Terra + Aqua interleave** (MOD13Q1 + MYD13Q1, offset by 8 days) roughly doubles the clear
  observations in December, and Whittaker fuses both naturally. *Not run here*: I did not fetch Aqua
  (the sibling modis family notes ORNL's MYD lags about a month; PC has both).

**Edge effect (as-of value).** I refit the smoother using only data up to each date, then compared that day's value with the final fit:

| pixel | WS λ=50 extrapolated | hold last good observation |
|---|---|---|
| savanna | RMS 0.020 | 0.016 |
| cropland | RMS 0.137 (p95 0.34) | **0.078** |

So: smooth the history, but for "today", **hold the last good value**, report its date, and
label it "estimated" once it is more than 16 days old. Never extrapolate a 2nd-order Whittaker
past the last good observation.

## 2. Same-date baselines and minimum samples

**NDVI** (Cuatro Cañadas, baseline = all other years 2000–2026):
- Raw single 16-day slot: n = 17–26, falling to **n = 8–9 for the 19-Dec slot**, which is cloudy.
- Pooling ±1 slot (about ±16 d) gives n = 42–78.
- Smoothed curve ±8 d, one value per year: n = 25–26.
- Median same-date sd is 0.16 (pooled) and 0.15 (smoothed). The 0.03 sd floor was never hit.

2023-24 drought (Sep 2023 – Apr 2024, 15 composites):

| variant | mean z | composites with z < −1.5 | consecutive-composite jitter (RMS Δz) |
|---|---|---|---|
| raw slot | −0.87 | 4 | 0.77 |
| raw ±1 slot | −0.76 | 3 | 0.71 |
| Whittaker ±8 d | −0.52 | 3 | 0.66 |

- Peak values: raw −3.36 (2024-02-02); Whittaker −2.19 (2024-01-17).
- Aug–Sep 2023 was **positive**: z +2 to +3.8, with the winter crop staying green longer.
- So an NDVI anomaly must be read against crop stage, not on its own.

**Weather percentiles** (ERA5 30-day rain, Los Tajibos, base 1991–2020, own year excluded):

| window | n | p (2023-10-31) | p (2024-09-30) |
|---|---|---|---|
| ±0 d | 30 | 0.0 | 6.7 |
| ±7 d | 450 | 1.3 | 10.0 |
| ±15 d | 930 | 1.3 | 11.3 |

- ±7 d gives smooth percentiles with 450 samples. Those samples are strongly autocorrelated: a
  30-day window only has about 30 independent values. So say "drier than X of 30 years", not "of 450".
- The ±0 d window can only produce steps of 1/30.

**Recommended rules:**
- **Weather:** ±7 d window, `percentileofscore(kind="mean")`, need ≥ 15 baseline years (else
  "insufficient baseline"), exclude the current year.
- **NDVI:** Whittaker λ=50 curve, ±8 d per-year mean, z = (x − mean)/max(sd, 0.03), need ≥ 8 years.
  For the drought decision, use the z of the 32-day mean (2 composites) or a persistence rule.
  Optionally use the pooled-raw z as a cross-check.
- **Next refinement (not in v1):** phenology-aligned baselines (days since green-up, from MCD12Q2
  or a double-logistic fit) would cut the 0.15 sd caused by shifts in sowing date.

## 3. Phenology fitting (double logistic)

- Use `scipy.optimize.curve_fit` per season.
- MCD12Q2 (the sibling family found it on ORNL) already gives green-up and peak dates at 500 m.
- Use for v1: decide **crop stage** for ADR-0001 D4. Hail "outside maturity/fallow" and the "no crop in
  the ground" ×0.6 both need it. Use MCD12Q2 or crop calendars, and do not fit our own in v1.
- Libraries: `timesat` 4.4.1 (PyPI, 2026-04) wraps the TIMESAT Fortran core. *Not installed or tested.*

## 4. MODIS ↔ Sentinel-2 cross-calibration (ADR-0002 D4)

**Method.** Sentinel-2 L2A NDVI is averaged over the **exact MOD13Q1 sinusoidal cell** and over a 3×3-cell box.
- Clear pixels: SCL in {4, 5}, at least 80 % clear.
- Scaling: per-asset `raster:bands` scale 1e-4 and offset −0.1. This handles the +1000 DN offset the S2 family flagged.
- Pairing: S2 scene within ±2 days of the MODIS pixel's actual acquisition day, with MODIS reliability 0.
- Model: OLS, MODIS ≈ a + b·S2. Applying it maps S2 onto the MODIS scale, and the MODIS baseline then applies.
- Cross-check: Theil-Sen.

**Los Tajibos** (woody savanna pixel):

| pairing | box | n | fit | R² | RMSE |
|---|---|---|---|---|---|
| strict ±2 d | exact cell | 54 | 0.251 + 0.688·S2 | 0.77 | 0.040 |
| strict ±2 d | **3×3 cells** | 52 | **0.226 + 0.723·S2** | **0.90** | **0.026** |
| S2 vs smoothed MODIS | 3×3 | 144 | 0.402 + 0.485·S2 (Theil-Sen 0.704) | 0.61 | 0.053 |

**Cuatro Cañadas** (cropland, MCD12Q1 class 12; S2 tile 20KNF, 203 scenes with cc < 60, 141 of them ≥ 80 % clear on the cell):

| pairing | box | n | fit | R² | RMSE | mean MODIS−S2 |
|---|---|---|---|---|---|---|
| strict ±2 d | **exact cell** | 30 | **0.117 + 0.815·S2** (Theil-Sen 0.129 + 0.801) | **0.945** | 0.037 | +0.020 |
| strict ±2 d | 3×3 cells | 29 | 0.005 + 1.123·S2 | 0.918 | 0.042 | +0.063 |
| S2 vs smoothed MODIS | exact cell | 138 | 0.207 + 0.657·S2 | 0.70 | 0.084 | +0.052 |
| smoothed, wet season only | exact cell | 30 | 0.148 + 0.664·S2 | 0.65 | 0.112 | −0.009 |

Findings:
- **The footprint has to match the field.**
  - On the homogeneous savanna, the 3×3 box fits better (MODIS point-spread function and geolocation).
  - On cropland, the 3×3 box mixes neighbouring fields at other crop stages: slope 1.12, offset +0.063.
    The exact cell is clearly better there.
  - Rule: fit on the MODIS cells **inside** the farm polygon, with S2 averaged over exactly those
    cells. Then apply the fit to the S2 mean over the polygon.
- Pairing with the smoothed MODIS curve weakens the OLS slope, because the smoothing errors sit
  in the regressor. **Use only strict same-date pairs.**
- **Fit pooled over farms of the same land-cover class.**
  - A per-farm fit has only 30–54 strict pairs in 5 years.
  - Wet-season subsets are tiny: the savanna's had R² 0.05–0.17, because of the narrow range.
  - Coefficients differ between savanna and cropland (slope 0.72 against 0.82).
  - Re-check yearly, and alarm if RMSE exceeds 0.05.
- **Alternative:** skip cross-calibration and give S2 its own same-date baseline from 2017.
  Earth Search c1 has history from 2015/2017, so that is 8–9 seasons.
  - For: no calibration error.
  - Against: about 8 years and fewer clear dates in December, so n falls below the minimum of 8 in cloudy slots.
  - Decide in the PO phase. My recommendation for v1: **cross-calibrate**. The baseline then has
    25 years, and the calibrated S2 value is just one more weighted observation in the same Whittaker series.
- Spectral band adjustment factors (SBAF, as in HLS: Claverie et al. 2018) are
  reflectance-level corrections between S2 and Landsat/MODIS bands. The empirical NDVI-level OLS
  absorbs them and also the scale difference. Not needed separately.

## 5. SPI / SPEI (reference)

- `climate_indices` 3.2.0 runs on Python 3.14. SPI-3 (gamma, 1991–2020) for 548 months took 0.38 s.
- Against my scipy gamma SPI: r = 0.998.
- The only difference is that **`climate_indices` clips SPI to ±3.09**: Jul 2024 is −3.09 against −3.86.
- 2023-24 at Tajibos: SPI-3 between −1.6 and −2.9 from Aug 2023 to Mar 2024, then −3.1 in Jul 2024. Consistent with the known drought.
- SPEI needs PET. FAO-56 ETo comes from the temp-eto family, and `climate_indices.indices.spei` would take it.
- SPI is a good **reference and validation signal** for the backtest. It does not replace the
  ADR's empirical percentiles. It also needs ≥ 30 years and works monthly, so it suits the long
  view, not the daily display.
- `xclim` 1.0.0 (2026-11-05) is the xarray alternative. *Not tested.*

## 6. Rain bias correction and station merging

ERA5 (Open-Meteo) against CHIRPS (ClimateSERV) at Los Tajibos, daily, 1981–2026-09-30:

| | ERA5 raw | ERA5 quantile-mapped → CHIRPS | CHIRPS |
|---|---|---|---|
| 30-day mean, 1991–2020 | 97.5 mm (+31 %) | — | 74.4 mm |
| wet days ≥ 1 mm | 37.2 % | 23.2 % | 23.8 % |
| days with 72 h ≥ 120 mm, 1991–2026 | 28 | 4 | 2 |

- Daily correlation of 30-day totals: 0.67.
- Percentile agreement between the two products: r = 0.51, mean |Δp| 23 points, same "dry < p20" flag on 78.5 % of days.
- Example: 2024-09-26 was p14 in ERA5 and p79 in CHIRPS.
- Published Bolivia evaluations also find ERA5(-Land) overestimates rain and CHIRPS has the
  better bias (MDPI Hydrology 12(9):225, 2025, *seen only in a search snippet*).

Consequences for ADR-0001 thresholds:
- `flood72hMm = 120` and `dryDays (< 1 mm)` are **absolute**, so they need a bias-consistent product.
  - On raw ERA5, false flood flags appear about 14× more often than on CHIRPS.
  - Dry spells are cut short by drizzle.
  - Either compute these on CHIRPS, or quantile-map ERA5 to CHIRPS per calendar month. The mapping
    is 20 lines of numpy and fitted on 1991–2020.
  - Or convert them to percentiles.
- Percentile signals (`rainDeficitPct`, `soilMoisturePctile`) do not need correction. **Pick the
  product, not the correction.** That choice belongs to the gridded-precip family and the PO phase.

**Stations.**
- The nearest station is **11–109 km** from each farm (SLVR is the closest for 10 of 12 farms).
- There are 9 stations within about 370 km.
- IDW or kriging across ≤ 9 points over that distance is not credible. The kriging variogram needs ≥ 30–50 points.
- Use stations to **validate**, and maybe for a **mean-bias check** at SLVR/SLET. Do not interpolate from them.
- Blending methods for later:
  - CHIRPS-style IDW of station/background ratios (CHC's BASIICS);
  - regression kriging with elevation (`pykrige` `RegressionKriging`, `scikit-gstat`, `gstools`);
  - examples of the operational standard: Peru's PISCO (SENAMHI-Peru) and SENAMHI-Bolivia CHIRPS merges in the literature.
  - The lowlands are flat (about 300–450 m), so elevation adds little as a covariate.

## 7. Sentinel-1 SAR as a cloud-free proxy

Scenes over Los Tajibos on PC (`sentinel-1-rtc`, all descending, relative orbit 10):

| year | distinct days | platforms |
|---|---|---|
| 2019 | 73 | S1B |
| 2020 | 90 | S1B |
| 2021 | 88 | S1B |
| 2022 | **13** | S1A |
| 2023 | **23** | S1A |
| 2024 | **25** | S1A |
| 2025 | 34 | S1A + S1C |
| 2026 | 29 | S1A, S1C, S1D |

- Last 13 months: 36 scenes, median gap 12 d, max 24 d. Latest 2026-11-03.
- Cuatro Cañadas had 19 scenes in the last 6 months (overlapping orbits).
- RVI = 4·VH/(VV+VH) at Cuatro Cañadas, Aug–Nov 2026: 0.61–0.83.
  - VV runs −8.5 to −10.3 dB and VH −14.4 to −17.4 dB.
  - The jump on 2026-10-10 lifts VV and VH together, which looks like **soil wetting after rain** rather than biomass.
- Verdict: useful as a "something changed under the clouds" flag for December. Not usable as a
  same-date baseline, because the 2022–24 coverage is thin (13–25 scenes a year), RVI depends on
  soil moisture and roughness, and the descending-only geometry adds a further constraint.
  **Out of scope for scored signals in v1.**
- Optional demo extra: show the VH time series next to NDVI in the December cloud gap.
- Access: PC anonymous SAS token, keyless (verified). Earth Search also lists `sentinel-1-grd` (*not probed*).

## 8. Spatiotemporal fusion (STARFM / ESTARFM / FSDAF)

- These predict 10–30 m reflectance images on dates with only coarse data.
- `starfm4py` exists (GitHub, nmileva). ESTARFM and FSDAF are mostly MATLAB/IDL ports, or GPU code (cuSTARFM).
- Each needs co-registered image pairs, per-band processing and moving-window searches. That is hours of compute and debugging per tile.
- **Benefit for us is close to zero.** We use one polygon-mean value per farm per date. Putting
  calibrated S2 values and MODIS values into one weighted Whittaker series gives the same
  temporal densification at the series level, at no cost.
- **Reject for v1.**

## Recommended minimal stack

- `numpy`, `scipy` (Whittaker via `scipy.sparse`, `savgol_filter`, `stats.percentileofscore`, gamma SPI),
  `pandas`. The project `.venv` has **no scipy yet**, so `service/` must add numpy and scipy.
- `statsmodels` (optional): OLS with confidence intervals for the cross-calibration report.
- `climate_indices`: reference SPI/SPEI for the backtest. It is pure Python and works on 3.14.
- For COG reads (shared with other families): `rasterio` 1.5.2 + `pyproj` 3.8 binary wheels installed cleanly on 3.14.
- **Avoid:**
  - `vam.whittaker` and `modape`: no Python 3.14 wheel, and the last releases were 2023–24.
  - `whittaker-eilers`: works (Rust wheel), but is unnecessary.
  - STARFM-family code.
  - `pykrige`: installs, but only use it if stations become dense.

## Recommendations per variable (methods)

| Variable | Primary method | Fallback | Baseline |
|---|---|---|---|
| NDVI history | Weighted Whittaker λ=50 on acquisition days, QA weights (0 → 1, 1 → 0.5, else 0) | SG (5, 2) after linear interpolation | same DOY ±8 d per-year mean of the smoothed curve, z with sd floor 0.03, n ≥ 8 |
| NDVI as-of | last good observation (MODIS, or calibrated S2), held, with date and "estimated" after 16 d | Whittaker value at the last good observation | as above |
| NDVI S2 current | OLS map MODIS = a + b·S2 from strict ±2 d pairs, S2 over the MODIS cells inside the polygon, pooled by land-cover class (cropland 0.117 + 0.815·S2) | own S2 baseline 2017+ (no calibration) | MODIS baseline |
| Precip percentiles | empirical percentile, ±7 d DOY window, own year excluded, ≥ 15 years | ±15 d window | 1991–2020 (or 30 years ending last year) |
| Precip absolute thresholds (72 h flood, dry days) | compute on CHIRPS, or ERA5 quantile-mapped to CHIRPS (monthly, 1991–2020) | convert the thresholds to percentiles | — |
| Tmax/Tmin, soil moisture | same percentile rule. Counts (frost or heat days) use the window count against the same window in other years | — | 1991–2020 |
| Drought reference | SPI-3 (`climate_indices`, gamma, 1991–2020) | own scipy SPI (unclipped) | — |
| Cloud-gap cross-check | S1 RTC VH and RVI (display only) | — | none (2022–24 too sparse) |

## Open risks

1. **Farm points off-crop.** 5 of 12 points are savanna or grassland in MCD12Q1. The backtest would
   test the wrong land cover. Fix the coordinates or polygons first.
2. **NDVI same-date sd of about 0.16 on cropland** (shifts in sowing date). z-scores are noisy, so
   the −1.5 threshold will flicker without persistence or pooling. A phenology-aligned baseline is the real fix (v2).
3. **December cloud gap.** 49 % of Terra composites are cloudy, right at soy emergence. Terra+Aqua and
   S2 help, but there will still be weeks with no optical data.
4. **PC MODIS catalogue holes** (12 composites, including 8 in a row in Jul–Nov 2025), and **ORNL
   slowness** (26–58 s per call under load, 1 × 502). Cache the history once (PC, fast), and fill
   holes and the newest composite from ORNL. Do not compute history at request time.
5. **Edge revision.** As-of NDVI can revise by about 0.08 (RMS) once later composites arrive. Show
   the observation date, not just the as-of date.
6. **ERA5 against CHIRPS disagree on timing** (percentile r = 0.51). Whichever is primary, the
   drought story can change. The backtest should run on both.
7. Cross-calibration coefficients come from 2 farms (one savanna, one cropland). Pooling over the
   7 cropland farms before the demo is *not done*.
8. ORNL `kmAboveBelow=0` returns the pixel containing the point. My S2 box reconstructs that
   sinusoidal cell, and it **matches ORNL's grid to within 5 mm** (checked against the sibling family's km=1 header). Its UTM bounding box is about 35 % larger than the cell (713 against 529
   S2 pixels) because of sinusoidal shear at 62° W. That is acceptable for a demo; an exact polygon mask would be better.

## Decisions to record as ADR (for the product-owner phase)

- **D-a** Smoother: weighted Whittaker, λ=50 (daily grid), on the actual acquisition day. QA weights
  0 → 1, 1 → 0.5, else 0. No upper envelope on cropland. SG (5, 2) is the fallback.
- **D-b** As-of NDVI: no extrapolation. Hold the last good observation, show its date, and flag it "estimated" after 16 days.
- **D-c** NDVI baseline: smoothed curve, ±8 d per-year mean, other years only, z with sd floor 0.03,
  minimum 8 years. The decision uses persistence (2 consecutive composites) or a 32-day mean z.
- **D-d** Weather percentile: ±7 d DOY window, empirical `kind="mean"`, own year excluded, minimum 15
  years, base 1991–2020. Wording: "drier than X of the last N years".
- **D-e** Cross-calibration: strict same-date (±2 d of the MODIS acquisition day) S2/MODIS pairs, with S2
  averaged over exactly the MODIS cells inside the farm polygon.
  - OLS MODIS = a + b·S2, pooled by land-cover class.
  - Measured values: cropland 0.117 + 0.815·S2, R² 0.945; savanna 0.226 + 0.723·S2, R² 0.90.
  - Alternative recorded: S2 with its own 2017+ baseline.
- **D-f** Absolute rain thresholds (`flood72hMm`, `dryDays`) are computed on CHIRPS, or on ERA5
  quantile-mapped to CHIRPS. Percentile signals need no bias correction.
- **D-g** Out of scope for v1: STARFM/ESTARFM/FSDAF, station kriging or IDW, S1 RVI as a scored signal,
  phenology-aligned baselines. S1 VH may be shown as a display-only cloud-gap cross-check.
- **D-h** `service/` dependencies: numpy, scipy, pandas (+ statsmodels optional, climate_indices for the backtest).
- **D-i** Fix the sample farm coordinates: 5 of 12 are not cropland.

## Sources (web)

- Eilers 2003, "A perfect smoother" (Anal. Chem.). Weighted Whittaker. WFP VAM `modape` / `vam.whittaker` docs: https://wfp-vam.github.io/modape
- Chen et al. 2004, SG upper-envelope NDVI reconstruction (RSE 91).
- S2 against MODIS NDVI comparison (R² 0.86, MODIS higher): https://agris.fao.org/search/en/records/66df05fc1c7e183f361e5f58 , https://ideas.repec.org/a/gam/jagris/v12y2022i12p2080-d992960.html
- Sentinel-1 RVI: https://custom-scripts.sentinel-hub.com/sentinel-1/radar_vegetation_index ; DpRVI (Mandal et al. 2020): https://research.tudelft.nl/en/publications/dual-polarimetric-radar-vegetation-index-for-crop-growth-monitori
- STARFM in Python: https://www.github.com/nmileva/starfm4py
- Station + satellite blending (BASIICS, FEWS): https://help.fews.net/en/tools/v3/chapter-9-background-assisted-station-interpolatio
- Bolivia precipitation product evaluation (ERA5-Land overestimates, CHIRPS better bias): https://www.mdpi.com/2306-5338/12/9/225
- PyPI metadata checked live: vam.whittaker, modape, whittaker-eilers, pykrige, climate-indices, scikit-gstat, gstools, xclim, timesat, pyts.
