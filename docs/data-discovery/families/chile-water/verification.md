# Verification of the `chile-water` family: an adversarial re-probe

- **Date:** 2026-11-07, run from a Python server context.
- **Access:** no accounts and no keys.
- **Method:** I re-downloaded the sources myself, on different issues, gauges and coordinates from the ones the
  researcher used. I ran the researcher's own parser (`probe_dga_bulletins.py`) on those other issues, and I read
  the PDFs by eye to check the numbers.
- **Files:** the throw-away probe scripts are in the session scratchpad. This is the only file I wrote in the repo.

## Verdict in one paragraph

All four top picks are real, keyless and live. Two parts of the report are wrong:

- **The parser output.** It is fragile, and on one gauge it returns numbers that belong to another station.
- **The 2026 story built on that output.** It does not hold.

The headline error is **Biobío at Rucalhue in September 2026. The flow is 941 m³/s against a mean of 560 (168 %),
not 220 m³/s.** The bulletin's own text confirms this: it says Rucalhue rose 3 % on August, from 913.4 to 941.1.

There are four more errors:

- **Weekly SWE is derived, not measured.** It is observed snow depth × a fixed density of 450 kg/m³.
- **The "south-centre snow drought" is an early melt.** On 31 August, SWE was above normal at all three
  south-central routes. An early melt moves the risk to January–March; it does not remove it.
- **Monthly latency is two numbers, not "5–6 weeks".** Publication comes about 2 weeks after month end.
  Effective staleness is 2–6 weeks, depending on where you are in the cycle.
- **Lago Laja is near its normal level.** It is at 88 % of its historical monthly mean, so it is not stressed.

GloFAS behaves as claimed. It also covers the Bolivian flagship, which the report missed. This makes it the only
top pick in this family that serves Santa Cruz, Bolivia.

## Not re-probed (unverifiable in this pass)

The items below appear in the recommendations, but I did not re-probe them in this session:

- MODIS MOD10A1/A2 snow cover on Planetary Computer;
- CR2 Explorador;
- CAMELS-CL;
- ERA5-Land snow depth;
- the DGA ArcGIS decree polygons, including the stale `VIGENTE` flag.

## What I probed

