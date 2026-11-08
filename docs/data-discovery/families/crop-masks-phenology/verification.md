# Verification: crop masks, calendars and phenology

Adversarial re-check of the top picks in `notes.md`. Probed live on 2026-11-07, keyless. To avoid repeating the original tests, I used **new coordinates** (0.1° boxes that are not the sample farms) and **new date ranges**:

- Cuatro Cañadas east (-62.25, -17.15)
- San Julián north (-62.70, -16.45)
- Pailón east (-62.15, -17.65)
- Guarayos (-62.95, -16.20)
- Yapacaní rice belt (-63.8..-63.3, -17.5..-16.9)
- Montero (-63.25, -17.33)
- Controls outside Bolivia: Sorriso MT (Brazil), Alto Paraná (Paraguay), Pergamino (Argentina)

The probe scripts stay in the session scratchpad, because the task allows me to write only this file.

## Summary

| Claim | Verdict |
|---|---|
| GLAD soy: keyless, 2001 start, range reads ~1 s | **Confirmed** |
| GLAD soy: "soy mask" | **Corrected**: summer-season soy only (imagery 1 Nov–30 Apr). Bolivian winter soy is not mapped. |
| GLAD soy: latency ~1 yr | **Corrected**: about 19 months. The 2024 file is the 2023/24 season (harvest-year label) and was posted 2025-11-07. |
| GLAD 2024 "incomplete for Bolivia" | **Corrected (it is worse)**: the 2024 layer is anomalous in Bolivia *and* in Mato Grosso, Brazil |
| GLAD licence "not stated" | **Confirmed**: nothing on the page. The paper's "academic research" clause covers the article, not the maps. Commercial use is unclear. |
| MapBiomas mirror: keyless, COG, 30 m, 2019–2024 | **Confirmed**: but the mirror's own README says 5 of 6 files return 404, which is stale or wrong |
| MapBiomas mirror: class 40 = flooded rice | **Refuted** for the mirror. Class 40 is not in its legend and does not occur, even in the Yapacaní rice belt. Rice sits in 72 (2024) / 18 (2019–23). |
| MapBiomas licence CC-BY-SA-4.0 | **Corrected**: the official site says **CC BY 4.0**. The mirror metadata says CC-BY-SA-4.0. |
| MapBiomas official GCS is 403 | **Confirmed**: 403 on objects, 401 on listing |
| FAO Crop Calendar: keyless, values | **Confirmed**: with minor corrections (31 entries in es vs 32 in en; wheat has 3 sub-zone rows) |
| FAO Crop Calendar licence "FAO open (attribution)" | **Corrected**: FAO general terms allow **non-commercial** use only. Commercial use needs permission (copyright@fao.org). |
| MCD12Q2 via ORNL: keyless, 2001–2025, 10-date cap | **Confirmed** |
| MCD12Q2 "flaky", "gaps 2023–24" | **Corrected (round 2)**: no 502 errors in either round. Fill years are common and not limited to 2023–24. San Pedro has fill (32767) in 2010, 2017 and 2018 (3 of 10 years). The product-year label is also not the season. Each band call takes 4–5.6 s. |
| MCD12Q2 "No Peak band" | **Confirmed (round 2)**: `/bands` lists 23 bands and none is Peak. EVI_Amplitude and NumCycles exist. |
| GLAD "tiled 256×256, not COG" | **Confirmed (round 2)**: block 256×256, no overviews, nodata unset, values {0,1} |
| Kc from FAO-56 Tables 11/12 | **Confirmed (round 2)**: the live FAO page matches `sample_kc_fao56.json` for soy, sorghum and the tropics soy stages |
| WorldCereal titiler `/statistics` keyless | **Confirmed (round 2)**: 200 in 0.62 s at a new polygon. Collection licence is CC-BY-4.0. |

## Details

### 1. GLAD/UMD South America soybean

