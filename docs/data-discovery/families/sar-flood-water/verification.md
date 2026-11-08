# SAR, flood and surface water: adversarial verification

Verifier pass, 2026-11-07 (about 00:30 to 05:50 UTC). Keyless only: no accounts, no keys.
I re-probed live with **different points** from the sample farms. I used:
- (-63.42, -17.08): Piraí lowlands near Portachuelo
- (-62.20, -16.60): east of the belt
- (-63.60, -17.70): west of Santa Cruz

I also used **different date ranges**: 2015, Q1 2019, Dec 2025 to Jan 2026, Oct to Nov 2026, Jan to Mar 2026, and Jul 2026. The probe scripts are in the verifier scratchpad and are not committed. This file is the only file I wrote here.

## Headline verdict

The four top picks stand: all of them are keyless today. But **three claims that drive the product logic are wrong or overstated**, and they change how the wrappers must be built.

1. **The GFM "0 = no flood" reading is unsafe.**
   - GFM forces flood to 0 inside its **exclusion mask**: pixels "that cannot be classified" (GFM Product User Manual, Products and Recommendations pages on extwiki.eodc.eu, read live).
   - On the 2026-11-03 pass, the exclusion mask covered **62 to 78 %** of 2 km boxes at Arrocera Mineros (77.9 %), Granja Las Londras (72.1 %), Parcela Okinawa Uno (66.3 %) and Canaveral San Antonio (61.7 %). At Cuatro Cañadas it was only 8.5 %.
   - So on most of the book, a GFM "no flood" means "not observable".
2. **"Validated against EMSR853" is overstated.**
   - Over the largest EMSR853 observed-flood polygon (26.7 km²), GFM flagged flood on only **5.8 %** (12-13), **27.8 %** (12-18) and about **17 %** (12-30) of the polygon (35.3 % and 21.4 % of the pixels inside the swath).
   - On 12-18, **39.6 %** of the polygon was in GFM's exclusion mask and 21.5 % was outside the swath.
   - Within the classifiable part of the polygon, recall was about 70 %, and GFM flood outside the polygon was tiny (0.1 to 0.2 km²).
   - So the right wording is "high precision, recall limited by exclusion mask and swath; partially corroborated".
3. **GFM cadence at the farms is 12 days, not 5 to 12. Latency is hours, not 1 to 3 days.**
   - At both of my test points, only the descending 09:42 UTC frame (relative orbit 10) had valid pixels: 2026-10-10, 10-22 and 11-03.
   - Every 09:34, 09:50 and 17:39 item that `intersects` returned was 100 % nodata there.
   - During the Dec 2025 flood, the Piraí point (-63.42, -17.08) had only **2 valid passes in 36 days** (2025-12-13 and 2026-01-06), a **24-day gap**.
   - The researcher's 12-18 and 12-30 detections came from the 09:50 track, which reaches Santa Rosa del Sara (-63.6) but not the farm belt.
   - STAC `created` is **2 to 6.5 h after acquisition** (11-03 09:42 pass, created 16:02Z; 11-04 09:34, created 11:57Z). The researcher's "≤4 days" measured the revisit gap, not latency.

## Per-source verdicts

