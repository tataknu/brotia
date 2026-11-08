# Global station archives: Chile (family `chile-global-stations`)

Probed 2026-11-07 UTC from a laptop, with no keys and no accounts. "Verified" means I fetched
real data during this session. The scripts are in `probes/`, and the small derived CSVs are in
this folder. Raw downloads stayed in the session scratchpad.

> Status: complete (2026-11-07). The raw OGIMET/GHCN/GHCNh/ERA5 downloads stayed in the session scratchpad. Re-run the probes to rebuild them.

## TL;DR

1. **Chile has a much denser station network in the global archives than Bolivia, but the convenient
   archives are broken.** GHCN-D has only 21 Chilean stations, all frozen on **2025-08-24** (ISD/GSOD
   end of life). Osorno is the exception and continues through SSOD from 2026-04. Worse, **GHCN-D/GSOD
   precipitation for Chile is undercounted since ~2010**. At Curicó in 2023 it shows 175 mm where the
   station's own 24 h SYNOP groups show 674 mm, and 20 of 39 wet days are stored as 0. **Do not use
   GHCN-D, GSOD or Meteostat for Chilean rain.** Meteostat's 2026 values are 100 % model forecast.
2. **OGIMET raw SYNOP is the best keyless station source.** It carries **85 Chilean stations between
   18 °S and 41.5 °S, hourly, with ~1 h latency**. Matched against the keyless **DMC EMA catalogue**
   (150 automatic stations with WMO↔national IDs), it gives a station **within ~12 km of 9 of the 11
   test farms**: Ovalle 2.6 km, Curicó 2.4, Talca 7.9, Parral 9.7, Chillán 5.9, Los Ángeles 6.8,
   Temuco 4.1, Requínoa 12, Osorno 7.5. The gaps are Quillota (22 km, coastal) and Santa Cruz
   Colchagua (34 km). The EMA stations appear on OGIMET only since 2021–24. Long records exist only at
   the WMO airports.
3. **DMC SYNOP coding has traps** that break generic decoders:
   - `7RRRR` at non-12Z hours is "since 12Z", not 24 h;
   - 12Z bulletins are empty in Apr–Aug 2024;
   - duplicate bulletins arrive for the same hour;
   - GHCN-D labels Tmax and precip **+1 day**.

   `probes/build_station_daily.py` handles all of these and cross-checks to 99–100 % agreement
   (Tmin, and Tmax with the shift) against GHCN-D.
4. **Station records are good from 2013 (Curicó) / 2017 (Chillán).** In 2001–2012 OGIMET is missing
   ~¾ of the main-hour bulletins. A same-time-of-year baseline built from them is **mostly
   megadrought years**: Curicó's annual rain is 602 mm for 1985–2009 vs **354 mm for 2010–2022**.
   The same month moves from the 27th to the 67th percentile depending on the baseline era. So:
   **baseline from a gridded 1991–2020 product (CR2MET / ERA5-Land); stations for validation and bias
   correction.**
5. **Station vs ERA5-Land / ERA5 for 2023–24** (precip from ERA5, because Open-Meteo has no ERA5-Land
   precip):
   - The monthly rain pattern agrees (r 0.95–0.98), but ERA5 is **50–70 % wetter** than the valley
     gauges.
   - ERA5-Land summer Tmax is **~2 °C too cold**, so it gives **half the hot days** (58 vs 144 at
     Curicó, 48 vs 97 at Chillán).
   - It catches **half the frost nights** (30 vs 58 at Chillán).

   Frost and heat signals need station bias correction or percentile-of-own-history.
6. **Near-real-time paths.** OGIMET has ~1 h latency. GHCNh is ~2.5 days behind and keyless, with
   hourly BUFR precip since Apr 2026, but needs QC and has no Chillán file. IEM METAR is real time for
   temperature only (precip is always 0), with patchy history.

## What I probed (live results)