- **Access**
  - Ran `HEAD` on `SouthAmerica_Soybean_{Y}.tif`. 2000 returns 404. 2001 returns 200 (267.9 MB, Last-Modified 2021-03-25). 2020 returns 200 (2021-03-25). 2023 returns 200 (2024-08-12). 2024 returns 200 (315 MB, 2025-11-07). 2025 returns 404.
  - Latency was 0.07–0.10 s. The directory listing returns 403.
- **Range reads**: seven 0.1° boxes took 1.1–1.4 s per year. No throttling was seen.
- **Soy fraction per box** (new boxes):

| Box | 2021 | 2022 | 2023 | 2024 |
|---|---|---|---|---|
| SCZ Cuatro Cañadas east | 0.49 | 0.40 | 0.53 | **0.21** |
| SCZ Pailón east | 0.23 | 0.26 | 0.33 | **0.07** |
| SCZ San Julián north | 0.06 | 0.02 | 0.03 | 0.02 |
| BR Sorriso MT | 0.23 | 0.23 | 0.23 | **0.16** |
| PY Alto Paraná | 0.37 | 0.36 | 0.36 | 0.36 |
| AR Pergamino | 0.16 | 0.19 | 0.12 | 0.22 |

- **The 2024 drop is not limited to Bolivia.** It also shows in Mato Grosso, while Paraguay and Argentina stay flat. MapBiomas 2024 for the same Bolivian boxes shows soy (39) at 0.47 (Cuatro Cañadas east) and 0.33 (Pailón east). GLAD 2024 gives 0.21 and 0.07 there. Treat GLAD 2024 as unusable for now.
- **Semantics** (Song et al. 2021, PMC8350977):
  - "we refer to a cropping year by the harvest year … 2001 indicates the 2000/2001 cropping year."
  - Only imagery from 1 Nov to 30 Apr is used, so the maps are **summer soy only**. Santa Cruz winter soy (FAO AEZ 003 2nd season, sown in June) is invisible to them.
  - No accuracy is reported for Bolivia; the continent-wide overall accuracy is 94–96 %.
- **Licence**: no licence on the project page. The data statement only gives download links. For a bank-facing product, ask glad@umd.edu.

### 2. MapBiomas Bolivia (source.coop mirror)

- **Access**: `HEAD` on all 2019–2024 COGs returned 200 (0.2–0.65 s). 2018 and 2025 returned 404. These are real COGs: 512×512 blocks, overviews 2–128, nodata 0.
- **Read speed**: 2023 took 4.0 s and 2024 took 2.5 s, for 5 boxes plus one 0.5° box.
- **The mirror's README/AGENTS.md contradicts itself.** It says "1 of 6 rasters are served … 5 of 6 … return HTTP 404 (upload in July 2026 stopped part way)", but today all six return 200. The third-party metadata is not reliable. Re-check availability at startup, and pin the snapshot in DuckDB.
- **Classes**
  - 2019–2023 (Col 2) use 18 = agriculture.
  - 2024 (Col 3) uses 39 = soy (beta) and 72 = other crops.
  - **Code 40 is absent** from the mirror legend and from the unique values in the 2024 Yapacaní–Mineros rice belt: {3, 6, 11, 12, 13, 15, 21, 23, 24, 25, 31, 33, 39, 68, 72}.
  - So "flooded rice (40)" holds only for the official Col 4, which is not reachable without a signup.
- **Licence**: the official bolivia.mapbiomas.org page says "uso público, abierto y gratuito mediante referencia. CC BY 4.0". The mirror STAC/README says CC-BY-SA-4.0. Cite the upstream CC BY 4.0. Either licence allows commercial use with attribution.
- **Official GCS**: the Col 4 2025 and 2024 coverage files and a fire 2025 file all return 403. Listing the bucket returns 401 for anonymous callers. Confirmed.

### 3. FAO Crop Calendar API

