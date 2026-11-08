# Global station archives: Santa Cruz lowlands (family `global-stations`)

Probed 2026-11-06/07 UTC from a laptop with no keys and no accounts. "Verified" means I fetched
real data during this session. The scripts are in `probes/`. The derived CSVs are in this folder.

## TL;DR

1. **The WMO station network near the farms is thin.** Inside 150 km there are 4 usable
   synoptic stations: **Viru Viru 85244/SLVR** (11–109 km from the farms, median ~55 km),
   **El Trompillo 85245/SLET** (30–126 km, an urban airport), **San Javier 85195/SLJV**
   (66–167 km) and **Concepción 85196/SLCP** (81–180 km). Guarayos 85175 and Vallegrande 85264
   (2,000 m, in the Andes foothills) are farther away and less representative. WMO OSCAR lists
   only 6 Bolivian stations in the box 15.5–19 °S, 61.5–64.5 °W. **No WMO station sits in the
   eastern soy belt** (Cuatro Cañadas, Pailón, San Julián) or in Okinawa.
2. **NCEI's classic products froze on 2025-08-24.** ISD and GSOD were retired (end of life
   2025-08-29). **GHCN-Daily for every Santa Cruz station also ends between 2025-08-21 and 2025-08-24**, because its
   Bolivian data came from GSOD (source flag `S`). Only Vallegrande continues, from a new source.
   Any pipeline built on GSOD, ISD or GHCN-D gets **no Santa Cruz data after Aug 2025**.
3. **The replacement, GHCNh (hourly), is live and keyless.** It updates daily, and the latest
   SLVR record is 2026-11-04 14 UTC (~2 days' latency). It covers SLVR from 1985. But **NCEI's
   SYNOP feed for SLVR stops after Mar 2026**: only METAR remains, and METAR carries **no
   rainfall amounts** in Bolivia. GHCNh also passes station coding errors through unflagged. On
   2024-01-11 12Z it stores 911 mm, from the section-1 group `69114`, while the same bulletin's
   section 3 says `70001` (0.1 mm). Use GHCNh for temperature only, or apply our own QC.
4. **OGIMET raw SYNOP is the best keyless station rain source.** Viru Viru reports every 3 hours,
   24/7, up to the current hour (latest seen: 2026-11-07 00 UTC). The 12 UTC bulletin carries the
   24 h rain (`333 … 7RRRR` and `6RRR4`). The `iR` indicator separates "dry, 0 mm" from "not
   measured". History starts in **2000**: a 1995 request returned an error. Requests must be
   paced. Use **one-month requests ≥ 15 s apart**. Quarter- and year-long requests get silently
   truncated or come back empty when the server is slow, and gaps under ~10 s trigger HTTP 501.
   In Nov 2023, OGIMET shows the full rainfall that GHCN-D misses (19.7 mm vs 7.9 mm in GHCN-D).
5. **IEM (Iowa Mesonet) gives METAR temperature in near-real time** (≤1 h), keyless, from 1984,
   with a gap in 2009–2011. **IEM "precip" for Bolivian stations is always 0.00**: Bolivian METAR
   has no rain group, so it must be treated as *missing*, never as dry. Daily Tmax from hourly
   METAR runs low against the SYNOP max thermometer: the fitted offset is **+1.27 °C** (0.8–1.7 °C
   depending on the period), so it needs this bias correction.
6. **Meteostat is a trap for precipitation.** Its keyless bulk files (`data.meteostat.net`) fill
   gaps with **DWD MOSMIX model forecasts**. For SLVR, 100 % of 2026 daily precipitation and
   ~68 % of 2023–24 precipitation is `dwd_mosmix`, not observed. The licence is **CC BY-NC 4.0**
   (non-commercial). The JSON API needs a RapidAPI key (HTTP 401 without one).
7. **Use the stations for validation and bias correction, not as the per-farm primary source.**
   One point gauge 40–100 km from a field cannot stand for that field's convective rainfall.
   The stations are excellent as (a) a **ground-truth check on the 2023–24 drought** and the
   Nov 2023 heatwave (see the results below), (b) a **bias and scale check for CHIRPS / ERA5-Land
   / IMERG** at the SLVR pixel, and (c) a **Tmax/Tmin anchor** for heat and cold-surge (*surazo*)
   signals.

## Stations within ~150 km of the farms

Farm-to-station distances are in `farm_station_distances_km.csv`.

| WMO | ICAO | Name | Elev m | Farms within (km) | GHCN-D | GHCN-D PRCP / TMAX / TMIN days present, 1991–2020 | GHCNh | OGIMET SYNOP (2026-11) | IEM METAR |
|---|---|---|---|---|---|---|---|---|---|
| 85244 | SLVR | Viru Viru Intl | 373 | 11–109 | BLM00085244, 1984-07 → **2025-08-24** | 42 % / 82 % / 49 % (PRCP absent 1999 and **2009–2018**) | BLI0000SLVR, 1985 → 2026-11-04 | 3-hourly (25 bulletins/3 d) | 1984 → now (gap 2009–11) |
| 85245 | SLET | El Trompillo (city) | 418 | 30–126 | BLM00085245, 1958 → 2025-08-24 | 28 % / 71 % / 50 % | BLI0000SLET + BLU00085245 | 6-hourly (12/3 d) | 1942 → now |
| 85195 | SLJV | San Javier | 520 | 66–167 | BLM00085195, 1976 → 2025-08-21 | 11 % / 32 % / 34 % | BLU… (sparse) | 6-hourly (8/2 d) | 2022 → now |
| 85196 | SLCP | Concepción | 497 | 81–180 | BLM00085196, 1958 → 2025-08-22 | 22 % / 77 % / 52 % | BLU00085196 | 6-hourly | 1942 → now |
| 85175 | SLAS | Ascensión de Guarayos | 247 | 141–228 | BLM00085175, 1976 → 2025-08-22 | 16 % / 39 % / 40 % | BLU085175-1 | 6-hourly | 2025-09 → now |
| 85264 | SLVG | Vallegrande (2,000 m) | 1998 | 148–245 | BLM00085264, 1989 → **2026-10-31** (new source flag `2`) | 10 % / 29 % / 31 % | BLM00085264 | 6-hourly | 1942 → now |

The "days present" figures **understate** real coverage. GSOD and GHCN-D drop many SYNOP days,
and they often omit dry days. Since 2019, SLVR GHCN-D has ~140 PRCP days a year, almost all of
them wet days, yet the annual totals look plausible (1,100–1,300 mm). A **missing PRCP is
ambiguous: it may mean 0 mm or unknown**. OGIMET's `iR` flag resolves this.

Not in any global archive: SENAMHI's own climate stations (e.g. Okinawa, San Julián, Saavedra
CIAT, Cuatro Cañadas). They belong to the national family (SENAMHI / SISMET).

