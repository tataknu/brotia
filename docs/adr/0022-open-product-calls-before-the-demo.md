# ADR-0022: Open product calls before the Sunday demo

- **Status:** Proposed (each call has a product owner default, which applies if nobody decides by code freeze, Sunday 07:00)
- **Date:** 2026-11-07
- **Builds on:** ADR-0016, ADR-0017 D5, ADR-0019, ADR-0020
- **Decided by:** the team (pending)

## Context

After the review fixes, the v1 numbers are honest, but four results will be questioned by a parametric-insurance
judge or will surprise the presenter. Each needs a call, not more code under time pressure.

## Decisions

### D1. Copiapó table grape: High badge, "verify" text

- **Situation:** score 69.6, tier High, from canopy moisture (NDMI z −1.1, moderate stress, impact 0.46) plus the low-confidence
  abandonment flag (0.4) and a geography amplifier (148 m below the zone average). The driver says "Vigour loss, not a confirmed
  stop of irrigation"; the credit actions are "watch before installment" and "field visit".
- **Options:** (a) keep, and explain it as "high water stress, verify on site"; (b) stop a low-confidence flag from scoring and let NDMI
  alone set the tier.
- **Default: (a).** It is consistent with the contract, and the contrast with Ovalle shows the guard working.

### D2. Paine walnut: no credit action for a mapped but unconfirmed burn

- **Situation:** the GWIS polygon (163 ha, 29 Nov 2025) covers the orchard, but native NDVI is 0.87 before and 0.86 after. Score 30.5,
  normal, no credit action. The driver text asks for a field visit, but no rule fires.
- **Options:** (a) accept; (b) add a credit metric for "burn mapped on the farm, unconfirmed" → field visit.
- **Default: (a)** for the demo; present Paine as the example of the system refusing a coarse polygon. (b) goes to v1.1.

### D3. Seeded override chg-0002 shadows the agent's flagship proposal

- **Situation:** the agent proposes bloom frost −2.4 → −2.0 °C for cherry on zone-requinoa, but the Requínoa cherry farm already has its
  own −2.0 override (chg-0002). Applying the proposal changes no number on the dashboard, and there has been no cold night anyway
  (coldest hour this week 5.2 °C at the Requínoa station).
- **Options:** (a) keep, and demo Apply for the audit trail ("proposed by agent, applied by user"), not for a score change; (b) remove
  chg-0002 (changes the sample spec, two Python tests, `rules.test.ts`, the contract fixture and its generator).
- **Default: (a).** Say in the demo: "This farm already had a more cautious setting; the agent's backtest supports the same value for the zone."

### D4. Snapshot date: 7 or 8 November

- **Situation:** the verified snapshot is dated 2026-11-07 (exported 20:45 UTC). A Sunday export would show 2026-11-08 but has not been verified.
- **Options:** (a) present the verified 11-07 snapshot; (b) run the demo-prep steps on Sunday morning and re-export with asOf 2026-11-08.
- **Default: (b) only if done before 07:00 and the verifier passes; otherwise (a).** Copy `app/public/snapshot/` aside before re-exporting, so the verified 11-07 copy stays available.

## Consequences

- None of these defaults changes code. D2 (b) and a northern table-grape calendar (ADR-0017 D5) are the first v1.1 items.
- The demo script in `docs/v1-status.md` follows these defaults.
