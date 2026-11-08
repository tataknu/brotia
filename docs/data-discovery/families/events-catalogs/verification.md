# Adversarial verification: disaster and drought event catalogs

Verifier probes ran 2026-11-07, about 05:00-05:45 UTC, from a laptop. No keys and no accounts were
used. Scripts and downloads were kept in the session scratchpad, so only this file was written here.

**Re-check at 2026-11-07 07:36 UTC.** A second pass re-ran the deciding probes, and all of them gave the
same result as before:
- The GDO directory returns 200 in 0.35 s and lists 36 zips (1991 to `20260101_20261021`). The 2026 zip is
  432 KB and takes 0.77 s; its newest dekad is **2026-09-21**. All 1,108 features have `consolidated=True`,
  and there is still no `intensity` property. `copyright.txt` says CC BY 4.0.
- CEMS `EMSR655` returns 403, while `EMSR656` and `EMSR853` return 200.
- The GDACS Bolivia DR list for 2023-2026 still holds only 1016449 (Green) and 1016612 (Orange).
- FIRMS: the 2026 yearly MODIS Bolivia file returns 404 and 2025 returns 200. The `api/area/` page says
  "DAY_RANGE: 1 .. 5". `api/map_key/` says "sign up for free MAP_KEY using your email" and
  "5000 transactions / 10-minute interval". A DEMO key returns 400.

**Test points.** I did not use the sample farms, except where a claim was about a named farm.
- Region points: San Julián (-62.62,-16.91), Yapacaní (-63.83,-17.40), Charagua in the Chaco
  (-63.20,-19.79), San José de Chiquitos (-60.74,-17.85) and Pailón town (-62.72,-17.66).
- Town points for the flood checks: Warnes (-63.17,-17.51), Montero (-63.25,-17.34) and
  Portachuelo (-63.39,-17.35).
- Date ranges different from the researcher's: GDO 1991, 2023, 2024, 2025 and 2026; GDACS
  2000-2022; FIRMS 2000, 2012, 2023 and 2025.

## Verdict summary

