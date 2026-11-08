# ADR-0007: Vegetation pipeline (NDVI, NDMI): long baseline plus Sentinel-2 current

- **Status:** Accepted. One parameter (the NDVI sd floor, D6) is Proposed.
- **Date:** 2026-11-06
- **Builds on:** [ADR-0002](0002-v1-real-data-architecture.md) D4, D5; [ADR-0003](0003-market-scope-and-sample-portfolios.md)
- **Evidence:** `CATALOG.md` (satellite imagery and NDVI pipeline; interpolation and gap-filling),
  `followups/04-s2-modis-calibration.md`, `followups/02-farm-relocation.md`,
  `families/modis-viirs-ndvi`, `families/sentinel2-landsat-hls`, `families/chile-satellite-fit`,
  `families/gapfill-fusion`

## Context

Crop greenness (NDVI) is the one signal that looks at the crop itself rather than at the weather. A
lender reads it as "is the crop growing like it normally does at this date?". ADR-0002 D4 planned a
MODIS baseline since 2000 plus a Sentinel-2 current value, cross-calibrated. Discovery confirmed that
plan for Bolivia and found it does not work for Chilean orchards, which are far smaller than a MODIS
pixel.

Clouds matter for the demo: in the Santa Cruz rainy season (Dec–Mar), a field gets only 1.5–2.5 clear
Sentinel-2 views a month, with gaps of 30–42 days. The app must say how old the last clear look is.

## Decisions

### D1. Sources per region

| Role | Bolivia | Chile | Evidence |
|---|---|---|---|
| Current NDVI / NDMI | Sentinel-2 L2A, Planetary Computer (PC) data API `item/statistics`, one call per scene | same | Verified live: 1,495 calls, 0 errors, median 0.53 s (follow-up 04); 0 errors at 4 Chile sites (chile-satellite-fit) |
| Current failover | Earth Search `sentinel-2-c1-l2a` (3–6 h fresher; archive from 2017-11 / 2018-02 on 20KNF) | same | Verified live |
| Long NDVI baseline | **MODIS MOD13Q1/MYD13Q1** on PC, COG window reads, 2000– | **Landsat C2 L2** on PC (30 m, 1984–), calibrated to Sentinel-2 per block, plus Sentinel-2's own history from 2015 | Bolivia fields have 12–16 MODIS pixel centres (follow-up 02). In Chile only **2–3 % of orchard blocks** contain one MODIS pixel that is ≥ 80 % orchard (median block 1.2–3.6 ha) |
| MODIS backfill | ORNL subset REST for PC holes (2025-07-03 → 2025-11-16): verified for all 8 composites, values identical to PC | MODIS only where a pixel is ≥ 80 % one block | Follow-up 04 (verified) |
| Long NDMI baseline | Landsat C2 L2 NIR/SWIR1: `Landsat NDMI = 1.030·S2 NDMI(B8A/B11) + 0.037`, R² 0.996, n = 81 | same | Follow-up 04 (verified). Landsat 5/7/8 harmonisation untested |
| Licence | Copernicus, NASA, USGS: commercial OK with attribution | same | CATALOG licence table |

This supersedes ADR-0002 D4 ("MODIS baseline per field") for Chile.

### D2. Sentinel-2 polygon statistics, one call per scene

Expression (three outputs in one call):

```
where((SCL==4)|(SCL==5)|(SCL==6), (B8A-B04)/(B8A+B04-2000), 0); ...NDMI...; clear*1.0 (+B04*0)
```

- NDVI = mean(masked NDVI) / mean(clear). Skip the scene if the clear fraction inside the polygon is
  below 0.5. SCL 3 (cloud shadow) counts as not clear.
- `+B04*0` forces the clear count onto the 10 m grid; without it SCL is evaluated at 20 m.
- Never pass `nodata=-9999` or a NaN fallback: both return HTTP 500.
- Use **B8A**, not B08: mean bias +0.022 against +0.052 when compared with MODIS.
- Filter on polygon-level SCL, not on the tile `eo:cloud_cover < 30 %`: it keeps 1.4–5× more scenes.
- SCL misses thin haze (2026-09-15 passed as 99 % clear). Add a temporal spike check: reject a scene
  whose NDVI drops sharply from both neighbours and recovers. The 0.15 cut-off is our proposal and is
  untested; a B02 brightness check is the alternative.

### D3. DN offset rule (verified, follow-up 04)

| Host | Rule |
|---|---|
| PC | Subtract 1000 from each band only when the **item's** `s2:processing_baseline ≥ 04.00`. Key on the item, not the date: PC holds 04.00/05.00 reprocessings dated 2019 and 2021 next to 02.xx/03.00 originals |
| Earth Search c1 | Always subtract 1000 (reprocessed to ≥ 05.00 back to 2018) |
| Legacy Earth Search `sentinel-2-l2a` | Never subtract |

Getting this wrong lowers NDVI by about 0.15–0.17 on these fields, which would look like a crop failure.

### D4. Deduplication

- Same datatake: keep the highest processing baseline, then the latest generation time.
- Different datatakes, same date and tile: keep the most valid polygon pixels, then the best clear
  fraction.