| Source | Call | Result |
|---|---|---|
| GHCN-D station list and inventory | `ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-{stations,inventory}.txt` | 200 in 3.2 s / 12.9 s (11 MB / 36 MB). **21 Chilean stations** (`CI…`), all but one are WMO synoptic airports and GSN stations. |
| GSOD (verified directly) | `ncei.noaa.gov/data/global-summary-of-the-day/access/{2025,2026}/85629099999.csv` | 2026: **404**. 2025: 200, 57 KB, last row **2025-08-24**. |
| GHCN-D per-station CSV ×10 | `ncei.noaa.gov/data/global-historical-climatology-network-daily/access/CI000085629.csv` and so on | All 200, 0.3–1.1 s, 0.5–2.7 MB, Last-Modified 2026-11-05. **Every one ends on 2025-08-24, except Osorno CIM00085782**, which continues to 2026-10-27 with source flag `2` (SSOD v2, the GSOD replacement). Values are in **tenths** of mm and tenths of °C. |
| WMO OSCAR/Surface | `oscar.wmo.int/surface/rest/api/search/station?territoryName=CHL` | 200, 2.8 s, 165 KB. 202 stations, 112 of them in 29.5–41.5 °S. Only 13 carry a `0-20000-0` WMO ID in that band. The rest use DMC national numbers (`0-152-…`). |
| **DMC EMA catalogue (keyless)** | `climatologia.meteochile.gob.cl/application/servicios/getEstacionesRedEma` | 200, 0.8 s, 53 KB JSON. 150 automatic stations, each with `codigoNacional`, `CodigoOMM` and lat/lon. **71 of them also appear on OGIMET with SYNOP in Nov 2026.** Station names are double-encoded (UTF-8 inside latin-1), so fix the mojibake. |
| DMC data services | `…/servicios/getDatosRecientesEma/340031`, `…/getTemperaturaHistoricaDiaria/340031` | 200, but the body is `"Este servicio ha sido bloqueda para el usuario que consulta"`. They need `usuario=<email>&token=<apiKey>` from a free portal account. I did **not** sign up. |
| **OGIMET getsynop** (blocks 854–857, 2026-11-05 → 07) | `ogimet.com/cgi-bin/getsynop?block=856&begin=202611050000&end=202611070600` | 200, 0.4–0.7 s, 49–160 KB. **85 Chilean stations between 18 °S and 41.5 °S send hourly SYNOP** (≈54 bulletins in 54 h), latest 2026-11-07 06Z. Examples: Curicó `85629 … 333 10249 70000` (Tx 24.9 °C, 24 h rain 0.0); Chillán 12Z `… 333 20041 70000` (Tn 4.1 °C). |
| GHCNh station list | `ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh-station-list.csv` | 200, 0.6 s, 2.2 MB. 216 `CI…` entries, including `CIN00xxxxxx` (DMC national-number) stations such as Rancagua 340045, Los Ángeles 370033 and Temuco 380013. |
| GHCNh S3 listing for 2026 | `…/global-historical-climatology-network/?list-type=2&prefix=hourly/access/by-year/2026/parquet/GHCNh_CI` | 200, 0.14 s. 39 Chilean files, all LastModified 2026-11-06 00:45Z. **Chillán (SCCH / CIN00360011) is not among them.** |
| GHCNh 2026 PSV ×7 | `…/by-year/2026/psv/GHCNh_CII0000SCIC_2026.psv` and others | 200, 0.9–2.3 s, 1.2–5.1 MB. Latest record is **2026-11-04 14Z** (~2.5 days old). SYNOP (`FM12`) rows stop after Mar 2026. From Apr 2026, BUFR (`FM94_1`, source 412) rows supply hourly `precipitation`. Details below. |
| IEM network list | `mesonet.agron.iastate.edu/geojson/network.py?network=CL__ASOS` | 200, 0.24 s. 42 stations. SCQP (Temuco La Araucanía) has wrong coordinates (−33.3, −68.0). |
| IEM daily | `…/cgi-bin/request/daily.py?network=CL__ASOS&stations=SCIC…` | 200, 1.5 s, 597 KB (SCIC). 200, 0.9 s, 341 KB (SCCH). `precip_in` is **never > 0** (Chilean METAR has no rain group). Coverage: SCIC is good for 1973–2000 and 2019+, but has only 2–36 days a year in 2001–2018. SCCH is good only for 2016+. |
| IEM METAR | `…/cgi-bin/request/asos.py?station=SCIC&station=SCCH&station=SCEL…` | 200, 0.16 s. Latest report: SCEL 2026-11-07 07Z (real time), SCCH 2026-11-06 23Z, **SCIC 2026-11-06 09Z (22 h old)**. Example: `SCIC 060900Z AUTO 18008KT … FEW028 10/06 Q1017`. |
| Meteostat bulk | `data.meteostat.net/daily/{1995,2010,2023,2024,2026}/{85629,85672}.csv.gz` | 200 (one 404: 85672 in 1995), 0.2 s. **Precip is filled with model forecast**: all of 2026 is `prcp_source=metno_forecast` (300/300 days), and 2023 is 283 model days to 82 observed. Its 2026 Curicó total is 1,207 mm, against ~420 mm in the station 24 h reports. Licence is CC BY-NC. `stations/85629.json` (200) has a useful WMO/ICAO/GHCN/USAF crosswalk. |
| Open-Meteo archive (ERA5, ERA5-Land) | `archive-api.open-meteo.com/v1/archive?…&models=era5_land,era5&daily=precipitation_sum,temperature_2m_max,temperature_2m_min` | 200. **`era5_land` precipitation is null** (Open-Meteo does not serve ERA5-Land precip), so the precipitation comparison uses **ERA5 (0.25°)** and the temperature comparison uses **ERA5-Land**. A 2-year, 2-model, 3-variable call **cost 31 rate-limit units, and only 148 of 10,000 were left for the day** on our shared IP. Other families are using it heavily, so budget the calls. |
| OGIMET history of DMC EMA stations | `getsynop?block=85504` (Ovalle) / `85663` (Retiro Copihue) / `85704` (El Huertón), for the first week of 2012-01, 2017-01, 2021-01, 2024-01 and 2025-01, 18 s apart | 2012, 2017 and 2021: **0 synops**. 2024-01 and 2025-01: 142–169 hourly AWS bulletins a week. Two calls returned **501** (rate limit). **The EMA SYNOP stream on OGIMET starts somewhere between 2021 and Jan 2024**, so it is useful for *current* monitoring only, not for baselines. Precipitation comes as hourly section-3 `6RRR5`, or with `iR=4`. |
| **OGIMET bulk pull** (this family) | `probes/ogimet_pull.py`: quarterly requests, 16 s apart, truncation check | Curicó 2000 → 2026-11-07 07Z: 108 quarters in ~45 min, 87,626 de-duplicated bulletins. Chillán 2013 → now: 56 quarters, 63,462 bulletins. One 501 that recovered on retry. Bulletins per quarter at Curicó: ~360–530 (3-hourly with gaps) in 2017–18, ~700 (3-hourly) in 2019 → mid-2022, then **~2,150 (hourly) from Q3–Q4 2022**. |
| CR2 (Univ. de Chile) station compilation | `www.cr2.cl/datos-de-precipitacion/`, `ftp.cr2.cl/download/` | **403** and **404** to scripted requests. Treat it as manual download only. Not verified. |

