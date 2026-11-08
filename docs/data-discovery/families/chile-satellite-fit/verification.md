# Adversarial verification: `chile-satellite-fit`

I re-probed everything live on 2026-11-07. I used no keys or accounts. I deliberately chose **new** places and dates, different from the researcher's:
- **New CIREN boxes:** Paine/Buin (RM, layer 60), San Felipe (V, 59), Rengo (VI, 61) and Los Ángeles (VIII, 64).
- **New test block:** a 4.32 ha CIREN `CEREZO` block at Buin (rol 390-37, centroid −70.783, −33.799).
- **New LST point and windows:** Paine, nights of May–Oct 2024 and Jun–Aug 2025.
- **Re-checks:** I also re-ran the S2-vs-Landsat comparison on the researcher's Requínoa block, and recomputed their LST statistics from `out_lst_frost.json`.

The probe scripts and raw outputs are in the session scratchpad, not in this folder.

## Verdict summary

| # | Claim | Verdict |
|---|---|---|
| 1 | CIREN Catastro Frutícola is keyless and gives species per block (layers 55–68, 2,000 per page) | **confirmed** |
| 2 | CIREN is a census of plantings ≥ 0.5 ha, with a median block of 1.2–2.5 ha | **corrected**: 6.3 % of blocks are < 0.5 ha (smallest 0.017 ha); the median in the new boxes is 2.2–3.6 ha |
| 3 | CIREN licence: "public, terms not found" | **unverifiable**: `copyrightText`, WMS `Fees` and `AccessConstraints` are all empty, and the IDE terms page is 404 |
| 4 | A CIREN species label means a cherry/avocado canopy you can score | **corrected**: the first cherry block I pulled (2025 vintage) is at NDVI 0.17–0.44, against 0.47 in 2019 |
| 5 | Sentinel-2 L2A on PC: keyless, history from 2015-08-08 at 19HCC, latest 2026-11-03, one relative orbit | **confirmed** |
| 6 | S2 DN offset: subtract 1000 only when `s2:processing_baseline` ≥ 04.00 | **confirmed** |
| 7 | Landsat C2 L2 on PC: keyless, from 1984-12-24, latest 2026-11-02, scene-level clear counts | **confirmed** |
| 8 | Landsat 30 m is cross-calibrated to S2, so it can serve as the long baseline for 1–3 ha blocks | **corrected**: a global offset only works for dense canopy. On a sparse 4 ha block, Landsat reads +0.06 to +0.16 above S2 |
| 9 | MODIS LST on PC: daily, from 2000, ~2-day latency | **corrected**: latency and history start are confirmed, but **PC has no LST items for 2025-07 to 2025-11** (and no MOD13Q1 items for 2025-07 to 2025-10). NASA CMR has those granules |
| 10 | LST is valid on about 25 % of nights | **corrected**: the figure depends on site and year. Paine May–Oct 2024 gave 43–46 % (20–61 % per month) |
| 11 | LST vs station Tmin: r 0.946, bias −0.23, RMSE 1.28 (Aqua) | **confirmed**: it reproduces exactly, and filtering on the LST-error QC improves it to r 0.962, RMSE 1.12 |
| 12 | Aqua frost F1 0.91 at −1.5 °C | **corrected**: the −1.5 °C threshold was chosen on the same 6 frost nights it is scored on. At a fixed 0 °C, F1 is 0.71 |
| 13 | IDE Minagri GeoServer is 404, so reject it | **confirmed**. A CIREN WMS (200) exists as an alternative |
| 14 | Earth Search C1 as the S2 fallback | **confirmed, with a caveat**: it is keyless, 200 in 0.24 s and has the latest item 2026-11-03, but its archive at this point starts **2017-11-20**, not 2015 |
| 15 | PC rate limits: "none observed" | **unverifiable** from docs (the PC terms page rendered empty). Empirically, 0 non-200s in about 450 calls at 4 threads |
| 16 | Santa Cruz coverage | CIREN has **0** features in the Bolivian farm box, because it is Chile-only. PC S2, Landsat and MODIS all cover Santa Cruz (latest 2026-11-04, 2026-10-28 (T2) and 2026-11-05) |