| # | Probe | Result |
|---|---|---|
| 1 | Bulletin index `dga.mop.gob.cl/servicios-de-informacion/boletines/` | 200, 3.6 s, 450 kB, 420 PDF links. The first weekly issue is **2024-01-02** (`Informe-Hidrometeorologico-Semanal-02-Enero-2024`). The latest weekly is 2026-11-02. The cadence is irregular: 2026-03-02 and 2026-03-23 are missing, and 02-02 and 02-03 are both present. Monthly issues go back to **2005** (N° 328, August 2005) with gaps, and run more or less continuously from 2011-11. Snowmelt forecasts go back to the 2009–10 season. |
| 2 | Weekly 2026-11-02 PDF | 200, 2.3 s, 643 kB. `Last-Modified` 2026-11-05, so the issue is uploaded about 3 days after its data date (02-Nov, 08 h). There is no flow table (0 matches for "caudal"). Reservoir values match the claim: La Paloma 612.8/750 (82 %), Lago Laja 1843.6/5582 (33 %), Colbún 1539.9/1544 (100 %). |
| 3 | Snow footnotes of that same PDF | **"³: EAN 2026 estimado con densidad de 450 kg/m³"** is on every route, for example Portillo 220 cm → 990 mm and Lo Aguirre 21 cm → 94 mm. The values are marked "Valores aproximados al 02-noviembre 8 hrs". Lo Aguirre is a **"Nueva Lo Aguirre"** (relocated site) compared with the 1991–2020 normal of the old site. The "2025 same date" column is 0 or s.d. at every route. |
| 4 | Researcher parser on **2026-10-26** weekly (662 kB) | `reservoirs()` → **0 rows**. The table rows start with leading spaces, so the `^\S` anchor fails. The snow rows parsed (20). |
| 5 | Researcher parser on **2025-11-03** weekly (980 kB) | Reservoirs: 24 rows (Corrales is missing). Snow: **0 rows**, because this issue has no snow section. 2024-10-07 also has no snow section. 2025-07-14 has one, but `pdftotext` spaces out the letters ("Na ci mi ento del Sobra nte"). |
| 6 | Monthly bulletin September 2026 | 200, 23.5 s, 9.93 MB, 57 pp. **`Last-Modified` 2026-10-16** (created 2026-10-14). The August issue has `Last-Modified` 2026-09-15. Page 2 says the values are "de carácter provisional … datos brutos no validados". |
| 7 | Researcher `gauge_monthly()` against an independent read | Aconcagua (25.7/18.3), Grande (7.4/3.8), Cachapoal (61.4/45.8), Tinguiririca (43.7/36.3), Maule Armerillo (430.0/233.9) and Ñuble (201.4/135.1) all match. **Biobío at Rucalhue does not: the parser gives 219.7, the PDF says 941.1.** The current row has only 11 values (November is missing: "Problemas en la configuración de equipos"). The 12-value regex skips that row and takes a later station's row. The same bug gives **Maule Q.2024-25 Sep = 31.5; the true value is 199.8**. The Armerillo footnote reads "Cauce desviado por obras de mantención". |
| 8 | Snowmelt forecast 2026–27 PDF | 200, 8.2 s, 3.2 MB, `Last-Modified` 2026-10-02. 19 stations from **Copiapó to Ñuble (no Biobío or Laja)**. The anomalies match the claim (Aconcagua +2, Cachapoal −12, Tinguiririca −18, Maule +7, Ñuble +36, Grande +36, Hurtado +120). The method is a single deterministic value with an error of ±20 %. The predictors are data up to August, plus *average* spring precipitation. The values are **natural-regime** volumes. Q20/Q50/Q85 are historical exceedance curves plotted for comparison; they are not forecast probabilities. Cuadro 2 gives peak SWE at 31 August: Lo Aguirre +5 %, Volcán Chillán +21 %, Alto Mallines +25 %. |
| 9 | Weekly 2026-10-26 against 2026-11-02 (SWE) | Lo Aguirre fell from 339 to 94 mm, Volcán Chillán from 492 to 284 mm, and Alto Mallines from 120 to 0 mm in one week. This is a fast melt-out, not a snow-poor winter. |
| 10 | Decree page and XLS `Decretos_zonas_escasez_historico_04-09-2026.xls` | Page: 200, 1.8 s. XLS: 200, 1.3 s, 90 kB, `Last-Modified` 2026-09-04. **251 data rows**; 269 rows only if you count blank and repeated header rows. The expiry column mixes Spanish text dates (246) and Excel serials (5), and has typos ("octubrede"). The page labels the sheet "(2008-2025)", and the map is "vigentes al 19-08-2026". Five decrees are active on 2026-11-07: Chiloé (until 2027-03-16), Elqui and Limarí (until 2027-07-10), Choapa and Lluta Bajo (until 2027-07-24). This is **confirmed**. |
| 11 | Open-Meteo Flood API at new points | All 200, 0.6 s. With `start_date=1984-01-01`, the first non-null value is **1997-01-01** at every point. The docs still say "from 1984". `models=consolidated_v4` **ends 2025-05-31**; `forecast_v4` starts 2023-06-01. So the "seamless" series after mid-2025 comes from the forecast model, not the reanalysis. |
| 12 | GloFAS, Chile: Maipo at El Manzano (-70.38, -33.59) | The cell's October median for 1997–2025 is **3.6 m³/s**. The DGA forecast gives about 91 m³/s for October and a Sep–Mar volume of 2914 hm³ (about 160 m³/s). This confirms the "wrong in Andean valleys" claim and extends it to the Maipo. |
| 13 | GloFAS, **Bolivia**: Río Grande at Puerto Pailas (-62.80, -17.66) and Piraí at Santa Cruz (-63.20, -17.75) | Río Grande: October 2026 mean 188 m³/s, **7th percentile** against 1997–2025, 184 m³/s on 2026-11-06, and a forecast running to 2026-11-16. Piraí: 0.5 m³/s median; the cell is too small or off-river. **GloFAS does cover the flagship region for large rivers.** |
| 14 | Open-Meteo terms page | Free API is **non-commercial only**. Limits: 10 000 calls a day, 5 000 an hour, 600 a minute and 300 000 a month. Data licence CC-BY 4.0. Confirmed. |
| 15 | DGA ArcGIS `ALERTAS/MapServer/0` | 200, 2.0 s. 1000 features (`exceededTransferLimit` = true). `mod_fechra` falls between 04:00 and 04:49 UTC today for every row; this is a refresh time. **Only 11 of 426 active flow stations have a non-zero value.** So the layer is a live alert flag, not a continuous water level. |
| 16 | DGA licence | No licence, terms or CC page is linked from the boletines or decree pages; the only "copyright" string belongs to a CSS library. `robots.txt` allows `/uploads/`. Commercial reuse rests on general Chilean public-information law. It is **not** stated. |
| 17 | Bolivia analogue (SENAMHI `hidrologia/boletin-hidrologico`, `alertas`) | 200. The only PDF linked is a 2022 Lake Titicaca weekly. Nothing usable for Santa Cruz rivers was found. |