### GHCNh 2026 for Chile: what the precipitation fields mean

These checks use the Curicó (CII0000SCIC) and Temuco Maquehue (CIN00380013) PSV files.

- **`precipitation`** comes only from `FM94_1` (BUFR SYNOP, source code 412). There is one value per hour,
  on the hour, from Apr 2026 onward, with no measurement or QC code. It is an **hourly amount**. It has
  gross mis-codes: Temuco shows **135.0 mm in one hour** on 2026-08-04 00Z, and nothing flags it.
- **`precipitation_24_hour`** is a rolling 24 h total, repeated every 3 h, so summing it is wrong
  (the naive sum for Curicó is 3,190 mm). Take **one value per day, at 12Z**.
- **The two fields disagree.** In Aug 2026, Curicó's hourly values sum to 81.9 mm but the 12Z 24 h values
  sum to 13.8 mm. For Temuco the figures are 327 mm and 51 mm. Neither field is complete.
- **Monthly check against OGIMET at Curicó, 2026** (24 h @12Z / hourly sum / OGIMET):

  | Month | GHCNh 24 h @12Z | GHCNh hourly sum | OGIMET |
  |---|---|---|---|
  | Mar | 108 | – | 108 |
  | Jul | 165 | 200 | 208 |
  | Aug | **13.8** | 81.9 | **116** |
  | Oct | 82 | 56 | 88 |

  Some months match; others are off by up to 8×.
- **Verdict.** GHCNh does carry near-real-time Chilean station precipitation, keyless, about 2.5 days
  behind. It needs our own de-duplication, a gross-error cap, and a cross-check against OGIMET before
  use. It is a **gap-aware fallback only**. **Chillán has no 2026 GHCNh file.**

## Stations near the Chile test locations

Distances are in `farm_station_distances_km.csv`. "SYNOP on OGIMET" means the station sent bulletins
on 2026-11-05 → 07, as matched through the keyless DMC EMA catalogue (`CodigoOMM`).

| Farm | Nearest station with SYNOP on OGIMET | km | Nearest GHCN-D station | km | Nearest IEM METAR | km |
|---|---|---|---|---|---|---|
| Quillota avocado | 85556 Viña del Mar Torquemada (coastal, **not** the interior valley) | 22.5 | CI000085543 Quintero (coast, nearly empty) | 27 | SCVM | 23 |
| Ovalle table grape | **85504 Ovalle Escuela Agrícola** | 2.6 | CI000085488 La Serena | 76 | SCSE | 76 |
| Requínoa cherry | **85608 Rancagua** (DMC 340045) | 12 | CI000085629 Curicó | 86 | SCRG | 12 |
| Santa Cruz (Colchagua) wine | 85619 Nilahue–La Quebrada / 85629 Curicó | 34 / 39 | CI000085629 Curicó | 39 | SCIC | 38 |
| Curicó apple/cherry | **85629 Curicó General Freire** | 2.4 | CI000085629 Curicó | 1.6 | SCIC | 1.6 |
| Talca vineyard | **85631 Panguilemo** (DMC 350028; GHCNh also has CIM00085620 "TALCA") | 7.9 | CI000085629 Curicó | 65 | SCIC | 65 |
| Parral rice | **85663 Retiro Copihue** | 9.7 | CIM00085672 Chillán | 52 | SCCH | 53 |
| Chillán blueberry | **85672 Chillán Bernardo O'Higgins** | 5.9 | CIM00085672 Chillán | 6.5 | SCCH | 5.6 |
| Los Ángeles maize/wheat | **85704 El Huertón** / 85703 María Dolores (SCGE) | 6.8 / 10 | CIM00085682 Concepción | 100 | SCGE | 10 |
| Temuco wheat/oats | **85743 Temuco Maquehue** | 4.1 | CI000085743 Temuco | 3.1 | SCTC (IEM archive ends 2014) | 4.6 |
| Osorno potato | 85782 Osorno Cañal Bajo (SCJO), not in the EMA catalogue; only **7 SYNOPs in 54 h** on OGIMET | 7.5 | **CIM00085782 Osorno (still updating via SSOD)** | 7.5 | SCJO | 7.0 |