## Evidence

### CIREN Catastro Frutícola (`esri.ciren.cl/.../IDEMINAGRI/CATASTRO_FRUTICOLA/MapServer`)

**Service metadata:**
- `?f=json` returns 200 in 0.73 s: `maxRecordCount` 2000, capabilities `Query,Map,Data`, ArcGIS 11.5, pagination supported.
- Layers 55–68 are "PRODUCTORES FRUTÍCOLAS". Vintages: Arica and Tarapacá 2022, Atacama to Los Lagos 2024/2025, Aysén 2022.
- Fields: `objectid, gid, mslink, desccomu, rolpredi, especie_01..04, comudere, provdere, regidere`. There is **no area, planting year, variety or irrigation field**.
- Native SR is 3857, and `outSR=4326` with `f=geojson` works.

**Queries in new ~10 km boxes (all keyless):**

| Box | Layer | HTTP | Time | Blocks | Median ha | p90 ha | Smallest ha | Top species |
|---|---|---|---|---|---|---|---|---|
| Paine | 60 | 200 | 4.6 s | 599 | 3.33 | 7.9 | 0.072 | CEREZO 235, NOGAL 96, VID DE MESA 84 |
| San Felipe | 59 | 200 | 4.9 s | 732 | 2.21 | 4.9 | 0.017 | VID DE MESA 392, DURAZNERO CONSERVERO 129 |
| Rengo | 61 | 200 | 4.8 s | 494 | 3.60 | 8.2 | 0.15 | CEREZO 232, NECTARINO 48 |
| Los Ángeles | 64 | 200 | 4.1 s | 54 | 2.53 | 6.2 | 0.49 | ARÁNDANO 41 |

- Across 1,825 blocks, **115 (6.3 %) are < 0.5 ha**, so the "≥ 0.5 ha census" wording is wrong. They may be slivers or sub-blocks.
- Blocks are still far below MODIS 250 m pixel size (6.25 ha), which supports the researcher's "MODIS mixes blocks".

**Other folders and services:**
- The `Catastro_Fruticola` and `OBSERVATORIO` folders return `{"code":499,"Token Required"}`. Confirmed.
- **Bonus 1:** `IDEMINAGRI/PROPIEDADES_RURALES/MapServer` is keyless. It holds rural property polygons with field `rol`; layer 7 (Maule 2021) returned 72 parcels in a 2 km box at Curicó in 3.7 s. Layer vintages run from 2013 to 2023. This is a better fallback for non-fruit farms than "drawn by the user": the bank can match the `rol`.
- **Bonus 2:** `USO_DE_LA_TIERRA_CIREN` (land use, 2019–2026 vintages) is map-only. A query returns 400 "No está permitida la capacidad solicitada".
- **Bonus 3:** `SEGURO_AGRICOLA` (crop-insurance claim layers, 2017) is listed, but I did not probe it.
- WMS at `esri.ciren.cl/server/services/IDEMINAGRI/CATASTRO_FRUTICOLA/MapServer/WMSServer` returns 200 in 4.6 s.
- `ide.minagri.gob.cl/geoserver/ows` and `/wms` return 404, which confirms the reject.

**Licence:** every licence field is empty, and `ide.minagri.gob.cl/terminos-y-condiciones/` is 404. **Commercial use is unconfirmed.** It is safe for a hackathon demo, but needs a written OK from CIREN before production.

**Label vs canopy:** the Buin `CEREZO` block (2025 vintage, 4.32 ha) has these S2 NDVI values:
- 2019-01-19: 0.47.
- Nov 2025–Apr 2026: 0.41–0.44 in Nov–Dec, falling to 0.17–0.25 in Feb–Apr.

