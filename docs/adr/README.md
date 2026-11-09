# Architecture decision records

Climate Loan Monitor, MIT Energy & Climate Hack 2026 (Suyana track). Each ADR records one decision,
the evidence behind it and what it changes. Data evidence lives in `docs/data-discovery/` (CATALOG.md,
catalog.json, families/, followups/). The v1 backlog that implements these ADRs is
[`docs/backlog/v1.md`](../backlog/v1.md).

**Status meanings.** *Accepted:* the evidence was verified live during data discovery, or the decision was
implemented and verified during the v1 build (ADR-0014 onward), and the choice is clearly in v1's interest. *Proposed:* the team must make a named call; each Proposed ADR states the
call and the product owner's default if nobody decides.

## Index

| # | Title | Status | Summary |
|---|---|---|---|
| [0001](0001-v0-product-and-risk-definitions.md) | v0 product and risk definitions | Accepted (partly superseded) | Entities, field-vs-itself baseline, thresholds, perils, score and tiers, drivers, money at risk, disasters panel, wizard. Santa Cruz assumptions superseded for Chile by 0003, 0005, 0006, 0008, 0010 |
| [0002](0002-v1-real-data-architecture.md) | v1 real-data architecture and anomaly math | Accepted (D4 superseded for Chile) | FastAPI + DuckDB + source wrappers with fallback, offline snapshot, 13-month window, percentile/z anomalies. MODIS-per-field baseline superseded for Chile by 0007 |
| [0003](0003-market-scope-and-sample-portfolios.md) | Market scope, regions and sample portfolios | Accepted; D5 Proposed | Chile primary, Bolivia second; two sample portfolios on verified real fields (10 CIREN parcels in Chile, 12 relocated 81 ha fields in Bolivia); per-region crops and perils. Calls: rice farm, Warnes Sur, Osorno |
| [0004](0004-precipitation-and-station-data.md) | Precipitation and weather-station data | Proposed | Chile: CR2MET R1+NRT with DMC station truth. Bolivia: CHIRPS v3 (1991–2020) proposed, IMERG for dry spells, ERA5 fallback. Same-stream rule, centroid-cell rule, stations for validation only. Call: CHIRPS without follow-up 03 |
| [0005](0005-temperature-eto-frost-heat-and-hail.md) | Temperature, reference ET, frost, heat, harvest rain and hail | Accepted; D5, D7 Proposed | Percentiles trigger, degrees display. ERA5 in Bolivia; CR2MET + RAN hourly stations in Chile. Chile crop-window perils (bloom frost, harvest rain, heat). Hail out of v1 as a peril. Calls: Chile thresholds, frost/harvest-rain weight 0.8 |
| [0006](0006-soil-moisture-and-irrigation-water-supply.md) | Soil moisture, water balance and irrigation water supply | Proposed | Bolivia: ERA5-Land root-zone percentile, CHIRPS-forced bucket fallback. Chile irrigated: DGA decree + snowmelt forecast water-supply signal replaces field drought. Calls: ERA5-Land vs bucket; decree-sets-watch rule |
| [0007](0007-vegetation-ndvi-ndmi-pipeline.md) | Vegetation pipeline (NDVI, NDMI) | Accepted; sd floor Proposed | S2 one-call polygon statistics, DN-offset rule, MODIS baseline + ORNL backfill (Bolivia), Landsat baseline (Chile), MODIS = 0.940·S2(B8A) + 0.048, Whittaker, hold-last-good, z with persistence |
| [0008](0008-flood-and-surface-water.md) | Flood and surface water | Accepted | Bolivia: heavy-rain percentile (CHIRPS pentad; IMERG 72 h when available) + GFM observed water with exclusion mask + GloFAS Río Grande context. Chile: flood not scored; DGA live alerts as context. `flood72hMm` becomes a display line |
| [0009](0009-disaster-event-catalogs.md) | Event sources for the recent-disasters panel | Accepted; D6 Proposed | Own-signal droughts, GWIS/FIRMS fire, GFM/CEMS flood, DGA decrees, Diario Oficial, DMC/SENAMHI warnings self-archived; GDACS/GLIDE as narrative only. Calls: FIRMS key, declaration duration |
| [0010](0010-crop-masks-calendars-and-phenology.md) | Crop masks, irrigated flag, calendars and phenology | Accepted; D4 Proposed | MapBiomas/GLAD/WorldCover (Bolivia), CIREN + ODEPA (Chile), CIREN irrigated-area flag, curated calendars per zone, phenology from the field's own NDVI. Call: approximate Chile windows |
| [0011](0011-platforms-licensing-and-source-registry.md) | Access platforms, licensing and the source registry order | Proposed | Licence tier in provenance; registry order per variable and region; pre-build all baselines (Open-Meteo quota); catalog verification enum. Calls: free accounts, licence requests, production ERA5 path |
| [0012](0012-source-access-patterns.md) | Source access patterns for the data service | Accepted | One cached fetch path (TTL, dedup, stale-on-error), provenance fields, polite concurrency, parallel event merge; header spoofing rejected |
| [0013](0013-v1-product-scope-fruit-crops-risk-imagery.md) | v1 product scope: six fruit and nut crops, crop rules, risk formula, imagery and water status | Accepted | Cherry, blueberry, avocado, walnut, hazelnut, table grape. Chile enhanced tier, other South American countries standard tier, Bolivia archived. Zones = 35 km² circles with peer comparison. Crop → zone → farm rules (agronomic + credit) with audit. Risk = f(C, D, G) per crop and stage. NDVI interpolation + AI super-resolution (display only). Water status ladder. Agent chat panel |
| [0014](0014-v1-imagery-pipeline-as-built.md) | v1 imagery pipeline as built | Accepted; D9 Proposed | NDVI from B08 (not B8A), PC data API pixels, centre-in mask, 50 %/80 % clear thresholds, Whittaker λ 500 with hold, 32-day null rule, ±8-day S2-only baseline, one vigour-signals call for peers/abandonment/irrigation. Call: spring z bias |
| [0015](0015-super-resolution-model-sen2srlite.md) | Super-resolution model | Accepted | SEN2SRLite RGBN ×4 (CC0, 0.07 s MPS / 0.3 s CPU per chip, no CUDA), vendored weights, AI on observed frames only, MPS → CPU → Lanczos fallback with reason, display only |
| [0016](0016-v1-sample-portfolio-composition.md) | v1 sample portfolio | Accepted | 12 real CIREN orchards (2 per crop), illustrative bank and loans (USD 2.42M), shared zones Requínoa and Los Ángeles, seeded audit, CIREN irrigation results, no tax-roll field |
| [0017](0017-crop-templates-sources-and-approximations.md) | Crop templates: sources and approximations | Accepted (approximate); D5 Proposed | FAO frost T10/T90, FAO-56 Kc (hazelnut from walnut), Agroseguros harvest rain, unverified central-Chile calendars; absolute ramps replace percentile triggers. Call: northern table-grape calendar |
| [0018](0018-v1-weather-water-and-event-sources-as-built.md) | v1 weather, water and event sources as built | Accepted | CR2MET byte-range reads, R1 baseline 22/30 years (no ETo baseline), RAN station first for frost/heat/rain, ERA5 last resort (never called live), pinned agromet CA, DGA decree logic, snowmelt, GWIS/FIRMS/CEMS handling |
| [0019](0019-risk-engine-and-v1-1-trust-guards.md) | Risk engine and the v1.1 trust guards | Accepted | Noisy-OR C/D, G = mean of available; abandonment needs collapse + no recovery; burned-area polygons checked against own 10 m NDVI; zone-relative irrigation test; peers capped at 8; honest provenance dates |
| [0020](0020-farming-agent-grounding-and-backtest.md) | Farming agent: grounding and backtest | Accepted | Proposals via a tool; ungrounded thresholds refused; backtest truth = Sep 2013 frost + station proxies (fires and decrees context only); error mapping; agronomic leaves only |
| [0021](0021-app-display-audit-and-offline-behaviour.md) | App display, rule editing and offline behaviour | Accepted | The app never computes a metric; native imagery first, enhancement opt-in; three-level rule editor with audit; offline snapshot with rules-only banner and auto-reconnect |
| [0022](0022-open-product-calls-before-the-demo.md) | Open product calls before the demo | Proposed | Copiapó High vs "verify"; Paine has no credit action; chg-0002 shadows the agent proposal; snapshot date 7 vs 8 Nov. Defaults given |
| [0023](0023-per-source-concurrency.md) | Per-source concurrency | Accepted | Amends 0012 D3: Planetary Computer (Sentinel-2, DEM) 8 concurrent, national sites ≤ 2, global pool 16 taken after the source slot. Cold S2 fetch for one orchard 95.8 s → 22.5 s |
| [0024](0024-brotia-brand-and-v1-1-information-architecture.md) | BrotIA brand and v1.1 information architecture | Accepted | Name, palette tokens, logo risk ramp (tiers and scores only), IBM Plex Mono numbers; sidebar routes; Home = allocation performance (no invented history, no cross-currency sums); report table (a)–(e) with TOTAL; incidents = farm-touching events + fired rules on the as-of day and the day before (6 vs 83 literal); farm tabs and Rules-tab editing; `.cjs` Tailwind config; warn-ink / danger-ink |
| [0025](0025-insurance-request-handoff-to-suyana.md) | Insurance request handoff to Suyana | Accepted | Report table Insurance column (Suyana logo mark); "Send to Suyana" queues the request in a service outbox (`insurance_requests`, status `queued`, no outbound call); payload = farm, loan, score and top 3 drivers, requested perils (frost, water, excess rain, fire) and uncovered ones; honest copy; one exception to CONTRACT §0 statelessness; what a real integration needs |
| [0026](0026-second-demo-portfolio.md) | Second demo portfolio (sample-cl-sur) | Accepted | CLSO2 "Southern Orchards Credit II" (D6 names: CLSF1 / CLSO2, fictional lenders): 9 real CIREN orchards in Maule, Ñuble and Biobío with an illustrative lender side; `sur-` farm ids; `GET /portfolios/samples`, `GET /portfolios/sample?id=`; multi-portfolio offline snapshot (primary keeps v1 names); samples auto-load on first start |
| [0027](0027-landing-page-and-app-route.md) | Landing page at `/`, platform under `/app` | Accepted | Scroll-story landing page built from the deck scenes at `/`; platform at `/app/*` with legacy redirects; links via `@/shell/paths` |