**Main finding.** DMC streams its whole automatic network (EMA) over the GTS as hourly SYNOP, and OGIMET
archives it. So **9 of 11 test locations have a real station within ~12 km**. Several of these are
non-airport, agricultural-school sites, such as Ovalle Escuela Agrícola, El Huertón Liceo Agrícola and
Retiro Copihue. **But** their SYNOP history on OGIMET starts only between 2021 and 2024. Before that,
only the WMO airport and synoptic stations exist (85488, 85574/77, 85629, 85672, 85682, 85743,
85766, 85782, 85799). Bolivia's Santa Cruz has nothing comparable. The weak spots are **Quillota**, where the
nearest SYNOP station is coastal and DMC 320124 "Quillota Liceo Agrícola" sends no SYNOP, and
**Santa Cruz (Colchagua)**, at 34 km.

## Results: Curicó General Freire (WMO 85629 / SCIC / GHCN CI000085629)

The station is 2.4 km from the Curicó test farm and 39 km from Santa Cruz (Colchagua). Files:

- `85629_daily.csv`: 1957 → 2026-11-06, with a source column for each field.
- `85629_completeness_by_year.csv`
- `85629_climatology_monthly_2000_2022.csv`
- `85629_baseline_era_sensitivity.csv`
- `85629_histograms.csv`
- `85629_monthly_2023_now.csv`
- `85629_vs_era5_2023_2024_{monthly.csv,stats.json}`

To rebuild: first run `probes/ogimet_pull.py 85629 2000 2026 RAW`, which takes ~45 min of polite
quarterly requests, then run `probes/build_station_daily.py`.

### How the daily series is built (and the conventions that matter)

- **Rain day.** A rain day D runs from **12Z D to 12Z D+1** (08/09 local time) and is labelled D.
  The value comes from these sources, in priority order:
  1. the 12Z section-3 `7RRRR` group (24 h total);
  2. the 12Z `6RRR4` group;
  3. the sum of the four 6 h `6RRR1` groups at 18, 00, 06 and 12Z, where `iR=3` counts as 0 mm;
  4. the sum of hourly `6RRR5` groups;
  5. `iR=3` at 12Z, which means 0 mm.

  A QC step rejects values above 250 mm/day.
- **Temperature.** Tmax for day D is the 00Z(D+1) `1sTTT` group, and Tmin is the 12Z(D) `2sTTT` group.
  When those are missing, the series falls back to the max or min of the hourly SYNOP temperatures,
  with a fitted offset (Tx **+0.4 °C**, Tn **−0.2 °C**; MAE after the offset is 0.74 / 0.50 °C).
- **DMC coding quirk (Chile-specific).** A section-3 `7RRRR` sent at any hour **other than 12Z** is
  the amount *since 12Z*, not a 24 h total. At 18Z it equals that bulletin's 6 h amount (for example
  `60221` with `70220`). Reading it as a 24 h value undercounts heavily, so the parser ignores it.
- **GHCN-D day alignment.** GHCN-D labels Chilean **Tmax and precipitation one day later** than the
  physical day. With that +1 shift, Tmax matches 100 % of days before 2010 and 91 % from 2015, and
  rain matches 86 % / 83 %. Tmin matches at shift 0 (99–100 %). A naive same-date join gives an
  apparent Tmax bias of −1.8 °C that does not exist. **Any wrapper that joins GHCN-D with gridded
  data by date must apply this shift.**
- **ERA5 day.** ERA5 daily values are the local calendar day (00–24, `America/Santiago`). Lag 0
  correlates best (r 0.71, against 0.65 at lag 1).

### Coverage (days present per year: precip / Tmax / Tmin)

| Period | Status |
|---|---|
| 1985–1998 | GHCN-D (source `I`): rain on 160–310 days a year, Tmax 145–190, Tmin 270–330. This is the **only pre-megadrought baseline**. |
| 1999 | Rain missing (11 days). |
| 2000 | OGIMET: rain, Tx and Tn all ≥ 342 days. |
| **2001–2012** | **OGIMET has gaps.** Only ~90 of the 00Z and ~145 of the 12Z bulletins each year, plus `NIL` bulletins. Rain on 137–234 days a year, Tmax on 31–119. **Not usable as a baseline.** |
| 2013–2015 | Complete. |
| 2016–2019 | Rain is complete except 2016 (277 days). **Tmax is weak** (94–203 days): the 00Z bulletins lack `1sTTT`. |
| 2020–2023 | Rain ≥ 95 % (2022: 78 %). Tmax ≥ 88 %. **Tmin is 68–79 % in 2020–22.** |
| **2024** | **Apr–Aug rain is missing**: the 12Z bulletins are empty (`43/// /////`) and only 3 of 4 six-hour slots exist, so the total would be only a lower bound. Temperature is complete. |
| 2025 → 2026-11-06 | Complete. Latency is about 1 h. |

