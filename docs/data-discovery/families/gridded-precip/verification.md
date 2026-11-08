# Gridded and satellite precipitation: adversarial verification

Verifier pass on the `gridded-precip` top picks (`notes.md`). Probed on 2026-11-07 (US Eastern). No accounts, keys or credentials were used.
I used points that are not sample farms:
- **P1** = (-62.60, -17.10), between Brecha 8 and Cuatro Cañadas
- **P2** = (-63.05, -17.45), near Warnes

I also used date ranges that the researcher did not use: Feb 2019, the year 2014, Jun 2000, and 2026-10-20..11-07.
The probe scripts and raw outputs are kept outside the repo, in the session scratchpad (`.../scratchpad/gpv/verify/`).
I did this because this task allowed me to write only this file. The probe URLs and parameters are given inline below, so anyone can repeat each probe.
`verified=true` means I re-probed the value live. `verified=false` means I only read documentation, or could not test it.

## Verdict summary

| # | Claim | Status | Short reason |
|---|---|---|---|
| 1 | CHIRPS v3 on CHC is keyless; daily `rnl`/`sat` and pentads are consistent | **confirmed** | rnl and sat sums equal the pentad exactly at P1 and P2; prelim daily sums equal the prelim pentad |
| 2 | CHIRPS v3 latency: final to 09-30, prelim daily to 10-31 (posted 11-02), prelim pentad about 2 d | **confirmed** | directory listings |
| 3 | CHIRPS v3 history 1981 (`sat` from 1998) | **confirmed** | listings and readme |
| 4 | CHIRPS v3 licence "public domain / free with citation" | **corrected** | the page says CC0-style waiver **and** CC BY 4.0. Commercial use is OK; attribution is expected |
| 5 | CHC rate limits: about 1.5 s per file works, 20 COGs in 30 s, baseline in 1–1.5 h | **corrected (material)** | 429s at 1, 3 and **6 s** spacing; 8–10 s pacing was needed; files took 9–76 s each |
| 6 | Daily CHIRPS is a disaggregated pentad and equal splits make fake wet runs | **confirmed (live example)** | `sat` at P2, 2019-02-06..09: four consecutive days of 0.469 mm |
| 7 | CHIRPS v3 is "homogeneous at Santa Cruz" | **corrected** | the researcher's own CSV shows v3 falls about 18 % from 1981–90 to 1991–00 (ERA5/v3 ratio 1.04 to 1.33 at Mineros). Better than v2, but not homogeneous before 1991 |
| 8 | v3 percentiles 2023-24: p3 (Tajibos) / p0 (Mineros); v2 p23 / p13 | **confirmed (recomputed)** | from the saved CSVs, not re-downloaded |
| 9 | ClimateSERV IMERG V07 Late (dt 226) / Early (dt 227) are keyless and live | **confirmed** | 200, jobs take 8–62 s |
| 10 | IMERG latency: Late about 2–3 d, Early about 1–2 d | **corrected** | on 11-07: Late latest is 11-04 (3 d), Early latest is 11-05 (**2 d**) |
| 11 | IMERG history starts 2000-06-08 | **confirmed for Late**; Early starts **2000-06-02** | probes at P1 and P2 |
| 12 | IMERG "41 of 9646 days missing" (looks harmless) | **corrected** | the gaps are **clustered**: 2014-06-01..07 (also at P1), **all of May 2024**, and 2023-12-31..2024-01-01 |
| 13 | IMERG is a good primary for dry spells and heavy rain | **corrected (caveat)** | IMERG Late is much wetter than every other product: 2014 at P1 was 1937 mm, against CHIRPS v3 1316, CPC 1464 and ERA5 1279 |
| 14 | ClimateSERV dt 0 is CHIRPS **v2** | **confirmed (stronger evidence)** | ClimateSERV's own `etl_dataset` catalogue has source_url `CHIRPS-2.0/global_daily/tifs/p05/` |
| 15 | ClimateSERV limit of 20 years per request | **confirmed** | the help page says so |
| 16 | Open-Meteo ERA5: 1940 start, to 11-01, `era5_land` precip null | **confirmed** | probed at P2 and P1 |
| 17 | Open-Meteo licence CC-BY 4.0 | **corrected (material)** | the terms say the free API is for **non-commercial use only**. A bank product needs a paid plan |
| 18 | Open-Meteo "12 farms x 46 y in one call", about 10k calls/day | **corrected** | the quota is weighted: cost = locations × max(1, days/140). That call costs about **1,440** units. The shared IP had **157 / 10,000** units left |
| 19 | CPC Unified: keyless, from 1979, latency about 1 d | **corrected** | latest is 11-05 on 11-07 (about 2 d). A year slice took 23 s. **Inhomogeneity:** "V1.0" up to 2005, then "V1.0 RT" from 2006 |
| 20 | CHIRPS3-GEFS 16-day, issued daily, hindcast 2001–2019 then 2021→ | **confirmed** | README and listing |
| 21 | CHC's preferred bulk path (FTP/rsync) | **unverifiable** | FTP returned 550 and rsync timed out from this sandbox (it may be a network restriction) |

