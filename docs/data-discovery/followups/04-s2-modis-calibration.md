# Follow-up 04: Sentinel-2 / MODIS calibration (NDVI, NDMI) for Santa Cruz

Run 2026-11-07, 08:50–09:45 local (UTC-5). No accounts or keys were used: PC STAC, the PC data API and the PC anonymous SAS token; Earth Search over plain HTTPS; ORNL REST.
Points (500 m x 500 m box around each): Colonia Cuatro Canadas (-62.47,-17.30), Parcela Okinawa Uno (-62.93,-17.27), Hacienda El Cusi (-62.55,-17.38). All three fall inside S2 tile **20KNF** (relative orbit R010). MODIS tiles: h12v10 for Cuatro Canadas and El Cusi, h11v10 for Okinawa. 4–5 MODIS pixel centres fall inside each box.
Scripts and raw outputs are in the session scratchpad (`.../scratchpad/cal/`). They were not copied here, because the rule allows only this file.

## TL;DR

1. **DN offset: the rule depends on the host, and on PC you must key it on `s2:processing_baseline`, not on the date.**
   - PC items with a baseline below 04.00 (02.12 and 03.00, 2015 to Jan 2022) have **no** +1000 offset. On 20KNF, the PC items for 2015–2017 are all 02.12 (40) or 03.00 (4); a query for ≥ 04.00 before 2018 returned 0.
   - PC items with baseline ≥ 04.00 have the offset, **including 6 reprocessed pre-2022 items on 20KNF**: Dec 2021 scenes with baseline 04.00, generated 2023. These sit next to the 03.00 originals.
   - Earth Search **c1** has reprocessed everything to ≥ 05.00, so **every c1 item, 2018 included, has the +1000 offset**. This was checked: a c1 query on 20KNF for baseline < 05.00 returned 0 items, and the 2018-02 items are 05.00. Its `raster:bands` offset of -0.1 is correct.
   - If the offset is not removed, NDVI drops by about 0.15–0.17 on these fields.
2. **S2 → MODIS NDVI cross-calibration (n = 308 pairs, 2019-01 to 2026-09, 3 points pooled).** Use **B8A**: `MODIS ≈ 0.924·S2 + 0.061` (OLS), R² 0.899, RMSE 0.050. Theil-Sen gives 0.940·S2 + 0.048. B08 gives a worse fit: 0.880·S2 + 0.110, R² 0.887, RMSE 0.054, and a mean bias of +0.052 against +0.022 for B8A.
3. **ORNL fills the 2025 PC hole.** ORNL served all 8 missing MOD13Q1 composites (2025-07-12 to 2025-11-01) at all 3 points, keyless, with HTTP 200. On overlapping dates its values are **identical** to PC.
4. **Long NDMI baseline: Landsat C2 L2 on PC works.** On same-day pairs, `Landsat NDMI = 1.030·S2 NDMI(B8A/B11) + 0.037`, R² 0.996, RMSE 0.009, n = 81. With ±3 days: n = 359, R² 0.982, RMSE 0.019.
5. **New gotcha:** PC `modis-13Q1-061` items from about 2024-03 to 2025-05 have **no `platform` property**. A STAC filter `platform = terra` silently drops 29 composites, so filter on an id prefix of `MOD13Q1.` instead.

## Source status (all probed live, verified = true unless noted)

| Source | Call | HTTP | Latency | Latest at the points | History start at the points |
|---|---|---|---|---|---|
| PC STAC `sentinel-2-l2a` | collection GET / search sortby | 200 | 0.19 s / 0.31 s | 2026-11-04 (S2A, 20KNF, baseline 05.13) | 2015-10-21 (20KNF); collection 2015-06-27 |
| PC data API `item/statistics` (S2) | 1,495 POSTs, 5 expressions per call | 200, 0 errors | median 0.53 s, p95 0.85 s; 679 s total with 4 threads | — | — |
| Earth Search `sentinel-2-c1-l2a` | search sortby `properties.datetime` | 200 | 0.14–0.28 s | 2026-11-04 | **2018-02-07** on 20KNF (c1 starts later than PC) |
| PC STAC `modis-13Q1-061` (Terra) | search | 200 | 0.2–0.5 s | 2026-09-30 (A2026273) in STAC | 2000-02-18 |
| PC MOD13Q1 COG window reads (NDVI + reliability) | 534 composites read (154 off-tile items skipped) | OK (one hang before HTTP timeouts were set) | median 0.73 s, p95 1.56 s per item, 2 bands | — | — |
| ORNL `MOD13Q1/dates` | GET | 200 | 1.6 s | **2026-10-16 (A2026289)** | 2000-02-18; 614 composites |
| ORNL `MOD13Q1/subset` (10 composites, km = 1) | 6 GETs | 200 | NDVI 4–29 s; reliability 3.7–3.9 s | covers 2025-06-10 to 2025-11-01 | — |
| PC STAC `landsat-c2-l2` | search | 200 | 0.3 s | 2026-10-28 (LC09, **T2**); T1 to 2026-10-20 | 1984-04-07 (LT05, path 230/072); L8 from 2013-03-25 |
| PC data API `item/statistics` (Landsat) | 921 POSTs | 200; 3 fails (one scene, LC08 2022-05-02, repeated 5xx) | median 0.61 s, p95 1.24 s | — | — |
| PC STAC `modis-43A4-061` | search | 200 | 0.33 s | 2026-10-28 | 2000-02-24 (pixels **not read**, verified = false) |