### Same-time-of-year climatology (2000–2022, months with ≥ 80 % of days)

Only months with at least 80 % of days present count. That leaves 10–11 usable years for the
winter months, mostly 2013–2022, which means **megadrought years**. **The temperature
columns are thinner still:** `n_years_temp` is only 4–8 for Apr–Sep, because Tmax was poorly
reported in 2001–2012 and 2016–2019.

| month | n_yrs | precip mean | p10 | p50 | p90 | wet-day freq (≥1 mm) | Tx mean | Tx p90 | Tn mean | Tn p10 | Tn min | days Tx ≥ 30 | days Tn ≤ 0 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 21 | 5.8 | 0 | 0 | 6.5 | 0.02 | 30.6 | 33.5 | 13.2 | 10.7 | 4.2 | 20.2 | 0 |
| 2 | 22 | 4.2 | 0 | 0.1 | 8.5 | 0.01 | 29.8 | 33.4 | 12.5 | 10.0 | 3.8 | 16.1 | 0 |
| 3 | 15 | 3.9 | 0 | 0.2 | 11.3 | 0.02 | 27.5 | 31.9 | 10.6 | 7.6 | 3.2 | 7.3 | 0 |
| 4 | 11 | 11.5 | 0.9 | 6.8 | 19.1 | 0.06 | 21.8 | 26.8 | 7.4 | 3.8 | −0.6 | 0.2 | 0.2 |
| 5 | 10 | 37.8 | 10.9 | 28.5 | 70.1 | 0.14 | 16.4 | 20.8 | 6.2 | 1.0 | −2.2 | 0 | 1.9 |
| 6 | 10 | 118.5 | 15.5 | 30.5 | 236.2 | 0.24 | 13.0 | 17.1 | 4.6 | −0.3 | −4.7 | 0 | 3.5 |
| 7 | 10 | 74.3 | 9.6 | 58.1 | 129.9 | 0.17 | 12.5 | 16.0 | 3.6 | −0.8 | −5.1 | 0 | 5.2 |
| 8 | 10 | 62.6 | 7.7 | 48.5 | 147.1 | 0.19 | 14.9 | 19.6 | 4.7 | 0.1 | −3.5 | 0 | 3.0 |
| 9 | 11 | 48.4 | 7.9 | 29.3 | 85.8 | 0.15 | 17.6 | 22.3 | 6.4 | 2.0 | −2.1 | 0 | 0.6 |
| 10 | 12 | 19.7 | 0.2 | 4.6 | 68.1 | 0.07 | 21.6 | 26.8 | 7.8 | 4.4 | 0.5 | 0.2 | 0 |
| 11 | 21 | 9.3 | 0 | 5.7 | 25.2 | 0.04 | 26.3 | 30.5 | 10.1 | 6.8 | 3.5 | 4.6 | 0 |
| 12 | 22 | 6.5 | 0 | 0.2 | 12.0 | 0.02 | 28.7 | 32.6 | 11.9 | 9.3 | 3.9 | 11.8 | 0 |

Summary:
- **Rain falls in winter (May–Sep).** Summer rain is near zero, except in rare events such as
  **Mar 2026 (108 mm, 100th percentile)**. Rain at cherry harvest (Nov–Jan) is exactly the kind of
  rare event a percentile can flag.
- **Frost peaks in Jun–Aug** (3–5 days a month with Tn ≤ 0 °C, minimum −5.1 °C). The bloom-relevant
  months are Sep–Oct, when Tn ≤ 0 happens on 0.6 and 0 days a month.
- **Heat.** There are 16–20 days a month with Tx ≥ 30 °C in Dec–Feb, and Tx p90 is ~33.5 °C.

Daily histograms (baseline years):

```
wet season May-Sep            dry season Oct-Apr
    0  68.0%                      0  94.0%
0.1-1  14.5%                  0.1-1   3.1%
  1-5   6.2%                    1-5   1.4%
 5-10   4.3%                   5-10   0.6%
10-20   3.6%                  10-20   0.4%
20-50   2.6%
  >50   0.7%
Tmax is bimodal: winter peak 12-14 C, summer peak 28-32 C, p99 about 35 C.
Tmin ranges from -2 to 17 C; 1.9 % of days are <= 0 C.
```

### The megadrought problem: which "own history"?

Suyana's rule is to compare each field with its own same-time-of-year history. In Chile the answer
depends on **which years count as history**. Mean monthly rain at Curicó in each baseline era
(`85629_baseline_era_sensitivity.csv`):

| Era | Annual (sum of monthly means) | May | Jun | Jul | Aug | Sep |
|---|---|---|---|---|---|---|
| 1985–2009 (GHCN-D + 2000) | **602 mm** | 91 | 158 | 119 | 76 | 62 |
| 2000–2022 | 402 mm | 38 | 119 | 74 | 63 | 48 |
| 2010–2022 (megadrought) | **354 mm** | 40 | 73 | 78 | 68 | 34 |