## Changes I recommend to the family report

0. **This is the most useful finding for v1. Give it to the Bolivia flood family.**
   - **What:** Open-Meteo Flood API (GloFAS v4) on the Río Grande at Puerto Pailas.
   - **Request point:** lat -17.66, lon -62.80. The API returns cell -17.675 / -62.825.
   - **Access:** keyless, live, about 0.6 s per call.
   - **Reading:** the October 2026 mean is 188 m³/s, which is the 7th percentile against 1997–2025. The forecast
     runs to 2026-11-16.
1. **Fix or replace the PDF parser before any number goes on screen.**
   - Allow leading whitespace.
   - Map values to months by column x-position (pdfplumber), not by counting 12 numbers.
   - Raise an error when a row has fewer than 12 values, rather than reading on into the next station.
   - Cross-check each value against the narrative "% vs previous month" text.
   - Run regression tests on at least three issues per bulletin type.
2. **Drop the "Los Ángeles maize: stress" row and the south-centre snow-drought story.** The September flow for
   Biobío is 168 % of mean and for Maule 184 %. SWE at 31 August was above normal; the November deficit is an
   early melt. A truthful 2026 story is "wet north-central plus early melt in the south". The early melt
   moves the risk of a shortfall to January–March; it does not remove it. Do not swing from "stress" to "no risk".
3. **Label SWE as an estimate.** It is depth × 450 kg/m³, approximate, from automatic sensors. Use depth anomaly
   as the primary snow metric. Flag the relocated Lo Aguirre site. Expect gaps: only some weekly issues have the
   snow tables.
4. **Score reservoirs against the historical monthly mean, not % of capacity.** Lago Laja is at 33 % of capacity
   but 88 % of its normal. Some rows have a mean above capacity (Rapel 540 > 471). This may be a change in how capacity is defined. Flag these
   rows as inconsistent and handle them explicitly.
5. **Correct the latency, history and wording claims:**

   | Item | Corrected value |
   |---|---|
   | Monthly bulletin latency | about 2–3 weeks after month end; the next issue is expected around mid-November |
   | Monthly archive | from 2005 (with gaps), not 2012 |
   | Weekly archive | from 2024-01, not 2023 |
   | Snowmelt forecast wording | a deterministic ±20 % natural-regime forecast with historical Q20/50/85 references; it does not cover Biobío |

6. **GloFAS:**
   - Build baselines from `consolidated_v4` (1997 to 2025-05).
   - Treat later values as forecast-derived.
   - Bolivia use: see item 0. For small rivers such as the Piraí, check the cell with a neighbourhood search.
   - The non-commercial licence remains a production risk.
7. **Decrees:**
   - Parse both date formats.
   - Also scrape the decree page for new `Decreto-*.pdf` links, because the XLS can lag by weeks.
   - Keep "provisional / no explicit licence" on the provenance card.
8. **Priority:** every DGA product covers **Chile only, with no Santa Cruz (Bolivia) coverage**. For the v1
   flagship this family is a secondary market demo at best. Do not spend v1 build time here, apart from reusing
   GloFAS.