- MODIS on PC: deduplicate on (product, `AYYYYDDD`, tile), keep the newest production time. Filter by
  id prefix `MOD13Q1.`, never by `platform` (empty on items from ~2024-03 to 2025-05; a `platform`
  filter silently drops 29 composites).

### D5. MODIS baseline construction (Bolivia)

- One COG window per tile (h11v10, h12v10) per composite over the portfolio bounding box: ~2,500 reads
  as a one-off prefetch into DuckDB. Refresh the anonymous SAS token at ~40 min.
- Mask `pixel_reliability` 0/1 (strict mode also drops VI_Quality bits 8, 10, 15 and usefulness ≥ 12).
- Field value = median of pixels whose centre lies inside the polygon. Mark a composite missing if the
  good fraction is < 0.5. Report `n_years` per composite.
- Mask baseline years before land clearing (MCD12Q1), so a field that was forest in 2003 does not
  inflate its own "normal".

### D6. Cross-calibration, smoothing and anomaly

| Step | Decision | Evidence |
|---|---|---|
| S2 → MODIS scale | `MODIS = 0.940·S2(B8A) + 0.048` (Theil-Sen), pooled; per farm once ≥ 30 pairs exist | Follow-up 04: n = 308, 3 cropland points 2019–2026, R² 0.899, RMSE 0.050 (verified). Wet-season slope is lower (0.85) |
| S2 → Landsat scale (Chile) | Per-block linear fit on same-week pairs | Chile-satellite-fit: Landsat 0.761 vs S2 0.70–0.78 the same week (Requínoa); per-block fit not yet run |
| Smoothing | Weighted Whittaker, λ = 500, on a daily grid at the real acquisition dates; QA weights 1 / 0.5 / 0; calibrated S2 values inserted as observations | gapfill-fusion (confirmed). Savitzky-Golay (5, 2) acceptable fallback |
| As-of value | **Hold the last good observation with its date.** Labelled "estimated" after 16 days. Curve values > 32 days from a good observation are gap-filled and never alarm on their own | 1.0–1.8× better than extrapolating (gapfill-fusion) |
| Anomaly | z-score against the same day of year ±8 d in the other baseline years, with persistence (2 composites in a row) or a 32-day mean z | ADR-0002 D5 |
| sd floor (**Proposed**) | 0.05 | On cropland the same-date sd is 0.09–0.21 because sowing dates shift. Team call: 0.05, or keep ADR-0002's unspecified floor |
| Chile scoring window | Deciduous crops scored Oct–Apr only (winter NDVI measures the inter-row cover crop). Evergreen crops Dec–Apr with sd floor 0.03–0.04. Young orchards: detrend or use the last 3 seasons | chile-satellite-fit |
| Still-an-orchard gate (Chile) | Recent peak NDVI ≥ 0.5 and no step change, else flag "land use may have changed" | chile-satellite-fit |

### D7. Clear observations by region and season (for the "data as of" label)

| Region / season | Usable S2 scenes per month | Longest gap |
|---|---|---|
| Santa Cruz, rainy season Dec–Mar | 1.5–2.5 | 30–42 d (Nov–Jan) |
| Santa Cruz, dry season Jun–Sep | 5.6–7.4 | — |
| Central Chile, Dec–Mar | 5–6 | — |
| Central Chile, May–Aug | 2–2.5 | ~40 d (Jul–Aug) |
| Temuco, winter | 1.2–1.4 | up to 65 d |

MODIS wet-season composites are often lost entirely (81/81 pixels cloudy at Mineros in 2026-03 and
2024-03). The NDVI driver must never claim a current anomaly from a gap-filled value.

## Rejected / refuted

- **S2-to-MODIS calibration 0.117 + 0.815·S2 (2 pixels):** superseded by 0.940·S2(B8A) + 0.048 (n = 308).
- **DN offset keyed on date:** wrong; keyed on processing baseline. Earth Search c1 always needs it.
- **HLS S30 NDVI ≈ S2 + 0.04:** it is ~+0.08 above S2 B08. HLS is a Could fallback only.
- **MODIS over Chilean orchards** except pure pixels.
- **STARFM / ESTARFM / FSDAF fusion:** hours per tile, no benefit for polygon means.
- **HANTS / harmonic fits** (worst on cropland) and **upper-envelope smoothing** (−0.02 bias).
- **Sentinel-1 RVI as a scored baseline:** 2022–24 too sparse; display only.
- **`vam.whittaker` / `modape`:** no Python 3.14 wheel; implement Whittaker with numpy/scipy.
- **Phenology-aligned baseline:** the right fix for shifting sowing dates, but v2.

## Consequences

- The project `.venv` lacks scipy and rasterio; the service needs both (or Whittaker in numpy only).
- The MODIS prefetch and the Landsat Chile baseline must be built offline into DuckDB before the demo.
- "Data as of" for NDVI is the date of the last clear scene, which in the Santa Cruz rainy season can be
  a month old. The farm page shows that date next to the value.
- PC MODIS also has the 2025-07 → 2025-11 hole for land-surface temperature and NBAR, with no keyless
  backfill. Neither is in v1.