## Evidence

### CHIRPS v3 (CHC data server)

- **Keyless, listing latency (verified=true).**
  - `daily/final/rnl/cogs/2026/` ends at `chirps-v3.0.rnl.2026.09.30.cog` (23.9 MiB, posted 2026-Oct-15 22:27).
  - `daily/prelim/sat/2026/` ends at `chirps-v3.0.prelim.2026.10.31.tif` (posted 2026-Nov-02 20:31).
  - `prelim/pentads/latam/tifs/` ends at `2026.10.6` (posted Nov-02). The pentad `10.3` was posted Oct-19, which is **4 d** after the pentad ended. So "about 2 days" is the typical delay, not a guarantee.
  - Final pentads and monthly files end at 2026-09. There are 3,294 pentad COGs (1981.01.1 to 2026.09.6) and 549 monthly COGs.
  - Final is posted about mid-month. On 11-07 the final data is 38 days old, and October final should arrive around Nov 15.
- **History (verified=true).** `rnl/cogs/1981/` has 365 files. `final/sat/` starts at 1998.
  - Note: the rnl 1981 COGs are dated **2026-Apr-20** and the pentad COGs are dated 2025-Feb. The daily archive was regenerated in April 2026, so a cached baseline must store the build date and the file modification time.
- **Internal consistency (verified=true, P1/P2, pentad 2019.02.2 = Feb 6–10).**

  | | P1 | P2 |
  |---|---|---|
  | pentad COG | 9.10 | 4.69 |
  | Σ rnl daily | 9.10 | 4.69 |
  | Σ sat daily | 9.10 | 4.69 |
  | prelim pentad 2026.10.6 (latam tif) | 12.72 | 15.48 |
  | Σ prelim daily Oct 26–31 | 12.72 | 15.48 |

  - **Equal-split artefact, live:** sat at P2 for Feb 6–9 was 0.469, 0.469, 0.469, 0.469 mm, then 2.815 mm.
  - rnl and sat time the rain very differently. At P1, rnl spreads it over 5 days (0.56, 1.83, 0.38, 3.04, 3.29). sat puts 0, 0, 0, 0.29 and then 8.81 mm on the last day.
  - So daily wet-day and dry-spell counts depend on the disaggregation method, as the readme warns.
- **Units and metadata (verified=true).** float32, mm, EPSG:4326, 0.05°, tiled COG.
  - **`nodata` is None.** The file does not declare a nodata value, so the wrapper must mask negative values itself.
  - The prelim daily and latam tifs are not tiled.
- **Rate limits (verified=true, corrected).** Repeated 16 KB range GETs on one COG returned:
  - 1 s spacing: `206 206 206 429 429 429 206 429`
  - 3 s spacing: `206 429 206 206 206 206 429 429`
  - 6 s spacing: `429 206 206 206 206 429 206 206`
  - nginx sends no Retry-After header.
  - With GDAL retries and 8–10 s pacing, one file read took 9–76 s. One read failed after 111 s.
  - At this throughput, 3,300 pentad reads take about **9–18 h**, not 1–1.5 h. The 7 h estimate for the daily build would become days.
  - Caveat: other workflow agents may share this IP and this server, so the limit for one client may be looser. Still, the plan must not assume 1.5 s per file.
  - The CHC landing page says **HTTP is the "least preferred"** method and asks scripts to use FTP or rsync. Neither worked from this sandbox (FTP 550, rsync connect timeout), so I could not verify them.
  - Option: the `latam` subset tifs are about 3.5 MB per pentad and 4 MB per month. One whole-file GET avoids the 2–3 range requests per COG open.
- **Licence (verified=true, corrected).** chc.ucsb.edu/data/chirps3 says: "CHIRPS3 is in the public domain, as registered with Creative Commons, and is licensed under a Creative Commons Attribution 4.0 International License … the Climate Hazards Center has waived all copyright." Commercial use is allowed. Cite Funk et al. 2026, Sci Data 13:718.
- **v2 retirement (verified=true):** daily readme: "CHIRPS v2 is being retired; its last month of operation will be December 2026."
- **Homogeneity (recomputed from `annual_totals_v3_v2_era5.csv`, verified=partial).**
  - The researcher's decadal means and correlations reproduce exactly.
  - But v3 also drops about 18 % from 1981–90 to 1991–00: 1460→1191 mm at Tajibos and 1628→1330 mm at Mineros. ERA5 does not drop at Mineros (1655→1708).
  - The ERA5/v3 decadal ratio is 0.89–1.10 at Tajibos and **1.04–1.33** at Mineros. For v2 it is 1.06–1.84.
  - Conclusion: v3 is much better than v2, but it is not homogeneous. Keep the baseline at **1991–2020** and do not start it in 1981.
