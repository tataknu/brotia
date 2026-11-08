# ADR-0009: Event sources for the "recent climate disasters" panel

- **Status:** Accepted (D1–D5). D6 (free keys and the Diario Oficial end-date assumption) is Proposed.
- **Date:** 2026-11-06
- **Builds on:** [ADR-0001](0001-v0-product-and-risk-definitions.md) D8, [ADR-0003](0003-market-scope-and-sample-portfolios.md), [ADR-0006](0006-soil-moisture-and-irrigation-water-supply.md), [ADR-0008](0008-flood-and-surface-water.md), [ADR-0012](0012-source-access-patterns.md) D4
- **Evidence:** `CATALOG.md` (events catalog plan, refuted claims), `families/events-catalogs`,
  `families/chile-emergencies`, `families/chile-water`, `families/chile-ag-stats-credit`,
  `families/bolivia-national`, `families/sar-flood-water`

## Context

Banks asked for "the top recent climate disasters affecting my portfolio" (ADR-0001 D8). The panel
ranks events by the loan money exposed and labels events "near the book that hit no farm".

The discovery found that **no external catalogue covers recent droughts**: the Copernicus drought
tracker publishes each event 3–6 months after it ends, and GDACS has no 2024 or 2025 Bolivian drought.
Big public catalogues also draw footprints far too coarse for a farm: some GDACS flood "footprints" are
the whole Santa Cruz department, and one drought cluster spans 12 million km². Intersecting those with
farms would put every farm "inside" every event.

So the panel combines three kinds of evidence, each labelled honestly:

1. **Our own signals** (what the satellites and weather data show on the farms);
2. **observed footprints** (burned area, mapped flood);
3. **official acts and warnings** (decrees, declarations, forecast warnings), which carry legal or
   institutional weight for a credit committee.

## Decisions

### D1. Event layers per region

| Layer | Chile (primary) | Bolivia | Footprint test |
|---|---|---|---|
| Drought / water shortage (last 3–6 months) | **Our own** water-supply and rain/soil signals (ADR-0006), grouped into an event when ≥ 2 farms reach watch in overlapping windows | **Our own** rain, dry-spell and soil-moisture percentiles (ADR-0004, ADR-0006), grouped the same way | farm-level by construction |
| Official water-scarcity decree | **DGA decree XLS** (2008–2026), active = expiry after the as-of date | — | province / commune text → CONAF Comunas layer (CUT code) |
| Official agricultural emergency | **Diario Oficial** daily-index scraper (2016-08-17–), Minagri "emergencia agrícola" and MOP "escasez hídrica" resolutions (Could, backlog W-17) | Gaceta Oficial Santa Cruz decrees, curated by hand (Could) | commune / municipio |
| Wildfire burned area | **GWIS/EFFIS `nrt.ba.poly`** WFS (2012–, ~1 d latency, ~100 ha floor, CC BY 4.0); geometry union, never area sum (sums double-count ~12 %). Copernicus EMS fire vectors where activated (EMSR715 Feb-2024 Valparaíso; EMSR859 Jan-2026 Biobío/Ñuble) | same (1.6 M ha in Aug–Sep 2019 verified) | polygon ∩ farm, and distance |
| Active fire now | FIRMS NOAA-20/21 South America 7-day CSV (keyless, ~4 h) | same, as 5 / 25 km rings with a same-season percentile against FIRMS MODIS yearly 2000–2025 | point in ring; exclude managed cane and rice burning (Mineros) |
| Observed flood | Copernicus EMS rapid-mapping vectors where a flood activation exists (none found for the sample sites) | **GFM** observed flood per pass (ADR-0008); CEMS vectors to validate (EMSR853 Dec-2025 Piraí flood) | polygon ∩ farm; GFM "not observable" kept as its own state |
| Official heat / cold waves | DMC geoservicios heat and cold waves, last 90 days (keyless GeoJSON) | — | station → nearest farms |
| Forecast warnings | DMC `datos_AAA.json` + zone GeoJSON, **self-archived hourly** (no archive exists anywhere) | SENAMHI active-alerts JSON, self-archived at most hourly (`X-RateLimit-Limit: 100`) | point in polygon; labelled "official warning (forecast)" |
| Index and narrative | GLIDE + IFRC GO (country 46) + ReliefWeb RSS | GDACS + GLIDE + IFRC GO (country 33) | **never intersected with farms** |

