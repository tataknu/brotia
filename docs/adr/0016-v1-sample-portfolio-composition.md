# ADR-0016: v1 sample portfolio: 12 real CIREN orchards, illustrative lender side

- **Status:** Accepted
- **Date:** 2026-11-07
- **Builds on:** ADR-0003 D1 (sample portfolios on verified real fields), ADR-0010 (CIREN, irrigated flag), ADR-0013 D1, D3, D11
- **Supersedes:** ADR-0003 D2 (10 CIREN parcels across the old Chile crop list) for v1
- **Decided by:** the svc-portfolio builder, live on 2026-11-07

## Context

ADR-0013 D11 requires a Chilean sample portfolio of real CIREN orchards covering all six crops, with loans. The
lender side (bank, borrowers, loans) cannot be real. The portfolio must also tell the demo stories without
anyone hand-picking a result.

## Decisions

### D1. Selection rule

- Two orchards per crop, chosen live from CIREN Catastro Frutícola: the right `especie_01`, 2–30 ha, compact shape,
  a few km outside town centres.
- The two contract fixture orchards are kept: Requínoa cherry (CIREN 22722) and Ovalle table grape (CIREN 663).
- Hazelnut is `AVELLANO` in CIREN (confirmed live); `cirenEspecie` stays `['AVELLANO', 'AVELLANO EUROPEO']` with the citation.

| Farm id | Crop | ha | CIREN layer / objectId | Zone | Loan (USD) |
|---|---|---|---|---|---|
| cl-requinoa-cherry | cherry | 2.3 | 61 / 22722 | zone-requinoa (shared) | 120,000 |
| cl-curico-cherry | cherry (new planting) | 5.6 | 62 / 6545 | auto | 260,000 |
| cl-chillan-blueberry | blueberry | 4.5 | 63 / 989 | auto | 60,000 |
| cl-los-angeles-blueberry | blueberry | 11.0 | 64 / 1280 | zone-los-angeles (shared) | 260,000 |
| cl-quillota-avocado | avocado | 23.5 | 59 / 12007 | auto | 900,000 |
| cl-cabildo-avocado | avocado (Petorca) | 12.3 | 59 / 2674 | auto | 140,000 |
| cl-requinoa-walnut | walnut | 23.9 | 61 / 15328 | zone-requinoa (shared) | 220,000 |
| cl-paine-walnut | walnut (replanting) | 4.6 | 60 / 4268 | auto | 110,000 |
| cl-parral-hazelnut | hazelnut (new planting) | 20.5 | 62 / 3156 | auto | 380,000 |
| cl-los-angeles-hazelnut | hazelnut | 7.4 | 64 / 1286 | zone-los-angeles (shared) | 75,000 |
| cl-ovalle-table-grape | table grape | 5.8 | 58 / 663 | auto | 180,000 |
| cl-copiapo-table-grape | table grape | 6.2 | 57 / 1286 | auto | 340,000 |

Total outstanding on 2026-11-07: USD 2,419,166.68.

### D2. Real versus illustrative

- **Real:** polygons and CIREN attributes.
- **Illustrative, and labelled so:** the bank ("Banco Valle Andino", fictional; named "Banco Demo" until ADR-0026 D6), farm names, loans, installments and the seeded rule edits.
- **Currency:** USD (the contract has no local currencies).
- **Built once, offline at request time:** `data/sample_portfolio_cl.geojson` (made by `app.domain.build_sample`) plus
  `sample_spec.py`; installments come from the ported schedule code. No network call at request time.

### D3. Zones

- Shared zones exist only where sample farms really fall inside one 35 km² circle: **zone-requinoa** (cherry + walnut) and
  **zone-los-angeles** (blueberry + hazelnut). Every other farm keeps its own auto zone, as the app does.

### D4. Seeded audit trail

Three user changes are seeded so the audit trail and "Custom" markers have content:

| Id | Scope | Path | New value |
|---|---|---|---|
| chg-0001 | zone auto-cl-ovalle-table-grape | `overrides.table_grape.rules.stages.harvest.harvestRainMm72h` | 8 → 5 mm (Flame Seedless) |
| chg-0002 | farm cl-requinoa-cherry | `overrides.rules.stages.bloom.frostCriticalC` | −2.4 → −2.0 °C (frost pocket) |
| chg-0003 | farm cl-requinoa-cherry | `creditRuleOverrides.cr-risk-high-before-installment.when.withinDaysBeforeInstallment` | 60 → 90 days |

The portfolio also adds one credit rule, **pf-score-80** (risk score ≥ 80 → restructure review).

chg-0002 shadows the agent's flagship zone proposal (bloom frost −2.4 → −2.0 °C on zone-requinoa); see ADR-0022 D3.

### D5. Irrigation from CIREN, honestly

- Test: farm polygon with a 500 m buffer, POST `returnCountOnly` against the CIREN irrigated-area layers.
- Inside covered regions, no hit means **unknown**, never "no".
- South of Maule there is no mask: fruit is irrigated "yes" with `estimated: true` (ADR-0010 D2).
- Results: unknown from the mask for Requínoa walnut, Paine walnut, Parral hazelnut and Copiapó table grape; estimated yes for
  Chillán blueberry, Los Ángeles blueberry and Los Ángeles hazelnut. For these, rung 1 relies on the dry-season vigour test
  (ADR-0014 D7) or the lender's declaration.
- Ovalle is declared irrigated by the lender (`irrigatedDeclared: true`), and CIREN also finds 5 irrigated polygons within 500 m.

### D6. Privacy and caching

- The property tax roll field (`rolpredi`) is **never requested** from CIREN.
- The CIREN cache never expires (each region's survey is a fixed snapshot). Clear the `ciren_*` cache rows after a new survey.

## Consequences

- **Variety and planting year are null** for every sample farm: CIREN polygons carry neither. ODEPA has them per commune,
  not per polygon, so they were not attached.
- Los Ángeles hazelnut has few same-crop peers in its zone and may read `insufficient_peers`.
- CIREN `objectId` is unique only within a layer: 1286 is both the Copiapó grape (layer 57) and the Los Ángeles hazelnut (layer 64).
  `sourceLayer` tells them apart.
- `/ciren/orchards`: when a layer exceeds the server's 2,000-feature page, "nearest 300" means nearest among those returned; this is
  flagged in `truncated` and in the provenance note.