- **Access**: `/countries/BO/{aez,crops,cropCalendar}?language=es` returned 200 in 0.48 / 0.63 / 1.35 s. No rate-limit headers were returned. `/swagger.json` is public and lists `/countries/{id}/cropCalendar/download`.
- **Entry counts**: 31 entries in `es` and 32 in `en`. The `en`-only entry is Interandino bean (AEZ 002), which is not relevant here. `/aez` returns `id: null` with `administrative_units: "-"`, so there is no geometry. Mapping a farm to an AEZ is a manual step.
- **AEZ 003 "Llanuras orientales y trópico húmedo"** (lastUpdated 19/03/2025):

| Crop | Sowing | Harvest |
|---|---|---|
| Soy | 15/11–20/12 | 01/03–15/04 |
| Soy 2nd season | 01/06–30/06 | 10/10–20/11 |
| Sorghum | 01/03–30/04 | — |
| Sorghum 2nd season | 01/09–31/10 | — |
| Rice (3 rows) | 15/10–15/12 | — |
| Rice (manual) | 15/09–30/11 | — |
| Wheat, eastern zone | 10/04–30/04 | 25/08–15/09 |
| Wheat, northern zone (row 1) | 01/05–20/05 | — |
| Wheat, northern zone (row 2) | 20/05–30/05 | to 20/10 |

  - All of these match the original claim. The single wheat line in the claim combines the three wheat rows.
  - There is **no maize, sunflower, sugarcane or chia** in AEZ 003. Confirmed.
  - AEZ 004 Gran Chaco has soy sown 01/12–31/01. If any farm sits in the southern (Chaco) part of Santa Cruz, pick that AEZ for it.
- **Licence**:
  - The site and the API show no licence.
  - FAO Terms (fao.org/contact-us/terms) allow use "for private study, research and teaching purposes, and for use in non-commercial products or services". Resale or other commercial use needs a request to copyright@fao.org.
  - The Crop Calendar is not one of the statistical databases covered by the open-data (CC BY 4.0) policy.
  - So **"FAO open (attribution)" is wrong for a commercial bank product**. It is fine for the hackathon demo. Sowing dates as facts in a curated table, with a citation, are a low risk. Redistributing the dataset is not allowed without permission.

### 4. MODIS MCD12Q2 / MCD12Q1 via ORNL

- **Access**: `/MCD12Q2/dates` at the new point returned 200 in 1.4 s, with 25 dates from A2001001 to **A2025001**. A 25-date request returned **400 "exceeds maximum subset tiles support of 10"**, which confirms the 10-date cap.
- **Speed**: 15 band calls (3 chunks × 5 bands) all returned 200. Each call took **2.5–4.7 s**, slower than the claimed 1–3 s. There were no 502 errors this session.
- **Gaps**: the new point (-62.25, -17.15) has **no fill years from 2001 to 2025**. The 2023–24 32767 fill at Cuatro Cañadas Lote 7 is specific to that pixel, not systematic.
- **Quality quirk**: cycle index is not tied to season.
  - In 2017, cycle 1 is a winter cycle (green-up 2017-05-21), and the 2016/17 summer cycle shows up as 2016 Greenup.Num_Modes_02 (2016-09-11).
  - Summer green-ups otherwise fall between 24 Sep and 25 Dec, and 2-cycle years (May green-up) occur in 2003, 2007, 2010, 2012–2016 and 2018.
  - Assign each cycle to a season by its date, not by its mode index.
- **Licence**: Earthdata catalog: "openly shared, without restriction", citation required. Its "latest year 2023" note is stale, because ORNL serves 2025. It says processing runs "6 months after the end of the calendar year". The 2025 product (cycles up to Jan 2026) agrees with that.
- **Continuity** (not verified live): Terra and Aqua are near the end of their missions. Plan the NDVI-derived phenology as the long-term path, as already recommended.

### 5. Fallback spot check

