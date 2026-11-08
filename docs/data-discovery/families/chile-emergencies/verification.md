# Verification: `chile-emergencies` top picks

An adversarial re-probe, run on 2026-11-07 between 07:00 and 07:50 UTC with no keys or accounts. I tried to refute
the researcher's four top picks and the recommendations built on them. I used **different coordinates and date
ranges** from theirs:
- Maule 2017 "Las Máquinas" box;
- Viña del Mar Feb-2024 box;
- Biobío/Ñuble Jan-2026 box;
- 2014, 2020 and 2025 full years;
- Oct-Nov 2026;
- Santa Cruz, Bolivia 2019;
- DMC points at Rancagua, San Fernando, Linares, Los Andes, Angol, La Unión and Vicuña;
- Diario Oficial dates in 2010, 2012, 2015, 2016, 2019, Aug-Sep 2026 and Nov 2026.

The probe scripts are in my scratchpad and are not copied here. Only this file was written.

## Verdict summary

| Pick | Verdict | One-line reason |
|---|---|---|
| GWIS `nrt.ba.poly` | **Confirmed as primary, but with key corrections** | Keyless, CC BY 4.0, 2012 onward. Latency is **about 1 day, not about 3 weeks**. The smallest polygon is about **100 ha, not 30-50 ha**. It **includes agricultural burning**. Summed polygons double-count about 12 %. |
| CONAF SIDCO via SENAPRED `sidco_ide` | **Refuted as the current-season primary** | Misses every large Jan-2026 Biobío/Ñuble fire. It totals 8,193 ha against GWIS's roughly 315 k ha. Stale since 2026-09-08. All rows have `vigente=0`. |
| DMC `datos_AAA.json` + zones | **Confirmed** | Keyless, live, zone polygons resolve. No archive anywhere, Wayback Machine included. `desde`/`hasta` are Spanish free text, not timestamps. |
| Diario Oficial daily index | **Confirmed, with corrections** | The per-act index starts on **2016-08-17**; 2019 backfill verified. Res. 485-490 were **published on 13 Aug**, not 6 Aug. The resolutions state **no end date**. The "catástrofe" regex gives false positives. |

## 1. GWIS/EFFIS `ms:nrt.ba.poly` WFS

| Check | Result |
|---|---|
| Access | **Keyless confirmed.** All calls returned 200. GetCapabilities has `Fees: none` and `AccessConstraints: None`. |
| Licence | **CC BY 4.0 confirmed** on `gwis.jrc.ec.europa.eu/about-gwis/data-license` ("reuse is allowed, provided appropriate credit is given"). Commercial use is OK with attribution. |
| History start | **2012-01-01 confirmed.** 2000-2011 in the central-south Chile box returned 0 features. Jan-Mar 2012 returned 468 polygons and 168 k ha. |
| Latency | **Refuted ("about 3 weeks").** Central Chile, 2026-10-01 to 12-31: 39 polygons, latest `initialdate` **2026-11-06 19:10** (probed 2026-11-07). South America: latest `initialdate` **2026-11-07**. The researcher's "latest 2026-10-18" was almost certainly an artefact of a truncated unfiltered query. Caveat: the newest polygons have `finaldate == initialdate` and may still grow, so treat polygons under about 2-3 weeks old as provisional. |
| Feature cap | **Corrected.** A date-filtered (OGC FILTER) South America query returned **34,376 features in one 24 MB response** (14.6 s), so no 5000 cap applied. An unfiltered small Ñuble box returned 2,469. With FILTER, the cap is not binding. (The 24 MB download broke the 20 MB rule; I did not repeat it.) |
| Axis order | **Narrowed.** lat,lon applies only to the `<Envelope srsName='EPSG:4326'>` inside an OGC FILTER (lon,lat returned 0 features). The KVP `bbox=` parameter is **lon,lat**: `resultType=hits` returned 0 for lat,lon and 15,351 for lon,lat. |
| Magnitude checks | Maule Jan-Feb 2017: 31 polygons, 331,093 ha. Viña del Mar 25 Jan to 15 Feb 2024: 8 polygons, **9,896 ha** (largest 5,924 ha, start 2024-02-02 18:38), consistent with the official Viña-Quilpué figure of about 9 k ha. Central-south Chile 15 Jan to 15 Mar 2023: 309 polygons, 552,895 ha, consistent with their 517,625 ha for a narrower window. |
| Units | The `area` attribute is in **ha**. It matched UTM-19S geometry area within 0.2 % (Viña 9,896 vs 9,901). |
| Small fires | **Corrected.** The smallest polygons were 94-102 ha in 2014, 2020 and 2025, with p10 about 150 ha and zero polygons under 94 ha. **Fires under about 100 ha are invisible**, and that is the farm-scale fire. |
| Overlap | Oct-Nov 2026: the sum of `area` was 11,230 ha but the union was 9,837 ha (**about 12 % double count**). Feb-2023 Biobío/Ñuble: 493.7 k summed vs 483.2 k union. Use the union for any burned-ha baseline. |
| Agricultural burning | **Not flagged by the researcher.** 2020 by month: the **April peak is 244 polygons and 77 k ha**, and May has 134 polygons. These are autumn stubble and quema-agrícola months, not the Jan-Feb wildfire peak. The layer is "burned area", not "wildfire". Filter by season or size, or label it "burned area". |
| Bolivia | Santa Cruz, Bolivia, Aug-Sep 2019 (Chiquitanía): 1,093 polygons, 1.6 M ha, 1.3 s. The same wrapper works for the flagship Bolivia portfolio. |