The same month gets a different percentile depending on the baseline:

| Month | Precip | 1985–2009 baseline | 2010–2022 baseline |
|---|---|---|---|
| Apr 2023 | 18 mm | **38th** pct | **80th** pct |
| Jun 2025 | 79 mm | **27th** pct | **67th** pct |
| Apr 2026 | 17 mm | 38th pct | 80th pct |

A megadrought-era baseline makes dry months look normal. **Recommendation:** use a fixed, documented
WMO-style baseline (1991–2020) from a *gridded* product, such as CR2MET, ERA5-Land or CHIRPS. Show
the station's percentile only as a check. Also expose "vs 1991–2020" and "vs last 10 years" side by
side, because a bank cares about both.

### 2023 → 2026 station view

The full table is `85629_monthly_2023_now.csv`.

- **2023 was a wet winter.** Aug 2023 had 315 mm (503 % of normal, 100th pct), including 150 mm on
  the 21 Aug rain day and 53 mm on 19 Aug. **Jun 2023, the big 22–26 June flood, is incomplete**: only 22 of 30 days are
  present, and the days present sum to 88 mm, while ERA5 has 314 mm. This is exactly the kind of
  event where a station hole matters.
- **Summer heat.** Jan–Feb 2023/2024/2025 had 22–30 days with Tx ≥ 30 °C and Tx anomalies of
  +1.2…+2.6 °C. Feb 2023 is also the month of the Ñuble–Biobío fire season.
- **Frost.** Jul 2024 had 14 days with Tn ≤ 0 °C (Tn anomaly −2.6 °C). Aug 2026 had 3.
- **2026.** A wet Mar 2026 (108 mm, around 2,700 % of normal), a dry Jun 2026 (8 mm, 0th pct), then
  a wet Jul 2026 (208 mm, ~90th pct) and Oct 2026 (88 mm, 100th pct).

### Station vs ERA5-Land / ERA5 at the station point, 2023–2024

Open-Meteo snapped the request to the grid point −35.0, −71.2 (elevation 224 m; the station is at
229 m). **Precipitation is compared with ERA5 (0.25°)**, because Open-Meteo returns null for
ERA5-Land precipitation. Temperature is compared with both.

| Comparison | n days | bias (model − station) | MAE | r | Event detection |
|---|---|---|---|---|---|
| Tmax vs ERA5-Land | 729 | −0.70 °C (**DJF −2.2**, JJA +1.1) | 2.34 | 0.935 | Tx ≥ 30 °C: station 144 days, ERA5-Land **58** (all 58 hits) |
| Tmax vs ERA5 | 729 | −0.04 (DJF −1.3) | 1.70 | 0.957 | station 144, ERA5 97 (94 hits) |
| Tmin vs ERA5-Land | 728 | +0.41 (DJF +1.2) | 1.82 | 0.875 | Tn ≤ 0 °C: station 22 days, ERA5-Land 27 (**14 hits**) |
| Tmin vs ERA5 | 728 | 0.00 (JJA +0.6) | 1.36 | 0.907 | station 22, ERA5 11 (8 hits) |
| Precip daily vs ERA5 | 566 | — | — | 0.71 | wet days ≥ 1 mm: station 49, ERA5 70 |
| Precip monthly vs ERA5 (18 complete months) | 18 | **ERA5/station = 1.68** | — | 0.95 | ERA5 1,086 mm vs station 647 mm |

What this shows:

- **The month-to-month pattern is right, but the amounts are not.** ERA5 at the Curicó grid point is
  ~70 % wetter than the gauge, because the 0.25° cell takes in Andean-foothill rain. Its timing
  (r 0.95) and percentile *signs* agree with the gauge. Use ratios and percentiles, not absolute mm.
- **ERA5-Land runs ~2.2 °C cold on summer days at Curicó.** That cuts the hot-day count (Tx ≥ 30)
  from 144 to 58. A heat or sunburn signal built on ERA5-Land with fixed thresholds misses most
  events. Use a station-based monthly additive bias correction, or percentiles of ERA5-Land's own
  history, which is the ADR-0002 approach and is robust to a constant bias.
- **Frost-day detection from ERA5-Land is weak.** It catches 14 of 22 station frost days and raises
  13 false alarms. Point frost depends on the valley floor's radiative cooling, which a 9 km grid
  cell does not resolve. Stations near orchards matter here.

### Bias-correction suitability

- **Temperature: good for central-valley farms ≤ ~15 km from a DMC station.** The station network
  is dense (Curicó, Panguilemo, Retiro Copihue, Chillán, El Huertón, Maquehue, Rancagua, Ovalle).
  Recent temperature series are near-complete, and latency is about 1 h through OGIMET. Fit a
  monthly additive correction of ERA5-Land Tmax/Tmin on 2013 → now. Pre-2013 records have too many
  holes for a 30-year station baseline.
- **Precipitation: validation and scaling only.** Use the gauges to check ERA5, CHIRPS and CR2MET on
  monthly ratios and percentile signs. Do not fill daily gaps from them: winter frontal rain is more
  spatially coherent than Bolivian convection, but the station has holes in exactly the flood events
  (Jun 2023, Jun 2024).