## What I probed (live results)

| Source | Call | Result |
|---|---|---|
| GHCN-D station list and inventory | `ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-{stations,inventory}.txt` | 200 in 4.3 s / 11 s (11 MB / 36 MB). 36 BL stations. Inventory says "→2025" for most. |
| GHCN-D per-station CSV | `ncei.noaa.gov/data/global-historical-climatology-network-daily/access/BLM00085244.csv` | 200, 0.65 s, 1.9 MB. Rows 1984-07-06 → **2025-08-24**. File Last-Modified 2026-11-05: it is refreshed, but holds no new Bolivian data. |
| GHCN-D AWS mirror | `noaa-ghcn-pds.s3.amazonaws.com/csv/by_station/BLM00085244.csv` | 200. Same end date (20250824). Bucket updated 2026-11-07. |
| NCEI Access Data Service (JSON, keyless) | `ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=BLM00085244&…&format=json&units=metric` | 200, 0.15 s. Example: `{"DATE":"2024-01-05","TMAX":"36.0","TMIN":"24.6","PRCP":"2.5"}`. Days with no data come back as empty objects. Good wrapper target, but frozen at 2025-08. |
| GSOD | `ncei.noaa.gov/data/global-summary-of-the-day/access/2026/85244099999.csv` | **404**. The 2025 directory was last written 2025-08-29. The last row is 2025-08-24. |
| ISD global-hourly | `ncei.noaa.gov/data/global-hourly/access/2026/…` | **301 → no 2026**. `isd-history.csv` was last modified 2025-08-30, and 12,052 stations "end" in 2025-08. |
| ISD/GSOD retirement | NOAA NESDIS notice | "ISD and GSOD reached end of life on August 29 [2025]… replaced by GHCNh; GSOD replaced by SSOD (in development)". |
| **GHCNh** station list | `ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh-station-list.csv` | 200, 2.2 MB. 11 entries in the Santa Cruz box. |
| **GHCNh** S3 listing (keyless, S3 API) | `ncei.noaa.gov/oa/global-historical-climatology-network/?list-type=2&prefix=hourly/access/by-year/2026/psv/GHCNh_BL` | 200. 18 Bolivian files for 2026, all LastModified 2026-11-06 00:41Z. |
| **GHCNh** SLVR 2026 | `…/hourly/access/by-year/2026/{psv,parquet}/GHCNh_BLI0000SLVR_2026.*` | psv 200, 3.5 s, 5.9 MB. parquet 200, 0.46 s, 0.46 MB. 7,739 rows, 2026-01-01 → **2026-11-04 14:00Z**. Report types: FM15 6,733, FM12 (SYNOP) 629 (**Jan–Mar only**), FM16 375. `precipitation_24_hour` has 111 rows. |
| GHCNh SLVR 2024 | same pattern | psv 7.3 MB. FM12 2,701 rows (all months). The 24 h precip sum is 1,893 mm, but one value is **911.0 mm on 2024-01-11 12Z**. That is the raw sec-1 `69114`, a station mis-code (sec-3 `70001` = 0.1 mm), and it carries no QC flag. A gross-error cap of 250 mm/day plus "prefer 7RRRR" fixes it. |
| GHCNh per-station POR | `…/by-station/GHCNh_BLI0000SLVR_por.psv` | Exists, but **293 MB**: use the by-year files instead. |
| **OGIMET getsynop** | `ogimet.com/cgi-bin/getsynop?block=85244&begin=202610010000&end=202611070000` | 200, 0.47 s, 35 KB, 288 bulletins, latest **2026-11-07 00Z**. Example: `AAXX 01124 85244 01460 … 60384 … 333 10225 20190 … 70381` (38.1 mm / 24 h). |
| OGIMET history | `begin=2000-01…`, `begin=1995-01…` | 2000: 200 (data). 1995: `Status: 503 … SELECT command denied … synops2_1995_1`. **No data before 2000.** |
| OGIMET limits | 1-year request | 200 in 51 s, but a 2004 full-year request was **silently truncated** at 27 Apr, and a burst triggered a `501` reply. Quarterly chunks with 12 s pauses work. Help page: "No more than 200000 synops in a petition… please don't abuse." No licence is stated. |
| OGIMET block query | `block=852` / `block=851` (prefix) | All 85xxx stations in one call. Counts over 2 days: 85244 ×25, 85245 ×12, 85195 ×8, 85196 ×8, 85175 ×8. |
| **IEM** network | `mesonet.agron.iastate.edu/geojson/network.py?network=BO__ASOS` | 200, 0.23 s. 36 Bolivian stations with archive_begin (SLVR 1984-07-01, SLET 1942-10-01). |
| **IEM** METAR | `…/cgi-bin/request/asos.py?station=SLVR&data=tmpc&data=p01m&data=metar&…` | 200, 0.18 s. Latest 2026-11-07 04:00Z (≈ real time). `p01m` = 0.00 on every row. |
| **IEM** daily | `…/cgi-bin/request/daily.py?network=BO__ASOS&stations=SLVR&year1=1984…&var=max_temp_f&var=min_temp_f&var=precip_in&format=csv` | 200, 1.6 s, 575 KB, 1984-07-05 → 2026-11-07. **precip_in has 7,858 non-null values and 0 > 0.** A second immediate request (SLET) returned **429**, and a later one hung for >2 min. Use one request at a time. |
| Meteostat legacy bulk | `bulk.meteostat.net/v2/daily/85244.csv.gz` | 200, 160 KB, ends **2026-03-14**. |
| Meteostat new bulk | `data.meteostat.net/daily/{year}/85244.csv.gz` | 200 for 1990–2026, with a `*_source` column per field. 2026 prcp source: `dwd_mosmix` 189 / observed 0. 2023: `dwd_mosmix` 251 / `ghcnd` 114. `stations/85244.json` 200 (crosswalk wmo/icao/ghcn/usaf). |
| Meteostat JSON API | `meteostat.p.rapidapi.com/stations/nearby` | **401** (RapidAPI key needed: free tier, instant signup). |
| WMO OSCAR/Surface | `oscar.wmo.int/surface/rest/api/search/station?territoryName=BOL` | 200, 2.9 s, 53 KB. 56 Bolivian stations, 6 in the farm box, all "operational". |