### D2. Join and labelling rules

- Join catalogue entries on GLIDE only after checking that hazard and date agree (IFRC GO's "Fires
  Bolivia 2025" carries the December flood's GLIDE).
- Normalise GDACS alert-level case. GDACS wildfire alert level does not track size: parse hectares.
- GWIS is labelled "burned area" and includes agricultural burning.
- SENAMHI alert type 28 is a cold front, not frost. Warnings are forecasts, not observed events.
- Diario Oficial resolutions are matched by regex on titles; the "catástrofe" pattern gives false
  positives, so each match is checked against the resolution's "Resuelvo" text.

### D3. Ranking (unchanged from ADR-0001 D8)

Top 6 by exposure at risk, with a "most recent" toggle. An event within 50 km of a farm that hit none
is shown as "near the book, hit no farm" rather than $0. Each event shows its provider, its kind
(own signal / observed footprint / official act / forecast warning) and its date.

### D4. Older droughts (Could)

Copernicus GDO drought tracking (`jspeS`, 1991–, keyless, CC BY 4.0) labels older events as a
"regional drought event". Union multi-part features per `(id_cl_st, time)`. It cannot rank farms
(clusters up to 12 M km²) and lags 3–6 months, so it never represents an ongoing drought.

### D5. Start archiving now

DMC and SENAMHI warnings have no public archive. A small job snapshots both every hour into DuckDB from
now on. Started on Saturday (backlog W-12), it gives the panel less than one day of real warning history
by the Sunday 09:30 demo; say so on screen.

### D6. Team calls (Proposed)

| Call | Why | PO default |
|---|---|---|
| Sign up for a free FIRMS MAP_KEY | Keyless FIRMS has no Jan–Oct 2026 data (yearly 2026 returns 404). INPE monthly CSVs fill it keylessly but are 25–186 MB each | No key in v1: use GWIS polygons for 2026 burned area and FIRMS 7-day for "now". Keyless option for May–Oct 2026 hotspots: INPE daily CSVs (1–5 MB, from 2026-05-14; events-catalogs verifier; INPE licence unverified) |
| Diario Oficial declarations have no end date | We must assume one to call a declaration "active" | Active for 12 months after publication, labelled "assumed duration" |

## Rejected / refuted

- **Intersecting GDACS FL/DR polygons with farms:** department-sized or 2° blocks.
- **GDO jspeS for ongoing droughts:** each event is published 3–6 months after it ends (latency claim
  refuted).
- **CONAF SIDCO as the current-season fire primary:** stale since 2026-09-08 and misses every large
  Jan-2026 fire (8,193 ha against GWIS's ~315 k ha). Enrichment only.
- **SENAPRED alerts:** AppSync behind a Cognito login (401).
- **GWIS latency ~3 weeks and 30–50 ha floor:** corrected to ~1 day and ~100 ha.
- **CEMS keyless history from 2012:** the keyless JSON starts at 2023-03 (EMSR656).
- **ReliefWeb API v2, EM-DAT, IFRC Montandon:** need approval, registration or a token.
- **DesInventar:** ends in 2015.
- **DGA ArcGIS decree `VIGENTE` flag:** stale (2023-04-21).

## Consequences

- The panel works with zero external drought catalogue, because recent droughts come from our own
  signals. This must be said in the UI ("detected from satellite and weather data on your farms").
- Provider calls run in parallel and merge (ADR-0012 D4); one failing provider never empties the panel.
- Demo events with verified footprints: EMSR853 (Bolivia flood, near the book), GWIS/EMSR859 (Chile
  Jan-2026 Biobío/Ñuble fires; 24.9 km from Los Ángeles and 33.9 km from Chillán, measured from the
  town points in chile-emergencies notes, not re-verified; recheck on the CIREN parcels), the active Limarí decree (Ovalle table grapes), and the 2023/24 Santa Cruz drought from
  our own signals.
