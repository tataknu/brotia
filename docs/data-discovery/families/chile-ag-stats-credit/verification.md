# Verification: chile-ag-stats-credit

Adversarial re-check of the top picks in `notes.md`. Probed live on 2026-11-07, without keys or accounts.
I used new coordinates: San Felipe (-70.70, -32.76), Buin (-70.75, -33.75), Rengo (-70.90, -34.42), Malloa, Molina (-71.30, -35.10), Retiro, San Carlos, Mulchén, Victoria and La Unión.
The probe scripts are in my scratchpad, not in this folder.

## 0. The blocking issue: market and coverage

- **Santa Cruz (Bolivia) coverage of every top pick: none.** All four top picks cover Chile only.
  The task brief, the sponsor (Suyana) and all 12 test farms are in Santa Cruz, Bolivia.
- **The "Chile is primary market per team decision 2026-11-06" claim is unverifiable.**
  Neither `docs/adr/0001` nor `docs/adr/0002` mentions Chile. No file outside `families/` mentions Chile either.
- **What this means:** the sources are sound *for Chile*. None of them should go into the variable registry as "primary" until the team records the market decision in an ADR.

## 1. CIREN Catastro Frutícola (orchard polygons)

| Claim | Verdict | Evidence |
|---|---|---|
| Keyless REST, JSON/GeoJSON, ArcGIS 11.5 | confirmed | Metadata 200 in 0.6 s. Formats: JSON, geoJSON, PBF. Pagination is supported. maxRecordCount = 2000 |
| ~4 s per query | confirmed (and worse under load) | Every query takes 3.55–4.15 s, including `returnCountOnly`. **5 parallel queries:** 4.5 / 4.6 / 8.6 / 8.6 / 12.6 s, 12.6 s wall time. The server runs about 2 queries at a time, which gives about 0.4 queries per second |
| Layers 55–68 are orchard (productor) polygons; Valparaíso has 13,438 | confirmed | Counts: V 13,438; VI 23,732; VII 23,038; VIII 1,462; X 611 |
| history_start 2016 (vintages 2016–2025) | **corrected** | The 2016 vintages are only on the cold-store and packing-plant layers. The orchard layers are **one snapshot per region: 2022, 2024 or 2025**. There is no polygon history |
| Parcel-level species | confirmed, with a caveat | 2 km buffers: San Felipe 129 polygons (VID DE MESA 88); Buin 112 (NECTARINO 32); Rengo 60; Molina 42 (CEREZO 38); San Carlos 4. Median polygon is 2.8 ha. `especie_02..04` is `' '` in 129/129 polygons, so each polygon carries one species. Several polygons share one `rolpredi` (up to 17 per roll) |
| Polygon intersect works | confirmed | POST `esriGeometryPolygon` with `f=geojson` returns 200 in 3.6 s |
| Bad `outFields` gives an "opaque 400" | **corrected** | The HTTP status is **200**, and the body is `{"error":{"code":400}}`. The wrapper must check the body, not the status |
| Licence not stated | confirmed | `copyrightText`, `iteminfo.licenseInfo` and `accessInformation` are all empty. The IDE Minagri homepage has no data licence; its only "License" strings belong to the WordPress theme. **Commercial use is unconfirmed** |
| WMS on, WFS off | confirmed | WMS GetCapabilities 200 (109 KB, 4.1 s). WFS 400 |

## 2. CIREN USO_DE_LA_TIERRA_CIREN_2 (land use)

| Claim | Verdict | Evidence |
|---|---|---|
| Keyless; the version without `_2` refuses queries | confirmed | `_2` has capabilities Map, Query, Data. The version without `_2` returns "Requested operation is not supported" |
| Vintages 2019–2026, Atacama to Los Ríos, no Los Lagos | confirmed | 10 layers: Araucanía 2019, Valparaíso 2020, Coquimbo and RM 2021, Atacama and Maule 2022, Ñuble and Biobío 2023, O'Higgins 2024, Los Ríos 2026 |
| Gives ARROZ / MAIZ / TRIGO / AVENA / VID polygons | **confirmed but weak** | Group-by on `CULTIVO ANUAL` polygons: **Ñuble** 4,619 SIN CLASIFICAR vs 1,576 MAIZ, 206 ARROZ and **1 TRIGO** (about 68 % unclassified). **Maule** 6,353 S/C vs 2,991 MAIZ and 647 ARROZ (about 60 %). **O'Higgins** 1,138 unclassified vs 2,393 MAIZ (about 26 %). At Retiro (rice country) there was no ARROZ within 3 km. A label on an annual crop is also a single-season snapshot, and crops rotate |
| Built on 2004–2009 orthophotos | corrected (mostly) | The `origen` field shows the sources: CATASTRO BOSQUE NATIVO (2014, 2016, 2020, 2024), Sentinel-2 classification, catastro frutícola 2019, 2022 and 2024, and field samples. Maule 2022 rests on the 2016 native-forest catastro |
| Field names differ by region; mojibake | confirmed, and worse | `usoactual`/`uso_actual`, `variedad`/`variedad1`, `objectid_1`/`objectid_12`; `ha` exists only in some layers. In Maule, `especie1` holds `S/C`. RM has `VIÃ\x91AS` (mojibake), not only O'Higgins |

## 3. ODEPA Catastro Frutícola CSV (CKAN)

