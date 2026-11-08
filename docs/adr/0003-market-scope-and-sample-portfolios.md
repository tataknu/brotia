# ADR-0003: Market scope, regions and sample portfolios

- **Status:** Accepted (D1–D4). D5 is Proposed and needs three team calls, listed there.
- **Date:** 2026-11-06
- **Builds on:** [ADR-0001](0001-v0-product-and-risk-definitions.md), [ADR-0002](0002-v1-real-data-architecture.md)
- **Evidence:** `docs/data-discovery/CATALOG.md` (market priority, open questions 1–2),
  `followups/02-farm-relocation.md`, `families/chile-ag-stats-credit`, `families/chile-satellite-fit`,
  `families/chile-crops-perils`

## Context

On 2026-11-06 the team decided that **Chile is the primary market and Bolivia the second region**.
ADR-0001 and ADR-0002 were written before that decision. They assume Bolivia everywhere: a Santa
Cruz crop list, Santa Cruz default climate, a Santa Cruz map centre and 12 Bolivian sample farms. The
verifiers noted that the Chile decision was not recorded anywhere outside the discovery notes
(`chile-ag-stats-credit/verification.md`). This ADR records it.

The decision matters for a lender because the two regions lose money in different ways:

- **Bolivia (Santa Cruz lowlands):** large, rain-fed soy and grain fields. The main risk is drought, as
  in the 2023/24 season, when soy yields in Pailón fell to 0.42 t/ha (ANAPO Memoria 2024).
- **Chile (central and southern valleys):** small, mostly irrigated fruit orchards and vineyards, plus
  rain-fed cereals in the south. The main risks are spring frost at bloom, rain at harvest, heat,
  irrigation water shortage and wildfire. For O'Higgins cherries, 27,408 ha are drip-irrigated and 1 ha
  is rain-fed (CIREN-ODEPA cadastre, verified live 2026-11-07).

Both sample portfolios were also wrong on the ground. **10 of the 11 Chile test coordinates are town
centres** by ESA WorldCover (CATALOG, `chile-satellite-fit`; CIREN land use puts all 11 in urban
classes, `chile-ag-stats-credit`), and **9 of the 12 Bolivian points were not on usable cropland**
(forest, river channel, pasture or the wrong crop). Any satellite number at those points would measure a town or a forest.

## Decisions

### D1. Two regions, Chile first

| Item | Chile (primary) | Bolivia (second region) |
|---|---|---|
| Default portfolio when the app opens | Chile sample portfolio | Selectable |
| Default map centre | Central valley, about (−71.3, −34.6), zoom to fit the portfolio | Santa Cruz soy belt, about (−62.9, −17.3) |
| Default currency | USD (CLP allowed) | USD (BOB allowed) |
| Region of a farm | Derived from its centroid (inside Chile or Bolivia). The region selects the source chain (ADR-0011) and the peril set (D3) | Same |
| Other countries | Out of v1. A farm drawn elsewhere is rejected with a clear message, instead of silently getting Santa Cruz weather as in v0 | Same |

Global satellite sources (Sentinel-2, Landsat, MODIS, GFM, FIRMS, GWIS) serve both regions. Most
weather, water, crop and event sources are region-specific, so every later ADR states the choice per
region.

### D2. Bolivia sample portfolio: the 12 verified field polygons

Adopt `docs/data-discovery/followups/02-farm-relocation/farms_fields.geojson` as the Bolivian sample
portfolio. Evidence (follow-up 02, all probes live 2026-11-07, keyless):

- 3 points kept, 7 moved 1.3–4.5 km onto cropland, 2 provisional (see D5).
- Each field is an 81 ha square (900 m × 900 m, UTM 20S) with 12–16 MODIS pixel centres inside, so all
  pass a 4-pixel minimum.
- Each field has a clear Sentinel-2 scene in Feb 2026 (NDVI 0.62–0.86) and in Aug 2026 (NDVI 0.33–0.57).
- The squares sit inside crop blocks but are not real field boundaries. The UI calls them "sample
  fields".

### D3. Chile sample portfolio: real CIREN parcels

Adopt `docs/data-discovery/families/chile-ag-stats-credit/samples/chile_test_farm_polygons.geojson`
(10 sites, nearest real polygon of the target crop, 0.5–4.6 km from the town coordinates, CIREN ArcGIS
REST, HTTP 200, 3.6–4.6 s per query, verified live 2026-11-07). Where `families/chile-satellite-fit`
holds a block for the same site (`field_*.geojson`: Requínoa, Quillota, Curicó, Ovalle, Colchagua,
Chillán), prefer the block that the satellite family has already tested against Sentinel-2.