This is not a healthy cherry canopy, which on the Requínoa block reached 0.70–0.78 in Mar–Apr. Possible causes are a replant, a removed block or a stale label; I did not resolve which. On a naive same-month baseline, the anomaly score would flag it as severe stress. So the product needs a **canopy-maturity / is-it-still-an-orchard gate** before scoring.

### Sentinel-2 L2A on Planetary Computer

**Archive at the Buin block (tile 19HCC):**
- STAC first item `S2A_MSIL2A_20150808T144816_R096_T19HCC_20210411T191030`, processing baseline 02.12.
- Latest item `S2B_MSIL2A_20261103T143749_R096_T19HCC_...`, baseline 05.13. Search took 0.55 s.
- In 2025 there were 84 items on 84 unique dates, all relative orbit 96, from S2A, S2B and S2C. That is about 7 per month.
- No monthly gaps from 2025-01 to 2026-11. Collection licence: `proprietary`, linking to the Sentinel terms.

**DN offset:**
- Raw B04 over the block is ~893 at pb 02.12 (2019) and ~2,400 at pb 05.11 (2026).
- With the −1000 offset, red reflectance is 0.138, which is plausible. Without it, red would be 0.238, which is not.
- So the per-item offset rule is correct and essential.

**Data API statistics:** with a CIREN polygon, `/item/statistics` returned 200 in 0.5–0.76 s per call. One call per scene with `;`-separated expressions works.

### Landsat C2 L2 on PC

**Archive:**
- Buin: first `LT05_L2SP_233083_19841224`, latest `LC09_L2SP_233084_20261102`.
- Requínoa: 1,256 items on 1,248 unique dates, almost all WRS 233/084. At Buin, rows 083 and 084 overlap, so **deduplicate by date**.
- Scene-level < 30 % cloud views per month (2000–2025, items): Jan 2.9, Feb 2.5, Mar 2.7, May–Jul 1.1–1.2. This matches the researcher.
- Thin early years: 1984 has 1 date, 1985 1, 1987 4 and 1995 7.

**Polygon-level QA:** clear views are lower than scene-level counts. In Feb 2005 at Buin, 2 of 4 scenes had 0 clear pixels over the block.

**Cross-sensor check (same-week pairs, Nov 2025–Apr 2026, both ≥ 95 % clear):**

| Block | Landsat − S2 NDVI | Notes |
|---|---|---|
| Requínoa, 19.75 ha dense cherry | −0.02 to +0.02 on 15 pairs | One outlier: 2026-04-24 Landsat 0.61 vs 2026-04-22 S2 0.79 |
| Buin, 4.32 ha sparse cherry | **+0.06 to +0.16 on every one of ~32 pairs** (e.g. 2026-01-26 LS 0.415 vs 2026-01-27 S2 0.253) | Inner −30 m buffer still gives LS 0.32 vs S2 0.22 |

- **Footprint mismatch:** the data API counts 70 Landsat pixels (~6.3 ha) over a 4.32 ha polygon, against 487 S2 pixels (4.9 ha).
- **Not only edges:** the bias persists inside the inner buffer, so it is not only edge mixing.
- **Reflectances:** S2 red is 0.138 against Landsat red 0.113.
- **Conclusion:** the inter-sensor offset depends on NDVI level and block. "MODIS = 0.148 + 0.794·S2"-style single fits from one dense block do not transfer. Landsat→S2 calibration must be fitted **per block** on the 2015/2017–2026 overlap, using windowed medians, not single scenes.

### MODIS MOD11A1/MYD11A1 LST on PC

**Archive and latency:**
- Collection extent starts 2000-02-24. First item `MOD11A1.A2000055`.
- Latest `MYD11A1.A2026309` (start 2026-11-05) on 2026-11-07, so latency is ~2 days. Confirmed.
- `item.datetime` is None; use `start_datetime`. Confirmed.
- **`platform` is an empty string on 44 % of items** (530 of 1,215). Filter on the id prefix (MOD/MYD), not on `platform`.

