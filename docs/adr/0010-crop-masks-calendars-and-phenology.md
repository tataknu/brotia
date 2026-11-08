# ADR-0010: Crop masks, irrigated flag, crop calendars and phenology

- **Status:** Accepted (D1–D3, D5). D4 (crop calendars) is Proposed: the Chilean calendar rows are
  unverified against an agronomic source.
- **Date:** 2026-11-06
- **Builds on:** [ADR-0001](0001-v0-product-and-risk-definitions.md) D1, D4; [ADR-0003](0003-market-scope-and-sample-portfolios.md); [ADR-0007](0007-vegetation-ndvi-ndmi-pipeline.md)
- **Evidence:** `CATALOG.md` (matrix rows for masks and calendars, refuted claims),
  `families/crop-masks-phenology`, `families/chile-ag-stats-credit`, `families/chile-crops-perils`,
  `families/chile-satellite-fit`, `followups/02-farm-relocation.md`

## Context

Two questions sit under every number on screen: "is there really a crop on this polygon?" and "what
stage is it in right now?". The first protects the lender from scoring a forest or a town (which is
what 9 of 12 Bolivian points and 10 of 11 Chilean points, by WorldCover, originally were). The second decides whether
a dry month matters: a dry month during soy pod-fill or cherry bloom costs money; the same dry month
on a fallow field does not.

Every land-cover map is annual and ends in 2021–2024, so none of them says what is growing this
season. The current-season answer must come from the field's own NDVI.

## Decisions

### D1. Cropland check when a farm is added

| Region | Primary | Fallback | Rule | Evidence |
|---|---|---|---|---|
| Bolivia | MapBiomas Bolivia 2024 (source.coop mirror), classes {39 soy, 72 other temporary crops, 18 agriculture} + 0.5 × 21 mosaic | ESA WorldCover 2021 class 40 (PC) | Warn when the cropland share inside the polygon is < 0.9 | Follow-up 02 (verified live; georeferencing checked against independent probes). Mirror is third-party; official GCS bucket returns 403 |
| Bolivia soy | GLAD/UMD soybean, max over 2021–2023, and soy ≥ 0.5 in ≥ 2 of 3 years | MapBiomas 2024 class 39 | Badge "soy confirmed by map" or "crop unverified" | Follow-up 02. **The 2024 GLAD layer is unusable** (regional soy share 0.075 against 0.34 in 2023) |
| Chile orchards | CIREN Catastro Frutícola layers 55–68 (`especie_01..04`, `rolpredi`) | CIREN land use `USO_DE_LA_TIERRA_CIREN_2` | Polygon intersect via REST POST (~4 s, ~2 concurrent) | Verified live (chile-ag-stats-credit, chile-satellite-fit). Errors return HTTP 200 with an `error` body. Use `_2`, not the layer without suffix |
| Chile annual crops, vines | CIREN land use `_2` (ARROZ, MAIZ, TRIGO, AVENA, VID) | user-declared crop | Badge "crop from user" when the layer has no species | 60–68 % of annual-crop polygons in Maule and Ñuble have no species ("S/C") |
| Chile "still an orchard" | Recent peak NDVI ≥ 0.5 and no step change (ADR-0007 D6) | — | Flag "land use may have changed" | chile-satellite-fit |

The check warns; it never blocks. A banker may know the farm better than the map.

### D2. Irrigated flag

| Region | Rule | Evidence |
|---|---|---|
| Chile | Irrigated when the polygon intersects, or lies within 500 m of, a CIREN `HIDRICO_PUBLICO` irrigated-area polygon (Atacama to Maule plus RM, 2016–2022). South of Maule (no layer): default irrigated for fruit, vines and rice; rain-fed for cereals, potato and canola. ODEPA's irrigation method per block is shown as evidence | Verified live: Requínoa, Ovalle and Parral polygons hit at 500 m. Town-centre points hit only at 3 km, so never test a single point |
| Bolivia | Default rain-fed; user can override (rice may be irrigated) | No public irrigated-area layer found |

