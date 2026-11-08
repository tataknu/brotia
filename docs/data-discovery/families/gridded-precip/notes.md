# Gridded and satellite precipitation — data discovery notes

Family key: `gridded-precip`. Probed 2026-11-06/07 (US Eastern). No accounts, keys or credentials used.
Sample farms: Estancia Los Tajibos (-62.52, -16.86) and Arrocera Mineros (-63.29, -17.20). Some probes ran on all 12 farms.

## TL;DR

1. **Use CHIRPS v3 for the rain baseline, not CHIRPS v2.** At Santa Cruz, CHIRPS v2 is not
   homogeneous over time. Its 1991–2000 Oct–Mar mean is about 40 % below 1981–90, and CHIRPS v3
   and ERA5 do not show this drop. Because of this, v2 ranks the 2023-24 drought only at p23
   (Tajibos) and p13 (Mineros) against 1991–2020. **CHIRPS v3 ranks it p3 and p0**: the 2nd-driest
   and the driest of 33 seasons. ERA5 ranks it p0 at 11 of the 12 farms. So v2 would weaken the
   backtest signal that ADR-0002 D1 needs. CHC also ends v2 production after Dec 2026.
2. **ClimateSERV (SERVIR) works keyless and is the easiest polygon time-series API.** Its CHIRPS
   (datatype 0) is **v2**: the 2024-01-15 value matches the v2 COG exactly (4.27 vs v3 3.87). Its data
   ends 2026-09-30, about 5 weeks behind. Its **IMERG V07 Early/Late (datatypes 227/226) are live**:
   Early runs to 2026-11-05, Late to 2026-11-04, with history from 2000-06. The old datatypes 26/91
   (IMERG V06) stopped in 2024-06, and CHIRPS-GEFS (31/32) returns nothing.
3. **CHC (data.chc.ucsb.edu) serves CHIRPS v3 keyless as GeoTIFF/COG.** We read single pixels with
   HTTP range reads through rasterio `/vsicurl`. Daily final (`rnl`) runs to 2026-09-30. Daily prelim
   (`sat`) runs to 2026-10-31, about 6 days behind. Pentads, monthly and annual are also there.
   The server returns **HTTP 429 to bursts**, so reads must be paced (about 1.5 s per file for all 12
   farms together).
4. **Open-Meteo archive (ERA5) is the most convenient fallback.** One call returns all 12 farms for
   1981→2026 in 3.9 s, with data to 2026-11-01. `era5_land` precipitation comes back **all null**;
   use `era5`. ERA5 has a wet-day (drizzle) bias. Its year-to-year totals correlate only 0.44–0.48
   with CHIRPS v3. Only ever compare ERA5 against an ERA5 baseline.
5. **Never mix products between the current window and the baseline.** Climatologies differ by up
   to 1.5× between products at the same farm. A percentile is only meaningful against the same
   product's own history.

## What was probed (live results)