## Results: Viru Viru (85244) daily series and climatology

Files: `slvr_daily.csv` (1985-01-01 → 2026-11-07, one row per day, with a source column for each
field), `slvr_completeness_by_year.csv`, `slvr_climatology_monthly.csv`, `slvr_histograms.csv`,
`slvr_monthly_2023_now.csv`. Rebuild with `probes/build_slvr_climatology.py RAW_DIR OUT_DIR` after
pulling the raw files with `probes/ogimet_fill_months.sh`.

**How the series is built.** For precipitation, OGIMET SYNOP comes first (12 UTC `7RRRR`, then
`6RRR4`, then `iR=3` → 0 mm), followed by GHCN-D in its "dense" years only (1985–1998, when dry
days were reported), plus a QC cap of 250 mm/day. For temperature, OGIMET SYNOP comes first, then
GHCN-D, then IEM METAR with a fitted offset (Tx **+1.27 °C**, Tn −0.22 °C).

**Coverage.** Daily Tmax/Tmin is ≥ 98 % complete for 1986–2026, except 1985 (96 %), Tmax in 2009 (94.5 %), and
Tmin in 2009–2011. Daily
precipitation is ≥ 71 % complete for 1985–1998 (but missing for 1993), ≥ 89 % for 2001–2006,
and ≥ 95 % for **Jul 2023 → now**.
The gap from **2007 to Jun 2023** is fillable from OGIMET but **not pulled**. Under throttling
(HTTP 501 when the gap between requests is < 15 s; empty or truncated replies when the server is
slow) it is a ~1–2 h one-off cache job. Run it overnight with `ogimet_fill_months.sh` and
`OG_SLEEP=20`. GHCN-D cannot fill this gap: PRCP is absent for 2009–2018, and after 2019 dry
days are missing.