ESA WorldCover on Planetary Computer: STAC search took 0.2 s, an anonymous SAS token returned 200, and the collection licence is CC-BY-4.0. Reading the Cuatro Cañadas east box took about 1.6 s:

| Year | Cropland (40) | Tree (10) |
|---|---|---|
| 2021 | 0.47 | 0.42 |
| 2020 | 0.55 | 0.39 |

MapBiomas 2024 gives 0.70 crop and 0.27 forest for the same box. The masks agree in direction but differ by up to 0.2 in fraction. "Agree with each other" holds at farm level, but it is loose.

### 6. Round 2 re-probe (2026-11-07, later run)

This run used four more 0.1° boxes that are not sample farms and are not the round-1 boxes, plus other date ranges:

- San Pedro (-63.45, -16.80)
- Cabezas, Chaco (-63.00, -18.50)
- Okinawa east (-62.75, -17.25)
- Yapacaní west (-63.90, -17.30)

**Availability did not change.**

- GLAD: 2000 returns 404. 2001, 2023 and 2024 return 200 (Last-Modified is the same as in round 1). 2025 returns 404.
- MapBiomas mirror: 2018 returns 404, 2019 and 2024 return 200, 2025 returns 404.
- FAO: `/aez` returns 5 rows, `/crops` 36 rows and `/cropCalendar` 32 rows (en), in 0.5–1.5 s.
- ORNL `/MCD12Q2/dates` at San Pedro: 25 dates, A2001001 to A2025001, in 2.1 s.

**GLAD vs MapBiomas soy fraction:**

| Box | GLAD 2022 | GLAD 2023 | GLAD 2024 | MapBiomas 2024 (39) |
|---|---|---|---|---|
| San Pedro | 0.31 | 0.45 | 0.32 | 0.39 |
| Okinawa east | 0.36 | 0.39 | **0.10** | 0.26 |
| Cabezas (Chaco) | 0.01 | 0.02 | 0.00 | 0.05 |
| Yapacaní west | 0.03 | 0.05 | 0.03 | 0.03 |

This is a third Bolivian box where GLAD 2024 collapses (Okinawa east) while MapBiomas 2024 still shows soy. The round-1 verdict (do not use GLAD 2024) still holds. Reads took 0.02–0.22 s per box and year.

**MapBiomas mirror:**

- 2023 has class 18 only. 2024 has 39/72.
- Class 40 does not occur in any box, including the Yapacaní west rice area, where 72 = 0.64.
- The file tags say "Collection 3 (2024); earlier collection for 2019-2023", and the legend source is the Col3 PDF. The class-40 refutation stands.
- Reads took 0.2–1.1 s per box.

**MCD12Q2 at San Pedro, 2010–2019 (new range):**

| Product year | 2010 | 2011 | 2012 | 2013 | 2014 | 2015 | 2016 | 2017 | 2018 | 2019 |
|---|---|---|---|---|---|---|---|---|---|---|
| Greenup cycle 1 | fill | 2010-12-24 | 2011-10-02 | 2012-09-16 | 2014-01-14 | 2014-09-07 | 2015-09-10 | fill | fill | 2018-09-13 |
| Greenup cycle 2 | fill | fill | fill | 2013-09-09 | fill | fill | 2016-09-22 | fill | fill | fill |
| NumCycles | fill | 1 | 1 | 2 | 1 | 1 | 2 | fill | fill | 1 |

What this shows:

- **Gaps are not limited to 2023–24 or to one pixel.** This pixel has 3 of 10 years missing.
- **The product year does not equal the season.** Most cycle-1 green-ups fall in the previous calendar year (Sep–Dec). Assign each cycle to a campaign by its date, not by its year label or mode index. This confirms the round-1 quirk at a second point.
- Each call took 4.1–5.6 s. MCD12Q1 LC_Type1 was 12 for 2020–2024 (1 call, 5.4 s).

**WorldCereal (fallback/validation):**