| Source / path | Probe | Status, latency of call | Latest value seen | History start | Result |
|---|---|---|---|---|---|
| ClimateSERV `submitDataRequest` CHIRPS (dt 0), 0.05° box at Tajibos | Oct-23..Mar-24 avg | 200, about 8 s per job | 2026-09-30 | 1981-01-01 | 527 mm (183/183 days) |
| ClimateSERV CHIRPS, chunk size test | 1 y / 5 y / 10 y / 45 y | 8 s / 24 s / 36 s / **fail (progress −1)** | — | — | Docs give a 20-year limit per request. Full 1981→2026 for one farm in 5×10 y chunks takes about 2 min 45 s. |
| ClimateSERV CHIRP (dt 90) | season | 200, 27 s | **2026-06-10 (stale)** | — | 497 mm, 178/183 days |
| ClimateSERV IMERG V06 Late/Early (dt 26/91) | season, 2025-26 | 200 | **2024-06-01 (stopped)** | 2000-06-08 | 673 / 700 mm |
| ClimateSERV IMERG **V07 Late (dt 226)** | season, recent | 200, 11–30 s | **2026-11-04** | 2000-06-08 | 646 mm (181/183 days); Oct-1..Nov-4 2026: 93 mm |
| ClimateSERV IMERG **V07 Early (dt 227)** | season, recent | 200, 11–30 s | **2026-11-05** | — | 666 mm; Oct-1..Nov-5 2026: 95 mm |
| ClimateSERV CHIRPS-GEFS (dt 31/32) | 2025, Oct–Dec 2026 | 200 but 0 rows | — | — | not usable |
| CHC CHIRPS v3 daily final `rnl` (ERA5-disaggregated), COG `…/daily/final/rnl/cogs/YYYY/*.cog` | pixel read, 20 days × 12 farms | 206 range reads, 0.5–4 s per file, 30 s for 20 files, 0 errors | 2026-09-30 | 1981 | 512×512 tiles; 2024-01-01..20 at Tajibos: 88 mm |
| CHC CHIRPS v3 daily prelim `sat` (IMERG-disaggregated) `…/daily/prelim/sat/2026/*.tif` | pixel read | 6.5 s, strip TIFF (not tiled), 11.7 MB | **2026-10-31** (posted 2026-11-02) | prelim 2025 onward; final `sat` from 1998 | 0.01 mm |
| CHC CHIRPS v3 monthly / annual tifs | Oct–Mar 1991–2024 and 1981–2025 annual at 2 farms | about 1 s per file, paced | 2026-09 | 1981 | see the tables below |
| CHC CHIRPS v2 final daily COG | pixel | 44 s (with 429 retries) | **2026-06-30** | 1981 | 4.27 mm on 2024-01-15. v2 prelim daily to 2026-10-31. |
| CHC CHIRPS3-GEFS 16-day forecast `…/CHIRPS-GEFS/v3/16_day/2026/11/c3g_2026.11.06.tif` | pixel | 0.8 s (69 MB file, range read only) | issued 2026-11-06 | hindcast 2001–2019, 2021→ | **next 16 days: Tajibos 43.9 mm, Mineros 43.3 mm** |
| Open-Meteo archive `models=era5` (0.25°) | 12 farms × 1981→2026 in 1 call | 200, 3.9 s, 3.6 MB | **2026-11-01** (about 5 days behind) | 1940-01-01 | season 502 mm at Tajibos |
| Open-Meteo `models=era5_land` | daily and hourly precip | 200 | — | — | **precipitation all null** (temperature works) |
| Open-Meteo `models=ecmwf_ifs` (archived IFS analysis) | recent, start | 200 | **2026-11-06** (0 lag) | 2017 (2015 is null) | tail filler only, not a baseline |
| NASA POWER daily point `PRECTOTCORR` (source header: MERRA2) | season, 1981→2026 | 200, 0.3–0.8 s | **2026-11-03** (−999 after) | 1981-01-01 | 722 mm at Tajibos (wet outlier) |
| NOAA PSL CPC Unified gauge 0.5° OPeNDAP `…/cpc_global_precip/precip.YYYY.nc.ascii?…` | point slice | 200, 1.2 s | **2026-11-05** | 1979 (1978 → 404) | 537 mm at Tajibos, 452 mm at Mineros |
| NASA CMR granule search (keyless metadata) | IMERG V07 daily | 200 | Early 2026-11-05, Late 2026-11-05, **Final 2025-09-30** | 1998-01-01 | GES DISC data needs an Earthdata login (302 to URS) |
| CHRS PERSIANN `persiann.eng.uci.edu/CHRSdata/` | directory listing | 200 | PDIR-Now daily **2026-11-06** | PDIR-Now 2000-03-01 | open HTTP, but 31 MB global .bin.gz per day; not downloaded (over size cap) |
| NOAA NCEI PERSIANN-CDR `…/precipitation-persiann/access/YYYY/` | listing | 200 | **2026-07-31** (about 3 months behind) | 1983 | 0.25° daily NetCDF per day, keyless |
| IRI Data Library CHIRPS / CPC | point CSV | 200 but returns **sign-in page** ("The Data Library now requires all users to sign in") | — | — | needs a free account now |
| Planetary Computer STAC | collection list | 200 | `gpm-imerg-hhr` ends **2021-05-31**; `era5-pds`; no CHIRPS | — | not useful for precipitation |

Probe scripts and outputs are in this folder (`probe_*.py` / `*.out`, `fetch_*.py`, `compare_season.py`,
`extra_stats.py`, `decadal_ratio.py`).

## Cross-product comparison, Oct-2023..Mar-2024 (the 2023-24 drought)

Each cell shows: season total (mm) | percentile against the product's own 1991–2020 Oct–Mar
history | its 1991–2020 mean.

| Product | Tajibos | Mineros |
|---|---|---|
| **CHIRPS v3** (CHC monthly) | 535 \| **p3** \| 764 | 559 \| **p0** \| 906 |
| CHIRPS v2 (ClimateSERV daily) | 527 \| p23 \| 621 | 543 \| p13 \| 757 |
| ERA5 (Open-Meteo) | 502 \| **p0** \| 904 | 749 \| **p0** \| 1135 |
| NASA POWER (MERRA-2) | 722 \| p20 \| 850 | 769 \| p27 \| 871 |
| CPC Unified gauge 0.5° | 537 \| – | 452 \| – |
| IMERG V07 Late (ClimateSERV, ±0.05° box) | 616 \| **p4** vs 2000–2022 (2nd driest of 25) \| 964 | not fetched (job stopped, about 20 min per farm) |
| IMERG V07 Early (ClimateSERV, ±0.025° box) | 666 (Late with the same box: 646) | – |

