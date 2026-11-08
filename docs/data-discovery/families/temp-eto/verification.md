# Adversarial verification: temperature, ETo and actual ET (`temp-eto`)

I re-probed the researcher's top picks on 2026-11-07 (UTC), using different coordinates and periods.
No accounts, keys or credentials were used. The probe scripts are in my scratchpad, not in this folder. The key numbers are reproduced below.

**Probe points (none of them is a sample farm):**
- San Julián NE (-62.20, -16.60)
- Portachuelo W (-63.55, -16.95)
- (-62.00, -17.95)
- Viru Viru (SLVR, -63.135, -17.645), for 2026 station truth
- Paraguay Chaco and Iowa, for the WaPOR coverage test

**Verdict summary.** The four picks hold up as choices. Several supporting claims are wrong or apply only at one place:
- the "POWER WS2M is broken everywhere" claim;
- the cause of the POWER Tmax bias;
- WaPOR RET as a cross-check;
- the CHIRTS access cost;
- the claim that there is no 2026 station truth.

There is also a new data-quality hazard: WaPOR AETI in October.

## 1. Open-Meteo archive, `models=era5`

| Claim | Status | Evidence (my probe) |
|---|---|---|
| Keyless, HTTP 200, about 0.4 s | confirmed | Short requests: 200 in 0.43-0.50 s. Uncached long pulls are slower: 30 y × 3 vars took 6.7 s; 1940-2026 took 18.7 s and 867 KB. |
| Latency about 6 days | confirmed (7 d) | On 2026-11-07 the latest non-null `era5` and `era5_land` day was still **2026-10-31** at both new points. |
| History 1950 verified, 1940 not verified | **upgraded: 1940 verified** | 1940-01-01..10 returned valid Tmax/Tmin. `start_date=1939-12-25` returned HTTP 400: "allowed range from 1940-01-01". ET0 is null on the very first day (1 null in 31 716). |
| `era5_land` ET0 null | confirmed | All null at both new cells. |
| Rate limit 600 weighted/min | confirmed | Header `X-RateLimit-Cost`: 1.0 for 19 days, **234.8 for 30 y × 3 vars**, **679.6 for 1940-2026**. One full-history pull empties the minute window (remaining 0). |
| Hourly and daily caps not verified | **now verified** | Terms page: "Less than 10'000 API calls per day, 5'000 per hour and 600 per minute. You may only use the free API services for non-commercial purposes. You accept to the CC-BY 4.0 licence". Unverified: whether the daily cap counts weighted units. |
| Licence CC-BY 4.0, free tier non-commercial | confirmed | Same terms page. **A bank product needs the paid API or self-hosting.** |
| ET0 is genuine FAO-56 PM | confirmed | At (-62.0, -17.95) I recomputed 2019 daily FAO-56 from Open-Meteo's own daily inputs: r 0.989, bias +0.33 mm/d (my daily recompute about 6 % higher), MAE 0.35. Hargreaves gave r 0.76. |
| No actual ET on ERA5 | confirmed | `hourly=evapotranspiration`, `models=era5`: 0 of 72 values non-null. |
| Tmax bias -1.46, MAE 1.63 at SLVR | **corrected: depends on season and period** | Against Ogimet SYNOP at SLVR for 2026, `era5` Tmax was **Sep bias +0.06, MAE 1.06, r 0.95** and **Oct bias -0.71, MAE 1.44, r 0.93**. Tmin was Sep +0.95 / 1.16 / 0.97 and Oct +0.53 / 0.92 / 0.93. ERA5 is still the best of the gridded sources. The roughly 1.5 °C cold bias is not a constant. |
| `era5_land` Tmax cold by 2.6-3 °C | corrected (smaller, still cold) | 2026 SLVR: Sep -0.93, Oct -1.45 (MAE 1.66 / 2.27). The recommendation to avoid it for temperature still stands. |

## 2. NASA POWER daily point (AG)