## Results: Chillán Bernardo O'Higgins (WMO 85672 / SCCH / GHCN CIM00085672)

The station is 5.9 km from the Chillán blueberry farm and 53 km from Parral. The file set matches
Curicó's (`85672_*`). OGIMET was pulled only for **2000–2001Q1 and 2013 → now**, to save time, and
GHCN-D before 2000 is almost empty: 0–118 rain days a year. **The usable station record is therefore
2013/2017 → now.** That is too short for a same-time-of-year baseline: the 2000–2022 climatology
has only 8–12 years per month, almost all of them megadrought years (annual mean 613 mm).

- **Coverage.** Rain is ≥ 88 % complete from 2017 on (2015: 95 %; 2016: 75 %). Tmax is ≥ 79 % complete from 2017 on (2013–2016 have only 82–103
  days a year). Tmin is ≥ 92 % from 2017 on, except 2021 (240 days).
- **2023–24 rain.** **Both flood months are present**: Jun 2023 had 225 mm (174 % of the short
  baseline) and Jun 2024 had 349 mm (100th pct). Jul–Aug 2024 is incomplete (20–24 days). The station
  holes are therefore station-specific: use ≥ 2 nearby stations where possible.
- **Frost.** Chillán is much frostier than Curicó: **58 station frost nights in 2023–24** (17 in Jul
  2024 and 13 in May 2024, with Tn anomalies of −3.5 °C).
- **Against ERA5-Land and ERA5.**

  | Comparison | n days | bias (model − station) | MAE | r | Event detection |
  |---|---|---|---|---|---|
  | Tmax vs ERA5-Land | 661 | −0.66 °C (**DJF −1.9**) | 1.57 | 0.978 | Tx ≥ 30: station 97 days, ERA5-Land **48** |
  | Tmin vs ERA5-Land | 730 | **+1.29 °C** (DJF +2.25, JJA +0.23) | 1.89 | 0.899 | Tn ≤ 0: station **58**, ERA5-Land **30** (27 hits) |
  | Tmax vs ERA5 | 661 | −0.53 | 1.05 | 0.992 | Tx ≥ 30: ERA5 50 |
  | Tmin vs ERA5 | 730 | +0.97 | 1.35 | 0.948 | Tn ≤ 0: ERA5 29 (28 hits) |
  | Precip daily vs ERA5 | 666 | — | — | 0.73 | wet days: station 116, ERA5 128 |
  | Precip monthly vs ERA5 (21 months) | 21 | **ERA5/station = 1.53** | — | **0.98** | ERA5 2,332 mm vs station 1,528 mm |

- **What it means.** At both stations, ERA5 and ERA5-Land get the month-to-month rain pattern right
  (r 0.95–0.98) but run **50–70 % wet**. They **halve the frost-night and hot-day counts**. The
  per-farm frost and heat signals need either station-based bias correction or the percentile-of-own-
  model-history approach, and the UI should not show "°C below zero" from raw ERA5-Land.

## Recommendations (this family, Chile)

| Variable | Primary (station truth) | Fallback | Role in the product |
|---|---|---|---|
| precip (daily, station) | **OGIMET raw SYNOP** for the nearest DMC station: 12Z `7RRRR`, then 4×6 h `6RRR1` with `iR=3` as zero. Rain day is 12Z→12Z. Coverage is 2013 → now, ~1 h latency. | **GHCNh** `precipitation_24_hour` at 12Z, one value per day, as a **gap-aware fallback only**: cross-check it monthly against OGIMET before use, because Aug 2026 shows 13.8 vs 116 mm (keyless, ~2.5 days latency, Chillán missing). GHCN-D and GSOD are **not** fallbacks after 2010 (see risks). | Validation, scaling, and percentile-sign checks of the gridded primary (ERA5, CHIRPS, CR2MET). Not the per-farm primary. |
| Tmax / Tmin | **OGIMET SYNOP** 00Z `1sTTT` and 12Z `2sTTT`, falling back to hourly max/min with an offset (+0.4 / −0.2 °C) | **GHCNh** hourly temperature (keyless, 2.5 days), then IEM METAR (real time at SCEL/SCCH, but SCIC was 22 h behind, and coverage is patchy for 2001–2018) | Per-month additive **bias correction of ERA5-Land**: Tx is about −2.2 °C in summer at Curicó. A per-farm *current-value* fallback for the 9 farms ≤ 12 km from a station. |
| Frost (spring, Sep–Nov) | OGIMET 12Z Tmin from the nearest valley station (≤ 12 km) | ERA5-Land Tmin bias-corrected with the station (hit rate only 14/22 uncorrected) | Frost-night labels for cherries, kiwis and vineyards. Count events from the station when it is within 10–15 km. |
| Heat / sunburn | OGIMET Tmax (`1sTTT`) | GHCNh hourly max + 0.4 °C | Count days with Tx ≥ 30/32/35 °C. Do **not** use raw ERA5-Land for counts (58 vs 144 hot days). |
| Rain at harvest (cherry cracking, Nov–Jan) | OGIMET daily rain, near real time | ERA5 / IMERG | Rare-event detector: summer rain at p90+ is easy to flag against a near-zero climatology. |
| Station registry | **DMC `getEstacionesRedEma`** (keyless, 150 EMA stations, WMO↔national↔ICAO crosswalk) + WMO OSCAR + GHCNh station list | Meteostat `stations/{id}.json` crosswalk | Maps each farm to its nearest station(s) |
| Not recommended | **GHCN-D / GSOD precipitation after ~2010**, Meteostat precipitation (model fill, CC BY-NC), IEM `precip_in` (always 0), GHCNh `precipitation` (hourly BUFR, mis-codes, inconsistent) | — | — |