Every product that is homogeneous at Santa Cruz (CHIRPS v3, ERA5, IMERG V07) puts 2023-24 at p0–p4. Only CHIRPS v2 and POWER do not.
ERA5 for all 12 farms: 2023-24 is p0 at 11 farms and p7 at Agricola Warnes Sur. Season totals run
479–749 mm against 1991–2020 means of 807–1135 mm (`extra_stats.out`).

**Homogeneity check, annual totals in mm (decadal means, `annual_totals_v3_v2_era5.csv`):**

| Decade | Tajibos v3 | v2 | ERA5 | Mineros v3 | v2 | ERA5 |
|---|---|---|---|---|---|---|
| 1981–90 | 1460 | 1224 | 1264 | 1628 | 1547 | 1655 |
| 1991–00 | 1191 | **819** | 1251 | 1330 | **974** | 1708 |
| 2001–10 | 1113 | 1027 | 1148 | 1321 | 1274 | 1517 |
| 2011–20 | 1066 | 874 | 1164 | 1361 | 1052 | 1501 |
| 2021–25 | 1143 | 1113 | 1041 | 1333 | 1270 | 1297 |

Correlation of annual totals: v3~ERA5 0.48 / 0.44, v3~v2 0.77 / 0.71, v2~ERA5 0.23 / 0.13.
v2 has deep dry decades (likely from changes in which stations feed it). v3's gauge-undercatch
correction and denser station normals remove most of that.

**Wet-day statistics (dry-spell sensitivity), Oct–Mar:**

| Farm, product | wet days ≥1 mm in 2023-24 | 1991–2020 mean wet days | max dry spell 2023-24 |
|---|---|---|---|
| Tajibos ERA5 / CHIRPS v2 / POWER | 70 / 51 / 75 | 100 / 63 / 100 | 17 / 18 / 21 |
| Mineros ERA5 / CHIRPS v2 / POWER | 95 / 49 / 69 | 117 / 64 / 98 | 18 / 17 / 21 |

The 1 mm wet-day threshold means very different things in each product. ERA5 and POWER drizzle
on about 100 days per season, CHIRPS on about 63. The `dryDays` (21 consecutive days) threshold
is therefore product-specific. Express it as a percentile against the same product's history, or
calibrate it per product.

## Recommendations per variable

| Variable | Primary | Fallback | Baseline | Why |
|---|---|---|---|---|
| `precip` daily, rain-deficit totals (30–60 d) | **CHIRPS v3**, three tiers: final `rnl` daily COGs (to M−1, about 5 weeks behind) → prelim `sat` daily (about 6 days behind) → IMERG V07 Early via ClimateSERV dt 227 for the last few days, labelled "estimated" | **ERA5 via Open-Meteo** (`models=era5`), with its own ERA5 baseline. Second fallback: CPC Unified (1-day latency, gauge). | CHIRPS v3 1991–2020 (or the last 30 y). Build it from **pentad COGs** (about 3,300 reads, about 1–1.5 h once for all 12 farms) or daily `rnl` COGs (about 16.7k reads, about 7 h sequential; run it overnight) into DuckDB. | Homogeneous at Santa Cruz, flags 2023-24 at p0–p3, 0.05° (5.5 km), keyless. CHC recommends pentad or monthly totals over daily. |
| Dry spell (`dryDays`), heavy-rain days (flood / waterlogging proxy) | **IMERG V07 Late via ClimateSERV dt 226** (a real daily satellite field, 0.1°, 2000-06 →, 2–3 days behind, keyless polygon API) | CHIRPS v3 `sat` daily (uses IMERG timing) or ERA5 (drizzle bias: shorter dry spells) | IMERG 2000–2025 (26 seasons) | CHIRPS daily is a pentad total split across days by ERA5/IMERG timing, and that can create artificial wet runs. |
| Rain outlook (optional "what's next") | **CHIRPS3-GEFS 16-day total**, CHC GeoTIFF (issued daily, 0.8 s pixel read) | Open-Meteo forecast API (other family) | CHIRPS3-GEFS hindcast 2001–2019 (for anomaly) | Keyless, bias-corrected to CHIRPS3. |
| Validation only | CPC Unified, NASA POWER, PERSIANN-CDR | — | — | POWER is a wet outlier (722 vs about 530 mm) and its MERRA-2 wet-day frequency is ERA5-like. |

Wrapper sketch (ADR-0002 D2):
- `ClimateServWrapper(datatype)` covers IMERG 226/227 and CHIRPS v2. It needs async submit → poll →
  fetch, chunks of 10 years or less, and about 10–40 s per job.