- **2023-24 percentiles (recomputed, verified=false for the live data).**
  - Tajibos: 535 mm. Only 2015-16 (514 mm) is lower in 1991–2020, so the percentile is p3.3, 2nd driest of 33.
  - Mineros: 559 mm is the lowest season, so p0.
  - I did not re-download a 30-year v3 baseline because of the 429s.
- **2014 cross-check at P1 (verified=true).** CHIRPS v3 monthly 2014, Jan to Dec: 156, 168, 155, 23, 190, 159, 57, 11, 65, 62, 162, 109. Annual total **1316 mm**.

### ClimateSERV IMERG V07 (dt 226 Late / 227 Early)

- **Live and keyless (verified=true).**
  - dt 227 at P1, 2026-10-20..11-07: 17 days, last value **11-05** (8.9 mm), job took 14 s.
  - dt 226 at P2: 16 days, last value **11-04**, job took 8 s.
  - So on 11-07 Early is 2 d behind and Late is 3 d behind.
- **History start (verified=true).**
  - dt 226 at P2 starting 2000-05-25: the first value is **2000-06-08** (4.6 mm).
  - dt 227 at P1: the first value is **2000-06-02**.
- **Gaps (verified=true).**
  - dt 226 for all of 2014 at P1 returned 358 of 365 days. **2014-06-01..07 is missing.**
  - The researcher's Tajibos CSV has the same gap. It also has gaps at **2024-05-01..31 (31 days)**, 2023-12-31..2024-01-01 (during the season) and 2026-01-21.
  - These are ingestion gaps in the service, and they come back silently as missing dates.
- **Magnitude bias (verified=true).**
  - 2014 at P1: IMERG Late **1937 mm** (with 7 days missing), CHIRPS v3 1316, CPC 1464, ERA5 1279.
  - January 2014: IMERG 382 mm, CHIRPS v3 156, CPC 151, ERA5 277.
  - In the researcher's own data, the Oct–Mar mean at Tajibos is 964 mm for IMERG and 764 mm for CHIRPS v3 (+26 %).
  - So absolute heavy-rain thresholds (for example ≥ 50 mm/day) fire much more often on IMERG. Thresholds must be percentiles of the same product.
- **dt 0 = CHIRPS v2 (verified=true).**
  - `GET /api/etl_dataset/?format=json` lists CHIRPS with source_url `https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_daily/tifs/p05/`.
  - The IMERG V07 entries point to the PPS `imerg/gis` GeoTIFFs. Direct PPS access needs a free PPS registration.
  - All IMERG pipelines show `is_pipeline_enabled: false`, but the data keeps updating. Do not use that flag for health checks.
  - dt 0 at P1 for 2019-02-06..10 gave 0, 0, 0, 0, 6.30 mm (total 6.3). v3 gave 9.10 for the same days. The v2 COG for 02-08 at P1 is 0.0, which matches.
- **Limits (verified=true for the docs).** The help page says: "a limit of 20 years of data per request has been implemented". It states no licence or SLA (verified=false). The IMERG data itself is NASA open data.
  - Risk: SERVIR was co-funded by USAID, which was wound down in 2025. The service is up today, but its continuity is not assured (verified=false).

### Open-Meteo archive (ERA5)

- **Data (verified=true, P2, 2026-10-20..11-07).**

  | model | non-null days | last value | grid cell |
  |---|---|---|---|
  | `era5` | 13 of 19 | **11-01** | -17.5, -63.0 |
  | `era5_land` | **0 of 19** | — | — |
  | `era5_seamless` | — | 11-01 | — |
  | `ecmwf_ifs` | — | 11-07 | — |

  - `era5_land` precipitation is also all null in 2019, for `precipitation_sum`, `rain_sum` and hourly precipitation.
  - `era5_seamless` returns the era5_land grid but its precipitation comes from era5.
  - The series starts on 1940-01-02. The 1940-01-01 value is null, because the first UTC day is incomplete.
  - ERA5 2014 at P1: 1279 mm.