| Claim | Status | Evidence |
|---|---|---|
| Keyless; T2M 1981+, radiation 1984+ | confirmed | San Julián: T2M, WS2M and WS10M first value 1981-01-01; ALLSKY first value 1984-01-01. 1981-2026 in 5 vars: 1.4 s, 1.35 MB. |
| Latency 3 d (met), 4 d (radiation) | confirmed | Latest T2M 2026-11-04; latest radiation 2026-11-02 (queried 11-07). |
| "WS2M about 0.27 m/s every year, unusable" | **corrected: specific to the grid cell** | 2023 mean WS2M / WS10M by point: Tajibos 0.27 / 1.55; **Portachuelo 0.05 / 1.20** (daily values of 0.00); Mineros 0.82 / 1.98; San Julián 1.1 / 2.2 (ratio 0.5, all years 1981-2026); Pailón 1.65 / 3.05; SLVR 2.45 / 3.85; San José 2.41 / 3.75. The ratio ranges from 0.04 to 0.64, which looks like it depends on the cell's roughness. The researcher's recommendation is still right (derive u2 from WS10M with FAO-56 eq. 47). The reason is general, not local: FAO-56 assumes a grass reference surface, so eq. 47 from 10 m is the methodologically correct input everywhere. |
| MERRA-2 to GEOS-IT seam about 2026-10-01 | confirmed, exact date | The header lists `MERRA2, GEOSIT`. At Portachuelo, WS2M was 0.00-0.03 through 2026-09-30, then 0.86 on 10-01, 1.17 on 10-02 and 2.94 on 10-03. In Oct 2026, wind jumped at Tajibos, Mineros, Pailón and Portachuelo but **fell** at San José (2.84 → 1.02), so the seam can go either way. |
| Seam gives Tmin +1.8 °C and Tmax +2.4 °C | **partly corrected** | The Tmin step is real. San Julián, POWER minus ERA5: Oct 2026 **+2.49** against ≤ +1.3 in every month of 2025-Sep 2026. At SLVR against the station, Tmin bias was Sep +0.43 and Oct **+2.90**. **Tmax is a different story:** POWER minus ERA5 was already +2.5 to +4.5 °C in Aug-Nov 2025, inside the MERRA-2 period. That is a seasonal warm bias in the dry season, not the seam. Against the station, POWER Tmax bias was Sep 2026 +2.49 and Oct +3.85, with r falling 0.93 → 0.65. |
| Public domain | unverifiable | The methodology URL returned 404. NASA data are generally unrestricted, but I did not read a licence statement. |

## 3. CHIRTS-ERA5

| Claim | Status | Evidence |
|---|---|---|
| Keyless HTTP, 0.05°, not a COG | confirmed | `tiled False`; resolution 0.05°. |
| History 1980 | confirmed (files) | `tmax/tifs/daily/1980/` contains 1980-01-01. The CHC web page says "1983 through the present"; 1983-2016 is the CHIRTS climatology period. |
| Latency about 5 d (latest 2026-11-01) | confirmed | Latest is still 2026-11-01 on 11-07. The CHC page states a 5-day lag. This is one day fresher than Open-Meteo's ERA5. |
| **Data gaps** | **new finding** | **2026-10-31 is missing for both tmax and tmin** (HEAD returns 404). I checked every 2026 day from 01-01 to 11-01 and that is the only missing day. The wrapper must handle holes. |
| About 3.6 s per point read | **corrected** | My reads took **26.6 s (Tmax) and 12.5 s (Tmin)** per file with GDAL retries for 429. A 30-year backfill is a multi-day offline job. |
| Licence "CC-BY (CHC), not verified" | **now verified** | The CHC CHIRTS-ERA5 page says "Creative Commons Attribution 4.0 International License … public domain". |
| "Percentile anomalies about equal to ERA5" | **corrected for Tmin** | The README says Tmax is a monthly mean and variance correction of ERA5, so the claim holds for Tmax. **Tmin is computed differently:** CHIRTS-ERA5 Tmin = CHIRTS-ERA5 Tmax − (ERA5 Tmax − ERA5 Tmin), so its anomaly also carries the Tmax correction. |
| SLVR accuracy (13 days) | plausible only | n = 13, and the source uses station data. A one-day oddity: on 2026-10-30 at SLVR, CHIRTS gave 25.0 / 22.3 (DTR 2.7), while ERA5 gave 26.3 / 20.8 (DTR 5.5). By the README the two DTRs should match, which suggests a different day convention (UTC vs local). **Verify the date convention before any absolute-°C display.** |

## 4. FAO WaPOR v3 L1