## (1) DN offset: answered

**Probe.** Raw COG windows were read over the 500 m boxes, client side. PC was read with the SAS-signed href and Earth Search with plain HTTPS. Two scenes were compared on the same tile and season: 2020-08-10 and 2023-08-15, both 20KNF with 0 % cloud. Results are in `dn_offset.json`.

| Scene | Host | `s2:processing_baseline` | Cuatro Canadas B04 mean / min | B08 mean | B8A mean | Offset metadata |
|---|---|---|---|---|---|---|
| 2020-08-10 | PC | 02.12 | 1069.6 / **477** | 2993.9 | 3207.7 | PC `raster:bands` has no scale/offset |
| 2020-08-10 | ES c1 | **05.00** (reprocessed) | 2083.2 / **1470** | 4058.1 | 4277.2 | `raster:bands` scale 1e-4, offset **-0.1** |
| 2023-08-15 | PC | 05.09 | 1872.1 / 1313 | 3891.0 | 4080.2 | none |
| 2023-08-15 | ES c1 | 05.09 | 1868.8 / 1317 | 3878.5 | 4067.3 | offset -0.1 |

Okinawa and El Cusi show the same pattern. PC 2020 B04 minimum is 351 and 477, while ES c1 2020 is 1318 and 1485. In 2023 the two hosts agree within about 40 DN.

**Conclusions (verified):**
- A PC 2020 B04 minimum below 1000 is physically impossible if the offset is present. **On PC, the +1000 offset does not apply before 2022 for baseline 02.xx/03.xx items.**
- ES c1 2020 values are about PC + 1000. On Cuatro Canadas, B04 is +1014 and B08 is +1064; the extra beyond 1000 comes from processor differences.
- Cuatro Canadas NDVI from box means:
  - PC raw: 0.474.
  - ES c1 minus 1000: 0.477.
  - ES c1 *without* the offset correction: 0.322, an **error of -0.15**.
- **Earth Search c1 is all reprocessed (baseline ≥ 05.00, back to 2018), so subtract 1000 for every c1 item.** Earlier family notes found the opposite for the *legacy* `sentinel-2-l2a` Earth Search collection: its `boa_offset_applied` is true and DN are already minus 1000. The wrapper therefore needs three rules: PC (by baseline), ES c1 (always), ES legacy (never).
- **The date rule is unsafe on PC.** `s2:processing_baseline >= 04.00` with datetime < 2022-01-25 returned **6 items on 20KNF**, all Dec 2021 reprocessings generated Jan 2023. They sit beside the 03.00 originals.
  - On 2021-12-28 at Cuatro Canadas, the 03.00 original has B04 mean 998 and min 262. The 04.00 copy has mean 1977 and min 1257.
  - NDVI is 0.453 for the 03.00 item and 0.463 for the 04.00 item with the rule applied. **Without the rule the 04.00 item gives 0.298.**
  - The reverse query (baseline < 04.00 after 2022-01-25) returned 0 items.
- Two of the duplicate granules have nodata (all 0) over the point, and the PC data API returns **HTTP 500** for them. The dedupe should prefer the newest generation and skip a granule with a 500 or an all-zero result.
- Observed PC baselines 2018–2026: 02.12, 03.00, 04.00, 05.09–05.13.
- **Implementation:** `off = 1000 if baseline >= "04.00" else 0`, then the data-API expression `(B8A-B04)/(B8A+B04-2*off)`. Residuals give no sign of an offset error across the switch: the mean residual is -0.008 for 2019–2021 and +0.007 for 2022+. See risk 3.

## (2) S2 → MOD13Q1 cross-calibration: answered