- **Licence and terms (verified=true, corrected).** open-meteo.com/en/terms: "You may only use the free API services for non-commercial purposes." Other limits: fewer than 10,000 calls/day, 5,000/hour and 600/minute, and limits apply per IP. A hackathon demo is fine. A bank deployment needs the paid API (or self-hosting).
- **Quota weighting (verified=true).** These are the `X-RateLimit-Cost` headers:

  | request | cost |
  |---|---|
  | 1 location × 14 days | 1.0 |
  | 2 locations × 14 days | 2.0 |
  | 1 location × 365 days | 2.61 |
  | 1 location × 396 days | 2.83 |

  - So cost ≈ locations × max(1, days/140).
  - One call for 12 farms × 46 years costs about 1,440 units, so it is not "one call" against the quota.
  - **At probe time the shared IP had 157 of 10,000 units left**, with reset at 2026-11-08 00:00 UTC. Other agents or teammates on the same IP can exhaust the quota during the demo.

### CPC Unified (NOAA PSL OPeNDAP)

- **Data (verified=true).** These are the slice sizes per year file:
  - `precip.2026.nc` has 309 time steps, so the last value is **2026-11-05** (29.9 mm at the cell -17.25, 297.25).
  - `precip.1978.nc` returns 404 and `precip.1979.nc` is present.
  - A one-cell × one-year ASCII slice took **23 s**, not 1.2 s.
  - 2014 at P1: 1464 mm, no missing values. Units are mm and the missing value is -9.97e36.
- **Inhomogeneity (verified=true, new).** The DAS `title` is "CPC GLOBAL PRCP V1.0" for 1979–2005 and "CPC GLOBAL PRCP **V1.0 RT**" from 2006. That is the retrospective product (dense gauges) joined to the real-time product (fewer gauges, GTS-based). This is the same kind of break that was used to reject CHIRPS v2. A 1991–2020 CPC baseline straddles the join.

### CHIRPS3-GEFS (verified=true)

- `CHIRPS-GEFS/v3/16_day/2026/11/` holds daily files from c3g_2026.11.01 to 11.06. Each is 65.9 MiB and is posted about 09:21 local server time.
- The README says: "our CHIRPS3-GEFS record is available from 2001-2019, and 2021 to Present". The 2020 folder exists but holds only a README.
- The README also says it is GEFSv12, bias-corrected to CHIRPS3 and downscaled to daily with IMERG-Late.

## What survives, and what changes

The family picks are sound. CHIRPS v3 should be the baseline product. ERA5 and IMERG each need their own baseline. CHIRPS v2 and ClimateSERV dt 0 should be rejected. The changes below are about effort, licence and correctness at the edges:

1. **Baseline build budget.** Plan for about 10 s per CHC request, and run the build once, offline, before the demo.
   - Build Oct–Apr pentads only first: 30 y × 42 ≈ 1,260 reads, about 3.5 h. Use monthly COGs (360 reads) for whole-year context.
   - Consider whole-file latam tifs (3.5–4 MB) instead of COG range reads.
   - The baseline should be 1991–2020. Do not start it in 1981.
2. **Do not splice IMERG Early millimetres onto a CHIRPS series without adjustment.** IMERG Late runs about 26–47 % wetter than CHIRPS here.
   - Either scale the last days by a CHIRPS/IMERG monthly ratio for that pixel and month, or keep the tail as a separate "estimated" anomaly against the IMERG baseline.
   - The researcher's own rule 5 (never mix products) applies to the three-tier plan.
3. **Gap handling.** dryDays and heavy-rain counters must treat missing IMERG dates as unknown, never as dry. Flag any window with more than 2 missing days.
4. **Product-specific thresholds.** Heavy-rain and waterlogging thresholds on IMERG must be IMERG percentiles, not absolute mm.
5. **Open-Meteo is non-commercial on the free tier.** Use it for the hackathon only and mark it "paid tier for production".
   - Cache ERA5 in DuckDB once. The quota is per IP and weighted by days/140, and it was almost exhausted (157 left) on 11-07.
6. **CPC: use it for the low-latency tail and cross-checks only, not as a percentile baseline.** It has the V1.0 → V1.0 RT break at 2006 and coarse 0.5° cells.
7. **Store `source_mtime` and the build date with every CHIRPS v3 value.** The archive was regenerated in April 2026. Treat the COG `nodata=None` as "mask values below 0".

## Re-check (2026-11-07, second pass)

I re-probed the time-sensitive claims live. All verified=true.
- CHC: final `rnl` still ends at 2026-09-30 and prelim `sat` at 2026-10-31. Both listings return HTTP 200 in under 2 s.
- ClimateSERV at P1: dt 226 (Late) last value is 11-04 (job took 11 s). dt 227 (Early) last value is 11-05 at 8.9 mm (job took 6 s). This is unchanged.
- CPC `precip.2026.nc` still has 309 time steps, so the last value is 11-05.
- **Open-Meteo archive now returns `{"error":true,"reason":"Daily API request limit exceeded"}`** with `X-RateLimit-Remaining: 0.0`. The shared-IP quota went from 157 to 0 units within hours. This confirms the demo risk: ERA5 must be pre-cached in DuckDB, and the live fallback must not depend on it.