**The gap:**
- Per-month item counts at Paine show **zero LST items for 2025-07 through 2025-11**. 2025-06 has 60, then nothing until 2025-12 (60).
- `modis-13Q1-061` has the same hole for 2025-07..2025-10.
- NASA CMR (keyless) returns **153 MYD11A1 granules and 10 MOD13Q1 granules** for 2025-07-01..2025-11-30 at the same point. The data exists upstream; the PC copy is missing it.
- This hits ADR-0002 directly: it cuts the start of the 13-month display window, and it removes the 2025 year from every Jul–Nov same-time-of-year baseline.
- S2 and Landsat on PC have no such gap.
- `hls2-s30` on PC is also thin in 2026: 1 item in Mar, 2–3 in May–Sep, against 4–8 per month in 2025. Do not rely on it as the gap-filler without checking upstream.

**Validity at Paine (May–Oct 2024, 365 point reads, all HTTP 200, 58.6 s at 4 threads):**
- Terra valid on 46 % of nights, Aqua on 43 %. Monthly values range from 20 % (Jun) to 61 % (Jul).
- Jun 2025 had 6 nights per sensor with QC-coded items, and 4 and 2 of them were valid.
- Units: raw × 0.02 − 273.15 °C; fill value 0. Confirmed.

**Recomputing the researcher's Curicó stats from their rows:**
- Correlation statistics reproduce exactly: MYD r 0.946, bias −0.23, RMSE 1.28, n 39.
- With the LST-error ≤ 2 K QC filter: r 0.962, RMSE 1.12, n 31.
- Pairing Tmin with D+1 makes both sensors worse, so the same-day pairing they used is right.
- Frost detection:
  - The threshold was the F1-maximising value on the same data, with 6 frost nights.
  - At a fixed 0 °C, Aqua gives TP 5, FP 3, FN 1 (**F1 0.71**).
  - At −1.5 °C, Terra gives TP 1, FN 6.
  - So the 0.91 figure is optimistic and in-sample.

### Santa Cruz (Bolivia) cross-check

- CIREN returns a count of 0 at (−62.52, −16.86), as expected.
- PC latest items there:
  - S2: `T20KNG` 2026-11-04.
  - Landsat: `LC09 230/072` 2026-10-28 (Tier 2).
  - MODIS: `h12v10` 2026-11-05.

## Recommendation changes

1. **MODIS on PC cannot be the only MODIS path.** Detect missing dates by comparing PC with CMR. Fill the 2025-07..11 hole from ORNL MODIS subset (keyless, slow) or LP DAAC (free Earthdata login). Failing that, flag the hole and exclude 2025 from Jul–Nov baselines. This applies to both the Chile and Santa Cruz pipelines.
2. **Landsat→S2 calibration must be per block** (or NDVI-dependent) on the overlap years, with windowed (monthly) medians. Do not use one global equation. Deduplicate Landsat by date where WRS rows overlap, and count clear views at polygon level with `qa_pixel`, not scene `eo:cloud_cover`.
3. **Add a canopy-maturity gate before scoring CIREN blocks.** For example, require a recent peak-season S2 NDVI ≥ 0.5 and no step change. The species label alone is not enough.
4. **Use `PROPIEDADES_RURALES` (keyless, `rol`)** as the fallback polygon source for non-fruit Chilean farms, ahead of hand-drawn polygons. Treat CIREN commercial-use terms as an open legal question.
5. **Frost:** keep MODIS LST as the cold-pool downscaler only. Quote its skill as F1 ~0.7 at a fixed 0 °C (n is tiny), and quote validity as 25–45 % of nights depending on site.
6. **Earth Search C1 is fine as a latency fallback,** but its archive here starts 2017-11. Keep PC for the 2015–2017 baseline years.
