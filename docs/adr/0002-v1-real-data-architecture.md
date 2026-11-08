# ADR-0002: v1 real-data architecture and anomaly math

- **Status:** Accepted
- **Date:** 2026-11-06
- **Builds on:** [ADR-0001](0001-v0-product-and-risk-definitions.md)

## Context

v0 proved the product shape with fake, deterministic data. v1 replaces the fake series with
real public data behind the same `src/data/api.ts` contract. Every number on screen must be
traceable from its source, through its formula, to its explanation.

## Decisions

### D1. Three phases for v1

1. **Initial data discovery.** For every formula input, find a free source and test it on the
   12 sample farms. Record for each source:
   - spatial and temporal resolution;
   - how many years of history it has;
   - latency;
   - how often values are missing (clouds);
   - access: key, rate limits, CORS;
   - licence.

   **Done when:** every input has a primary and a fallback source, or is explicitly out of scope.
2. **Math formula creation.** Each signal gets a written spec:
   - inputs and units;
   - aggregation window;
   - baseline construction;
   - anomaly measure;
   - severity ramp from 0 to 1;
   - how it enters the combined score.

   **Done when:** a reference implementation passes tests against known hand-computed values,
   and an offline backtest on the 2023–24 Bolivian drought moves the affected farms to watch or
   high.
3. **End-to-end, bulletproof and trustworthy.** Data flows source → cache → compute → API →
   UI, and the path must be:
   - **Traceable:** every value carries provenance (source, observation date, resolution).
   - **Resilient:** a failing source falls back to the cache or the fallback source, and the value is labelled "estimated".
   - **Demo-safe:** the demo runs from a saved snapshot when there is no network.

### D2. Backend: small FastAPI service, no queues

- **Service:** a Python FastAPI service computes everything. The React app's `api.ts` calls it over HTTP.
- **No queues yet:** requests run synchronously, and a cache makes repeated calls cheap.
  We will revisit queues and background jobs later.
- **Source wrappers:** each data source sits behind a common interface, so new sources plug in
  without touching the formulas. A wrapper has:
  - a name and the variables it provides;
  - a fetch method taking a location or polygon and a time range;
  - normalised output: daily or composite time series, in SI units, with provenance;
  - a health check.

  The formulas ask for a *variable* (e.g. `precip`). A registry resolves it to the primary
  wrapper, falling back to the next one if that fails.
- **Storage:** a DuckDB file holds the raw downloads (cache), the derived series, and the assessments,
  all keyed by source, location and date range.
- **Offline snapshot:** the service can export the sample portfolio to static JSON. The front end can
  load that snapshot when the service is unreachable, so the demo never depends on the network.

### D3. Time window: 13 months, as of today

- **As-of date:** today, or the latest date the data actually covers. Each signal shows its own
  "data as of" date, because latency differs: about 5 days for ERA5, about 3 weeks for MODIS,
  and 2–5 days for Sentinel-2.
- **Display window:** the 13 months before the as-of date, which covers one full season plus a
  month. This replaces v0's 24 months.
- **Baseline history:** the field's normal is still built from multi-year history for the same
  time of year, outside the display window:
  - weather: up to 30 years;
  - MODIS NDVI: since 2000, using the zone's `baselineYears`.

### D4. Satellite depth: MODIS baseline + Sentinel-2 current

- **MODIS MOD13Q1** (250 m, 16-day, since 2000) builds each field's same-date NDVI baseline.
- **Sentinel-2 L2A** (10 m, via Planetary Computer, scene classification cloud mask) gives
  current state as a mean over the farm's polygon.
- **Cross-calibration:** a linear fit over the overlapping period maps Sentinel-2 NDVI onto the MODIS
  scale before comparing it with the MODIS baseline.
- **NDMI** comes from Sentinel-2 bands 8 and 11, if feasible.

### D5. Anomaly math

- **Rain, dry spell, soil moisture, heat and frost counts:** expressed as an empirical percentile against the same
  calendar window in each baseline year. In plain language: "drier than 9 of the last 10 years".
- **NDVI:** expressed as a z-score against the same-date baseline (mean ± sd, with an sd floor). In plain language:
  "crop greenness 78 % of normal for this date".
- **Severity ramps and score combination:** ADR-0001 D4–D5 stay unchanged unless the formula spec
  (phase 2) changes them in a follow-up ADR.

## Consequences

- **New code:** v1 adds a `service/` Python project (FastAPI, DuckDB, source wrappers, formulas, tests)
  next to `app/`.
- **`api.ts`:** the functions become async HTTP calls with a snapshot fallback. The UI needs loading
  and error states and a provenance display.
- **Removed:** the replay and backtest UI is not part of v1. The 2023–24 backtest runs offline as validation.
- **Reuse:** the draft `pipeline/` scripts (Open-Meteo and MODIS fetchers with cache, crop
  calendars) can seed the first source wrappers.
