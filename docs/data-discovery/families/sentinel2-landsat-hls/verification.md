# Verification: Sentinel-2, Landsat and HLS current imagery

**Role:** adversarial verifier.
**Date:** 2026-11-07. This is the second pass.
**Credentials:** none. No accounts, keys or credentials were used.

**Why a second pass:** the first pass (00:35 UTC) could not reach Planetary Computer (PC), so it
marked every PC claim "unverifiable". At 07:00–07:40 UTC PC answered normally (STAC 200 in
0.39 s, SAS token 200 in 0.36 s). All PC claims below are now verified live. The outage was
transient and local, but it still argues for automatic failover.

**Coordinates:** these differ from the researcher's farms.
- **V1 "south":** (-62.62, -17.45), MGRS 20KNF, between Cuatro Cañadas and Pailón. One orbit (R010).
- **V2 "north":** (-63.05, -16.70), MGRS 20KMG, where orbits R010 and R053 overlap.
- **Haze check point:** (-62.45, -16.92), MGRS 20KNG.

**Polygons:** 0.01° squares (about 1.1 km x 1.1 km). The large-polygon test used a 0.1° square.

**Probe scripts:** these ran from the session scratchpad. Only this file is written here. The
researcher's `s2lib.py` was used read-only.

## 1. Planetary Computer: live results (new in this pass)

| Probe | Result |
|---|---|
| STAC search, last 60 d, `sentinel-2-l2a` | **V1:** 200 in 0.71 s, 15 items / 15 dates, latest 2026-11-02. **V2:** 200 in 0.82 s, 37 items / 30 dates, latest 2026-11-05. The counts match Earth Search c1 exactly. |
| S2 history (sort ascending) | **V1:** 2015-10-21 (`S2A_MSIL2A_20151021T142012_R010_T20KNF_20210412…`). **V2:** 2015-08-25. |
| Unsigned blob GET | **409** `PublicAccessNotPermitted` |
| SAS token `/api/sas/v1/token/{coll}` | 200 for sentinel-2-l2a, hls2-s30 and landsat-c2-l2, with no key. The token carries `msft:expiry` about 40–60 min ahead. Signed range GET: **206** in 0.55 s. |
| PC ingest latency (signed HEAD, blob `Last-Modified`) | 11-02 14:17 → 21:11 (**6.9 h**). 11-04 14:20 → 11-05 00:50 (**10.5 h**). 11-05 14:27 → 21:37 (**7.2 h**). Earth Search c1 items were `created` after **4.4–4.8 h** (11-02 19:04, 11-05 19:00). |
| PC S2 items per year at V1 (items / dates) | 2016: 17/17, 2017: 25/25, 2018: 69/69, 2019: 71/70, 2020: 71/71, 2021: 75/71, **2022: 108/72**, **2023: 117/72**, 2024: 71/70, 2025: 84/83, 2026: 72/72. **There is no 2022 hole on PC** (Earth Search c1 has only 5 items there). |
| Processing baselines on PC at V1 | 2016–2020 are mostly 02.12/03.00, **but 2019-03-09 also has a 05.00 copy**. 2021 is mixed 02.12/03.00/04.00. In 2022–2023, 04.00 sits next to 05.09/05.10 reprocessings. **87 duplicate date/tile pairs** (for example 2021-12-08 03.00 and 04.00, 2022-03-08 04.00 and 05.10). |
| Item metadata | PC S2 items have **no `raster:bands` scale or offset** and no `created` field. The offset must come from `s2:processing_baseline`. |

### DN offset and cross-host checks (client reads, V1, B04/B08/B11/SCL)