### Copernicus GFM (EODC STAC + COG): CONFIRMED keyless, with three corrections
| Claim | Verdict | Evidence |
|---|---|---|
| Keyless STAC/COG/WMS | confirmed | STAC HTTP 200 in 0.4-0.5 s; COG windows 1.4-2.9 s (0.01-0.2 s when cached); WMS GetCapabilities 200 (2.3 MB, 4.3 s); WMS GetMap 200 in 0.6 s |
| History from 2015-01-01 | confirmed | First item at (-63.42,-17.08) is 2015-01-03. 2015 had 151 tile items and **25 valid passes** (S1A only), about 12-24 days apart. Q1 2019 had 15 valid passes, every 6 days (S1A+S1B). Archive items were created 2024-11-05 (backfill) |
| Latency ~1-3 days | **corrected** | 2-6.5 h after acquisition (STAC `created`) |
| Temporal res 5-12 days at farms | **corrected** | 12 days in 2026 at the farm belt (d10 only). Gaps up to 24 days in the wet season (Dec 2025) |
| 0 = no flood, 1 = flood, 255 = nodata | **corrected** | Values are right, but 0 also covers excluded pixels (PUM: "Exclusion mask ... 1 (TRUE) → 0 (No flood)"). Exclusion covers 62-78 % at 4 of 5 farm boxes |
| Validated against EMSR853 | **corrected** | Recall 5.8 / 27.8 / ~17 % of the polygon; ~70 % within classifiable pixels; high precision |
| Licence "free and open" | confirmed | CEMS terms (`/api/v1/terms/`, updated 29 Jul 2026): "free, full and open access ... without any express or implied warranty" (Reg. 912/2010). No commercial restriction. Attribution is required ("Contains modified Copernicus Emergency Management Service information [Year]"). Disclaimer: "for information purposes only ... does not constitute in any way an early warning" |
| Rate limits none observed | confirmed (soft) | About 330 COG window reads in about 15 min, 8 threads, no throttling |
| Gotcha: item bbox = tile | confirmed, and worse | `intersects` also returned an ascending item on an Oceania tile (`OC020M_E120N072T3`, EPSG:27706), which is fully nodata. Filter on `SA020M` and valid pixels |
| WMS time 2015-01-01 → 2026-11-07 | confirmed | `observed_flood_extent` time dimension ends 2026-11-07 |

### Open-Meteo Flood API (GloFAS v4): CONFIRMED, with a licence downgrade and mapping caveats
| Claim | Verdict | Evidence |
|---|---|---|
| Keyless, fast | confirmed | HTTP 200, 0.38-0.6 s (3.4 s cold) |
| History starts 1997 (1984-96 null) | confirmed | Checked at 2 new cells (-17.025,-62.825) and (-17.275,-63.275): first non-null 1997-01-01. The docs table still says "1984 - July 2022", so the docs are stale |
| Consolidated ends 2025-05-31 | confirmed | `consolidated_v4` non-null to 2025-05-31. `forecast_v4` non-null **from 2023-06-01** (new fact) |
| 210-day forecast | **corrected** | `forecast_days=210` gives time to 2027-06-04, but the last non-null value is **2027-05-04** (about 180 days of data) |
| Río Grande 6.9th pct, annual max 2008 2359 | confirmed | Reproduced at (-17.525,-62.825): 7-day mean 194.6, pct 6.9. Independent cell (-17.775,-62.825): 193.7, pct 6.9, max 2354 |
| Missed the Dec 2025 Piraí flood | confirmed | (-17.575,-63.275): Dec 2025 max 22.9 m³/s on 12-27, against a Dec median of 15.6 and a Dec p99 of 56.7 (1997-2024) |
| Pre-mapped "Piraí lon ≈ -63.275/-63.325" | **corrected** | The rule is too coarse. At (-17.425,-63.275) the max is 0.02 m³/s, and at (-17.275,-63.325) it is 2.25, both off-channel. (-17.225,-63.325) gives 27. The map must take the max-mean cell per latitude row from the scan, not a longitude constant. Open-Meteo docs: "Varying coordinates by 0.1° can help". The Río Grande cell (-62.825,-17.525) has **0 % JRC GSW water within 1 km**, so it is a model cell and must not be drawn as the river |
| Licence CC-BY 4.0, free tier non-commercial | confirmed (now live) | `/en/terms`: "Less than 10'000 API calls per day, 5'000 per hour and 600 per minute. You may only use the free API services for non-commercial purposes. You accept to the CC-BY 4.0 licence". `/en/pricing`: commercial use needs a paid plan. A bank product is commercial |
| Rate limit ~500 locations | refined | Calls are **weighted**: a request longer than 2 weeks or with more than 10 variables counts as several calls ("4 weeks of data equals 3.0 API calls"). By that rule, one 1997-2026 daily pull counts as hundreds of calls. Pull the baseline once per channel cell, cache it in DuckDB, and refresh only the recent tail |