Notable alternatives, **national** sources that belong to the regional or national families. None of
these are verified here:

- **DMC Servicios Climáticos API.** It has full daily and hourly history, but needs `usuario` + `token`
  from a free portal account on climatologia.meteochile.gob.cl. This is probably the best fix for the
  OGIMET 2001–2012 hole and the Jun 2023 / Jun 2024 gaps.
- **CR2 Explorador Climático and the station compilation** (DMC + DGA, ~800 rain gauges, 1950 →).
  Scripted access returned 403, so it is manual download only.
- **CR2MET v2.5**, a 0.05° gridded precip/Tmax/Tmin dataset for 1960–2021 under CC BY 4.0, on Zenodo
  (record 7529682; 2.5 GB pr + 6.8 GB txn zips). I verified the metadata through the Zenodo API. It is
  the natural **1991–2020 baseline** for Chile.
- **INIA / Agromet** agro-meteorological stations, located in orchards.
- **DGA** stations for river flow, snow and reservoirs: water availability matters more than field
  rain for irrigated fruit.

## Risks / open issues

- **GHCN-D and GSOD precipitation is badly undercounted for Chile.** At Curicó in 2023, GHCN-D
  (source `S` = GSOD) totals **175 mm on 361 "present" days**, against **674 mm** from the station's own
  SYNOP 24 h groups. **20 of 39 wet days are stored as 0.0**. Annual GHCN-D totals since 2010 look like
  an extreme drought everywhere: Temuco 188 mm and Chillán 220 mm in 2023. Do not use GHCN-D precip
  for Chile from ~2010, even before the 2025-08 freeze.
- **GHCN-D for Chile froze on 2025-08-24** (ISD/GSOD end of life). Only Osorno continues, through SSOD
  (`2`) since 2026-04-03. The 13-month display window therefore needs OGIMET, GHCNh or the DMC API.
- **OGIMET is the only keyless daily-rain source, and it has holes.**
  - 2001–2012: about a quarter of the 00Z and 12Z bulletins are missing, and some are `NIL`.
  - Apr–Aug 2024: the 12Z bulletins are empty.
  - Jun 2023: the flood month is partial.

  There is no SLA and no licence statement. **HTTP 501 appears sporadically, even with requests 16–18 s
  apart.** Retry with backoff. Cache in DuckDB. Never call it per request.
- **DMC-specific SYNOP coding.** `7RRRR` at non-12Z hours means "since 12Z". 12Z bulletins can be
  empty while the 11Z and 13Z AWS messages exist. Duplicate bulletins arrive for the same hour, for
  example manned plus AWS: merge them field by field. A generic SYNOP decoder (or Meteostat or GSOD)
  gets this wrong.
- **The baseline era drives the answer.** The 2010–2022 megadrought cut Curicó's mean annual rain by
  ~40 % (602 → 354 mm). Station records that are complete only since 2013 cannot give a 30-year
  same-time-of-year baseline. Use a gridded 1991–2020 baseline (CR2MET or ERA5-Land) and the stations
  for validation. State the baseline years in the UI.
- **The Quillota interior valley has no SYNOP station nearby.** The nearest is coastal Viña
  Torquemada, 22 km away. Santa Cruz (Colchagua) is 34–39 km from a station. Those farms need the
  gridded product plus the DMC API or INIA.
- **Day-boundary conventions** differ by source. The station rain day is 12Z→12Z. GHCN-D labels Tmax
  and precip **+1 day**. ERA5 uses the local 00–24 day. Daily comparisons must align them. Monthly
  totals barely change.
- **Open-Meteo quota is shared across the team.** One 2-year, 2-model call cost 31 units, and only
  ~85 were left for the day. Its free tier is non-commercial. Cache the results, or move to the CDS
  (free key) for production.
- **Licences.** NOAA products are open, but WMO Res. 40 may limit commercial redistribution of
  non-US data. Meteostat is CC BY-NC. OGIMET states no licence. DMC requires citation ("citar a la
  DMC como fuente"). Fine for a demo; a bank product needs a review.
- **Irrigated agriculture.** For central-valley fruit, field rain is a weak stress signal. Snowpack,
  reservoir and river data (DGA) and water-scarcity decrees matter more. They are out of scope for
  this family, so flag them to the national and water families.