**Baselines used.** Precipitation: 20 calendar years contribute (1985–1992, 1994–1998, 2000
[Jan–Apr only], 2001–2006). Only months with ≥ 80 % of days present are used, so each calendar
month has 12–17 usable years. Temperature: 1991–2020. Mean annual precipitation is **1,314 mm**, which
is plausible for Viru Viru. The rainy season runs Nov–Mar (Dec 222 mm, Jan 169 mm). The dry
season runs Jun–Sep (Aug 34 mm).

### Monthly climatology (same-time-of-year baseline)

| month | n_years_precip | precip_mean_mm | precip_p10_mm | precip_p50_mm | precip_p90_mm | wetday_freq_ge1mm | tmax_mean_c | tmax_p90_c | tmin_mean_c | tmin_p10_c | tmin_min_c | days_tmax_ge35_per_month | days_tmin_le5_per_month |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.0 | 13.0 | 168.5 | 65.2 | 125.2 | 365.2 | 0.3 | 32.0 | 35.0 | 22.0 | 20.0 | 2.8 | 3.4 | 0.0 |
| 2.0 | 16.0 | 142.2 | 76.9 | 132.1 | 210.3 | 0.3 | 31.3 | 34.0 | 21.6 | 19.6 | 1.8 | 0.8 | 0.0 |
| 3.0 | 14.0 | 132.1 | 69.0 | 111.2 | 206.5 | 0.3 | 31.4 | 33.8 | 21.1 | 18.8 | -0.2 | 0.8 | 0.2 |
| 4.0 | 17.0 | 113.4 | 32.2 | 79.2 | 234.5 | 0.2 | 30.2 | 33.4 | 19.6 | 15.2 | 10.6 | 0.5 | 0.0 |
| 5.0 | 16.0 | 76.2 | 12.8 | 59.1 | 168.4 | 0.2 | 27.5 | 31.8 | 17.4 | 12.0 | 7.0 | 0.0 | 0.0 |
| 6.0 | 12.0 | 85.2 | 16.4 | 83.8 | 136.0 | 0.2 | 26.4 | 30.5 | 16.1 | 10.8 | 0.5 | 0.0 | 0.3 |
| 7.0 | 16.0 | 51.3 | 4.6 | 37.3 | 114.2 | 0.1 | 27.0 | 31.3 | 15.3 | 9.8 | 5.0 | 0.0 | 0.0 |
| 8.0 | 17.0 | 33.9 | 1.5 | 24.3 | 73.8 | 0.1 | 29.8 | 34.3 | 16.6 | 11.0 | 5.8 | 1.4 | 0.0 |
| 9.0 | 13.0 | 74.2 | 8.1 | 70.1 | 140.2 | 0.2 | 31.8 | 36.2 | 18.7 | 13.8 | 0.8 | 7.7 | 0.1 |
| 10.0 | 14.0 | 103.0 | 18.3 | 85.9 | 228.2 | 0.2 | 32.5 | 36.3 | 20.6 | 16.8 | 1.8 | 7.4 | 0.0 |
| 11.0 | 15.0 | 112.2 | 48.6 | 87.1 | 246.8 | 0.2 | 32.4 | 35.5 | 20.9 | 17.8 | 1.8 | 5.3 | 0.0 |
| 12.0 | 13.0 | 222.1 | 77.1 | 225.0 | 368.7 | 0.4 | 31.9 | 34.6 | 21.7 | 19.4 | 0.8 | 2.7 | 0.1 |

