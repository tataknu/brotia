# Frost, heat and hail: adversarial verification

- **Verifier probes ran on:** 2026-11-07, 05:40–06:30 UTC. All probes were keyless and no account was created.
- **Scope:** I re-checked the researcher's top picks and recommendations in `notes.md`.
- **Independent test points (not sample farms):**
  - P1 (−62.10, −16.45), north of San Julián
  - P2 (−63.40, −18.10), south of Santa Cruz
  - P3 (−62.20, −17.50), east of Pailón
- **Independent station:** El Trompillo, GHCN-D `BLM00085245` (−17.812, −63.171), not SLVR.
- **Re-checks at farm coordinates:** only to reproduce the 2021 surazo LST values.
- **Where the probe scripts live:** in the session scratchpad, not in this folder. The key calls are quoted inline below.

## Verdict summary

| Claim | Verdict |
|---|---|
| Open-Meteo archive: keyless, ~5 d latency, 600/5k/10k limits, non-commercial | **Confirmed**. Two additions: the budget is weighted and shared per IP, and there is a 300k/month cap |
| Open-Meteo ERA5 history 1950 (1940 per docs) | **Corrected**. ERA5 returns values from **1940-01-01**; ERA5-Land returns nulls for 1940 and starts in 1950 |
| ERA5 cold-night bias +2.0 °C, so "ERA5 5 °C ≈ 2.5–3 °C screen" | **Corrected**. The bias depends on the station: +1.06 °C at El Trompillo, so 5 °C ≈ 4 °C there |
| Rank agreement r 0.95, cold-night hit rate 77–78 % | **Confirmed** at a second station for Tmin (r 0.951, hit 0.77). The Tmax hit rate is only 0.62 |
| ERA5 better than ERA5-Land for heat | **Confirmed** (P3: 245 vs 88 degree-hours > 35 °C). ERA5 still undercounts days ≥ 35 °C by about 45 % |
| "Archive has no CAPE" | **Confirmed** (all null at P2) |
| GFS CAPE + LI from 2021-03-23 is the only keyless point CAPE; a 30-y baseline needs CDS signup | **Refuted**. ERA5 CAPE 1940 → 2026-08 is keyless on AWS (`nsf-ncar-era5`, CC BY 4.0). It is offline-batch only |
| "ecmwf_ifs025 and icon_seamless have no CAPE" | **Corrected**. ICON, UKMO and GEM do return CAPE (from mid/late 2022, no LI). ECMWF does not. GFS is still the longest record and the only one with LI |
| PC MODIS LST: keyless, 2000-02-24 →, latest 2026-11-04, good coverage | **Corrected**. **There is a PC catalog gap from 2025-07-01 to 2025-12-01** on both tiles. The granules exist at LP DAAC (CMR) |
| PC token: collection token gives 403, use the container token | **Corrected (wording)**. The collection token request returns 200, but COG reads signed with it fail with 403. The container token works |
| Aqua ~01:30 / Terra ~22:30 night passes | **Corrected**. Orbit drift: Aqua was at 0.6 h local in 2005 and 3.0–3.9 h in 2026; Terra went from 23.2 h to 21.0 h. The baseline is not homogeneous |
| 2021-07-01 surazo caught at all 12 farms (0.8–4.5 °C) | **Confirmed** (Okinawa Uno 0.77, Pailón 1.25). At new points: P3 2.2, P2 4.9, P1 cloudy |
| About 50 % of cold nights cloud-free; LST − Tmin median +4.85 °C | **Partly confirmed**. Cloud-free on 8 of 20 Trompillo cold nights (40 %). The median offset was **+2.4 °C** there, so it is site-dependent |
| CHIRTS-ERA5: keyless, 1980 →, ~6 d, best Tmax (bias −1.06) | **Corrected**. Licence is public domain / CC BY 4.0 (commercial use OK). The 2026-10-31 file is missing. The Tmax bias did not beat ERA5 at Trompillo. **A 429 can silently corrupt reads** |
| GOES-19 GLM: keyless, ~1 h latency, history 2024/2025 →, GOES-16 2018–2025 | **Corrected**. Latency is **< 1 min**. GOES-19 starts on **2025-01-15**; GOES-16 runs 2018 → 2025-04-07 (DOY 097) |
| GLM separates model rain from real storms | **Confirmed** on new days: 2026-03-09 (45 mm GFS rain) had ≤ 6 flashes per sampled file; 2026-02-10 (CAPE 3,830, dry) had 0 |
| NASA POWER hourly fallback | **Confirmed**. Keyless, 0.27 s, starts 2001-01-01 (a 2000 request gets 422), latest 2026-11-04 23 h LST |
| S2 NDVI hail-damage rule; GOES-16 flash-day baseline; CHIRTS Tmin +3.56 °C; POWER daily 1981; ORNL MYD11A2 | **Unverifiable** (not re-probed) |