| Date | Host / baseline | Red median DN | Clear | NDVI | NDMI | Read time |
|---|---|---|---|---|---|---|
| 2026-11-02 | PC 05.13 (−1000) | 2196 | 0.662 | 0.4933 | −0.0282 | 4.3 s |
| 2026-11-02 | Earth Search c1 05.13 (−1000) | 2196 | 0.662 | 0.4933 | −0.0282 | 5.3 s |
| 2019-07-17 | PC **02.12** (no offset) | **1812** | 0.688 | 0.3212 | −0.0002 | 5.7 s |
| 2019-07-17 | Earth Search c1 05.00 (−1000) | 2856 | 0.659 | 0.3181 | 0.0044 | 4.8 s |

- **2026:** the two hosts are bit-identical.
- **2019:** they differ. The two products have different baselines, and the DN gap is 1044, not
  exactly 1000. NDVI differs by 0.003 and the clear fraction by 0.03.
- **Effect:** the PC "no offset before 04.00" rule holds. A mixed-host S2 history will carry a
  small baseline drift, which is negligible next to seasonal z-scores.

### Data API (`/api/data/v1/item/statistics`), V1 2026-11-02 (20KNF)

| Test | Result |
|---|---|
| Masked NDVI `where(SCL∈{4,5,6},(B08-B04)/(B08+B04-2000),0)` | 200 in 0.65 s, count 11,990 (10 m) |
| SCL-only clear expression | 200 in 0.46 s, count **3,080 (20 m grid)**, mean 0.6601 |
| Clear expression forced to 10 m (`…+B04*0`) | 200 in 0.54 s, count 11,990, sum 7,925 (0.6610) |
| Masked mean, researcher method (sum / (clear_frac_20m × count_10m)) | **0.4941** |
| Masked mean, 10 m clear count | **0.4934** (client read: 0.4933) |
| **One call with three `;`-separated expressions** (NDVI; NDMI; clear@10 m) | **200 in 1.05 s**: NDVI 0.4934, NDMI −0.0295, clear 0.661 |
| `B04-B08` (integer underflow test) | min −5853, max 1103. **The arithmetic is signed. No uint16 wrap.** |
| Unmasked NDVI | min −5.33: the denominator is near 0 on dark pixels, so always mask |
| `nodata=-9999` with `where(…, -9999)` | **HTTP 500** (reproduced) |
| SCL `categorical=true` | 200 in 0.33 s, with a histogram |
| 0.1° polygon (about 11 km) | `max_size=1024`: 1.71 s, 1,048,576 px, NDVI 0.4685. Without `max_size`: 2.71 s, 1,173,972 px, NDVI 0.4684 |
| Burst test, 40 calls on 4 threads | 40 × 200, wall time 4.5 s, slowest call 0.58 s. No rate-limit headers were returned. |

### HLS on PC

| Probe | Result |
|---|---|
| `hls2-s30` / `hls2-l30`, last 60 d | **V1:** S30 9 items (latest 11-02), L30 4 items (latest 10-20). **V2:** S30 22 items / 17 dates, L30 6 items (latest 10-27). |
| History on PC | S30 **2020-01-03** (V1), 2020-01-01 (V2). L30 **2017-08-24** (V1), 2017-08-31 (V2). The `hls2-s30` collection extent says 2020-01-01. LP DAAC itself has S30 from 2016-06-27. |
| PC against NASA CMR-STAC (keyless metadata), V1, 60 d | S30: CMR 10, PC 9 (**2026-10-13 missing on PC**). L30: CMR 5, PC 4 (**2026-09-10 missing**). These are real mirror holes in the middle of the window, not just lag. |
| CRS / scale | **EPSG:32620** (read from the COG), scale 1e-4, offset 0, nodata −9999 |
| Fmask at the haze point, 2026-09-15 (`HLS.S30.T20KNG.2026258…`) | Bit 1 (cloud) **0.998**, aerosol = high on 100 %, clear (bits 1–4 = 0) **0.0**. This confirms the claim at a different point. |
| HLS blue on 2026-09-15 | median **0.086** (S2 L2A gave 0.218). HLS NDVI was 0.397 (neighbours 0.42–0.44). LaSRC corrected the haze that Sen2Cor left in. |
| S30 against raw S2 NDVI, 2026-09-25 at the haze point | Raw S2: B08 **0.3548**, B8A **0.4025**. HLS S30 (B8A) **0.4372**. |