### Daily histograms (baseline years)

```
wet_season_oct_apr
       0  64.4% #######################################
   0.1-1   9.8% ######
     1-5   7.9% #####
    5-10   5.4% ###
   10-20   4.9% ###
   20-50   5.8% ###
     >50   1.9% #
dry_season_may_sep
       0  79.5% ################################################
   0.1-1   6.5% ####
     1-5   5.7% ###
    5-10   3.1% ##
   10-20   2.1% #
   20-50   2.6% ##
     >50   0.5% 
tmax_c
   18..19   0.5% #
   19..20   0.6% #
   20..21   0.8% #
   21..22   1.0% ##
   22..23   1.4% ##
   23..24   2.0% ###
   24..25   2.5% ####
   25..26   3.1% #####
   26..27   3.4% #####
   27..28   4.2% ######
   28..29   6.4% ##########
   29..30   8.3% ############
   30..31  11.0% ################
   31..32  13.3% ####################
   32..33  13.0% ###################
   33..34  11.1% #################
   34..35   7.9% ############
   35..36   4.5% #######
   36..37   2.2% ###
   37..38   1.0% ##
   38..39   0.4% #
tmin_c
     7..8   0.4% #
     8..9   0.5% #
    9..10   1.0% #
   10..11   1.4% ##
   11..12   2.0% ###
   12..13   2.4% ####
   13..14   2.9% ####
   14..15   3.7% #####
   15..16   4.1% ######
   16..17   4.9% #######
   17..18   5.8% #########
   18..19   7.3% ###########
   19..20   8.9% #############
   20..21  11.5% #################
   21..22  15.2% #######################
   22..23  16.4% #########################
   23..24   8.6% #############
   24..25   2.1% ###
```

(The Tmin histogram is in the CSV. There are no days below 0 °C in 1991–2020. The coldest day
was −0.2 °C in March, which looks suspicious. Tmin ≤ 5 °C is rare, at most ~0.3 days per
month (June), and comes with *surazo* cold surges.)

### 2023-24 drought / heat check (station view of the Suyana validation event)

