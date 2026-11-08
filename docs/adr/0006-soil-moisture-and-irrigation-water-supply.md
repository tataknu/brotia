# ADR-0006: Soil moisture, water balance and irrigation water supply

- **Status:** Proposed. D1 (Bolivia soil moisture source) and D4 (Chile water-supply composite) need
  the team's call. D2, D3 and D5 are ready to accept; D3's Chile soil source (ERA5-Land) is unverified
  at Chilean sites.
- **Date:** 2026-11-06
- **Builds on:** [ADR-0001](0001-v0-product-and-risk-definitions.md) D4, [ADR-0003](0003-market-scope-and-sample-portfolios.md), [ADR-0004](0004-precipitation-and-station-data.md), [ADR-0005](0005-temperature-eto-frost-heat-and-hail.md)
- **Evidence:** `CATALOG.md` (Chile national sources, "what changes for irrigated Chilean
  agriculture", refuted claims), `families/soil-moisture`, `families/chile-water`,
  `families/chile-crops-perils`, `families/chile-ag-stats-credit`

## Context

ADR-0001 D4 builds drought from three parts: rain deficit, dry spell and soil moisture, and it
down-weights drought × 0.4 when a zone is irrigated. That works for a rain-fed soy field in Santa Cruz.
It does not work for most of Chile:

- Chilean fruit is irrigated by default (O'Higgins cherries: 27,408 ha drip, 1 ha rain-fed).
- What hurts an irrigated orchard is **water supply**: a dry winter in the Andes, low reservoirs, low
  river flow, and an official water-scarcity decree. Rain on the field barely matters.
- Down-weighting drought × 0.4 for irrigated farms would hide the megadrought years (2019–2022:
  21, 33, 38 and 35 decrees a year) instead of showing them.

For the lender the question is the same in both regions: "will this farm have the water to make the
crop that repays the loan?". The data that answers it differs by region.

## Decisions

### D1. Bolivia root-zone soil moisture: ERA5-Land (Proposed)

| Role | Source | Baseline | Latency | Evidence |
|---|---|---|---|---|
| Primary | ERA5-Land `soil_moisture_0_to_100cm_mean` daily, Open-Meteo `models=era5_land` (demo); CDS for production | 1991–2020, same ±7-day window | ~6 d | Confirmed live (soil-moisture verifier). Tajibos Oct 7–Nov 1 percentile: 2023 = 7, 2024 = 0 (against a 1996–2025 baseline; recompute on 1991–2020, backlog V-3h). 30-y pull costs 80.5 Open-Meteo weight units |
| Fallback | FAO-56 single bucket `S += P − Ks·Kc·ETo`, forced by **CHIRPS rain** (ADR-0004) and ERA5 ETo, TAW from SoilGrids `wv0033 − wv1500` (126 mm/m Tajibos, 147 mm/m Mineros) | same | follows CHIRPS | Bucket vs ERA5-Land daily r 0.89, anomaly r 0.83 (forced with ERA5 rain in the probe) |
| Second opinion | GRACE-DA NDMC root-zone GeoTIFF percentile (keyless, weekly, 2003–); CPC monthly leaky bucket | own | weekly / monthly | Verified live. Use id `rtzsm_inst`; SISSA name labels are swapped |

**Team call:** ERA5-Land as primary, or the CHIRPS-forced bucket as primary so that soil moisture
agrees with the rain signal. ERA5 missed the Aug-2020 event (CATALOG open question 3). PO default:
ERA5-Land primary for v1 (verified, already flags 2023 and 2024), bucket as fallback. Caveat: 2024/25 is
the control season (ANAPO: normal yields), and ERA5 rain in Jul–Oct 2024 was 99 mm against 201 mm
(CHIRPS) and 213 mm (POWER) (soil-moisture verifier), so the 2024 flag may be ERA5's dry bias, not a
drought. V-1 must check soil moisture in the control season too.

**Show antecedent rain.** Soil moisture integrates rain from before the window: at Tajibos in Oct 2026,
soil was at the 87th percentile while window rain was at the 10th, plausibly because of 58 mm on
Oct 5–6 (researcher's explanation; the verifier did not re-test it, verified = false). The
driver text must mention it ("soil still wet from 58 mm on 5–6 Oct") instead of showing two
contradicting numbers.

### D2. Bolivia water demand and actual ET

- ETo from ADR-0005 D2 feeds the water-balance driver ("crop water demand 130 % of normal").
- Actual ET from FAO WaPOR v3 L1 AETI/RET (300 m, dekadal, 2018–, CC BY) is a **Could**: it is a
  short baseline (z-score with an sd floor) and in-season only.

### D3. Chile rain-fed farms keep the rain-based drought

Los Ángeles (wheat), Temuco (wheat/oats) and any farm with no irrigated-area hit keep ADR-0001's
three-part drought, using CR2MET rain (ADR-0004 D2) and ERA5-Land soil moisture as a percentile only.
ERA5-Land soil moisture has **not** been probed at a Chilean site (only Bolivia), and the CR2MET-forced
bucket fallback is untested; both are verified = false for Chile. The insurer reference for rain-fed
annual crops is "monthly rain < 50 % of normal and below the crop's water requirement" (Agroseguros/INDAP
sheets: **unverifiable**, exact PDF URLs not recorded; context only).

### D4. Chile irrigated farms: basin water-supply signal replaces field drought (Proposed)

A farm is **irrigated** when its polygon intersects, or lies within 500 m of, a CIREN `HIDRICO_PUBLICO`
irrigated-area polygon (never a single point test; ADR-0010 D2). For irrigated farms the drought peril
is replaced by a **water-supply** signal for the farm's basin:

| Input | Source | Normal | Latency | v1 priority | Evidence |
|---|---|---|---|---|---|
| Active water-scarcity decree covering the farm's province / commune | DGA history XLS `Decretos_zonas_escasez_historico_*.xls` (251 decrees plus 19 embedded header rows, 2008–2026) **plus** a scrape of the decree page for new `Decreto-*.pdf` links, because the XLS lags by weeks (current file `Last-Modified` 2026-09-04) | — | weeks | **Must** | Verified live. Active on 2026-11-07: Limarí, Elqui, Choapa, Chiloé, Lluta Bajo. The filename embeds a date, so scrape the page for the current link. The DGA ArcGIS layer's `VIGENTE` flag is stale (2023-04-21): use it for geometry and history only |
| Sep–Mar snowmelt volume forecast vs 1991–2020 | DGA *Pronóstico de caudales de deshielo* PDF (October, 19 gauges Copiapó–Ñuble) | in the PDF | yearly | **Must** | Verified live. Deterministic ±20 %, not probabilistic; no Biobío |
| Reservoir storage vs historical monthly mean | DGA weekly bulletin PDF (25 reservoirs) | in the PDF | ~1 week | Could (backlog W-15) | Verified live; parser needs column-position tests |
| Monthly river flow vs 1991–2020 mean | DGA monthly bulletin PDF | in the PDF | 5–6 weeks | Could (no v1 story) | Verified live; **the regex parser picked the wrong station** once (see refuted) |
| Snow-cover percentile per basin | MODIS MOD10A2 8-day, PC zonal statistics | 2001– same composite date | ~6 d | Could | Probed live by the researcher (~0.5 s per call); not re-probed by the verifier (verification: unverifiable) |

Combination rule for v1 (proposal): severity = the worst of the available inputs, each expressed as a
0–1 ramp from its own "% of normal"; **an active decree sets the floor at the watch tier**. The
signal enters the score with drought's weight (1.0). The irrigated × 0.4 multiplier in ADR-0001 D4 no
longer applies to Chile.

**Team call:** accept "decree + snowmelt forecast" as the v1 minimum (PO default), and whether a decree
alone should set "watch" for every irrigated farm in its province.

### D5. Gridded cell rule

Soil moisture follows ADR-0004 D6: the cell containing the field centroid. ERA5-Land is 0.1°, so
nearby farms may share values; the UI says so.

## Superseded items

| Earlier decision | What changes | Applies to |
|---|---|---|
| ADR-0001 D4: drought parts × 0.4 when irrigated | Replaced by the water-supply signal (D4) | Chile irrigated farms |
| ADR-0001 D3 `soilMoisturePctile` (20th) | Unchanged in meaning; computed on ERA5-Land or the bucket | Bolivia, Chile rain-fed |

## Rejected / refuted

- **"Snow drought in the south-centre" (chile-water notes):** refuted by the verifier. The Biobío at
  Rucalhue in Sep 2026 was **941 m³/s, 168 % of its 560 m³/s mean**, not 220; the parser read another
  station. Lago Laja is 88 % of its normal, not "33 % = stress". 2026 is wet in the north-centre
  (snow +97 % to +485 %), and the south-centre had an above-normal peak followed by a fast melt.
- **DGA decree count 269:** the file holds 251 decrees (269 rows); the latest is No. 185 (Choapa).
- **DGA ArcGIS `ESTACION_EMBALSE`:** stale since 2019-11-12. Rejected.
- **SNIA / BNA live discharge:** login or 403 to scripts. Not pursued.
- **GloFAS for narrow Andean valleys:** Aconcagua monthly medians ~0.2 m³/s against 13–28 observed.
  Large rivers only (Maule, Biobío, Ñuble, Tinguiririca), as a labelled model.
- **NASA POWER GWETROOT:** anomaly r 0.38 against ERA5-Land, sign inverted in 2024 and 2026.
  Validation only.
- **Open-Meteo `best_match` for soil moisture:** splices IFS (bias sd 0.022 vs signal spread ~0.08).

## Consequences

- Up to three DGA PDF parsers: the snowmelt forecast for v1; the weekly and monthly bulletins are
  Could. Each needs a golden-value test against a saved PDF, because the first parser silently returned
  another station's numbers.
- The demo story for Chile changes from "dry soil" to "water supply": e.g. Ovalle table grapes under an
  active decree even though the 2026 snowpack is high, because decrees lag hydrology. The UI must show
  both facts, not just the decree.
- DGA products are marked provisional and state no licence (ADR-0011).