**Reading the last row:**
- The bias against B08 is +0.08.
- About +0.048 of it comes from the band choice (B8A against B08).
- About +0.035 comes from HLS processing (30 m, LaSRC, BRDF and the bandpass adjustment).

### Landsat C2 L2 on PC

| Probe | Result |
|---|---|
| Last 60 d | **V1:** 7 items, latest 2026-10-28 (T2). **V2:** 12 items / 6 dates, latest 2026-10-19. History from 1984-04-07 (V1) and 1984-04-30 (V2). |
| PC `created` | Every Sep–Oct scene is stamped 2026-11-05 or 11-06 (a bulk re-index), so it says nothing about latency. USGS product IDs show processing 2–10 days after acquisition (230072 20261028 → 20261031; 20261012 → 20261022). |
| Missing scenes | Path 231 2026-10-27 and 11-04 are absent from PC, USGS and Earth Search. The HLS **L30 does have 2026-10-27 at V2**, so the acquisition exists and the C2 L2 product is lagging. |

## 2. First-pass results that still stand (Earth Search, USGS, CMR; re-checked where noted)

- **Earth Search c1:**
  - Keyless: COG range GET 206 in 0.36 s.
  - Re-checked today: V1 15 items, latest 11-02; V2 37 items, latest 11-05.
  - History starts 2018-01-06 (V2) and 2018-02-07 (V1).
  - **2022 is missing**: 5 items at V1 and 12 at V2, all `created` 2024-01-11 as a one-off
    backfill, so the hole is likely permanent.
  - The c1 offset of −0.1 is correct on every date (2018 and 2019 are baseline 05.00).
- **Earth Search legacy `sentinel-2-l2a`:**
  - History starts 2017-01-03.
  - It has `_0_`/`_1_` duplicates for 2018–2021.
  - It has a double-offset trap: `boa_offset_applied=True`, yet it still declares offset −0.1.
- **Landsat on AWS:** unsigned HTTPS returns 403 (requester-pays).
- **Haze at the haze point on 2026-09-15:**
  - SCL said 99.7 % clear and the S2 cloud probability was 0.
  - S2 L2A blue was 0.218 (about 0.09–0.10 on nearby dates) and NDVI was 0.236 (about 0.35).
- **Rainy season at V1 (Dec-2025 to Mar-2026):**
  - About 1.5 usable dates (≥50 % clear) per month.
  - Gaps of up to 40 d.
  - The polygon test keeps 1.5x the scenes of the tile `eo:cloud_cover < 30` filter.
- **Copernicus licence:** free, full and open, commercial use allowed, with attribution
  ("Contains modified Copernicus Sentinel data [Year]"). PC STAC `license` is "proprietary" and
  links to the Copernicus T&C (S2), the LP DAAC policy (HLS) and the USGS policy (Landsat). The
  underlying data licences therefore apply.

## 3. Verdicts per claim

