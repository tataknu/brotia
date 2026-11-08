# ADR-0008: Flood and surface water

- **Status:** Accepted
- **Date:** 2026-11-06
- **Builds on:** [ADR-0001](0001-v0-product-and-risk-definitions.md) D3–D4, [ADR-0003](0003-market-scope-and-sample-portfolios.md), [ADR-0004](0004-precipitation-and-station-data.md)
- **Evidence:** `CATALOG.md` (Bolivia matrix, events plan, refuted claims), `families/sar-flood-water`
  (notes and verification), `families/chile-water`, `families/chile-crops-perils`

## Context

ADR-0001 flags flood when 72-hour rain reaches 120 mm. That is a weather proxy: it says "a lot of rain
fell", not "this field was under water". A lender wants the second, because only standing water on the
field destroys a crop or delays the harvest that repays the loan.

Discovery found one keyless source of **observed** water that works in the rainy season: Copernicus
GFM, built from Sentinel-1 radar, which sees through clouds. Optical flood maps are blind then
("insufficient data" on 93 % of Santa Cruz pixels on 2025-12-18). GFM has a catch: a value of 0 means
either "no flood" or "we could not see", and on the 2026-11-03 pass GFM could not see 62–78 % of the
area around four of the Bolivian farms.

In central Chile, river flooding of orchards is rare; the water perils there are scarcity (ADR-0006)
and rain at harvest (ADR-0005).

## Decisions

### D1. Bolivia: three flood layers

| Layer | Source | What the lender sees | Evidence |
|---|---|---|---|
| Heavy rain (weather trigger) | v1: max **CHIRPS v3 pentad** (5-day) total, as a same-season percentile against its own 1991–2020 pentads. CHIRPS daily values are disaggregated pentads (equal splits seen live, gridded-precip verifier), so a CHIRPS 72-hour maximum is not a real measurement. When IMERG V07 Late exists (backlog W-16), max 72-hour rain on IMERG against its own 2000– baseline (ADR-0004 D3: IMERG for heavy rain). 120 mm / 72 h stays as a display line | "Heaviest 5-day rain in 12 years" | Absolute rain thresholds must be computed on CHIRPS, not ERA5: ERA5 quantile mapping fails on the 72 h tail out of sample (CATALOG §5) |
| Observed flood on the field | **Copernicus GFM** (EODC STAC + COGs, 20 m, 2015–), per pass: flooded / observable-dry / not-observable fractions inside the polygon | "Water seen on 18 % of the field on 18 Dec (radar)" or "not observable on this pass" | Verified live (sar-flood-water, verifier: confirmed with corrections). Latency 2–6.5 h after the pass; one valid pass every ~12 d. Commercial OK (Copernicus) |
| River level upstream | **GloFAS v4** via Open-Meteo Flood API, at the main-channel cell (Río Grande only), same-week percentile against 1997–2025 | "Río Grande at the 96th percentile for this week (model)" | Verified live. Demo only on Open-Meteo; CEMS EWDS (free key) for production |

Rules for the GFM wrapper (all from the verifier):

- Read the **exclusion mask on every item**. Report three fractions, never just "flood %".
- STAC returns 300 km tile items; count valid pixels (≠ 255) inside the polygon and skip empty items.
- Describe it as "high precision, recall limited by exclusion mask and swath". Over the EMSR853 Dec-2025
  flood polygon, GFM flagged 5.8–27.8 % of the area; within the observable part, recall was about 70 %.

Rules for GloFAS:

- Snap each farm to the maximum-mean-discharge cell per latitude row (the farm's own cell carries
  0–0.6 m³/s and means nothing).
- Values after 2025-05-31 are forecast-derived; label them "estimated".
- GloFAS **missed the Dec-2025 Piraí flood** (EMSR853, 20 dead). It is context only and never the sole
  flood signal.

### D2. Bolivia: normally-wet fields

JRC Global Surface Water occurrence (1984–2021, 30 m, attribution licence) is a static "flood-prone /
normally wet" attribute. A field with high historic water (rice, river margins: Las Londras 15.6 %
ever-water at its original point) is judged against its own history, so normal wetness is not a flood.

### D3. Waterlogging proxy (Could)

Sentinel-1 RTC on PC, VV/VH backscatter anomaly against the field's own same-track (descending relative
orbit 10) same-season history. A fixed water threshold (VV < −18 dB and VH < −24 dB) gives ~0 % water
on every probed date, so only an anomaly works. Coverage since 2022 is one track, 13–34 scenes a year.
Display only in v1; not scored.

### D4. Chile

| Need | Decision |
|---|---|
| Flood peril on orchards and vines | Not scored in v1. ADR-0001's `flood72hMm = 120 mm` will almost never fire in the central valley |
| Live flood flag | DGA `ALERTAS` ArcGIS layer (1,019 stations, alert against blue/yellow/red thresholds, refreshed 2026-11-07 04:14 UTC) shown on the map as context. It is a sparse alert flag, not a continuous water level: only 11 of 426 active flow stations had a non-zero value (chile-water verifier) |
| Rain-caused loss | Rain at harvest (ADR-0005 D5) |
| Observed flood events | GFM and Copernicus EMS vectors go to the events panel (ADR-0009) when present |

## Superseded items

| Earlier decision | What changes | Applies to |
|---|---|---|
| ADR-0001 D3 `flood72hMm = 120 mm` as the trigger | Becomes a display line; the trigger is the heavy-rain percentile (CHIRPS pentad, or IMERG 72 h) plus GFM observed water | Bolivia |
| ADR-0001 D4 flood peril | Not scored for Chile in v1 | Chile |

## Rejected / refuted

- **GFM "0 = no flood":** refuted; 0 also means excluded (not observable).
- **GFM latency 1–3 days:** corrected to 2–6.5 h after the pass.
- **"GFM validated against EMSR853":** overstated; partial corroboration only.
- **GloFAS history from 1984:** values start 1997-01-01.
- **NOAA VIIRS flood archive as baseline:** gap 2021-01 → 2023-07; near-real-time only.
- **Global Flood Database:** CC BY-NC; not usable for a bank product.
- **Optical (MODIS/VIIRS) flood maps in the wet season:** blind under cloud.

## Consequences

- The farm page must show "not observable" as its own state, so a missing radar look is never read as
  "safe".
- EMSR853 (Dec 2025) is the demo's "event near the book that hit no farm": the nearest sample farms are
  16–28 km away (sar-flood-water, CATALOG). Those distances were measured from the original points;
  recheck them on the relocated polygons (ADR-0003 D2).
- A static farm → river-cell table must be built once for GloFAS.