## Evidence

### 1. Open-Meteo archive (`archive-api.open-meteo.com/v1/archive`)

**History start (P1, daily Tmin):**
- `models=era5`, 1940-01-01..05: 200 in 0.45 s, values `[20.3, 21.1, 21.2, 20.8, 20.5]`.
- `models=era5_land`, 1940: 200, all values `None`. From 1950-01-01: 200, `[20.7, 20.7, 19.8]`.
- So: ERA5 starts in 1940, ERA5-Land in 1950.

**Latency (P2, hourly T2m, 2026-10-25..11-07, run on 2026-11-07):**
- `era5` and `era5_land`: last valid value 2026-11-01T19:00 local. This confirms ~5 d latency.
- `best_match` in the *archive* API runs to 2026-11-07T23:00, so it blends in forecast data. It must be labelled "estimated", as the researcher proposed.

**CAPE:**
- `hourly=cape` with `era5` or the default model returns 200 but all values are null. The claim is confirmed.

**Terms and pricing pages** (`/en/terms`, `/en/pricing`, fetched 200):
- "You may only use the free API services for non-commercial purposes". Limits: 600/min, 5,000/h, 10,000/day, **300,000/month**.
- Paid tiers include a commercial licence on `customer-api.open-meteo.com`.
- The *data* are CC BY 4.0, so commercial redistribution of the data is allowed. The *free endpoint* is not.

**Weighted cost, observed in the `X-RateLimit-Cost` header:**
- A 30-year daily pull with 2 variables costs **154.7 calls**. That is (days / 14) × (variables / 10).
- A 13-month hourly pull with 1 variable costs 2.8.
- `X-RateLimit-Remaining` was **520 when I started and 165 after my probes**. The daily budget is per IP and shared by every teammate and agent on the same network.
- At this cost, the 30-year baselines for 12 farms × 2 models × 2 variables (≈ 3,700 calls) would use about a third of a day's budget.
- The researcher's 429s on 35-year pulls fit the 600/min weighted limit.

**Station check at El Trompillo** (`BLM00085245`, 1996-01 → 2025-08, n = 3,826 days with both Tmin and Tmax). One `era5` and one `era5_land` daily call.

| | ERA5 | ERA5-Land | Researcher's SLVR figure (ERA5 / ERA5-Land) |
|---|---|---|---|
| Tmin mean bias | −0.07 | +0.01 | +0.82 / +0.68 |
| Tmin bias, coldest 2 % (n = 78) | **+1.06** (median +0.80) | +1.84 | +2.01 / +2.58 |
| Tmin r / hit rate, coldest 5 % | 0.951 / **0.77** | 0.939 / 0.74 | 0.950 / 0.77–0.78 |
| Tmax bias, hottest 2 % (n = 85) | **−1.23** | −2.10 | −1.87 / −3.13 |
| Tmax hit rate, hottest 5 % | **0.62** | 0.59 | – |
| Absolute Tmin, 1996–2025 | 4.8 °C (2010-07-19) | 5.0 °C | station: 3.5 °C (1996-06-30); none ≤ 3 °C |
| Days ≥ 35 °C per year | **14.5** | 5.8 | station: 25.7 |
| 2023, on station-observed days | 36 | 26 | station: **65** |

What this table means:
- **Percentiles are confirmed.** Rank agreement for Tmin reproduces at a second station.
- **The absolute threshold does not transfer between stations.** The cold-night bias is about half the SLVR figure. El Trompillo is in the city, so urban heat probably raises its station minima and shrinks the bias. The offset therefore depends on the site.
  - "ERA5 ≤ 5 °C ≈ screen 2.5–3 °C" is an SLVR-only calibration. At El Trompillo it would be about 4 °C.
  - Treat the 5 °C threshold as a tunable display threshold, not a calibrated frost line.