### Sentinel-1 RTC (Planetary Computer): CONFIRMED, with a token correction
| Claim | Verdict | Evidence |
|---|---|---|
| Anonymous SAS token, keyless | confirmed, with risk | Token HTTP 200 in 0.18 s. Signed VV/VH reads at the new point worked (3.5-3.7 s per band, EPSG:32720, 10 m, float32, nodata -32768). Unsigned HEAD returns 409. **But the collection metadata says `msft:requires_account: true`**, so PC could enforce accounts later |
| SAS token expires after ~1 day | **corrected** | Fetched at 05:45:32Z, expiry 06:30:32Z: about **45 min**. Re-sign per request or batch (`planetary_computer.sign`) and retry on 403/409 |
| Licence CC-BY-4.0 | confirmed | Collection `license: CC-BY-4.0`, link to creativecommons.org. RTC by Catalyst (collection description) |
| History 2014-10; dual-pol from 2017 | confirmed | Extent 2014-10-10. At the new points: 2014-15 all VV-only; 2016 has 25 VV + 3 VV+VH; 2017 has 45 VV+VH + 7 VV |
| Only descending d10 since 2022 | confirmed | At all 3 new points, 2022-2026 scenes are all d10 |
| "3 tracks 2015-2021" | **corrected** | Each point sees **2** tracks: d10 plus a105 (west, -63.4/-63.6) or a32 (east, -62.2). There are 3 only belt-wide, and the ascending baseline differs between farms |
| Scenes/yr 2017-21 64-91 | partly | At my points 2017-21: 38-62 per year (2 tracks). 2022 13, 2023 23, 2024 24-25, 2025 34: identical to the researcher's figures. 2026: 29, but **45 at (-63.6,-17.7)**, where more S1C frames cover it |
| Cadence 12-day Aug-Nov 2026 (S1D) | confirmed | 2026-07-06 … 11-03 every 12 days (S1D). Also seen: a 24-day gap 2025-12-13 → 2026-01-06 and an 18-day gap 2026-03-31 → 04-18 |
| Latest 2026-11-03 | confirmed | `S1D_..._20261103T094231` is the latest at all points on 11-07 |
| Platform string | new gotcha | `platform` is mixed case (`Sentinel-1A` vs `sentinel-1c`/`-1d`), so normalise it before grouping |
| Fixed threshold ≈0 water | confirmed (second pass) | At (-63.42,-17.08): 0.0 % on 2026-01-30, 02-11 and 02-23, and 0.01 % on 11-03 |

### NASA LANCE MODIS/VIIRS flood via GIBS: CONFIRMED, and even weaker than claimed
| Claim | Verdict | Evidence |
|---|---|---|
| Keyless WMS, ~0.5 s | confirmed | GetMap 200 in 0.5-1.6 s, RGBA PNG |
| MODIS from 2021-01-01, VIIRS from 2025-06-03 | confirmed, with gaps | GetCapabilities shows gaps: MODIS 2021-01-06 to 03-04, 2021-03-08 to 21, 2021-12-21 to 22, 2023-07-21 to 25; VIIRS 2025-06-08 to 23. Latest: MODIS 2026-11-07, VIIRS 2026-11-06 |
| 93 % insufficient data (2025-12-18) | confirmed and generalised | New box (-64.0..-62.0, -18.2..-16.3), MODIS 2-day insufficient: 2024-03-25 60.8 %, 2025-01-20 100 %, 2026-01-20 93.8 %, 2026-02-15 98.2 %, 2026-03-10 100 %, **dry season** 2026-07-15 70.1 %, 2026-11-06 95.3 %. VIIRS: 76.8 / 100 / 100 / 25.3 / 96.8 % |
| Usable fallback | **corrected** | It is near useless for scoring. July 2026 (dry, fire season) showed 68 (MODIS) and 241 (VIIRS) "flood" pixels, likely false positives (burn scar or shadow, unverified). Use it as a visual layer only |

### Other sources in the recommendations
| Claim | Verdict | Evidence |
|---|---|---|
| NOAA VFM GLB034 on AWS, 2012+, ~1 day | **corrected** | Keyless listing 200. Latest 2026-11-06, `LastModified` 2026-11-07T03:18Z, GLB034 19.85 MB, 134 tiles a day. But **2021-01 to 2023-07 is missing** from both TIF and NetCDF (years go 2012-2020, then 2023-08 onward). It is not a continuous baseline |
| EMSR853 hit no farm, nearest 16 km | confirmed | Re-downloaded AOI02/07/08 (302 → S3, 3.3-8.5 MB). Union 68.4 km². Nearest: Canaveral 15.9 km, Warnes Sur 20.5 km, Mineros 25.9 km. No farm inside. 4 Bolivia activations (EMSR853, 799, 765, 709) |
| GDACS: alertlevel param needed, 41 floods | confirmed | 41 with `alertlevel=Green;Orange;Red` (40 Green, 1 Orange); 1 without. 8 fall in the Santa Cruz belt box |
| JRC GSW: Mineros 17.7 % ever-water | confirmed | GCS v1.4 window: 18.0 % (2 km box), max occurrence only 11 %. Licence: Copernicus, "without restriction of use", attribution "Source: EC JRC/Google" (verified in the second pass) |
| Global Flood Database CC-BY-NC | confirmed | GEE catalogue: "Creative Commons Attribution Non Commercial 4.0". Availability 2000-02-17 to 2018-12-10 |