| month | days_present | precip_mm | baseline_mean_mm | pct_of_mean | percentile_vs_baseline | tx_mean_c | tx_anom_c | tx_days_ge35 | tn_mean_c | tn_anom_c |
|---|---|---|---|---|---|---|---|---|---|---|
| 2023-07 | 30 | 7.9 | 51.34 | 15.0 | 19.0 | 26.7 | -0.3 | 0 | 18.5 | 3.3 |
| 2023-08 | 30 | 13.1 | 33.93 | 39.0 | 35.0 | 31.4 | 1.6 | 0 | 19.9 | 3.3 |
| 2023-09 | 28 | 39.8 | 74.17 | 54.0 | 38.0 | 32.6 | 0.8 | 11 | 22.1 | 3.4 |
| 2023-10 | 31 | 19.5 | 103.03 | 19.0 | 21.0 | 34.2 | 1.7 | 16 | 23.4 | 2.8 |
| 2023-11 | 30 | 19.7 | 112.15 | 18.0 | 0.0 | 34.6 | 2.2 | 16 | 24.3 | 3.3 |
| 2023-12 | 30 | 157.4 | 222.14 | 71.0 | 31.0 | 34.2 | 2.3 | 17 | 23.9 | 2.2 |
| 2024-01 | 29 | 45.5 | 168.51 | 27.0 | 8.0 | 33.8 | 1.8 | 8 | 24.1 | 2.1 |
| 2024-02 | 28 | 119.1 | 142.25 | 84.0 | 38.0 | 32.7 | 1.4 | 6 | 23.1 | 1.5 |
| 2024-03 | 29 | 52.4 | 132.07 | 40.0 | 7.0 | 33.3 | 1.9 | 4 | 23.7 | 2.6 |
| 2024-04 | 29 | 104.8 | 113.41 | 92.0 | 65.0 | 30.5 | 0.3 | 0 | 22.5 | 3.0 |
| 2024-05 | 31 | 81.0 | 76.21 | 106.0 | 69.0 | 24.2 | -3.3 | 0 | 16.6 | -0.7 |
| 2024-06 | 30 | 3.3 | 85.18 | 4.0 | 0.0 | 28.8 | 2.4 | 0 | 19.0 | 2.9 |
| 2024-07 | 29 | 13.4 | 51.34 | 26.0 | 25.0 | 25.3 | -1.7 | 0 | 14.7 | -0.6 |
| 2024-08 | 31 | 14.3 | 33.93 | 42.0 | 35.0 | 29.4 | -0.4 | 5 | 18.0 | 1.4 |
| 2024-09 | 28 | 103.3 | 74.17 | 139.0 | 62.0 | 33.1 | 1.3 | 15 | 21.0 | 2.3 |
| 2024-10 | 30 | 169.5 | 103.03 | 164.0 | 86.0 | 32.7 | 0.2 | 8 | 22.5 | 1.9 |
| 2024-11 | 30 | 55.7 | 112.15 | 50.0 | 27.0 | 32.2 | -0.2 | 3 | 22.4 | 1.5 |
| 2024-12 | 30 | 256.0 | 222.14 | 115.0 | 69.0 | 31.2 | -0.7 | 3 | 21.7 | 0.1 |
| 2025-01 | 29 | 85.9 | 168.51 | 51.0 | 23.0 | 32.0 | -0.0 | 1 | 22.7 | 0.8 |
| 2025-02 | 27 | 71.2 | 142.25 | 50.0 | 12.0 | 33.3 | 2.0 | 4 | 22.6 | 1.0 |
| 2025-03 | 29 | 309.4 | 132.07 | 234.0 | 93.0 | 29.8 | -1.6 | 0 | 21.8 | 0.7 |
| 2025-04 | 28 | 134.6 | 113.41 | 119.0 | 71.0 | 28.0 | -2.3 | 0 | 20.2 | 0.6 |
| 2025-05 | 30 | 96.4 | 76.21 | 127.0 | 75.0 | 28.2 | 0.7 | 0 | 19.4 | 2.0 |
| 2025-06 | 28 | 23.6 | 85.18 | 28.0 | 17.0 | 23.5 | -2.9 | 0 | 16.3 | 0.2 |
| 2025-07 | 30 | 0.1 | 51.34 | 0.0 | 0.0 | 27.6 | 0.6 | 0 | 15.5 | 0.2 |
| 2025-08 | 29 | 24.9 | 33.93 | 73.0 | 53.0 | 28.7 | -1.1 | 1 | 17.1 | 0.5 |
| 2025-09 | 30 | 160.9 | 74.17 | 217.0 | 100.0 | 33.7 | 1.9 | 15 | 21.2 | 2.5 |
| 2025-10 | 29 | 329.4 | 103.03 | 320.0 | 100.0 | 29.4 | -3.1 | 3 | 19.9 | -0.7 |
| 2025-11 | 30 | 99.4 | 112.15 | 89.0 | 80.0 | 30.3 | -2.1 | 0 | 21.0 | 0.1 |
| 2025-12 | 30 | 101.1 | 222.14 | 45.0 | 23.0 | 30.4 | -1.5 | 1 | 22.3 | 0.6 |
| 2026-01 | 30 | 86.2 | 168.51 | 51.0 | 23.0 | 32.5 | 0.5 | 4 | 22.4 | 0.4 |
| 2026-02 | 26 | 327.2 | 142.25 | 230.0 | 94.0 | 32.1 | 0.8 | 0 | 22.8 | 1.2 |
| 2026-03 | 28 | 240.1 | 132.07 | 182.0 | 93.0 | 31.0 | -0.3 | 0 | 22.4 | 1.2 |
| 2026-04 | 30 | 59.2 | 113.41 | 52.0 | 35.0 | 29.7 | -0.5 | 0 | 20.7 | 1.1 |
| 2026-05 | 31 | 51.5 | 76.21 | 68.0 | 38.0 | 25.0 | -2.5 | 0 | 16.4 | -1.0 |
| 2026-06 | 30 | 65.8 | 85.18 | 77.0 | 33.0 | 24.0 | -2.4 | 0 | 16.3 | 0.2 |
| 2026-07 | 30 | 54.7 | 51.34 | 106.0 | 56.0 | 27.1 | 0.1 | 0 | 18.1 | 2.9 |
| 2026-08 | 29 | 88.0 | 33.93 | 259.0 | 100.0 | 28.8 | -1.0 | 0 | 18.8 | 2.1 |
| 2026-09 | 30 | 218.4 | 74.17 | 294.0 | 100.0 | 29.5 | -2.3 | 3 | 19.5 | 0.8 |
| 2026-10 | 28 | 115.7 | 103.03 | 112.0 | 64.0 | 28.6 | -3.9 | 1 | 20.2 | -0.5 |
| 2026-11 | 5 |  | 112.15 |  |  | 34.4 | 2.0 | 3 | 23.2 | 2.2 |