| Claim | Verdict | Evidence |
|---|---|---|
| Keyless CKAN plus CSV | confirmed | `package_show` 200 in 0.8 s. The 2025 CSV is 200, 1.5 s, 4,457,173 bytes, 31,626 blocks (Valparaíso + RM). Quillota palto 1,668 ha |
| history_start 2020 | **corrected** | CKAN lists **27 annual files, 1999–2025**, all modified 2026-03-25. Each year covers only the regions surveyed that year: 2000 = 5 southern regions, 2019 = 9 regions, 2025 = V + RM. A national table means stitching the latest year per region; a per-region time series means taking roughly one survey every 3 years |
| Licence not checked | **corrected (favourable)** | `license_id: cc-by` (Creative Commons Attribution), so commercial use with attribution is allowed |
| Planting year and irrigation method per block | confirmed | 0 % nulls in 2000, 2019 and 2025. `Metodo de riego` includes `Secano` (rainfed), so it gives an irrigated/rainfed share |
| Quirks | added | UTF-8 BOM; decimal comma in `Superficie (ha)`; most commune names carry accents but some do not ("Los Angeles"). No coordinates |

## 4. DGA water-scarcity decrees (historical XLS)

| Claim | Verdict | Evidence |
|---|---|---|
| Keyless XLS, 90 KB, updated 2026-09-04 | confirmed | 200, 1.3 s, 90,112 bytes, Last-Modified 2026-09-04. The page links 5 current decree PDFs (93, 177, 179, 184, 185) |
| 269 rows, 2008–2026 | **corrected** | The sheet has 270 rows: **19 embedded header rows** and **251 decrees**. The researcher's sample CSV still holds 18 `Año` header rows as data |
| "One embedded header row to clean" | **corrected** | 19 header rows (one per year block). The year appears only on the first row of each block, so it needs a forward-fill. The expiry column mixes Spanish text dates and Excel date numbers (the 2026 block). 3 cells do not parse (2 blank, one typo `octubrede 2017`) |
| 5 in force on 2026-11-07 | confirmed | My own parse: Chiloé (to 2027-03-16), Elqui and Limarí (to 2027-07-10), Choapa and Lluta Bajo (to 2027-07-24) |
| Quillota 14 decrees 2013–2022; Petorca 25 | confirmed | Quillota: 14 rows over 9 years (2013–2022, none in 2016). Petorca: 25 rows, 2008–2023 |
| Licence | unverifiable | No data licence on the page; treat as public government information |
| Stable URL | risk added | The filename carries a date (`..._04-09-2026.xls`) and sits under `/2024/07/`. The wrapper must scrape the page for the current link |

## 5. Secondary recommendations, spot-checked

- **Irrigated areas (`Emergencias/HIDRICO_PUBLICO`): confirmed, with a caveat.**
  - Coverage: Atacama, Coquimbo, Valparaíso (2016), RM, O'Higgins and Maule (2021).
  - Each polygon carries only `objectid` and `id`, so this is a binary mask with no irrigation type.
  - A point query at Rengo found 0 polygons, while a 1 km buffer found 4. Test with a polygon intersect, never a single point.
- **INCENDIOS:** confirmed. Only the 2024-25 season is on the server.
- **SEGURO_AGRICOLA: the meaning and units are unverifiable.**
  - The layer group is named "SINIESTRALIDAD DE CRÉDITOS", and the service gives no description.
  - `cantidad_s` and `costo_tota` are strings with a decimal comma (e.g. `'183,99'`), and no unit is given.
  - Treat it as 2017–2018 context only.
- **CMF API:** confirmed. Without a key it returns 422 "API key no ha sido suministrada".
- **BCCh BDE:** confirmed. Without credentials it returns 302 to the error page.
- **INDAP PDF: the URL as written is corrected.**
  - The plain-`é` and ASCII URLs return 404.
  - Only the decomposed form `Cre%CC%81ditos` returns 200 (96,721 bytes).

## Recommendation changes

1. **Record the market decision first.** Write the Chile-vs-Bolivia market decision as an ADR before this family enters the variable registry. Until then, these sources are Chile context only and cover none of the Santa Cruz test farms.
2. **Orchards: the ODEPA CSV is the attribute and history source; CIREN polygons give geometry only.**
   - The ODEPA CSV (1999–2025, CC-BY) supplies species, planting year and irrigation method.
   - Its baseline is not "n/a": it gives about 26 years of commune × species area.
   - The CIREN polygons have no stated licence, so confirm commercial use with CIREN.
3. **Annual crops:** keep CIREN `_2` for geometry and add a `species_known` flag.
   - Where the species is S/C, report "annual crop, species unknown"; do not guess.
   - Do not trust an annual-crop label for the current season.
4. **Irrigated flag:** use a polygon intersect against the HIDRICO_PUBLICO mask, never a point. South of Maule, use the ODEPA `Metodo de riego` share.
5. **DGA:** build a cleaning parser (drop 19 header rows, forward-fill the year, read mixed expiry types, scrape the page for the current link). Do not ship the existing sample CSV: it holds 18 header rows.
6. **CIREN wrapper:**
   - Check the JSON body for `error`.
   - Allow at most 2 concurrent requests and a 15 s timeout.
   - Pre-compute and cache everything into DuckDB or the offline snapshot.