- STAC search took 0.51 s and returned item `20087_tc-annual_temporarycrops_2021` (the same AEZ 20087).
- titiler `/statistics` POST at a 1 km square at San Pedro returned 200 in 0.62 s, with a temporary-crop mean of 32 (0–100 scale).
- The collection licence is CC-BY-4.0.

**FAO-56 Kc:**

- The live page `fao.org/4/x0490e/x0490e0b.htm` returned 200 in 0.3 s.
- Table 11 for soybeans is 15/15/40/15 (85 d, Dec, Tropics). Table 12 for soybeans is mid 1.15 / end 0.50. Sorghum grain is 1.00–1.10 / 0.55. Sugar cane is 0.40 / 1.25 / 0.75. Rice is 1.05 / 1.20 / 0.90–0.60.
- These all match `sample_kc_fao56.json`.
- FAO-56 is under the same FAO copyright terms. Using the coefficients as cited facts is a low risk.

**FAO terms (re-fetched, 200):** "for use in non-commercial products or services, provided that appropriate acknowledgement of FAO…". The licence correction stands.

### Not re-probed (no verdict)

I did not test these independently, so their claims stay as the original researcher reported them:

- Esri/IO LULC
- GEOGLAM CM4EW
- GGCMI p3 (I only read the original `.out`, which shows a 01-Dec planting for sorghum, sunflower and wheat. That is consistent with the "about 4 months off" claim.)
- the curated `sample_crop_calendar_santacruz.json`

WorldCereal and the FAO-56 Kc values were checked in round 2.

## Recommendation changes

1. **Soy mask**: label GLAD as *summer-season soy, 2001–2023*. Do not use 2024, because it is anomalous across Bolivia and Mato Grosso. Taking the max over 2021–2023 is fine as "soy-capable field". It says nothing about winter soy. Use the FAO 2nd-season window plus NDVI for the winter campaign.
2. **Cropland mask (mirror)**: the class set is {18, 39, 72}, plus 21 as partial. Drop 40, which does not exist in the mirror files. Rice fields fall in 72/18, so crop type for rice has to come from the bank's declared crop.
3. **MapBiomas licence**: cite it as CC BY 4.0 (MapBiomas Bolivia), with the mirror as the access path. Do not trust the mirror's availability notes. Check with `HEAD` at startup and keep a pinned copy (per polygon in DuckDB, or a clipped Santa Cruz COG).
4. **FAO Crop Calendar**: keep it as the calendar prior, but log a **licence risk**. FAO terms are non-commercial unless permission is granted. For a bank-facing product, cite it as a reference and request permission. Do not redistribute the API payload.
5. **MCD12Q2**: keep it as a fallback or cross-check.
   - Budget 3–6 s per band call and up to 3 calls per band for 2001–2025 (10-date cap). Run it offline or at cache-build time only.
   - Map cycles to seasons by date, not by product year: most summer green-ups sit in the previous calendar year.
   - Expect about 10–30 % fill years per pixel. Do not use it as the only phenology source for any field.
6. **GLAD licence**: still unknown. Email glad@umd.edu before commercial use. Until then, use MapBiomas (CC BY 4.0) as the commercially safe soy layer for 2024.

Sources:

- GLAD project page: https://glad.umd.edu/projects/commodity-crop-mapping-and-monitoring-south-america
- Song et al. 2021 (PMC8350977): https://pmc.ncbi.nlm.nih.gov/articles/PMC8350977
- source.coop MapBiomas Bolivia README: https://data.source.coop/tristangruppwri/mapbiomas/mapbiomas-bolivia/README.md
- MapBiomas Bolivia downloads: https://bolivia.mapbiomas.org/downloads/mapas-para-descargar-geotiff/
- FAO terms: https://www.fao.org/contact-us/terms/en/
- Earthdata MCD12Q2 v061: https://www.earthdata.nasa.gov/data/catalog/lpcloud-mcd12q2-061