**Bolivia is archived (ADR-0013 D2).** The Bolivian decisions in 0003–0010 stay on record but are not part of the v1 build.

## What the new ADRs supersede in ADR-0001 and ADR-0002

ADR-0001 and ADR-0002 are not edited. These items are superseded:

| Item | Superseded by | Scope |
|---|---|---|
| ADR-0001 D1 crop list (10 Bolivian crops) | 0003 D4 (adds Chilean crops) | Chile |
| ADR-0001 D1 crop calendar "sowing day, season length" | 0010 D4 (region/zone rows with source) | both |
| ADR-0001 D3 `frostC = 0 °C`, `heatC = 35 °C` as triggers | 0005 D1 (percentile triggers; display thresholds) | both |
| ADR-0001 D3 `flood72hMm = 120 mm` as trigger | 0008 (heavy-rain percentile + observed water; not scored in Chile) | both |
| ADR-0001 D4 hail peril | 0005 D6 (no scored hail in v1; "unexplained NDVI drop" note) | both |
| ADR-0001 D4 irrigated × 0.4 drought | 0006 D4 (water-supply signal) | Chile irrigated |
| ADR-0001 D10 Santa Cruz sample portfolio and map centre | 0003 D1–D3 | both |
| ADR-0001 Consequences: Santa Cruz climatology for farms elsewhere | 0003 D1 (farms outside Chile/Bolivia rejected) | both |
| ADR-0001 D2 / ADR-0002 D3 zone `baselineYears` (3–10 y) for every signal | 0004 D1 (weather baselines fixed at 1991–2020; `baselineYears` applies to NDVI only) | both |
| ADR-0002 D4 MODIS baseline per field | 0007 D1 (Landsat + S2 history for Chilean orchards) | Chile |
| ADR-0002 D3 latency examples (MODIS ~3 weeks) | 0007, 0011 (PC Terra lags one composite; CMR is the oracle) | both |

