# ADR-0026: Second demo portfolio (sample-cl-sur)

- **Status:** Accepted
- **Date:** 2026-11-08
- **Scope:** service sample data (`service/app/domain/sample_spec_sur.py`, `service/data/sample_portfolio_cl_sur.geojson`,
  `build_sample --id`), two read endpoints, the multi-portfolio snapshot (`service/app/snapshot.py`), the app's Portfolios page and
  offline loader, and an additive contract change (CONTRACT v1.1: §A, §B, §C).
- **Amends:** ADR-0016 (one sample portfolio). Its selection rules (D1) are reused unchanged.

## Context

With one sample book, Home ("allocation performance across portfolios") aggregates a single portfolio, and the demo cannot show a
lender comparing books. A second book also tests the engine away from the central-valley orchards of `sample-cl`: southern cherries,
blueberries, hazelnuts and walnuts, repaid once a year after harvest.

## Decisions

### D1. A second real-geometry sample: "Cooperativa Demo — Sur frutícola" (renamed in D6)

- Id `sample-cl-sur`, lender "Cooperativa Demo", `CL`, `USD`. 9 real CIREN Catastro Frutícola polygons in Maule (Talca), Ñuble
  (Parral, Retiro, Chillán, San Nicolás) and Biobío (Los Ángeles): 2 cherry, 2 blueberry, 3 hazelnut, 2 walnut.
- Selected by a fixed rule before any assessment (ADR-0016 D1 plus: one ring, compactness ≥ 0.6, ≥ 3 km from the town centre, inside a
  CR2MET cell that already has its 1991–2020 baseline; the most compact polygon per area and crop).
- La Araucanía (CIREN layer 65) is not in the book. The selection rule required a CR2MET cell with its baseline already built, and the
  three regions chosen meet it; the builder did not record a further reason. Adding Araucanía later means building its baseline cells first.
- Geometry and CIREN attributes are real. The lender side (names, loans, annual post-harvest schedules in March–April) is illustrative.
  Variety and planting year stay null, as in `sample-cl`.
- Two shared zones where farms really fall inside one 35 km² circle (San Nicolás north, Los Ángeles south); the other farms get their
  own zone.

### D2. Farm ids are unique across samples

Snapshot and imagery files are keyed by farm id alone, so the new farms use the `sur-` prefix (`sample-cl` keeps `cl-`). A duplicate
id in an export is skipped with a warning.

### D3. Additive API (contract v1.1)

- `GET /portfolios/samples` lists `SamplePortfolioSummary` entries; `GET /portfolios/sample?id=<id>` returns one.
  `GET /portfolios/sample` without `id` still returns `sample-cl` byte for byte.
- `SnapshotExportRequest.portfolios` exports several portfolios; with no portfolio given, the export covers every sample.

### D4. Multi-portfolio snapshot

The first portfolio (the primary, `sample-cl`) keeps the v1 file names and the manifest's top-level fields, so a v1 reader still works.
Every other portfolio adds `portfolio-<id>.json`, `assessment-portfolio-<id>.json` and `events-<id>.json`; farm files keep their
v1 names. `manifest.portfolios` lists all of them, primary first. Offline, the app accepts assessments for any portfolio listed there.

### D5. App

The Portfolios page shows one row per sample ("Load sample portfolios" loads both). Home aggregates both books, and each has its own
report. The browser e2e loads both samples, checks the second book's report and one of its farms, live and offline.

### D6. Fund-style names and codes, no "load sample" UI (2026-11-07 addendum)

- Names read like credit funds, with a short code shown in mono before the name (report header, sidebar, Home, Incidents,
  Portfolios table): `sample-cl` → **CLSF1 · Chile Specialty Fruit Credit I**, lender **Banco Valle Andino**;
  `sample-cl-sur` → **CLSO2 · Southern Orchards Credit II**, lender **Cooperativa Agrícola del Sur**. Both lenders are fictional
  (formerly "Banco Demo — huertos Chile" / "Cooperativa Demo — Sur frutícola"). The lender side (lenders, loans, schedules, rule
  edits) stays illustrative; orchard polygons and climate data are real. The farm overview's "About this data" says so for sample books.
- Contract v1.1, additive: optional `Portfolio.code` and `SamplePortfolioSummary.code`. Ids, farms, loans and rules are unchanged,
  so scores do not move.
- The Portfolios page no longer has a sample card. On the first app start with an empty store the app loads both samples (live, or
  from the offline snapshot); later starts never bring deleted samples back (`samplesSeeded` in the store), except through the small
  "Restore sample portfolios" link. A stored sample whose name differs from the current one gets the current name, code and lender;
  rule edits and the audit trail are untouched.

## Result at the 2026-11-07 export

Live assessment, asOf 2026-11-07 (also in the offline snapshot exported 2026-11-08 03:32 UTC).

| Farm | Score | Tier | Outstanding (USD) | Leading driver |
|---|---|---|---|---|
| Los Ángeles south cherries | 83.5 | high | 315,000 | NDMI 2.7 sd below its own normal (severe stress) |
| Parral blueberries | 68.6 | high | 45,000 | NDMI 1.2 sd below normal while Maule snowmelt is 107 % of normal; credit action: field visit |
| Maule (Talca) cherries | 45.0 | watch | 160,000 | 1 VIIRS active-fire detection in the zone since 3 Nov |
| San Nicolás hazelnuts | 30.7 | normal | 157,500 | Burned area mapped in the zone circle (405 ha, 11 May 2026) |
| San Nicolás walnuts | 30.7 | normal | 90,000 | Same burned area (shared zone) |
| Chillán blueberries | 29.2 | normal | 70,000 | Burned area mapped in the zone circle (262 ha, 28 Dec 2025) |
| Retiro walnuts | 0 | normal | 180,000 | Background only: water-scarcity decrees in 8 years since 2008 |
| Parral hazelnuts | 0 | normal | 150,000 | Background only: burned area in the zone in 7 years since 2012 |
| Los Ángeles south hazelnuts | 0 | normal | 60,000 | Background only: burned area in the zone in 7 years since 2012 |

Totals: USD 1,227,500 outstanding; USD 520,000 at watch or high; farms high 2, watch 1, normal 6. One credit action.

The live app assesses as of today (UTC). Its report on 2026-11-08 (`docs/v1-screens/60-report-sur.png`) shows Parral blueberries at
53.4, watch, with the same field-visit action: high 1, watch 2, normal 6, portfolio risk 37.1. The other farms match the table.

## Consequences

- The demo can show two books side by side on Home with real data in both.
- `sample-cl` scores, tiers, exposure and its 5 credit actions are unchanged by the re-export (checked against the previous snapshot);
  only the event list grew (843 to 849 events).
- The snapshot grows by 9 farms of imagery.
- Adding a third sample is a spec file plus an entry in the spec registry; no contract change.