## Recommendation changes
1. **flood_observed (GFM)**
   - Read `exclusion_mask` (and `advisory_flags`) with every item. Report three states per farm: flooded fraction, observable-no-flood fraction and **not-observable** fraction.
   - Never show "no flood" when the farm is mostly excluded (rice, sugarcane, Las Londras, Okinawa).
   - A GFM negative is not evidence. Rain (`flood72hMm`) and S1 anomalies must still fire.
   - Expect one valid pass per 12 days at the farm belt.
   - Replace "validated" with "partially corroborated (≤28 % polygon recall, high precision)".
   - Cite STAC `created` latency: hours.
2. **flood_observed fallback**
   - NOAA VFM has a 2021-01 to 2023-07 archive gap, so it is NRT only and not a baseline.
   - Demote GIBS MODIS/VIIRS to a display-only layer. It is 60-100 % insufficient data even in the dry season and has suspected false positives.
3. **river_discharge**
   - Open-Meteo is the **hackathon tier** only (non-commercial, weighted call limits). The production primary should be CEMS EWDS GloFAS (free key, Copernicus licence allows commercial use).
   - Build the farm → cell map from the scan's max-mean cell per row, not a longitude constant.
   - Cache the 1997-2025 baseline once.
   - The usable forecast horizon is ~180 days, not 210.
4. **waterlogging_sar (S1 RTC)**
   - Re-sign assets per request (the SAS token lives ~45 min) and handle 403/409.
   - Record the `msft:requires_account: true` risk. The fallback is the same scenes from the CDSE/ASF GRD with our own calibration.
   - Normalise `platform` case.
   - The ascending track differs east/west, so stay d10-only as recommended.
5. **flood_prone_static**
   - Add the GFM `exclusion_mask` frequency as a static "SAR-blind" attribute next to JRC GSW.

## Re-check, 2026-11-07 about 07:35 UTC (second pass)
I re-ran the key probes at (-63.42, -17.08). Nothing in the verdicts above changed.
- **GFM STAC**: HTTP 200 in 0.45 s, 5 items for 10-25 to 11-08. The latest is still `20261104T093439` (created 11:57Z, 2.4 h after acquisition). The 11-03 09:42 items were created 15:38Z and 16:02Z (6.0 and 6.3 h). No new pass yet. The next d10 pass is expected 2026-11-15.
- **S1 RTC**: HTTP 200 in 0.48 s. The latest is still S1D 2026-11-03, d10, and Oct 2026 has a 12-day cadence (10-10, 10-22, 11-03). A new SAS token expires **45 min** after it is issued (07:34Z to 08:19Z). `msft:requires_account: true` is still set. Licence CC-BY-4.0.
- **Open-Meteo**: HTTP 200 in 0.4 s. `forecast_days=210` ends at 2027-06-04, but the last non-null value is still **2027-05-04**. The first non-null value is still 1997-01-01.
- **Closed open item, S1 fixed threshold**: the water fraction (VV < -18 and VH < -24 dB, 2x2 km box) was 0.0 % on 2026-01-30, 02-11 and 02-23 (wet season) and 0.01 % on 11-03. Mean VV was -8.5 to -10.5 dB. This **confirms** the researcher's "~0 on all dates" at a new point. Each signed band read took 4-5 s.
- **Closed open item, JRC GSW licence**: the GEE catalogue terms say "produced under the Copernicus Programme and is provided free of charge, without restriction of use". Attribution: "Source: EC JRC/Google". PC lists the licence as `other`. Commercial use is **allowed**.

## Not verified by me (keep verified=false)
- VFM GeoTIFF read speed and value legend.
- Whether the July-2026 GIBS "flood" pixels are burn scars.
- GFM REST API (needs an account).