## What the v1 build changed in earlier ADRs

Recorded during the build (ADR-0014 to ADR-0021). The earlier ADRs are not edited.

| Item | Changed by | Scope |
|---|---|---|
| ADR-0007 D2 NDVI from B8A | 0014 D1 (B08, native 10 m; B8A/B11 kept for NDMI) | Chile v1 |
| ADR-0007 Landsat + S2 history baseline | 0014 D6 (Sentinel-2 only, about 5 seasons) | Chile v1 |
| ADR-0005 D1 percentile triggers | 0017 D3 (CONTRACT §E.5 absolute ramps on physiological thresholds) | Chile v1 |
| ADR-0013 D3 / CONTRACT §E.9 up to 20 peers | 0019 D5 (max 8, disclosed in provenance) | v1 |
| ADR-0013 D7 rung 1 "stays green while rain-fed land browns" | 0019 D4 (zone-relative test: orchard ≥ 0.35, zone p25 ≤ 0.35, gap ≥ 0.25) | v1 |
| ADR-0013 D7 rung 4 canopy minus air temperature | not built (always null, noted) | v1 |
| ADR-0013 D7 rung 5 / CONTRACT §E.10 abandonment from the z run alone | 0019 D2 (confidence needs collapse + no recovery) | v1 |
| CONTRACT §E.5 burned area on the farm = 1.0 | 0019 D3 (checked against own NDVI; 0.4 when contradicted) | v1 |
| ADR-0013 D8 AI super-resolution of frames | 0015 D3 (AI on observed frames only; interpolated frames resampled and labelled) | v1 |
| ADR-0013 D9 backtest on fires and decree periods | 0020 D3 (context only; scored truth = Sep 2013 frost + station proxies) | v1 |
| ADR-0003 D2 Chile sample (10 parcels, old crop list) | 0016 (12 orchards, six v1 crops) | v1 |
| ADR-0012 D3 default 2 concurrent per source, global cap 8 | 0023 (Planetary Computer 8; national sites ≤ 2; global 16, source slot first) | v1 |
| ADR-0021 "the dashboard" page | 0024 D4, D6 (Home + portfolio report; farm page in tabs) | v1.1 app |
| CONTRACT §0 statelessness ("stores nothing about portfolios") | 0025 D1 (the insurance request outbox is the one exception) | v1.1 service |
| ADR-0016 one sample portfolio | 0026 (two samples: `sample-cl` and `sample-cl-sur`) | v1.1 |