- `ChcCogWrapper(product)` covers CHIRPS v3 daily, pentad and monthly, prelim, and GEFS. It reads
  with rasterio `/vsicurl`, samples all farms in one open, keeps one request in flight, waits about
  0.5 s between files, and sets `GDAL_HTTP_MAX_RETRY` for 429 responses.
- `OpenMeteoEra5Wrapper` takes a multi-location call.
- `CpcPslWrapper` uses OPeNDAP ASCII slices.
- Each value stores `source`, `version` (v3-final / v3-prelim / imerg-early), `obs_date` and
  `res_deg`.

## Notable alternatives (not used)

| Source | Access | Status |
|---|---|---|
| IMERG V07 direct (GES DISC OPeNDAP/Harmony) | free instant Earthdata signup | Not tested (needs credentials). CMR shows Early/Late to 2026-11-05 and Final to 2025-09-30. Use it if ClimateSERV is down. |
| Google Earth Engine (`UCSB-CHC/CHIRPS/V3/DAILY_RNL`, IMERG, GSMaP v7) | GEE account plus Cloud project (free noncommercial) | Fastest way to build a CHIRPS v3 daily baseline if a teammate already has GEE. Not tested. |
| GSMaP (JAXA) NRT / Gauge-NRT | free registration form; FTP credentials arrive by email; G-Portal | Not tested. 0.1°, about 4 h latency, 2000→. |
| MSWEP v2.8 / MSWX | application form; noncommercial is free, commercial is licensed (gloh2o.org) | Not tested. Approval is not instant, so not hackathon-viable. |
| PERSIANN-CCS / PDIR-Now (CHRS) | open HTTP, global 0.04° binary, about 31 MB per day | Listing verified; too heavy per file for point use. The CHRS portal offers clipped downloads via an email form. |
| TAMSAT | — | Africa only (by design); not applicable to Bolivia. Not tested. |
| IRI Data Library | **free account now required** (verified: dlauth sign-in wall) | — |
| meteoblue dataset API (CHIRPS3) | paid key | — |
| Planetary Computer | keyless STAC | IMERG collection ends 2021-05, no CHIRPS. Not useful. |

## Risks and open issues

1. **CHIRPS v2 (and ClimateSERV dt 0) is inhomogeneous at Santa Cruz and ends Dec 2026.** Do not
   use it for baselines. If ClimateSERV adds CHIRPS3 later, switch to it.
2. **CHC rate limits (HTTP 429)** on burst range reads. The baseline build must be paced and cached
   once. Never fetch it in the request path. The demo must run from the DuckDB/JSON snapshot.
3. **CHIRPS final is about 5 weeks behind and prelim about 6 days.** The last days of the 13-month
   window must come from IMERG Early or ERA5/IFS, labelled "estimated". Prelim values get revised
   when final arrives, so store `version` and recompute.
4. **The CHIRPS daily disaggregation artefact** (from the CHC v3 readme): days within a pentad are
   distributed by ERA5 or IMERG ratios, and even splits create fake wet runs. This hurts `dryDays`.
   Prefer IMERG for spell metrics and pentad totals for deficits.
5. **Products disagree on year-to-year variability** (annual correlations of only 0.13–0.48). Which
   one is right for Santa Cruz is still unverified against gauges. Next step: compare against
   SENAMHI or GSOD Viru Viru (SLVR, about -63.14, -17.64), which the stations family covers.
6. **ClimateSERV is a single public service** with no SLA. IMERG V06 ingestion silently stopped in
   2024-06 and returns empty arrays, not errors. Health checks must assert "latest date within N
   days", not just HTTP 200. Jobs take 10–40 s for one season. A 10-year IMERG chunk took about 7.5 min, so a full 2000→2026 IMERG history costs about 20 min per farm (about 4 h for 12 farms). Run it once, offline, with a cache. IMERG has about 0.4 % of days missing at Tajibos (41 of 9,646).
7. **Open-Meteo `era5_land` precipitation is null.** Precipitation must request `models=era5`, while
   the soil-moisture and temperature families may use `era5_land`. Several farms share one ERA5 cell
   (12 farms map to 11 cells): Mineros and San Antonio are identical.
8. **UTC day convention** (CHIRPS v3, IMERG, ERA5 via Open-Meteo `timezone=UTC`) versus local
   Bolivian time (UTC−4). Keep everything UTC for consistency.
9. **Licence.** CHIRPS is public domain / CC0-like ("free, cite"). IMERG is NASA open data. ERA5 is
   Copernicus licence (attribution) and Open-Meteo is CC-BY 4.0. CPC is NOAA public. POWER is open.