What this shows:
- **The 2023 drought is clearly visible.** Precipitation was below the 40th percentile in
  **every month from Jul 2023 to Mar 2024** (9 of 9). It reached the **0th percentile in Nov 2023**: 19.7 mm,
  18 % of normal, in the month when soy sowing needs the rains to start. Jan 2024 was 27 %
  (8th pct) and Mar 2024 40 % (7th pct). Jun 2024 was 4 %, before the 2024 fire season.
- **The heat also shows.** Tmax was +1.4…+2.3 °C above normal for Oct 2023 – Mar 2024, with
  **16–17 days ≥ 35 °C per month** in Oct–Dec 2023, against a normal of 2.7–7.4. Daily maxima
  reached **38–39 °C on 7–19 Nov 2023**. Tmin was +2…+3.4 °C above normal through 2023.
- **Recovery and flips.** The station shows a wet Sep–Oct 2024 (139 %, 164 %) and very wet
  months in Mar 2025, Sep–Oct 2025 and Feb–Mar 2026 (≥ 93rd pct). Then it shows a cool, wet
  Aug–Oct 2026 (Tx −1…−3.9 °C).
- **Verdict.** The station data is good enough to **confirm the sign and timing of
  gridded-product anomalies** at the SLVR pixel. A gridded product (CHIRPS / ERA5-Land) that
  does *not* show Nov 2023 as extremely dry and hot at this point should be distrusted.

### Hail / storm proxy check
In 25,681 de-duplicated SYNOP bulletins (2000–2006, 2023–2026) I found **4 hail-coded present
weather reports** (ww 90 or 96) and 14–62 thunderstorm reports a year. A single station is
**useless as a farm hail proxy**. Hail needs radar or satellite (GLM lightning, overshooting
tops) or the insurer's own claims data.

### Bias-correction suitability
- **Temperature: good.** The record is long (1985 →), near-complete and homogeneous across
  sources (annual-mean Tn for 2001–2006: SYNOP 18.9–19.6 °C, IEM 18.9–19.6 °C; the year-by-year
  difference is ≤ 0.25 °C). It is good enough
  for a monthly additive bias correction of ERA5-Land Tmax/Tmin at SLVR and SLET. For the
  western farms (≤ 50–60 km, same plain, ~300–400 m elevation) it can be transferred. It is less
  reliable for the eastern farms beyond the Río Grande (80–110 km).
