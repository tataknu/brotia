# ADR-0014: v1 imagery pipeline as built (NDVI series, interpolation, baseline, peers)

- **Status:** Accepted (D9 Proposed)
- **Date:** 2026-11-07
- **Builds on:** ADR-0007 (vegetation pipeline), ADR-0013 D3 and D8, CONTRACT §E.6, §E.9, §E.12
- **Decided by:** the svc-imagery builder during the v1 build; verified on the 12 sample farms and in the offline snapshot of 2026-11-07

## Context

ADR-0013 D8 asked for an NDVI image of each orchard for any date, with gaps filled by interpolation, and
for every metric to come from native 10 m pixels. ADR-0007 fixed the general method (Sentinel-2 L2A,
SCL mask, Whittaker smoothing, hold-last-good, z with persistence). The build had to choose the band pair,
the read path, the mask, the thresholds and the smoothing parameters, and it had to fit cold reads inside a
demo timeout. This ADR records those choices and where they depart from ADR-0007.

## Decisions

### D1. NDVI uses B08; NDMI uses B8A/B11

- **NDVI = (B08 − B04) / (B08 + B04)** everywhere: pixels, frames, series, baseline and peers.
- **NDMI = (B8A − B11) / (B8A + B11)**, the ADR-0007 D1 pair, unchanged.
- **Why not B8A for NDVI (ADR-0007 D2):** B8A was preferred for cross-calibration with MODIS, and MODIS is
  archived for Chile. The contract asks for native 10 m pixels; B8A is 20 m. The Chile discovery probe used B08.

### D2. Pixels come from the Planetary Computer data API

- **Read path:** `/item/bbox/{bbox}/{W}x{H}.npy`, nearest neighbour onto an EPSG:4326 grid of about 10 m. Each grid
  value is one native Sentinel-2 pixel. One call per scene, cached for good per item id.
- **Speed:** about 0.6 s per scene, against 7–10 s when reading the COGs directly with a SAS token. No SAS signing.
- **STAC search:** the current-year search is cached per calendar year with a 6 h refresh, so the cache key does
  not change day to day and a stale copy survives a network failure on demo day.
- **No failover yet:** if Planetary Computer fails, the service serves the stale cache, or null with a reason.
  Earth Search failover is not built.

### D3. Polygon mask is centre-in

- A pixel counts when its centre lies inside the orchard polygon.
- PC's statistics endpoint counts every touched pixel. On a 2 ha orchard this reads about 0.02 lower NDVI (checked
  in a test), because edge pixels mix in roads and bare ground.
- The same mask is used for the window and for the history, so z is consistent.

### D4. Clear-sky thresholds

| Use | Threshold |
|---|---|
| Scene usable for the series and the baseline | polygon clear ≥ 50 % (ADR-0007 D2) |
| Frame labelled *observed* | polygon clear ≥ 80 % (CONTRACT §E.12) |
| Tile-cloud prefilter: window / history / recent peer scenes | < 95 % / < 50 % / < 80 % |

### D5. Interpolation: Whittaker λ = 500, hold instead of extrapolate

- **Smoother:** Whittaker, λ = 500 on a daily grid, unchanged from ADR-0007.
- **Ends:** the value is held at the last (or first) clear observation instead of extrapolated (ADR-0007 D6). This
  removed z spikes of up to +4 at the end of the series during green-up.
- **Gaps:** interpolated frames and series points are dropped beyond **32 days** from a clear image (null, not filled).
- **Labels:** every gap-filled point has `estimated: true`; every frame has its kind and `daysToClear`.

### D6. Baseline and anomalies

- **Baseline:** raw clear scenes within ±8 days of the same date in each of the previous `baselineYears` (default 5)
  years. It needs at least 4 values from at least 2 years; otherwise the band is null.
- **Sentinel-2 only:** the ADR-0007 Landsat baseline for Chilean orchards is **not built**. PC's archive for these
  tiles is thin before late 2020, so "5 baseline years" is in practice at most about 5 seasons.
- **Provenance:** a vigour or water-stress value gives the date of the **last clear scene** used, and it is marked
  `estimated` when any composite in its window was gap-filled, with a note on how many days the value was held
  (review finding ST-3).

### D7. Peers, abandonment and the irrigation test in one call

- **One call per farm:** `app.imagery.vigour_signals` returns the zone-peer comparison, the abandonment run, the exact
  persistent z and the dry-season irrigation test. Earlier, risk fetched a full series plus a 5-year history per peer
  (about 330 PC calls each). The cold 12-farm portfolio went from over 20 minutes to 25–94 s.
- **Peers:** the nearest **8** CIREN orchards of the same crop in the zone circle (the contract says 20; recorded as a
  deviation in CONTRACT §E.9 and ADR-0019 D5), grouped into shared grids of at most 800 m, with a 75 s budget when
  cold. A peer whose polygon overlaps the farm by more than 50 % is the farm itself and is excluded.
- **Dry-season peers** are fetched only when the farm shows a candidate abandonment run.
- **Irrigated proxy (rung 1):** "yes" only when the orchard's Jan–Mar NDVI median is high, the zone circle's
  25th-percentile clear-pixel NDVI is ≤ 0.35 and the gap is ≥ 0.25; otherwise "unknown", never "no". The
  orchard threshold was lowered from 0.50 to **0.35** in the v1.1 review (CONTRACT §E.11), so a desert orchard
  at 0.45 beside bare land at 0.10 reads irrigated. The 25th percentile stands in for rain-fed land; it is not a
  land-cover mask.

### D8. Frames and PNGs

- **Frames:** every observed date plus an interpolated frame on the 5-day grid where no observed frame lies within ±2 days.
- **Native PNGs:** pixels outside the polygon are transparent and there is **no outline** (the contract's transparency
  rule). The app draws the polygon outline itself. SR PNGs get a 1-px inner outline.
- **Bounds:** the PNG bbox is the polygon bounds + 20 m (contract).
- **True colour:** one fixed stretch, `clip(refl / 0.20) ^ (1 / 1.5)`, only on observed frames.

### D9. Spring z bias (Proposed)

- **Finding:** dry-season (February) z for 3 farms in 2023–2025 sits near 0 (−0.8 to +0.9), so the abandonment test looks
  calibrated. Spring (November) z is consistently positive (+0.6 to +2.6). Likely causes: orchards maturing, or green-up
  timing shifting across the baseline years. Curicó's baseline sd is 0.21, which suggests the land changed inside the baseline.
- **Effect:** z is pushed up. It does not cause false stress alarms, but it can hide mild spring stress.
- **Options:** (a) detrend, or use only the last 3 seasons for young orchards (ADR-0007 D6); (b) a phenology-aligned baseline.
- **Product owner default if nobody decides:** keep v1 as is and say so on the slides; build (b) in v2.

## Consequences

- **Supersedes for Chile:** ADR-0007 D2 band choice for NDVI (B8A → B08) and the ADR-0007 Landsat baseline (S2 only in v1).
- **Not built:** the ADR-0007 D6 scoring window (deciduous crops scored Oct–Apr only), the "still an orchard" gate
  (peak NDVI ≥ 0.5, no step change), the young-orchard detrend, Earth Search failover.
- **Speed:** a cold `/imagery/farm` can take about 3 minutes (Copiapó took 169 s on a busy machine). Warm, 0.1–0.2 s.
  The demo runs on a warm cache or the offline snapshot.
- **Load on PC:** the concurrency cap (2) is per process. Running the warm script and the server at the same time
  doubles the load on Planetary Computer.