**Method:**
- **S2 data.** For each S2 date, one PC data-API call with SCL 4/5 as clear returned the clear fraction, NDVI(B08), NDVI(B8A), NDMI(B8A/B11) and NDMI(B08/B11).
  - The offset was set per item from its baseline.
  - Dedupe kept one item per date, preferring 20KNF and then the newest generation.
  - Scenes needed a clear fraction ≥ 0.9. That left 766 of 1,495 scene-point rows (271, 236 and 259 per point).
- **S2 composite.** Max of the box-mean NDVI across clear scenes with dates in [MOD13Q1 start, start + 15 d], Terra only.
- **MODIS data.** Mean NDVI of pixels with `pixel_reliability == 0` whose centre is inside the box. Composites need ≥ 2 good pixels.
  - PC COG windows supplied the main series.
  - **ORNL filled the 2025 hole and supplied 19 pairs.**
- **Fit.** y = MODIS, x = S2 (maps S2 onto the MODIS scale, as in ADR-0002). Theil-Sen is the median of pairwise slopes.

| Fit (y = MOD13Q1 NDVI) | n | OLS slope | OLS intercept | R² | RMSE | Theil-Sen slope / intercept | Mean MODIS − S2 | RMSE if no calibration |
|---|---|---|---|---|---|---|---|---|
| **Pooled, S2 B8A** | **308** | **0.924** | **0.061** | **0.899** | **0.050** | **0.940 / 0.048** | +0.022 | 0.057 |
| Pooled, S2 B08 | 308 | 0.880 | 0.110 | 0.887 | 0.054 | 0.895 / 0.098 | +0.052 | 0.077 |
| Cuatro Canadas, B8A | 113 | 0.948 | 0.049 | 0.924 | 0.046 | 0.973 / 0.037 | +0.025 | 0.053 |
| Okinawa Uno, B8A | 91 | 1.024 | -0.013 | 0.940 | 0.036 | 1.025 / -0.015 | +0.001 | 0.036 |
| El Cusi, B8A | 104 | 0.867 | 0.105 | 0.842 | 0.058 | 0.892 / 0.084 | +0.038 | 0.073 |
| Wet season Dec–Mar, B8A | 63 | 0.853 | 0.109 | 0.870 | 0.055 | 0.859 / 0.104 | +0.020 | 0.063 |
| Apr–Nov, B8A | 245 | 0.939 | 0.053 | 0.895 | 0.049 | 0.949 / 0.042 | +0.023 | 0.055 |
| PC only (no ORNL pairs), B8A | 289 | 0.916 | 0.067 | 0.895 | 0.051 | 0.932 / 0.052 | +0.023 | 0.058 |

**Other results:**
- **Value range.** S2 B08 ranges from 0.14 to 0.88 and MODIS from 0.22 to 0.88.
- **B08 residuals by NDVI tercile.** The mean residual is about 0 in every tercile, so a linear fit is adequate. The raw bias against MODIS shrinks as NDVI rises: +0.074 in the low tercile, +0.051 in the mid tercile and +0.031 in the high tercile.
- **Pairs per year:** 39, 50, 44, 51, 31, 20, 35 and 38 for 2019–2026. The wet season contributes 63 of 308 pairs (20 %), which is just at the margin.
- **Recommendation:** use **NDVI from B8A** (the narrow NIR band, closer to MODIS band 2) with the **pooled Theil-Sen mapping `0.94·x + 0.05`**. Store per-farm fits when a farm has ≥ 30 pairs, because El Cusi differs from Okinawa by about 0.15 in slope.

## (3) Gaps and NDMI

**ORNL in the PC hole: verified.**
- `GET https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=..&longitude=..&band=250m_16_days_NDVI&startDate=A2025161&endDate=A2025305&kmAboveBelow=1&kmLeftRight=1` returned 200 at all 3 points.
- It returned 10 composites: 2025-06-10 → 2025-11-01, which includes all 8 hole dates from 2025-07-12 to 2025-11-01. Each composite is a 9x9 grid with `proc_date` set.
- At Cuatro Canadas, NDVI ran 0.48 → 0.26 → 0.33 through the dry season.
- 2025-11-01 had 0 good pixels at all 3 points (cloud), which is a data reality and not an outage.
- On the overlap, ORNL and PC values are identical: 0.5818 and 0.5917 at Cuatro Canadas, and 0.6693 and 0.6265 at El Cusi.
- **Full list of PC Terra holes at these points (2019 to 2026-10):** 2023-02-18, 2024-08-12, 2024-12-18, 2025-07-12 → 2025-11-01 (8 composites), and 2026-10-16. The last one is newest on ORNL but not yet indexed on PC.
- **Recommendation:** use PC as primary, plus an ORNL backfill for any composite in the ORNL `/dates` list that is missing on PC. ORNL alone is too slow for the main series (up to 29 s per 10-composite call).