- **Precipitation: validation only, with care.** There is one good gauge (SLVR) and one urban
  gauge (SLET). Use them for **monthly/seasonal ratio checks and anomaly sign/percentile checks**
  of CHIRPS / IMERG / ERA5-Land, **not** daily quantile mapping. Daily convective rain at a point
  is not representative 50–100 km away. If we do quantile-map, do it at the gauge pixel only, as
  a diagnostic.


## Recommendations (this family)

| Variable | Primary | Fallback | Role |
|---|---|---|---|
| precip (station truth) | **OGIMET SYNOP 85244** (12 UTC 24 h group, `iR` for zero vs missing), 2000 → now, ~1 h latency | GHCN-D/NCEI ADS for ≤2025-08 (missing ≠ 0!); GHCNh FM12 de-duplicated (up to Mar 2026) | Validation and bias correction of the gridded primary (CHIRPS/IMERG/ERA5-Land), **not** the per-farm primary |
| Tmax / Tmin (station truth) | **OGIMET SYNOP** (00 UTC `1sTTT` = day max, 12 UTC `2sTTT` = night min) | **IEM METAR daily** (real time, from 1984, Tx bias ≈ +0.8…1.7 °C to add), then GHCNh hourly | Validation and anchor for heat / cold-surge signals; possible per-farm fallback for the 4 western farms ≤ 50 km |
| Frost / cold surge | OGIMET Tmin (12 UTC) | IEM METAR min | Lowland frost is rare (Tmin ≤ 5 °C a few days per year in Jun–Jul). Use it to label *surazo* events. |
| Heat | OGIMET Tmax | IEM (bias-adjusted) | Tmax ≥ 35 °C day counts. The Nov 2023 heatwave is clearly visible. |
| Hail / storm proxies | OGIMET present-weather `7wwW1W2` (ww 87–90, 96, 99 = hail) | IEM METAR `GR`/`GS` codes | Point-only, sparse. Context only. |
| Station metadata | WMO OSCAR REST + GHCNh station list | IEM network GeoJSON | Station registry |
| Not recommended | Meteostat bulk precip (model fill, CC BY-NC), GSOD/ISD (frozen), IEM `precip_in` (always 0) | — | — |

## Risks / open issues

- **Representativeness.** Convective rain varies over a few km. A gauge 50–100 km away validates
  regional anomalies (monthly or seasonal), not daily farm rainfall. Validate at ≥ monthly
  aggregation and at the gauge's own pixel.
- **OGIMET is a hobby/academic service**: no SLA, no explicit licence, IP throttling (501, silent
  truncation). Cache aggressively (DuckDB) and pull at most daily. Do not make it a live per-request dependency.
- **The GHCN-D Bolivian feed is dead since 2025-08** and may come back later via SSOD. Our
  13-month display window therefore needs OGIMET or GHCNh for the recent months.
- **The NCEI GHCNh SYNOP ingest for Bolivia appears to stop after Mar 2026** (FM12 rows only
  Jan–Mar). Temperature continues via METAR, but precipitation does not.
- **Day-boundary conventions.** The SYNOP 24 h rain at 12 UTC covers 08:00→08:00 local. I label
  it with the *previous* day. GHCN-D labels it with the observation day. CHIRPS/ERA5 use UTC days.
  Monthly totals barely change, but daily comparisons need a ±1 day shift.
- **Licences.** NOAA products are US-government open, but non-US GHCN data may carry WMO
  Resolution 40 restrictions on commercial redistribution. Meteostat is CC BY-NC. IEM has no
  formal licence (attribution is expected). For a hackathon demo this is fine. For a bank
  product it needs review.
- **Precipitation history gaps.** SLVR GHCN-D lacks precipitation for 2009–2018 and is
  dry-day-censored after 2019. OGIMET can fill 2000–2026, but **2007–Jun 2023 is not cached
  yet**, so the current precipitation baseline is 20 years ending 2006. Missing 12 UTC bulletins
  leave holes of ~3–5 % of days.
- **Station QC.** Raw SYNOP contains mis-codes (e.g. 911 mm). Always prefer sec-3 `7RRRR`, cap
  values at 250 mm/day, and cross-check against `6RRR4`. A Tmin of −0.2 °C in March is likely an
  outlier. Run a simple Tx ≥ Tn and climatological-range QC.
