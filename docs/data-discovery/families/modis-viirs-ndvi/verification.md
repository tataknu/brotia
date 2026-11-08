# Adversarial verification: MODIS / VIIRS / long-record NDVI

Verifier probe run: 2026-11-07 05:15–05:45 UTC. All probes ran without keys or accounts.
Coordinates were chosen to differ from the sample farms:
- (-62.00, -17.60): east of Cuatro Cañadas, h12v10
- (-63.45, -17.40): west of Montero, h11v10
- (-62.74 / -62.77, -17.50): straddle the tile edge

Date ranges also differ from the first pass: 2004-12, 2005-01, 2010, 2016-01/02, 2019 wet season, 2021/2023/2025-06 and 2026-09/10.
Probe scripts are in the session scratchpad and were not copied here (rule: only this file).

A **second pass** ran 2026-11-07 07:30–07:45 UTC at two more points: (-62.00, -16.40) near San Julián (h12v10) and (-63.30, -17.95) south of Warnes (h11v10). It also used 2008-01, 2013-08, 2025-07/11 and 2026-08/10. Its findings are in the next section. They change the verdict on claims 4, 5 and 16, and add claims 21–24.

## Headline (second pass): the PC MODIS archive has holes

**PC `modis-13Q1-061` does NOT hold a complete 2000–2026 record.** For each tile we listed every STAC item (all pages) and compared the list with the ORNL `/dates` inventory, which matches CMR.

| Product | PC composites | ORNL / CMR composites | Missing on PC (same on h11v10 and h12v10) |
|---|---|---|---|
| MOD13Q1 (Terra) | 602 | 614 | A2023049; A2024225; A2024353; **A2025193 → A2025305 (8 in a row)**; A2026289 |
| MYD13Q1 (Aqua) | 546–547 | 557 | A2022345; A2023297; (A2024361 on h11v10 only); **A2025185 → A2025313 (9 in a row)**; A2025361 |

- There is one **continuous hole from 2025-07-03 to 2025-11-16** in Terra and in Aqua. That is the whole 2025 dry season and the soy planting window.
- **The hole is in all PC MODIS collections, not only 13Q1.** A STAC search for 2025-06-15 → 2025-12-15 returned:
  - `modis-13Q1-061`: only A2025153–A2025177 and A2025321–A2025345.
  - `modis-43A4-061`: no daily items from A2025183 to A2025328.
  - `modis-09A1-061`: no items from A2025177 to A2025329.
- CMR lists all of these granules at LP DAAC. ORNL serves real values in the hole: MOD13Q1 NDVI at (-63.30, -17.95) for A2025193–A2025305 gave 8 values (DN 4820–7642), HTTP 200 in 23.5 s.
- **We checked if the files exist in PC storage without a STAC entry.** We built each blob URL from the CMR granule ID, then sent a HEAD with the container SAS token.

  | Composite | HEAD result | What it means |
  |---|---|---|
  | MOD A2025193, MOD A2025257 | **404** | Prefix list for `MOD13Q1/12/10/2025257/` is empty: the files are not there |
  | MOD A2023049 | **404** | Not there |
  | MYD A2025361 | **200** | File exists, but STAC does not list it |
  | **MOD A2026289** | **200** | Read worked: NDVI 1.87 s, reliability 0.37 s, median NDVI 0.880 at San Julián, reliability all 1 |

- **So the "1-composite lag" (claim 5) is not ingestion lag.** On PC, STAC indexing is incomplete and the newest Terra file is already in storage. An inventory diff against CMR finds these files.
- **The hole affects the display window as well as the baseline.** The 13-month window starts about October 2025. A2025289 (2025-10-16) and A2025305 (2025-11-01) are missing on PC. Without backfill, the "13 months" chart has no data for October and November 2025.
- **The 2025 MCD43A4 hole has no keyless fallback.** ORNL returns 400 for MCD43A4 at both new points ("No MCD43A4 data available for -16.4 -62.0 location"). Only LP DAAC (Earthdata login) or AppEEARS can fill it.

**Duplicate items.** On each tile, 10–11 composites appear 2–3 times with **different production timestamps**. They are reprocessed versions. Examples:
- MOD A2005241: 2020245… and 2024198…
- MOD A2021225: 2021243… and 2026110…
- MOD A2021257: three versions
- MOD A2022065, A2022097, A2024129: two versions each