| Claim | Status | Evidence |
|---|---|---|
| Keyless catalogue and COGs | confirmed | Catalogue HTTP 200 in 0.23 s. COG reads over `/vsicurl` take about 2 s each (18 reads in 35.6 s). |
| L1 is global, including Santa Cruz | confirmed | The AETI-D extent is -180..180 / -90..90. Valid values at San Julián (3.9), Portachuelo (0.5), Chaco PY (4.2) and **Iowa (0.3)**. |
| History 2018 | confirmed | AETI-D has 318 rasters, the first being 2018-01-D1. RET-E has 3231, the first being 2018-01-01. |
| Latency AETI about 1 week; RET-E 1 day | confirmed (better) | 2026-10-D3 was `created 2026-11-02`, 2 days after the dekad ended. RET-E for 2026-11-05 was created 11-06. Each raster's `updatesLog` has a single entry, so no revisions were seen. |
| RET at 0.25 × 0.3125°, scale 0.1 | confirmed | RET-E is stored as **Byte** (nodata 255, so the maximum is 25.4 mm/d and values are quantised to 0.1 mm/d). AETI is Int16, scale 0.1. |
| Licence CC-BY 4.0 | confirmed, with caveat | The FAO CKAN catalogue (`data.apps.fao.org/catalog`) lists "Actual evapotranspiration and interception (Global - Dekadal - 300 m) - WaPOR v3" with `license_id: CC-BY-4.0`. The Digital Public Goods registry lists the *portal* as CC-BY-NC-SA-4.0. Cite the dataset licence. |
| "RET-M Oct 2023 210 mm vs ERA5 206" (good cross-check) | **corrected** | That agreement holds at one point only. October WaPOR RET / ERA5 ET0 for 2018-2026: San Julián **0.76-0.94** (r 0.79); Portachuelo **0.92-1.17** (r 0.89). The offset is systematic and differs by location. Use RET only inside the same-system AETI/RET ratio, not to validate ERA5 ET0. |
| AETI usable as a z-score with an sd floor | **corrected: needs guards** | October AETI-M at Portachuelo, 2018-2026: 80, 81, 95, 97, 90, 70, **5.4**, 111, 69 mm. A 9 × 9 pixel window (about 2.7 km) in Oct 2024 has a median of 7.6 mm (range 2.1-21.9). The low value is **regional, not a dropout.** It is probably bare or burnt land before planting, given the 2024 fires and soy sown in November. The same window in Oct 2023 ranges from 17 to 151 mm, and AETI-D dropped from 2.7 to 1.3 mm/d between 2026-10-D2 and 10-D3. In October, AETI tracks planting date and land state, not crop stress. A single-pixel z-score would flag a false extreme. |

## 5. Other recommendations and claims

| Claim | Status | Evidence |
|---|---|---|
| MOD11A2 / MOD16A2GF / MOD16A2 dates via ORNL (keyless) | confirmed | At San Julián: MOD11A2 2000-02-18 to 2026-10-24 (5.9 s); MOD16A2GF 2000-01-01 to 2025-12-27; MOD16A2 2021-01-01 to 2026-10-16. |
| Heat-day count depends on the source | confirmed | Days with Tx ≥ 35 °C at SLVR, station (GSOD) vs ERA5, 2010-2024: 62/20, 71/28, 29/21, … 2020 70/59, 2023 77/50, 2024 73/46. **ERA5 undercounts by 1.2-3.7×, in every year.** |
| Frost near-null (Tmin ≤ 5 °C not seen 2023/2025) | confirmed, with nuance | GSOD SLVR 2010-2024: Tmin ≤ 5 °C on **4 days in 15 years** (3 in 2010, 1 in 2021; minimum 3.0 °C), and never ≤ 2 °C. ERA5 had 1 such day (2021). Cold *surazo* events of 3-6 °C do occur, and they matter for winter wheat (Pailón). Use a cold-percentile signal, not 0 °C. |
| GSOD for Bolivia ends 2025-08-24 | confirmed | 85244 (SLVR) and 85245 (El Trompillo) 2026 files return 404. ISD history lists the Santa Cruz-area stations ending 2025-08-22/24. |
| "No station truth for 2026" | **refuted (outside NOAA)** | **Ogimet SYNOP is keyless:** `ogimet.com/cgi-bin/getsynop?block=85244&begin=202609010000&end=202611061800` returned HTTP 200 in 0.5 s, 63 KB and 526 reports. Parsing section 333 (Tx at 00Z for the previous day, Tn at 12Z) gave 62 Tmax and 61 Tmin days for Sep-Nov 2026. These agree with the daily extremes from hourly obs (mean difference 0.39 °C). Ogimet's terms and rate limits are unverified, so keep usage light. Meteostat bulk `85244.csv.gz` is keyless but ends **2026-03-14** and is CC-BY-NC. |
| ERA5T revisions in the last 2-3 months | unverifiable | Not tested. |
| TerraClimate, SSEBop, AgERA5, GLEAM details | not re-probed | Not top picks. |