## 2. CONAF SIDCO via SENAPRED `interoperabilidad/sidco_ide/MapServer/0`

| Check | Result |
|---|---|
| Access | **Keyless confirmed.** 200, 0.43-0.48 s, `maxRecordCount` 2000. `copyrightText` and description are **empty**, so there is no stated licence. |
| Content | 43 polygons, `fecha_hora` 2026-01 to 2026-09 (Jan 3, Feb 5, Mar 15, Apr 5, May 11, Jun 2, Jul 1, Sep 1). Total 8,193 ha. Matches the researcher. |
| Completeness | **Refuted as a footprint source.** None of the 6 largest GWIS Jan-2026 Biobío/Ñuble polygons intersects any SIDCO polygon: 27,577 ha (centroid -72.93,-36.80, Concepción coast), 7,322, 6,704, 6,292, 3,957 and 3,120 ha. The only Biobío/Ñuble January SIDCO perimeter is SIETE ARBOLES at 98 ha. The EMSR859 fires are missing. |
| Freshness | **Refuted ("hours-days").** The latest `ultima_actualizacion` is **2026-09-08**, two months stale on 2026-11-07, while GWIS already shows 39 Chile polygons (11 k ha) for Oct-Nov 2026. All 43 rows have `vigente=0`, yet 10 still say `En Combate`, so the status field cannot be trusted. |
| Point layer | `SIIE/sidco/MapServer/0` has 3 Nov-2026 points, all `tipo = "Incendio no publicado"` (Totoras, Santa Leonor, Culenco). These are CONAF IDs and statuses only, with no area. Layer 1 has 0 rows. |
| Use | Use SIDCO only as **enrichment** (official fire name, commune, CONAF link) when one of its perimeters intersects a GWIS polygon. It is not a primary source. |

## 3. DMC Avisos/Alertas/Alarmas

| Check | Result |
|---|---|
| Access | **Keyless confirmed.** 200 with or without a User-Agent, 0.54-0.67 s, 14 KB, `Cache-Control: max-age=60`, no CORS header (fine for a server). |
| Freshness | `fecha_actualizacion` is 2026-11-06 23:52, which is Chile local time (`Last-Modified` 02:52 GMT). Store timestamps with the America/Santiago zone. |
| Content | 5 avisos + 1 alerta, matching the researcher. A new point test: **AA193 Altas Temperaturas hits Rancagua, San Fernando, Linares, Los Andes and Vicuña.** With their farms: AA193 hits their 6 farms and A605 their 4, both confirmed. A601 wind also hits Chillán and Los Ángeles, which they did not mention. All 87 zone codes (`indice`) resolved. |
| Data quality | **Not flagged by the researcher:** `desde`/`hasta` are free Spanish text ("la tarde del sábado 07 de noviembre del 2026"). They need a parser that maps mañana/tarde/noche to hour ranges. `emision` is also text. |
| Archive | **Confirmed absent.** `datos_AAA_historico.json`, `historico/`, `datos_AAA_2026.json`, `aaa.php` and `index.php` return 404; the folder returns 403. The Wayback CDX has **0 snapshots** of `datos_AAA.json`. Self-archiving from day one is required. |
| Licence | Not stated (*unverifiable*; meteochile terms were not read). |