| Site | Crop | Source layer | Irrigated | Status |
|---|---|---|---|---|
| Quillota | Avocado | Catastro Frutícola | assumed yes (HIDRICO_PUBLICO test not run) | adopted |
| Ovalle / Limarí | Table grape | Catastro Frutícola | yes (HIDRICO_PUBLICO hit) | adopted |
| Requínoa | Cherry | Catastro Frutícola | yes (HIDRICO_PUBLICO hit) | adopted |
| Santa Cruz (Colchagua) | Wine grape | Land use `_2` (VID, 1.4 ha) | assume yes | adopted |
| Curicó | Cherry (apple nearby) | Catastro Frutícola | assumed yes (HIDRICO_PUBLICO test not run) | adopted |
| Chillán | Blueberry | Catastro Frutícola | yes by default (Ñuble: no HIDRICO layer; ADR-0010 D2) | adopted |
| Parral | Rice | Land use `_2` (ARROZ) | yes (HIDRICO_PUBLICO hit) | adopted |
| Los Ángeles | Wheat | Land use `_2` (TRIGO, 14.2 ha) | no (rain-fed) | adopted |
| Talca | Wine grape | Land use `_2` (VID, `ha = 0`, class `S/C`) | unknown | provisional |
| Temuco | Wheat / oats rotation | Land use `_2` (0.36 ha, rotation with pasture) | no (rain-fed) | provisional |
| Osorno | Potato | none found (CONAF layer has no crop detail) | no | gap, see D5 |

CIREN polygons carry no planting year. That comes from the ODEPA CSV by commune (ADR-0010).

### D4. Crop list and peril set by region

ADR-0001 D1 lists 10 Bolivian crops. v1 keeps that list for Bolivia and adds a Chile list.

| Region | Crops in v1 | Main perils for a lender |
|---|---|---|
| Chile | cherry, apple, table grape, wine grape, avocado, blueberry, rice, wheat, oats, maize, potato | spring frost at bloom; irrigation water shortage (megadrought); rain at harvest; heat; wildfire; rain-fed drought (south only) |
| Bolivia | soy, maize, wheat, sorghum, sunflower, rice, sugarcane (quinoa, potato and chia stay in the enum but have no sample farm) | drought; flood; heat; frost (rare in the lowlands); wildfire |

The formulas for each peril are in ADR-0004 to ADR-0009. Hail is not a scored peril in v1 in either
region (ADR-0005 D6).

### D5. Open team calls on the portfolios (Proposed)

| # | Call | Evidence | PO default if no decision by Saturday 18:00 |
|---|---|---|---|
| 1 | **Arrocera Mineros (rice, Bolivia).** Drop it, relabel the crop, or keep it with a "crop unverified" badge | No field within 10 km has ≥ 5 % historical water; MapBiomas 2024 has no rice class in the region; the provisional field has a flat NDVI (amplitude 0.10) that looks perennial | Relabel to sugarcane-like "perennial, crop unverified" and keep the badge |
| 2 | **Agricola Warnes Sur (soy, Bolivia).** Accept the 14.7 km move, or keep the location as a non-soy crop | The area south of Warnes is pasture and urban; the only nearby candidate was soy in 2021 only | Accept the move and say so in the farm's provenance |
| 3 | **Osorno (potato, Chile).** Find a parcel (CIREN `PROPIEDADES_RURALES` or a drawn polygon) or drop the site | No CIREN crop polygon found for potato near Osorno | Drop Osorno from the demo portfolio (10 Chile farms) |

## Superseded items

| Earlier decision | What changes | Applies to |
|---|---|---|
| ADR-0001 D1 crop enum | Extended with the Chile crops in D4 | Chile |
| ADR-0001 D1 portfolio currency (USD or BOB) | CLP added for Chilean portfolios; amounts are still never converted | Chile |
| ADR-0001 D10 sample portfolio "12 farms in the Santa Cruz soy belt" | Replaced by the two portfolios in D2 and D3 | both |
| ADR-0001 Consequences: "the fake engine bakes in Santa Cruz climatology" | Removed. A farm outside Chile or Bolivia is rejected (D1) | both |
| ADR-0001 D3 defaults and D4 drought logic | Region- and crop-specific; see ADR-0005 and ADR-0006 | Chile |
| ADR-0002 D4 MODIS per-field baseline | Does not work for Chilean orchards; see ADR-0007 | Chile |

## Consequences

- The UI needs a region switch and a per-region default map centre. All Chile defaults replace the
  Santa Cruz defaults in `app/`.
- Every later ADR must give a per-region source choice.
- The sponsor (Suyana) and its flagship market are Bolivian, and the only event with ground truth is
  the Bolivian 2023/24 drought (ADR-0004, backlog validation). The demo therefore needs both
  portfolios, even though Chile is the primary market.
- The CIREN polygons state no licence. They are fine for the demo, but a written OK from CIREN is
  needed before production (ADR-0011).