## Recommendation changes

1. **WaPOR AETI:**
   - aggregate over the field polygon (median of 300 m pixels), never a single pixel;
   - compute anomalies only inside the crop-calendar window (after emergence);
   - prefer AETI/RET (same system);
   - flag dekads where AETI < 20 % of RET outside the season as "bare/fallow", not "stress".
2. **POWER wind narrative:**
   - the defect depends on the cell (WS2M from 0.00 to 2.45 m/s across Santa Cruz);
   - always derive u2 from WS10M (eq. 47), because FAO-56 assumes a grass reference;
   - never use WS2M.
3. **POWER Tmax** has a dry-season warm bias of +2.5 to +4.5 °C even in the MERRA-2 period. It is acceptable for its own percentiles, but never mix POWER with ERA5.
4. **The POWER as-of date** is fixed at **2026-09-30** for now (the switch was confirmed on 2026-10-01). Detect the seam automatically from the header `sources` plus a step change in wind.
5. **WaPOR RET is not a validation of ERA5 ET0.** Their October ratio ranges from 0.76 to 1.17 depending on location.
6. **Add Ogimet SYNOP** (SLVR 85244, El Trompillo 85245) as keyless 2026 station truth, for validation and the demo's "trust" panel. It belongs to the stations family. Respect Ogimet's terms.
7. **CHIRTS-ERA5:**
   - expect missing days (2026-10-31);
   - budget 10-30 s per read;
   - check the day convention before any absolute-°C display;
   - its Tmin anomaly is not the same as ERA5's.
8. **Open-Meteo backfill budget:**
   - 12 farms × 30 y × 3 vars ≈ 2,800 weighted calls; deduplicate by 0.25° cell first;
   - one 1940-to-today pull costs about 680 and fills the 600/min window, so pace at least 60 s apart;
   - the free tier is non-commercial, so a bank customer needs the paid API or a self-hosted instance.
9. **ERA5 baseline** can start in 1940 (verified). Prefer 1991-2020 or 1981-2025, because pre-1979 ERA5 assimilated far fewer observations over South America (not verified here).

## 6. Re-check later on 2026-11-07, at a new point (-63.40, -17.45)

| Check | Result |
|---|---|
| Open-Meteo archive `models=era5` | **HTTP 429 in 0.42 s: "Daily API request limit exceeded. Please try again tomorrow."** This machine's IP has used up the free daily cap (10,000/day) after one day of research by several agents. So the daily cap is real, it counts per IP, and almost certainly counts weighted units (multi-decade pulls cost 235-680 each). **Risk for the demo:** the snapshot must be built ahead of time, and nobody on the demo network should run backfills on demo day. |
| NASA POWER latest T2M | 2026-11-04 (HTTP 200, 0.37 s, Tmax 37.66 °C). For an Oct 25 to Nov 7 window the header `sources` is `['GEOSIT','POWER']`, with no MERRA2. This confirms the seam: recent data is GEOS-IT only. |
| CHIRTS-ERA5 files | 2026-10-31 tmax/tmin: still 404, so the gap persists. 2026-11-01 tmax: 200. 2026-11-02 and 11-03: 404, so the latest is still 11-01 and the lag is now 6 d. 429 errors came back on paced HEADs (1.5 s apart). |
| WaPOR L1-AETI-D | 318 rasters, 2018-01-D1 to 2026-10-D3, unchanged. At the new point, 2026-10-D3 AETI was 1.9 mm/d (keyless COG read OK). |
| WaPOR L1-RET-E | 3,231 rasters, latest still 2026-11-05 on 11-07, so the lag is now about 2 d. Listing the catalogue page by page takes **42 s**: cache the listing, or build raster URLs from the date pattern. |