| Claim | Status | Key evidence |
|---|---|---|
| GDO jspeS: keyless, 1991 start, 0.25°, dekadal, CC BY 4.0 | **confirmed** | The directory returns 200 in 0.3 s and lists 36 yearly zips. The first is `19910301_19911221` (first dekad 1991-01-01); the last is `20260101_20261021`. Zips are 0.3-0.55 MB and take about 0.75 s. Polygon vertices sit on a 0.125 offset, which matches a 0.25° grid of cell centres. `copyright.txt` says "CC BY 4.0", so commercial reuse is allowed with credit. |
| GDO jspeS "latency ~2 weeks" | **refuted** | The 2 weeks applies only to when the file is published. **Each event appears in exactly one publication, 3-6 months after its last dekad.** 6128 ended 2023-03-11 and was published 2023-09-11. 6337 ended 2024-04-01 and was published 2024-07-01. 6488 ended 2024-11-01 and was published 2025-03-01. 6647 ended 2025-09-21 and was published 2025-12-21. The newest dekad in the newest file (`20261021`) is **2026-09-21**, not 2026-10-21. The metadata says on-going and "potential" events exist only in the GDO Expert Map. Every downloaded feature has `consolidated=True` (1,108 features in 2026). |
| GDO jspeS "deduplicate on (id_cl_st,time), files repeat earlier dekads" | **corrected** | I found 0 repeats across publications in the 2023 and 2024 zips. The duplicate keys (42 in 2024, 73 in 2023) are **multi-part polygons inside one file**: different `id`, same `area_km2`. Dropping duplicates would throw away polygon parts. Take the **union** instead. The researcher's script iterates over all features, so their numbers are still right. |
| GDO jspeS "found the 2023-24 / 2024 droughts on all 12 farms", per-farm frequency baseline | **confirmed, quality flag** | Cluster 6337 reaches 12.2 M km² (2023-10-21); its bounds are lon -78..-38, lat -33..+12, roughly the whole Amazon basin and beyond. All 5 of my points were inside 6337 and 6128, from Charagua in the Chaco to San José de Chiquitos, 200 km east. Dates depend on the point: 6337 = 2023-08-21..2024-04-01 (20 dekads) at my points, against 2023-09-11..2024-03-01 at the farms. Large events do not tell farms apart, so a "frequency per farm" baseline will be almost the same for every farm. Some smaller events (5091, 5221, 5434) do split the farms. The `intensity` metric described in the metadata is **not** among the GeoJSON properties (`id, time, id_cl_s, id_cl_st, area_km2, centroid_x, centroid_y, consolidated`). |
| GDO RDrI-Agri: 1° grid, dekadal from 2010, through 2026-10-11, in `ver4-0-1` | **confirmed** | `ver4-0-1/` is the only version folder. The 2026 file is 276 KB and takes 0.7 s. The grid is 180×360 with 1° steps; there are 29 time steps, the last on day 283 (2026-10-11). The first file is `20100101`. |
| CEMS Rapid Mapping keyless REST API | **confirmed** | `public-activations-info/?limit=500` returns 200 in 0.93 s: 86 KB, count 268, codes EMSR656..EMSR935, activations from 2023-03-24 to 2026-10-19. The Bolivia activations EMSR709, 765, 799 and 853 are listed (EMSR853 gdacsId FL1103664, EMSR709 WF1018546). `public-activations/?code=EMSR853` returns 200 in 0.95 s (815 KB). |
| CEMS "history_start 2012 overall" | **corrected** | `public-activations/?code=EMSR100`, `EMSR500` and `EMSR655` return **403** "Authentication credentials were not provided". **The keyless JSON path starts at 2023-03 (EMSR656).** Older activations appear only as HTML portal pages (`mapping.emergency.copernicus.eu/activations/EMSR500/` returns 200). |
| CEMS "Dec-2025 Piraí flood AOIs contain or touch the sample farms" | **confirmed (AOIs) / corrected (flood vectors)** | AOI08 La Caranda contains Warnes Sur and Warnes town. AOI06 Montero is 0.1 km from Canaveral San Antonio. However, **AOI06 Montero DEL was "Not produced because of remote sensing limitations"**, as were the DEL products for AOI03, AOI05, the AOI01 monitoring product and the AOI07 monitoring product; only grading (GRA) products exist for some of these. I downloaded the AOI07 Warnes DEL zip (3.3 MB, 2.5 s, one 302 redirect). `observedEventA` is **one polygon of about 0.14 km²** ("Riverine flood, Semi-automatic", area 13.87, presumably in ha), 17 km from Warnes town and 28 km from Warnes Sur. The researcher measured 21 km for AOI08. In short, the AOIs touch the farms but the observed flood does not. |
| CEMS licence "Copernicus open" | **confirmed** | The CEMS Terms and Conditions (dated 07/06/2023) give "free, full and open access" and allow reproduction, distribution, communication to the public and adaptation, with no commercial restriction. A citation is required, and some data restricted under Art. 53 needs registration. The copyright URL inside the product XML (`emergency.copernicus.eu/mapping/ems/cite-copernicus-ems-mapping-portal`) now returns **404**. |
| GDACS: keyless, 419 Bolivia events 2023-01..2026-11, default filter hides Green, <1 d latency | **confirmed** | My count was 419 (2023-01-01..2026-11-07): WF 392 Green, 2 Orange, 1 Red; FL 21 Green, 1 Orange; DR 1 Green, 1 Orange. Without `alertlevel`, the API returns 5 events (4 Orange, 1 Red). The latest `todate` is 2026-11-06. Pagination ends with HTTP **204**. Each page takes 0.5-2.3 s. |
| GDACS "history_start ~2000" | **corrected (per hazard)** | FL in Bolivia goes back to 2001 (FL 1689, 2001-01-01). **WF starts 2021-07-05**: 301 Bolivia WF events between 2021-07 and 2022-12, none earlier. DR: Bolivia has 1 event in 2000-2022 (DR1012926, 2018-12-21..2020-08-10), and only 3 DR events worldwide are dated before 2018. In practice, DR coverage starts about 2018. Old events have the upper-case alert level `ORANGE`, so normalise case. |
| GDACS licence "open, attribution" | **unverifiable** | `About/termofuse.aspx` contains only a disclaimer: "purely indicative and should not be used for any decision making without alternate sources of information". I found no explicit licence. For a product facing a bank, this belongs in the risk list. |
| GDACS DR 1016612 is a "2°-block polygon" | **corrected (detail)** | `getgeometry` returns 200 in 0.3 s. The bounds are lon -70..-60, lat -20..-12, a union of 2° blocks. Yapacaní, San José de Chiquitos and Pailón are inside. San Julián and Charagua are outside the polygon, although inside its bbox. The point stands: it is far too coarse for farms. |
| GDACS DR as the fallback for **ongoing** droughts | **refuted (as a fallback for Santa Cruz)** | GDACS has **no Bolivia DR event for the 2024 or 2025 droughts**, which GDO records as clusters 6488 and 6647. The only other DR is 1016449 (Green, BRA GLIDE, 2023-06-11..2026-05-10), and its polygon (lon -62..-45, lat -30..-18) contains none of my Santa Cruz points. |
| FIRMS MAP_KEY: free instant email, ≤10 days per call | **corrected (docs); signup itself unverified** | `api/map_key/` returns 200 and reads: "sign up for free MAP_KEY using your email. The key will be sent to your email". The limit is **5000 transactions / 10-minute interval**, and "requesting 7 days" may count as several transactions. The `api/area/` form offers **DAY_RANGE 1-5 only**, so "up to 10" is not supported. The sources include `MODIS_SP` and `VIIRS_NOAA20/21/SNPP_SP`, with a `[DATE]` path that returns DATE..DATE+DAY_RANGE-1, so **a key can backfill Jan-Oct 2026**. I did not create an account, so live use stays verified=false. |
| FIRMS MODIS yearly Bolivia CSV, keyless 2000-2025, 2026 → 404 | **confirmed, quality flag** | HEAD requests: 2000 = 69 KB, 2023 = 8.1 MB, 2024 = 17.4 MB, 2025 = 3.06 MB (modified 2026-10-10), 2026 = **404**. The 2025 file covers all of Jan-Dec (37,623 rows; Jul 9,865, Oct 10,001), so it is not truncated; 2025 was simply a low fire year. **Orbit drift:** the Terra daytime median acquisition time moved from 14:12 to 13:19 UTC between 2023 and 2025, and Aqua's from 18:17 to 19:14. Detection counts depend on the time of day, so a 2000-2025 same-time-of-year percentile has a sensor-drift component in its last years. Counts within 25 km in 2025: Yapacaní 102, Pailón 92, San Julián 41. |
| FIRMS "VIIRS yearly = 71 MB (over size limit)" | **corrected** | That size is for 2024 only: viirs-snpp 2024 = 71.0 MB, viirs-jpss1 2024 = 77.2 MB. For 2025, viirs-snpp = 11.2 MB and viirs-jpss1 = 11.7 MB; viirs-snpp 2012 = 12.8 MB. The NOAA-20 path is `viirs-jpss1`; `viirs-noaa20` returns 404. |
| FIRMS NRT latency ~4-5 h; NOAA-20/21 instead of SNPP | **confirmed (slightly better)** | Fetched at 05:41 UTC: N20 24h = 860 KB, latest 2026-11-07 03:00 (about 2.7 h); N21 24h = 1.5 MB, latest 2026-11-06 19:51; MODIS 7d = 1.5 MB, latest 2026-11-06 23:52. The NRT files have **no `type` column**, so the `type==0` filter works only on the archive files. FIRMS data are NASA open data, CC0 by default per Earthdata data-use guidance (citation urged). |
| INPE monthly 25-180 MB; daily from 2026-05-14 | **confirmed (upper bound slightly low)** | `focos_mensal_202610.csv` = **186 MB**. Daily 20260514 = 1.1 MB (200); 20260513 = 404; 20261106 = 5.3 MB. Monthly files for 2023 are zips of 20-211 MB. I could not verify INPE's licence. |
| GLIDE narrative names Warnes, Montero, Mineros for FL-2025-000235-BOL | **confirmed** | The 2025 GLIDE JSON returns 200; the comment lists "El Torno, La Guardia, Warnes, Montero, General Saavedra, Mineros, Porongo, and Colpa Bélgica". GLIDE 2015-2022 for Bolivia returns only 10 records (DR-2021-000178, DR-2022-000377 among them), so it is sparse. |
| IFRC GO country 33 and GLIDE as the join key | **confirmed, quality flag** | `countries__in=33` returns 200 in 0.58 s with count 74. However, **"Fires Bolivia 2025" (2025-08-25) carries GLIDE FL-2025-000235-BOL**, which is the December flood's GLIDE. A GLIDE join needs a check that hazard type and date agree. |