| # | Claim | Status | Evidence / correction |
|---|---|---|---|
| 1 | PC S2/HLS/Landsat are keyless via an anonymous SAS token | confirmed | Unsigned 409, token 200 with no key, signed 206. The token expires in under 1 h: cache it and refresh it on expiry or on a 403. |
| 2 | PC rate limits are undocumented, and anonymous access is stricter outside West Europe | confirmed | No numbers and no rate-limit headers were seen. The PC docs page is JS-rendered and could not be re-read this pass; the wording comes from the first pass (docs snippet). |
| 3 | Data API item/statistics takes 0.3–0.9 s and is about 15x faster than client reads | corrected | 0.33–0.93 s per call, but client reads took 4.3–5.7 s today. That is about 5–10x per call, and about 4–5x for one 3-expression call (1.05 s) against one client read. |
| 4 | Masked mean = sum / (clear_frac × 10 m count) | corrected (minor) | 0.4941 against 0.4934 (10 m count) against 0.4933 (client): the error is about 0.001. Put a 10 m clear count in the same multi-expression call. |
| 5 | `nodata=-9999` gives HTTP 500 | confirmed | 500 reproduced. |
| 6 | PC S2 history starts 2015-10-21 at the farm | confirmed | 2015-10-21 at V1 (same orbit R010). 2015-08-25 at V2. Dense from 2018 (about 70 dates a year at V1); sparse in 2016–2017 (17 and 25 dates). |
| 7 | Subtract 1000 DN per item when `s2:processing_baseline` is 04.00 or later; pre-2022 PC has no offset | corrected | The per-item rule is right, but "pre-2022" is not a safe proxy. PC holds 05.00 and 04.00 reprocessings dated 2019 and 2021 next to 02.12/03.00 originals. Verified: 2019-07-17 at 02.12 has red 1812 with no offset. Key only on the item's baseline. |
| 8 | S2 latency under 8 h | corrected | The researcher used ESA `s2:generation_time`, which is not PC availability. PC blob `Last-Modified` came 6.9 h, 7.2 h and **10.5 h** after acquisition. Earth Search c1 came after 4.4–4.8 h, so the fallback is fresher than the primary. |
| 9 | About 3-day revisit | corrected | Depends on the site: about 4 d at V1 (one orbit, 15 dates in 61 d) and about 2 d at V2 (orbit overlap, 30 dates). |
| 10 | Earth Search c1 is keyless with public COGs | confirmed | 206 with no signing. |
| 11 | Earth Search c1 history 2018-02-07 ("to confirm") | corrected | 2018-01-06 (V2) and 2018-02-07 (V1). 2022 is almost missing (5 and 12 items, backfilled in 2024). PC has the full 2022, so PC is the better history host. |
| 12 | The c1 raster:bands offset −0.1 holds on old dates too | confirmed | 2018 and 2019 items are baseline 05.00, and the DN are +1000. |
| 13 | Earth Search legacy: double-offset trap, history 2017-01-03 | confirmed, extended | The trap is real. The collection also has duplicate `_0_`/`_1_` items for 2018–2021. |
| 14 | The PC HLS mirror has missing dates (11 S30 against 19 S2) | corrected | Most of the gap is HLS skipping scenes over 95 % cloud. PC is still 1 granule short against CMR for both S30 and L30 at V1 (10-13 and 09-10 missing mid-window). Real but small (about 10 %). |
| 15 | HLS on PC: S30 from 2020, L30 from 2017 | confirmed | S30 2020-01-03 and L30 2017-08-24 at V1. LP DAAC has S30 from 2016-06-27; the data needs a free Earthdata login. |
| 16 | Fmask caught haze that SCL passed (2026-09-15) | confirmed | At a different 20KNG point, Fmask cloud bit = 0.998 and clear = 0. SCL = 0.997 clear. |
| 17 | The polygon clear fraction keeps about 5x more scenes than the tile filter | corrected | 1.5x at V1 and 1.4x at Mineros (researcher's figures). The 5x is specific to Tajibos. |
| 18 | Rainy season: about 2 usable scenes per month, gaps up to 42 d | confirmed | V1: 1.5 per month, maximum gap 40 d. |
| 19 | Dedupe on date and tile, keeping the latest generation_time | corrected | Needs two rules: (a) same `s2:datatake_id` (a reprocessing; 87 pairs at V1 on PC) → keep the highest baseline or latest generation_time; (b) different datatakes on the same date and tile (V2 2026-09-18) → keep the most valid polygon pixels, then the best clear fraction. |
| 20 | Landsat C2 L2: history 1984, latency about 3 d, 7 items in 60 d | confirmed, with a caveat | History and counts confirmed. USGS latency is 2–10 d. PC `created` is a bulk re-index, so PC latency is unknown. The path 231 10-27 scene exists in HLS L30 but not in C2 L2 on any host. |
| 21 | Landsat: recent scenes start in tier T2 | corrected | T2 is a quality tier. A 26-day-old scene was still T2. Mask with `qa_pixel` and do not drop T2. |
| 22 | Landsat on AWS is requester-pays | confirmed | 403. |
| 23 | Copernicus licence: free and open, with attribution | confirmed | Commercial use is allowed. The PC `license` link points to the Copernicus T&C. |
| 24 | Microsoft PC terms; the data API is best-effort | unverifiable | The terms page is JS-rendered and the web-search budget was exhausted. No SLA was found. Treat it as best-effort. |
| 25 | S30 NDVI is about 0.04 above raw S2 because of harmonisation | corrected | Against B08 the bias is +0.08. About +0.048 is band choice (B8A against B08) and about +0.035 is HLS processing. Use one NIR band consistently in cross-calibration. |
| 26 | HLS is in EPSG:32620 | confirmed | Read from the COG. Still read the CRS per file rather than hard-coding it. |
| 27 | PC and Earth Search c1 return identical values | corrected | Identical for 2026 scenes (DN, clear and NDVI to 4 decimals). Not identical for 2019: PC 02.12 against c1 05.00 differ by 1044 DN, 0.003 in NDVI and 0.03 in the clear fraction. |

## 4. Recommendation changes

1. **Keep the PC data API as the primary** for speed, but use **one multi-expression call per
   scene**. The call is `NDVI;NDMI;clear@10m`, 1.05 s, and the masked mean is `sum_i /
   sum_clear`. Never use `nodata=-9999`.
2. **Make Earth Search c1 an automatic fallback** for two cases:
   - **Latency:** for the newest scene, ES was 3–6 h earlier than the PC blob write.
   - **Outage:** PC was unreachable for part of the night.
   - **History:** do not use c1 for history, because it has no 2022.
3. **Use PC for the S2 history**, which is complete from 2016 with no 2022 hole. Choose the DN
   offset per item from `s2:processing_baseline`, never by date.
4. **Dedupe with the two-rule scheme in verdict 19.** At V1 on PC, 2022 has 108 items over 72
   dates and 2023 has 117 over 72.
5. **Cache the SAS token** using `msft:expiry`, which is under 1 h ahead. Refresh it on a 403.
6. **Haze test:**
   - **S2 L2A:** add a blue (B02) check: polygon median above about 0.15–0.18, or more than 2x
     the neighbouring clear dates. SCL and the cloud probability both missed 2026-09-15.
   - **HLS:** this check would miss there, because LaSRC already removed the haze (blue 0.086).
     Use Fmask, including the aerosol bits.
7. **HLS:** use B8A for both sensors when comparing S30 with raw S2. Check PC completeness
   against the keyless CMR-STAC listing. PC dropped 1 of 10 S30 granules in 60 d.
8. **ADR wording:**
   - Revisit is 2–4 d.
   - PC latency is 7–11 h; ES latency is about 4.5 h.
   - The clear-fraction gain is 1.4–5x, depending on the site.

## 5. Open risks

- **PC:** it is a best-effort service with no published SLA or rate limits. It was briefly
  unreachable from this workstation.
- **Tile edges:** polygons that straddle two MGRS tiles are untested. The item statistics run
  per item, so the wrapper must merge them.
- **Landsat C2 L2 path 231 lag:** scenes from 10-27 onwards are missing. The cause is unknown.
- **Legacy collection:** ESA is retiring old-baseline products, so Earth Search legacy and the
  PC 02.12 items may change or disappear.
- **Mixed-baseline S2 history:** values drift by about 0.003 NDVI. This is acceptable for z-scores
  but must be documented.

**Retired from the first pass:**
- Integer arithmetic in the data API is signed, so there is no uint16 wrap.
- `max_size` downsampling on an 11 km polygon changed NDVI by only 0.0001.