A naive prefetch counts these composites twice and mixes vintages. Deduplicate on (product, AYYYYDDD, tile) and keep the newest production timestamp. (An earlier count of "13 duplicates" was partly our own artefact: two date ranges overlapped at a year boundary.)

**Re-confirmed at the new points:**
- STAC search: 200 in 0.17–0.59 s.
- SAS token: 200 in 0.12 s, `st` = now − 24 h, `se` = now + 45 min.
- Earliest items: MOD A2000049 and (from the first pass) MYD A2002185.
- Aqua is current on PC: MYD A2026281 matches CMR (produced 2026-10-27).
- Every 2026 `pixel_reliability` COG from A2026217 onward is `int8` with nodata -1. The 2008 and 2013 COGs are `uint8` with nodata 255.
- The NDVI COG scale tag is 10000. The STAC scale is 0.0001.
- ORNL at San Julián:

  | Product | First | Last | Composites |
  |---|---|---|---|
  | MOD13Q1 | 2000-02-18 | 2026-10-16 | 614 |
  | MYD13Q1 | 2002-07-04 | 2026-09-06 | 557 |
  | VNP13A1 | 2012-01-17 | 2024-05-24 | 569 |

  MCD43A4 returned 400. A 3-composite single-pixel MOD13Q1 subset took 8.2 s.
- CMR newest granules:
  - MOD13Q1 A2026289 ends 10-31, produced 11-03.
  - VNP13A1 v002 A2026297 has a window ending **11-08**, a future date.
  - VJ113A1 v002 A2026289 ends 10-31.
- The wet-season cloud loss is real and Aqua does not fix it. At (-63.30, -17.95), 6×6 px:
  - MOD A2008017: 36/36 cloud.
  - MYD A2008009: 32/36 cloud. MYD A2008025: 34/36 cloud.
  - With a 0.5 good-pixel fraction, all three January 2008 composites are dropped. Expect January baselines with fewer years than other months.
  - August 2013: all composites 36/36 good.

## Verdict summary

Rows 4, 5 and 16 were amended by the second pass. Rows 21–24 are new.

| # | Claim | Verdict |
|---|---|---|
| 1 | PC `modis-13Q1-061` is keyless (STAC + anonymous SAS) | **Confirmed** |
| 2 | Collection-level SAS token gives 403; the container token works | **Confirmed** |
| 3 | SAS token lasts "about 1 h" | **Corrected: about 45 min** |
| 4 | History starts 2000-02-18 (Terra) and 2002-07-04 (Aqua); "26 seasons" | **Start confirmed. Completeness refuted**: 12 Terra and 12–13 Aqua composites are missing, including 2025-07-03 → 2025-11-16 |
| 5 | PC lags LP DAAC by about 1 composite | **Corrected**: the newest Terra file (A2026289) is in PC storage but STAC does not list it. Other gaps are real missing files |
| 6 | A2026289 ends 2026-10-31; use the end date for "as of" | **Confirmed** |
| 7 | LP DAAC publishes about 3 days after the composite ends | **Confirmed, with a 1–3 day range** |
| 8 | Farms west of about -62.75° are in h11v10, east in h12v10 | **Refuted** (the boundary moves with latitude; one sample farm is misassigned) |
| 9 | Full history is about 2,500 reads, 15–25 min with 8 workers | **Corrected: about 7 min** (11 min with VI_Quality); the read count is right for Terra NDVI + reliability |
| 10 | Licence: NASA open data, no restrictions | **Confirmed** (CC0), but the PC metadata shows `other` / `proprietary` |
| 11 | QA: keep reliability 0/1; VI_Quality bit layout | **Confirmed**, plus a dtype gotcha |
| 12 | ORNL limit of 10 composites per call | **Confirmed** (and documented) |
| 13 | ORNL takes 3–18 s per call | **Corrected: 0.8–26 s** |
| 14 | ORNL MYD13Q1 lags; no MCD43A4 for Bolivia; VNP13A1 stops 2024-05-24 | **Confirmed** at a second location |
| 15 | AppEEARS product list is public; tasks need a login | **Confirmed** (task path itself is unverifiable) |
| 16 | PC `modis-43A4-061`: COG read "not tested" | **Now verified** (works), **but** there are no items from A2025183 to A2025328, and no keyless fallback exists (ORNL has no MCD43A4 for Bolivia) |
| 17 | MCD43A4 latency is "about 9 days" | **Corrected**: the datetime is the centre of a 16-day window, so data is ~2 days behind the window end |
| 18 | Terra stops science around Jan/Feb 2027, Aqua around Sep 2027 ("not verified") | **Confirmed by documentation** |
| 19 | "No keyless VIIRS VI path is current" | **Corrected: true only at 500 m.** Keyless, current coarse VIIRS NDVI exists |
| 20 | Restrict baseline years using MCD12Q1 | **Plausible, with a caveat**: MCD12Q1 is not on PC and is only reachable through ORNL (2001–2025) |
| 21 | (implicit) PC 13Q1 is a complete baseline on its own | **Refuted**: see the headline. Backfill from ORNL (keyless) |
| 22 | (implicit) one STAC item per composite | **Refuted**: 10–11 composites per tile have 2–3 reprocessed versions |
| 23 | 13-month display window can come from PC | **Corrected**: October and November 2025 are missing on PC and need ORNL backfill |
| 24 | ORNL is a full fallback for the PC products | **Corrected**: true for 13Q1 (Terra current, Aqua lags). False for MCD43A4 (400 for Bolivia) |