**Long NDMI baseline: Landsat C2 L2 on PC, verified.**
- **Method.** PC data API with the expression `where(qa_pixel==21824, (nir08-swir16)/(nir08+swir16-14545.4545), 0)`.
  - That expression applies scale 2.75e-5 and offset -0.2 inside the ratio.
  - Landsat 8 and 9, 2018–2026, `eo:cloud_cover` < 80: 921 scene-points, of which 507 have ≥ 0.9 clear.
  - Paths: 230/072 for all three points, plus 231/072 for Okinawa and El Cusi.
- A bitmask expression (`qa_pixel & 26`) returned **HTTP 500**, so the exact clear value 21824 was used.
- **Fits (S2 NDMI B8A/B11 as x):**
  - Same day: n = 81, `Landsat = 1.030·x + 0.037`, R² 0.996, RMSE 0.009; Theil-Sen 1.032 / 0.038.
  - ±1 day: n = 212, R² 0.980, RMSE 0.019.
  - ±3 days: n = 359, R² 0.982, RMSE 0.019.
  - S2 NDMI from B08/B11 instead: same day 1.003·x + 0.073, R² 0.987, so a larger bias. **Use B8A/B11 for NDMI.**
  - NDVI check, same day: Landsat = 0.927·S2(B8A) + 0.063, R² 0.969.
  - NDMI range covered: -0.22 to 0.36. Pairs exist in every year from 2018 to 2026.
- **Recommendation:** NDMI baseline = Landsat C2 L2, with S2 NDMI(B8A/B11) mapped to the Landsat scale with the fit above.
  - Landsat on PC has history at these points from 1984-04-07 (LT05). The L8/L9 part used in this test starts 2013-03-25.
  - **L5/L7-to-L8 harmonisation for the pre-2013 baseline was not tested (verified = false).** L7 SLC-off stripes after 2003 reduce pixel counts.
- **MCD43A4 bands 2/6: not tested (verified = false).** The family notes already found it inside the same 2025 PC hole, and ORNL has no MCD43A4 for Bolivia. Landsat is therefore the better path.

## Recommended primary / fallback

| Variable | Primary | Fallback | Rule to code |
|---|---|---|---|
| S2 NDVI/NDMI current | PC data API statistics (SCL 4/5, ≥ 0.9 clear for a calibration-grade value) | Earth Search c1 COGs | offset by **baseline** on PC; always −1000 on c1; dedupe duplicates; treat a 500 as skip |
| NDVI baseline | PC MOD13Q1 COG windows, filtering ids by `MOD13Q1.` (not `platform`) | ORNL subset, keyless, for composites missing on PC | reliability 0, centre-in-box, ≥ 2 good pixels |
| S2 → MODIS mapping | Pooled Theil-Sen B8A: `0.94·S2 + 0.05` | Per-farm fit when n ≥ 30 | refit yearly |
| NDMI baseline | Landsat C2 L2 (PC, qa_pixel == 21824) | — (MCD43A4 untested) | S2 NDMI(B8A/B11) → Landsat: `1.03·x + 0.037` |

## Open risks

1. **Box-level MVC.** The S2 composite takes the max of box means, not a per-pixel MVC. The MODIS footprint (point spread function) extends beyond the 500 m box. On mixed-field farms such as El Cusi (R² 0.84), the pooled fit is weaker.
2. **Wet-season thinness.** Only 20 % of pairs are Dec–Mar, and that season's slope is 0.85, compared with 0.94 for the rest of the year. Peak-season stress is where calibration matters most. Consider season-specific coefficients after more farms are added.
3. **Small step across the baseline change.** Raw MODIS − S2 is +0.012 for 2019–2021 and +0.030 for 2022+. This is not the 1000-DN error (that would be about 0.15), but a 0.02 step could come from the 04.00 processor changes or from crop changes. The cause is not established. Check it on more farms before freezing the coefficients.
4. **The PC data API is best effort.** A 500 is returned for some granules, and the 2018+ Landsat L8/L9 run slowed to about 2 s per call late in the run.
5. **ORNL latency.** 4–29 s per 10-composite call. It is fine for backfill, not for bulk.
6. **The MOD13Q1 2026-10-16 composite** is on ORNL and not yet in PC STAC. The "as of" logic should take the newest composite from either source.