- **Heat-day counts are biased low.** ERA5 still undercounts days ≥ 35 °C by about 45 %. That is true even of the extreme 2023 (36 vs 65 days on the same observed days).
  - `heatC = 35 °C` on ERA5 absolute values understates heat.
  - The percentile version (`heat_days_35` against the farm's own history) is the only defensible use.
- **The heat-day hit rate is weaker than the cold-night one** (0.62 vs 0.77).

**Recent 13 months at P3** (2025-10-07 → 2026-11-06, hourly):

| Model | Tmax | Tmin | Degree-hours > 35 °C | Hours ≤ 5 °C |
|---|---|---|---|---|
| ERA5 | 39.2 °C | 9.0 °C | 245.3 | 0 |
| ERA5-Land | 38.2 °C | 10.3 °C | 87.7 | 0 |

This confirms the ERA5-over-ERA5-Land choice for heat.

### 2. Open-Meteo historical-forecast (`historical-forecast-api.open-meteo.com/v1/forecast`), CAPE

All calls at P2 unless noted.

- **Before 2016-01-01:** 400, "out of allowed range from 2016-01-01 to 2026-11-22".
- **2019-01 and 2021-01:** 200, zero values.
- **2021-03-15..28:** first non-null value at **2021-03-23T00:00**. The start date is confirmed at a second coordinate.
- **Model sweep, 2023-01-10..12:**
  - `gfs_seamless`, `gfs_global`, `gfs025`, `ncep_gfs025`: CAPE max 3,010 with LI.
  - **`icon_seamless`: CAPE 2,500, no LI.** This contradicts "icon has no CAPE".
  - `ukmo_seamless`: CAPE 3,770, no LI.
  - `gem_seamless`: CAPE 3,910, no LI.
  - ECMWF IFS (both), JMA, Météo-France, CMA, BOM, KMA: no CAPE.
- **Start dates of the other models:**
  - ICON: null through 2022-06-10, values by 2023-01.
  - UKMO: values from about 2022-06-10.
  - GEM: null at 2022-06-10.
  - So GFS (2021-03-23) is still the longest record and the only one with LI. The extra models are useful only as a 2023 → ensemble cross-check.
- **Daily summary at P3, 2025-11 → 2026-03** (cost 3.2): top CAPE days were 2026-01-04 (4,850), 2026-02-07 (4,260), 2026-01-03 (4,030) and 2026-03-02 (3,990).

### 3. Keyless 30-year ERA5 CAPE: NCAR ds633.0 on AWS (this refutes "only keyless" and "needs CDS")

- **Listing:** `https://nsf-ncar-era5.s3.amazonaws.com/?list-type=2&prefix=e5.oper.an.sfc/202301/` returns 200. It contains `e5.oper.an.sfc.128_059_cape.ll025sc.2023010100_2023013123.nc` (727 MB, global, monthly).
- **Extent:** CAPE files exist from **194001** to **202608**; 202609 is absent. The RDA page for d633000 states 1940-01-01 → 2026-08-31.
- **Licence:** **CC BY 4.0**, with the Copernicus acknowledgement. Commercial use is allowed with attribution.
- **Point read:** `fsspec` HTTP file + `h5py`, read `CAPE[:, i, j]` at (−18.0, 296.5).
  - Took 3 s to open and 92.5 s to read 744 hourly values. Maximum 2,058.6 J kg⁻¹.
  - Chunks are (27, 139, 277), gzip, float32. One lat/lon chunk covers about 35° × 69°, so **all 12 farms fall in the same chunks**: one read serves the whole portfolio.
  - Estimated transfer is a few tens of MB per month-file.
- **Cost of a full baseline:** Oct–Mar for 1991–2025 is about 180 files × ~90 s ≈ 4–5 h as a one-off offline batch into DuckDB. Latency is about 2–3 months, so the current season still needs GFS.
- **Data-quality note:** the GFS and ERA5 CAPE climatologies differ. The p90 must be computed within one source, or the two must be quantile-mapped over their 2021–2026 overlap.

### 4. Planetary Computer MODIS LST (`modis-11A1-061`)

**Collection and search:**
- Collection 200 in 0.34 s, extent `2000-02-24 →`. STAC `license: proprietary`, linking to the LP DAAC policy (NASA open data, no restrictions).
- Earliest item is `MOD11A1.A2000055` (2000-02-24). Confirmed.
- Search at P1, 2026-10-28..11-07: 200 in 0.66 s, 16 items, latest **2026-11-04** (3 days old). Confirmed.

**Tokens:**
- `/api/sas/v1/token/modis-11A1-061` returns **200**, but COG reads signed with it fail with HTTP **403**.
- `/token/modiseuwest/modis-061-cogs` works (expiry ~45–60 min).

**Catalog gap (new; the most important correction):**
- Month-by-month search shows **no `modis-11A1-061` items from 2025-07-01 to 2025-12-01**. Items resume on 2025-12-02.
- The gap is on both tiles: h11v10 (Trompillo bbox) and h12v10 (Pailón bbox).
- `modis-11A2-061` and `modis-13Q1-061` show the same hole for September → mid-November 2025.
- NASA CMR (`cmr.earthdata.nasa.gov/search/granules.json?short_name=MOD11A1&version=061&temporal=2025-08-01..10`) lists 20–22 granules for these tiles in August and October 2025. **The data exist at LP DAAC but were not ingested by PC.**
- **Consequences:**
  - 2025-10-07 → 2025-12-01 of the 13-month display window has no PC LST, and no PC MOD13Q1 either. **This affects the NDVI family too.**
  - Winter 2025 (frost season) is missing from the PC baseline.
  - Filling the gap needs LP DAAC with an Earthdata login (free signup).

**Wrong tile from point search (wrapper bug class):**
- An `intersects` point search at Okinawa Uno (−62.93) returned only the h12v10 item. The pixel is actually in h11v10: the sinusoidal tile edge is near −62.83° at 17.3°S.
- Indexing gave column −12, and rasterio silently returned an edge value (7.29 °C instead of 0.77 °C).
- The researcher's bbox search with an in-bounds check is correct. A point-search wrapper must search by bbox and reject out-of-bounds indices.

**2021 surazo, with the bounds-checked reader:**

| Date | Okinawa Uno | Pailón | P3 | P2 | P1 | Trompillo |
|---|---|---|---|---|---|---|
| 2021-07-01 (Aqua) | 0.77 | 1.25 | 2.21 | 4.85 | cloudy | 7.09 |
| 2021-06-30 (Aqua) | 1.61 | 2.09 | 1.55 | 4.45 | cloudy (Terra 8.23) | 7.25 |

The researcher's farm values are reproduced, so the event detection is confirmed.

**20 coldest El Trompillo station nights since 2003:**
- Aqua was clear on **8 of 20** nights.
- Median Aqua LST − station Tmin was **+2.4 °C** (researcher at SLVR: +4.85).
- Two of the 20 dates (2025-07-01/02) returned no items because of the PC gap.

**Overpass drift** (`Night_view_time`, local solar hours, median over a 50 × 50 window near Pailón):

| Satellite | 2005-08 | 2015-08 | 2024-08 | 2026-08 | 2026-11 |
|---|---|---|---|---|---|
| Aqua | 0.6 | 1.9 | 1.5 | **3.0** | **3.9** |
| Terra | 23.2 | 22.8 | 22.3 | **21.0** | – |

Consequences of the drift:
- A night-LST value from 2026 is taken 2–3 h closer to dawn than the 2003–2020 baseline, so it runs colder. That creates a built-in cold bias in "pixel percentile for the window".
- To correct it, use `Night_view_time` as a covariate, or restrict the baseline to similar overpass times.
- Both satellites are near the end of their missions, so the VIIRS fallback (VNP21A1N/VJ121A1N, Earthdata login) matters more than `notes.md` suggests.

### 5. CHIRTS-ERA5 (`data.chc.ucsb.edu/experimental/CHIRTS-ERA5/`)

**Listing:** 200 in 0.33 s. Folders: tmax, tmin, hi, wbgt, vpd, EWX. `tmax/tifs/daily/` runs **1980 → 2026**. Confirmed.

**Latency:**
- The CHC page says daily Tmax/Tmin have a "5-day lag" and HI/WBGT a 6-day lag.
- The latest daily Tmax is 2026-11-01, but **2026-10-31 returns 404**: there are 304 files for 305 days in 2026.
- Wrappers must tolerate holes.

**Licence:**
- chc.ucsb.edu/data/chirts-era5: "CHIRTS-ERA5 is in the public domain … CC BY 4.0 … the Climate Hazards Center has waived all copyright". Cite DOI 10.15780/G2F08J.
- Commercial use is OK. This is better than the researcher's "CHC open data".
- The path is still `experimental/`, so its stability is not guaranteed.

**Rate limits and silent corruption (critical for the wrapper):**
- At 2 s pacing, reads got 429 after about 9 files. At 3 s pacing, HEAD requests still got 429.
- During those bursts, GDAL `/vsicurl` did **not always raise**:
  - One read returned **0.0** (2007-09-30).
  - Another opened as "NotGeoreferenced" and returned **−9999** (2007-09-29).
- Re-read with 40 s spacing, the same files give **36.97** and **35.30** with a proper transform.
- **A wrapper must validate the geotransform and the value range, and treat any 429 as a hard failure.**

**Corrupt file:** `CHIRTS-ERA5.daily_Tmax.2020.11.09.tif` fails with `TIFFReadDirectory: Failed to read directory at offset 26954888`. This repeated after spaced retries; the file is 26.98 MB.

**Hot-day bias at El Trompillo** (12 hottest station days since 2005; 8 valid reads):

| Source | Mean bias |
|---|---|
| CHIRTS-ERA5 | **−1.48 °C** |
| ERA5 (same days) | **−1.04 °C** |

- So CHIRTS is **not better than ERA5 at this station**. The researcher's −1.06 °C (SLVR) and this −1.48 °C are both small samples.
- Keep CHIRTS-ERA5 as the fallback, but drop the "best bias-corrected Tmax" claim.

### 6. GOES GLM L2 LCFA (`noaa-goes19` / `noaa-goes16`)

**Latency:**
- On 2026-11-07 at 05:53:45 UTC, the newest file was `OR_GLM-L2-LCFA_G19_s20263110553000_e…0553200_c…0553218.nc`, created 05:53:21.
- Latency is **under 30 s**, not ~1 h.

**History:**
- `noaa-goes19/GLM-L2-LCFA/` has only **2025** (first DOY 015) and 2026.
- `noaa-goes16/GLM-L2-LCFA/` has 2018 → 2025, last DOY **097** (2025-04-07, the handover to GOES-East).
- The combined record has no gap. The instrument changes at the handover, so detection efficiency may step. Account for that in a flash-day baseline.

**Quality flag** (from file attributes):

| Value | Meaning |
|---|---|
| 0 | `good_quality_qf` |
| 1 | degraded: events out of time order |
| 3 | degraded: event count exceeds threshold |
| 5 | degraded: flash duration exceeds threshold |

The researcher's quality-0 filter is correct.

**New-day check:**
- Method: one 20-s file every 2 h, quality-0 flashes in bbox (−64.0, −18.6, −61.5, −16.0) and within 50 km of P3.
- Files: 180 per hour, 0.64–0.87 MB, 0.26–0.54 s each.

| Day | Flashes in bbox per sampled file (within 50 km of P3) |
|---|---|
| 2026-02-07 (GFS CAPE 4,260) | 02 UTC 17 (11), 04 UTC 25 (6), 12 UTC 16 (10), 16–18 UTC 11 (1), 22 UTC 14 |
| 2026-03-09 (largest GFS rain, 45 mm, CAPE 2,020) | ≤ 6, mostly 0 |
| 2026-02-10 (CAPE 3,830, no rain) | 0 all day |
| 2025-11-09 (CAPE 0) | 0 all day |

- This supports "CAPE alone is not a storm" and "model rain is not convection". The claim is confirmed.
- Storms also occurred at 12–18 UTC (local morning and afternoon), not only overnight. The proposed 15→12 UTC sampling window covers this.

### 7. NASA POWER (fallback)

- **Hourly** (`power.larc.nasa.gov/api/temporal/hourly/point`, P3, `T2M`, 2026-10-20..11-07): 200 in 0.27 s. 384 of 456 hours valid; the last valid hour is **2026-11-04 23 h**.
- **Hourly from 2000-01-01:** 422 "The data starts at 2001/01/01". Confirmed.
- **Daily from 1981:** not re-probed.

## Recommendation changes

1. **Frost/heat thresholds.** Keep the percentile-first design (confirmed).
   - Re-label `frost_risk_hours` (ERA5 ≤ 5 °C) as a tunable threshold. The station offset ranges from +1.1 °C (El Trompillo) to +2.0 °C (SLVR).
   - Do not present `heat_days_35` absolute counts from ERA5 as observed; they are about 45 % low against stations.
2. **CAPE baseline.** Change the fallback from "ERA5 via CDS (signup)" to "**ERA5 CAPE from `nsf-ncar-era5` on AWS (keyless, CC BY 4.0, 1940 → about 2 months ago)**".
   - Run it as a one-off offline batch: about 180 monthly files, 4–5 h, all farms in one chunk.
   - Keep GFS for the current season, and quantile-map GFS to ERA5 over 2021–2026.
3. **MODIS LST (and the NDVI family's MOD13Q1).** The PC catalog has **no items for 2025-07-01 → 2025-12-01**. The wrapper must:
   - detect missing dates and say "no satellite data" rather than "clear / normal";
   - optionally backfill from LP DAAC (Earthdata login, free signup).
   - Tell the NDVI / Sentinel family: PC MOD13Q1 has the same hole.
4. **MODIS overpass drift.** Use `Night_view_time` as a covariate, or restrict the baseline by overpass hour.
   - Raise VIIRS VNP21A1N/VJ121A1N (Earthdata login) or GOES ABI LSTF from "fallback" to the planned replacement, because Terra and Aqua are drifting and near the end of their missions.
5. **PC wrapper.** Search by bbox, not by point. Check that the pixel row and column fall inside the COG. Use the container SAS token.
6. **CHIRTS-ERA5 wrapper.** CHC's 429s can silently return 0 / −9999 or an ungeoreferenced dataset, so the wrapper must:
   - validate the geotransform and the value range;
   - pace reads at 10 s or more, or batch offline;
   - tolerate missing days (2026-10-31) and corrupt files (2020-11-09).
   - Drop the "smallest hot-day bias" claim (not better than ERA5 at El Trompillo).
7. **Open-Meteo.** The free endpoint is non-commercial. The 10k/day budget is weighted (30 y × 2 vars ≈ 155) and **shared per IP across the team**.
   - Pull baselines once into DuckDB or the offline snapshot.
   - For any bank-facing pilot, plan the paid tier, or a self-hosted ERA5 from the NCAR/ARCO stores (CC BY 4.0).
8. **GLM.** The latency is seconds, so GLM can serve as a near-real-time "storm happened" layer.
   - The baseline is GOES-16 (2018 → 2025-04-07) followed by GOES-19 (2025-01-15 →). Disclose the instrument change.

## Open risks found by verification

- **Station dependence:** only two airport/city stations are available. Any absolute calibration is ±1 °C at best.
- **PC ingestion gaps** may recur. Monitor item counts per day.
- **Shared Open-Meteo IP budget** during the hackathon: several agents probing from one NAT can exhaust the 10k/day budget. This happened in part during this verification (remaining fell to 165).
- **Not re-probed** (unverifiable here): the Sentinel-2 hail-damage NDVI rule, GOES-16 flash-day climatology counts, CHIRTS Tmin +3.56 °C cold-night bias, NASA POWER daily 1981 start, ORNL MYD11A2.

## Status re-check (2026-11-07, 07:39 UTC)

I did not re-run the full verification above. It was written after the current `notes.md`, so it already covers the researcher's claims. I ran 4 cheap keyless probes on the findings most likely to change.

| Check | Result | Effect |
|---|---|---|
| PC `modis-11A1-061` search, bbox around Pailón (−62.8, −17.7, −62.5, −17.4) | Aug 2025: 200, **0 items**. Oct 2025: 200, **0 items**. 2025-12-01..10: 18 items, first `A2025336` (2025-12-02). Latest item `MYD11A1.A2026308` (2026-11-04) | **The catalog gap is still there.** Recommendation 3 stands |
| GOES-19 GLM listing for the current hour (2026/311/07) | 200, 0.10 s, 118 files; newest starts 07:39:00, created 07:39:21, listed at 07:39:43 UTC | **Latency under 1 min is confirmed again** |
| CHIRTS-ERA5 daily Tmax, HEAD only, 5 s apart | 2026-10-31 **404**, 2026-11-01 200 (26.9 MB), 2026-11-02 404 | The 10-31 hole is still there. Latest is still 11-01 |
| Open-Meteo archive, 1 day × 1 variable | **429 "Daily API request limit exceeded"**. `X-RateLimit-Remaining: 0.0`, reset at 2026-11-08 00:00 UTC | **New: this IP has used up its shared daily budget.** No team member or agent on this network can call the free Open-Meteo API until the reset |

### What changed

- **Open-Meteo is blocked for today.** Earlier in the run, remaining fell from 520 to 165. It is now 0.
  - Any pipeline or demo build today that calls Open-Meteo live will fail with 429.
  - The 30-year baselines must be pulled after 00:00 UTC and cached in DuckDB or the offline snapshot.
  - Until then, NASA POWER hourly (keyless; latest 2026-11-04 23 h) is the only live stopgap. The NCAR ERA5 store lags by about 2–3 months, so it can stand in for the 30-year baseline only, not for recent data.
- Nothing else changed. The verdicts above still stand.