The flag selects the drought logic (ADR-0006 D3/D4).

### D3. Orchard attributes (Chile)

ODEPA Catastro Frutícola CSV (CKAN, **CC BY**, 1999–2025; 2024 file has 103,716 blocks in 9 regions)
gives species, variety, planting year and irrigation method by commune and block. Filter to the latest
survey year per region. Used for: the farm card ("cherry, planted 2016, drip"), the young-orchard
baseline rule (ADR-0007 D6), and commune context. The CIREN polygons themselves have no planting year.

### D4. Crop calendars and stress windows (Proposed)

A curated table per region, zone and crop, each row with its source.

| Region | Source | Licence | Gaps |
|---|---|---|---|
| Bolivia | FAO Crop Calendar API, AEZ 003 "Oriental plains" + ANAPO Memoria text, **split by zone** (Integrada winter soy is sown Jun–mid-Aug) + GEOGLAM for maize and wheat. Draft: `families/crop-masks-phenology/sample_crop_calendar_santacruz.json` | FAO is non-commercial without permission: demo only | No source for lowland rice, sugarcane, sunflower or maize |
| Chile | Agroseguros earliest frost-coverage dates (**unverifiable**: exact PDF URLs not recorded, INDAP pages 404; chile-crops-perils verifier) + approximate stage months (chile-crops-perils, **not verified against INIA**) | Agroseguros/INDAP public PDFs (URLs to record) | All rows need an INIA or ODEPA source before production claims |

Proposed Chile stress windows (from chile-crops-perils): cherry 25 Aug–15 Jan; table grape (Limarí)
5 Sep–31 Jan; wine grape 15 Sep–30 Apr; apple 15 Sep–15 Apr; avocado year-round (winter fruit frost
Jun–Aug); rice 15 Jan–20 Feb (vanazón). Blueberry 1 Sep–28 Feb and wheat/oats Oct–Feb are derived
here from the stage table in chile-crops-perils (bloom to harvest), not quoted from a source.

**Team call:** accept these approximate windows for the demo with a visible "approximate calendar"
label (PO default), or limit Chile scoring to the frost and harvest-rain windows only.

### D5. Phenology: derived per field, from its own NDVI

- v1 uses the calendar windows from D4 to decide "in season / fallow".
- The field's own NDVI curve (ADR-0007) is shown with the calendar window shaded, so a banker can see
  whether the crop is up.
- Automatic per-field green-up detection is **not** in v1: it has not been validated on real polygons
  (CATALOG open question 12). MCD12Q2 (ORNL) is a build-time check only.

## Superseded items

| Earlier decision | What changes | Applies to |
|---|---|---|
| ADR-0001 D1 "each crop has a typical calendar (sowing day, season length)" | Calendars become region- and zone-specific rows with a source and an "approximate" flag | both |
| ADR-0001 D1 Zone `irrigated` flag (manual) | Set from CIREN polygons in Chile; manual in Bolivia | Chile |

## Rejected / refuted

- **GLAD soybean 2024:** unusable for Bolivia.
- **MapBiomas class 40 (rice):** absent from the mirror; rice falls in 72 or 18. MapBiomas licence is
  CC BY 4.0 upstream, not CC-BY-SA. The 2019–2023 maps use class 18; 2024 uses 39 and 72, so remap
  before comparing years.
- **FAO Crop Calendar as "FAO open":** non-commercial without permission (copyright@fao.org).
- **GGCMI global calendar:** knows only the summer season; wrong for the Santa Cruz winter campaign.
- **CIREN land use without `_2`:** refuses queries.
- **Single-point irrigated test:** misses at town-centre points; use the polygon with a 500 m buffer.

## Consequences

- Adding a farm triggers 2–4 slow mask queries (CIREN ~4 s each). Run them once at farm creation and
  cache the result with the farm.
- Rice in Santa Cruz and sugarcane cannot be confirmed by any open map; the UI shows "crop unverified".
- GLAD soybean and CIREN state no licence; written permission is needed before production (ADR-0011).