## What changes in the recommendations

1. **Drought events, recent part of the 13-month window.** jspeS cannot hold an event in about the
   last 3-6 months, and never holds one that is still going on. GDACS DR does not fill that gap for
   Santa Cruz: it has no 2024 or 2025 Bolivia DR events. For the recent months, the primary should be
   the gridded drought indices from the weather and drought families (SPEI/SPI percentiles per farm).
   jspeS stays the primary for the older part of the window and for the 1991+ event baseline. Use
   GDACS DR only as a context or alert flag.
2. **jspeS handling.** Union the multi-part features for each (`id_cl_st`, `time`); do not
   deduplicate them. Label jspeS results as "regional drought event", because large clusters cover
   the whole portfolio and do not tell farms apart.
3. **Flood footprints.** Treat CEMS as a verified observed footprint where a product was made. For
   EMSR853 there is no observed flooding on or near any farm (the nearest is ≥17-28 km away), and 5
   DEL products were not produced. The SAR flood family should be the **primary** source of farm hits,
   with CEMS used to validate or cross-check.
4. **History fields.** CEMS keyless history starts 2023-03 (EMSR656+). GDACS history depends on the
   hazard: FL 2001, DR about 2018, WF 2021-07.
5. **Fire, 2026 gap.** The MAP_KEY path is now documented: a free email sign-up, 5000 transactions
   per 10 minutes, DAY_RANGE 1-5, and SP/NRT sources with a DATE parameter. That gives about 60
   calls per source for Jan-Oct 2026, which makes it the clear choice over about 1 GB of INPE
   monthly files. Signing up is still a team decision.
6. **Fire baseline.** VIIRS yearly files are 11-13 MB in quiet years, so they are not uniformly too
   big. Note the MODIS Terra/Aqua orbit drift in recent years; consider the VIIRS 2012+ baseline as a
   check.
7. **Joins.** Before trusting a GLIDE join, check that hazard and date match (the IFRC GO record has
   the wrong GLIDE). Normalise GDACS alert-level case. Treat the GDACS licence as not stated.

## Not re-verified

ReliefWeb RSS and API, DesInventar (1970-2015), EM-DAT, Montandon, FEWS NET, VIDECI and the GDO
WMS. These are not top picks, and I took them as reported.