## Evidence

### Planetary Computer `modis-13Q1-061`

**Access**
- `POST /api/stac/v1/search` returned 200 in 0.45–0.50 s at all four new coordinates.
- `GET /api/sas/v1/token/modiseuwest/modis-061-cogs` returned 200 in 0.38 s with no auth.
  - With that token, a `HEAD` on the COG blob returns 200 (49.5 MB tile; we read only windows).
  - Without a token, the same `HEAD` returns **409**.
- `/token/modis-13Q1-061` also returns 200, but its token gives **403** on the blob.
  - Reason: the COG assets carry `storage:refs = azure-modiseuwest-modis-061-cogs`.
  - The collection token is for the HDF container `modis-061`.
  - The first researcher's explanation is correct.

**Token expiry**
- The token has `st = 2026-11-06T05:17Z` (backdated 24 h) and `se = 2026-11-07T06:02Z`, against a wall clock of 05:17Z.
- So the usable life is **about 45 minutes**, not 1 hour.
- Refresh the token at 40 minutes.

**Rate limits**
- The PC SAS doc ([sas.md in microsoft/PlanetaryComputerDataCatalog](https://raw.githubusercontent.com/microsoft/PlanetaryComputerDataCatalog/main/docs/concepts/sas.md)) says limits are tiered by two things: whether a subscription key is sent, and whether the request comes from Azure West Europe.
- Anonymous requests from outside that region get the least favourable tier. The doc gives no numbers.
- No response headers expose any limit.
- We did not hit a limit at 24 concurrent reads.

**History**
- The earliest Terra item is `MOD13Q1.A2000049.h12v10` (2000-02-18 to 2000-03-04).
- The earliest Aqua item is `MYD13Q1.A2002185.h12v10` (2002-07-04).
- The collection extent is `2000-02-18 → open`. All three agree with the claim.

**Latest data, PC vs LP DAAC**

| | PC on 2026-11-07 | LP DAAC via CMR | Lag |
|---|---|---|---|
| Terra | MOD A2026273 (09-30 → 10-15) | MOD A2026289 (10-16 → 10-31), produced 2026307 = 11-03 | 1 composite. A2026289 was still missing on PC 4 days after LP DAAC published it |
| Aqua | MYD A2026281 (10-08 → 10-23) | MYD A2026281 | none |
| MCD43A4 | A2026301 (produced 11-06) | A2026302 | 1 day |

- The PC lag comes from ingestion and differs between products. Do not hard-code "1 composite".

**Publication latency at LP DAAC**
- MOD A2026289: composite ended 10-31, production date in the ID is 2026307 (11-03), and CMR `updated` is 2026-11-03. That is 3 days.
- MOD A2026273: composite ended 10-15 and was produced 2026289 (10-16). That is 1 day.
- So the range is **1–3 days**.

**Composite dates**
- STAC `start_datetime` / `end_datetime` for A2026273 are 2026-09-30 / 2026-10-15T23:59:59.
- By the same rule, A2026289 ends 2026-10-31. Confirmed.
- The `composite_day_of_the_year` band holds the real observation day. In A2004353 it ranged over DOY 358–362, and in A2026257 over 264–269.
- This supports using the median of that band, or the composite end date, as "data as of".

**Windowed COG reads (6×6 px, ±750 m) at (-62.00, -17.60)**

| Composite | Read time NDVI / reliability / DOY | Reliability | Median NDVI (good px) |
|---|---|---|---|
| A2004353 | 1.65 / 0.36 / 0.91 s | 32 marginal (1), 4 cloud (3) | 0.785 |
| A2005001 | 1.17 / 0.36 / 0.37 s | all 0 | 0.757 |
| A2016017 | 1.15 / … | all 0 | 0.578 |
| A2016033 | 1.35 / … | all 0 | 0.721 |
| A2026241 | 1.12 / … | all 0 | 0.507 |
| A2026257 | 1.37 / … | 30 good, 6 marginal | 0.544 |

**Projection**
- The CRS is `+proj=sinu +lon_0=0 +R=6371007.181 +units=m`, with 231.656 m pixels on a 4800×4800 tile.
- This matches the researcher's reprojection recipe.

**Data-quality gotchas (new)**
1. **The `pixel_reliability` dtype and nodata changed between COG vintages.**
   - 2004, 2021, 2023 and 2025 files: `uint8`, nodata **255**.
   - 2026-09 file (A2026257): `int8`, nodata **-1**.
   - The "keep 0/1" mask (`np.isin(r, [0, 1])`) still works.
   - But code that tests `== -1` for fill, or that uses `ds.nodata` blindly while mixing vintages, will misclassify pixels.
   - VI_Quality (`uint16` / 65535) and NDVI (`int16` / -3000) were the same in all five vintages.
2. **The NDVI COG scale tag says `10000.0`.** This is the HDF4 divide-by convention. The STAC `raster:bands` scale says `0.0001`.
   - Any reader that auto-applies the GDAL scale, such as `mask_and_scale` in rioxarray, would multiply by 10000.
   - Always use the STAC value: `DN × 0.0001`.
   - MCD43A4 COGs carry `0.0001` correctly.

**Tile assignment (refutes the -62.75° rule)**
- MODIS sinusoidal tile edges follow meridians in projected x. In longitude, the h11/h12 edge (x = -6,671,703 m) is at lon = x / (R·cos lat).
- So across the portfolio's latitude span it moves from **-62.69° at 16.86°S to -63.00° at 17.74°S**.
- STAC `intersects` for each of the 12 farms:
  - **Granja Las Londras (-62.76, -17.74) is in h12v10.** The -62.75° rule would send it to h11v10.
  - Brecha 8 (-62.70) is 3 km from the edge.
  - Mineros Norte (-63.18, -17.03) is 0.4° inside h11. The edge at its latitude is -62.75.
- The portfolio-bbox approach reads both tiles, so it is unaffected. **A per-farm tile lookup must use STAC `intersects` or `floor((x + 20015109.354) / 1111950.5197)`**, and polygons near the edge need a mosaic of both tiles.

**Throughput**
- Test: 24 portfolio-bbox window reads (h12v10, 480×273 px, NDVI + reliability, 12 composites from 2010) with 8 threads.
- Wall time was **4.2 s**, so 5.7 reads/s. Per read: 0.35 s minimum, 1.17 s median, 2.5 s maximum. No errors.
- Estimated full Terra history:

| What | Reads | Time |
|---|---|---|
| 614 composites × 2 tiles × 2 bands | 2,456 | ~7 min |
| + VI_Quality (strict mode) | 3,684 | ~11 min |
| + Aqua (557 composites) | +3,342 (3 bands) | +~10 min |

- The researcher's "15–25 min" is conservative, which is fine.
- The anonymous rate-limit tier is a risk at this volume. Spread the prefetch over time and retry with backoff.

### Licence
- CMR UMM-C `UseConstraints` for MOD13Q1.061 and MCD43A4.061 link to the NASA Earthdata Data Use Policy.
- The [Earthdata data-use guidance page](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance) says: *"data provided from a NASA-led mission are licensed as Creative Commons Zero (CC0). While there are no restrictions on the use of these data, data users are very strongly urged to cite..."*.
- The only condition: NASA material may not imply NASA endorsement of a commercial product.
- **Commercial use for a bank product is allowed.** Cite the data and do not use NASA logos.
- The PC STAC `license` field reads `other` (13Q1) and `proprietary` (43A4), with no licence link. Record this so nobody reads it as a restriction.
- The PC platform terms page renders only with JavaScript and was not read. That is **unverifiable** here.

### PC `modis-43A4-061` (MCD43A4 NBAR)
- The COG read is **now verified** for A2026291.h12v10 at (-62.00, -17.60), ±1 km window (4×4 px at 463 m):

| Band | Read time |
|---|---|
| Band1 | 1.14 s |
| Band2 | 1.45 s |
| Band6 | 1.25 s |
| Mandatory QA Band1 | 0.39 s |

- `int16`, scale 0.0001, nodata 32767.
- **NBAR NDVI median = 0.674; NDMI (B2/B6) = 0.246.** The method works.
- In this sample, Mandatory QA was all **1**: the backup "magnitude inversion", which is lower quality than full inversion (0).
- The researcher gave **no QA rule for 43A4**. Add one: keep 0, flag 1, drop 255. Use the per-band QA for bands 1, 2 and 6.
- **Date semantics differ from 13Q1.**
  - Item A2026301 has `datetime` = 2026-10-28 (nominal day), `start_datetime` = 10-20 and `end_datetime` = 11-04. It was produced 11-06.
  - So the data is about 2 days behind the end of its window, not "about 9 days stale".
  - The nominal day is the centre of a 16-day moving window, so consecutive daily items are strongly autocorrelated. Sample every 8 days for the baseline. Report "as of" as the nominal day plus the window.
- The earliest item is A2000055 (2000-02-16). Confirmed.
- MCD43 is a Terra+Aqua combined product, so it also ends with Aqua (Sep 2027).

### ORNL DAAC subset REST API (at -17.60, -62.00)
- `/dates` responses took 0.5–1.4 s.

| Product | Composites | First | Last |
|---|---|---|---|
| MOD13Q1 | 614 | 2000-02-18 | 2026-10-16 (current) |
| MYD13Q1 | 557 | 2002-07-04 | **2026-09-06** (lags CMR's 10-08) |
| VNP13A1 | 569 | 2012-01-17 | **2024-05-24** |
| VNP09A1 | – | – | **2024-05-24** |
| MCD12Q1 | 25 | 2001 | 2025 |

- MCD43A4 returned **400** "No MCD43A4 data available for -17.6 -62.0 location". This confirms the gap for Bolivia.
- The product list (46 products) has no VJ1* and no VIIRS v002 entries.
- **10-composite cap:**
  - A2019001–A2019145 (10 composites) returned 200.
  - A2019161 (11 composites) returned **400** "exceeds maximum subset tiles support of 10" in 0.5 s.
  - The web-service page also documents it: *"There is a limit of a maximum ten modis dates per request."*
- **Latency is wider than claimed:** 0.8 s (2 composites, km=1) up to **26.3 s** (10 composites, km=0, single pixel).
- No rate-limit headers were returned. ORNL rate limits are **unverifiable**.
- Wet season 2019 at a single pixel: 3 of 10 composites were cloud (reliability 3). This matches the first pass: the wet-season cloud loss is real.

### AppEEARS
- `GET /api/product/VJ113A1.002` (no auth) returned 200 and layer metadata.
- `GET /api/task` (no auth) returned **403**. The task path needs an Earthdata bearer token.
- The docs say the token lasts about 48 h and the API can return 429. They also show a `recurring` date option with a `yearRange`, which suits a same-time-of-year baseline.
- Public `GET /api/quality/MOD13Q1.061/_250m_16_days_VI_Quality` returns the field names in this order: MODLAND, VI Usefulness, Aerosol, Adjacent cloud, Atmosphere BRDF correction, Mixed clouds, Land/Water, Snow/ice, Shadow.
  - This order is consistent with the researcher's bit layout (2–5 usefulness, 8 adjacent cloud, 10 mixed cloud, 15 shadow).
  - The endpoint does not expose the bit positions themselves, so those are consistent with the documented layout but not independently verified.
- Usefulness 12 = "Lowest quality" (still usable); 13 = "Quality so low that it is not useful".
  - Dropping ≥12 is strict. Dropping ≥13 is the documented "not useful" cut.
  - In the wet season, strict mode plus a 0.5 good fraction will blank many Jan–Mar composites. Fill them with Aqua.
- Task queue time and throughput are **unverifiable** without a login.

### VIIRS continuity and MODIS end of life
- [NASA Science, "Terra: the end of an era"](https://science.nasa.gov/science-research/earth-science/terra-the-end-of-an-era), 2025-12-29: projected end of science for "Terra in February 2027" and "Aqua in September 2027".
- [Earthdata alert, 2025-05-02](https://www.earthdata.nasa.gov/data/alerts-outages/transition-from-modis-viirs): platforms "will begin shutting down operations" in late 2026 / early 2027, and data users are urged to move to VIIRS.
- The researcher's dates are confirmed by documentation. The live data shows Terra still current (A2026289).
- CMR (keyless) newest VIIRS v002 granules over h12v10:

| Granule | Window | Produced |
|---|---|---|
| VNP13A1.A2026297 | 10-24 → 11-08 | 11-05 |
| VJ113A1.A2026289 | 10-16 → 10-31 | 11-01 |
| VJ213A1.A2026289 | 10-16 → 10-31 | 11-03 |

  - VNP13A1 has a granule whose window ends in the future. This is an 8-day phased product, so check the window end before using "as of".
  - VNP13A1 v002 `UseConstraints` is null in CMR, but the same NASA CC0 policy applies.
- **"No keyless VIIRS VI path is current" is too broad.** Two keyless, current, coarse VIIRS NDVI paths exist:
  - **NOAA CDR NDVI on AWS Open Data**: bucket `noaa-cdr-ndvi-pds`, anonymous S3 list 200 in 0.18 s. The newest file is `VIIRS-Land_v001_JP113C1_NOAA-20_20261102_c20261104…nc` (65.8 MB, daily global, 0.05°).
  - **NOAA STAR Blended VHP 4 km weekly**: directory listing 200; newest `VHP.G04.C07.j01.P2026044.*.nc`.
  - Both are far too coarse for a field. They are fine for regional drought context.
  - The 500 m claim stands: no keyless VNP13A1 / VJ1 v002 path exists (ORNL stops in 2024, and PC has no VIIRS collection).

### MCD12Q1 for land-cover year filtering
- PC has **no `modis-12Q1-061` collection.** The 21 MODIS collections there do not include it.
- The only keyless path is ORNL point subsets (2001–2025, yearly, 500 m).
- This works, but at 500 m MCD12Q1 cropland labels are unreliable in the Santa Cruz clearing frontier.
- Treat it as a coarse filter. A sharper land-use history source belongs to another family.

## Open risks found by verification
1. **PC anonymous rate tier.** The limits are undocumented and the data lives in West Europe. Throttle the bootstrap prefetch, retry on 403/409/429, and refresh the token every 40 min.
2. **PC ingestion lag differs by product.** Terra 13Q1 lagged at least 4 days behind LP DAAC; Aqua and 43A4 did not. Use CMR (keyless, 0.2 s) as the "what is newest" oracle and display the gap.
3. **Mixed COG vintages** (reliability dtype, scale tag) can silently corrupt masks or values unless the reader normalises them.
4. **"Final reprocessing" of MODIS** is mentioned in the Earthdata alert. A late collection reprocessing could shift the baseline, so version the DuckDB cache by collection.
5. **MCD43A4 also ends in 2027** (it needs Terra and Aqua). The VIIRS NBAR replacement (VNP43IA4 / VJ143IA4 v002) needs a login.
6. **Second pass: gaps in the PC MODIS archive.** These are concrete changes to the recommendations:
   - **(a) Inventory diff at bootstrap.**
     - List the PC STAC items per tile and product, and diff them against CMR (keyless, about 0.2 s per query).
     - For each composite that is missing from STAC, first try the blob URL built from the CMR granule ID. This works for some composites (A2026289, MYD A2025361).
     - If that gives 404, backfill per farm from ORNL. At 10 composites per call, the 2025 hole needs 1–2 calls per band per farm. This is a one-time cost.
   - **(b) Deduplicate** on (product, AYYYYDDD, tile) and keep the newest production timestamp.
   - **(c) Backfill the display window.** October and November 2025 are missing on PC, so the 13-month chart needs ORNL data for them. Use the same diff for the "as of" date: PC STAC alone shows Terra one composite staler than the data really is.
   - **(d) MCD43A4 NBAR / NDMI.** The 2025 hole cannot be filled without a key. Either accept a gap in the 2025 baseline year (drop 2025 from the NDMI baseline) or use the Earthdata login that the VIIRS decision already needs.
   - **(e) Version the DuckDB cache by production timestamp.** Reprocessed versions exist (one was produced in 2026-04 for a 2021 composite). Re-check the newest production timestamp per composite in incremental updates.
   - **(f) Expect fewer baseline years for January–February.** Terra and Aqua both lost January 2008 to cloud at 6×6 px. Show "n baseline years" per composite, not only per farm.

Second-pass probe scripts (recheck*.py) are in the session scratchpad and were not copied here.