## 4. Diario Oficial daily index

| Check | Result |
|---|---|
| Access | **Keyless confirmed.** 200, 0.75-2.3 s per day; about 1.9 s per day including the edition redirect. `robots.txt` returns **403** (no stated crawl policy). About 75 requests at 0.5-1 s spacing ran without blocking. |
| Redirects | Most days return a **302 to `index.php?...&edition=N`** even with a single edition. Some days go to `select_edition.php`. The researcher's `select_edition` check works, but it is safer to always collect the `edition=` links. |
| History start | **Resolved: 2016-08-17.** 17-08-2016 has 27 per-act PDFs. On 16-08-2016, and on 2015, 2012 and 2010 dates, the index only links whole-edition `sumarios/.pdf` and `impresos/.pdf`, so there are no per-act titles. A backfill is about 10 years × about 310 days. |
| Historical capture | **2019 megadrought verified:** 10-09-2019 has Minagri Res. 367, 388, 400, 405 and 431 (déficit hídrico: Coquimbo, Valparaíso, O'Higgins, RM, Maule). 17-09-2019 has Dec. 308 (zona de catástrofe, Coquimbo and Valparaíso). 25-09-2019 has MOP Dec. 91 (escasez hídrica, provinces of Valparaíso and San Antonio). Note the 2019 wording is "**Define** situación de emergencia agrícola". |
| 2026 acts | Res. 459 is in the **06-08-2026** edition; it was signed "Santiago, 28 de julio de 2026". **Res. 485, 486, 487 and 490 are in the 13-08-2026 edition**, not 6 Aug. MOP Dec. 179 (Elqui) is on 13-08-2026, and Dec. 177 (Limarí prórroga) on 03-09-2026. Sept 2026 has no new Minagri declarations. |
| PDF parsing | `pdftotext` on Res. 431/2019 and Res. 459/2026 (167-172 KB, 1.1-1.8 s): "Resuelvo: 1." lists the communes cleanly (Rauco, Licantén, … Constitución). Res. 459 mixes a commune list, "La totalidad de la Región de Coquimbo" and "Las provincias continentales de la Región de Valparaíso", so province and region expansion is required, as they said. |
| End date | **Not flagged:** neither resolution states a validity period or end date. "In force" must be inferred (for example 12 months, or until superseded). This is unlike the DGA decrees, which have `Fecha de Caducidad`. |
| False positives | The `CATÁSTROFE` regex matched "Catástrofe del Humo" (a monument), a comité-asesor appointment and a deadline extension. Tighten it. |

## Other spot checks (not top picks)

- **FIRMS (keyless):**
  - NOAA-20 and NOAA-21 South America 7-day CSVs are 200, 4.7-5.0 MB, and were modified 07:41-07:44 UTC today. Confirmed.
  - `modis_2026_Chile.csv` returns 404 and VIIRS-SNPP 2024 Chile is 200 (1.7 MB). Confirmed.
- **DGA page:** it still links `Decretos_zonas_escasez_historico_04-09-2026.xls`. Confirmed.
- **Not re-probed:** GDO, GDACS, GLIDE, IFRC GO, CEMS.

## Open risks after verification

- GWIS NRT polygon IDs may not be stable as fires grow (new IDs, overlapping versions). Snapshots must dedupe by geometry union, not by ID (*unverified* how IDs evolve).
- No fire product here sees fires under about 100 ha on or next to a farm except FIRMS points, which are dominated by agricultural burning.
- SIDCO and SENAPRED layers are ad hoc. The perimeter layer was not maintained into the 2026-27 season (as of 2026-11-07).
- The Diario Oficial has no stated rate limit or terms. Cache the PDFs and keep about 1 request per second.
- Licences for SIDCO, DMC and the Diario Oficial are not stated (Chilean public information; commercial use unverified).
