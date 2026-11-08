# ADR-0019: Risk engine as built, and the v1.1 trust guards (abandonment, fire, irrigation, peers)

- **Status:** Accepted
- **Date:** 2026-11-07
- **Builds on:** ADR-0013 D3, D6, D7; CONTRACT §E.1, §E.5, §E.7, §E.9–§E.11 (with the v1.1 notes added on 2026-11-07)
- **Decided by:** the svc-risk builder, the integration pass and the review-fix pass; the v1.1 notes are recorded in `contracts/v1/CONTRACT.md`

## Context

ADR-0013 D6 fixed the risk formula and D7 the water ladder. The first live run on real data showed that
some rules, applied literally, produced confident claims that the pixels did not support:

- **Copiapó table grape** scored 99 "abandoned, high confidence" while its canopy stayed at NDVI 0.40–0.50 and recovered.
- **Paine walnut** scored 75 "burned area on the orchard → restructure review" while its own 10 m NDVI was flat across the fire date (0.87 → 0.86).

For a parametric-insurance audience, a false "abandoned" or "burned" is worse than a missed one. The review added guards
that check coarse or statistical signals against the farm's own native pixels.

## Decisions

### D1. Formula as specified

- C and D are noisy-OR: `1 − ∏(1 − s_p · x_p)`. The 0.5 · weighted-mean + 0.5 · max blend is the base formula over C and D
  (ADR-0013 D6), not a per-peril combination. Contract fixtures reproduce exactly (58.6 and 13.4).
- G is the **mean of the available** geography factors. Unavailable factors still appear as zero-impact drivers with the
  reason; with none available G = 0 and a warning is added.
- Frost pocket: Copernicus DEM GLO-30 via Planetary Computer statistics; farm = mean of a 60 m disc on the centroid, zone =
  mean of the zone circle. GLO-30 is a surface model (it includes canopy); the provenance says so.

### D2. Abandonment needs a collapse and no recovery (CONTRACT §E.10 v1.1)

- The z run (z ≤ −2 for ≥ 3 composites, not zone-wide) still sets the flag.
- Confidence stays as computed only if the run is an **absolute canopy collapse** (run mean NDVI < 0.30, or ≤ 60 % of normal)
  **and** vigour has **not recovered** (current persistent z ≤ −1.0).
- Otherwise: confidence low (severity 0.4), and the evidence starts "Vigour loss, not a confirmed stop of irrigation" and asks for a field visit.
- **Effect on the sample:** Ovalle stays confirmed (30 composites, mean NDVI 0.18, still z −1.6). Copiapó drops from 99 to 69.6.

### D3. A burned-area polygon is checked against the farm's own NDVI (CONTRACT §E.5, §E.7 v1.1)

- When a GWIS footprint intersects the farm, compare the last clear composite in the 15 days before the fire with the lowest
  clear composite in the 15 days after.
- Green before (≥ 0.40) and a drop < 0.10 → the pixels contradict the polygon: severity **0.4** (as for a fire in the zone),
  estimated, both NDVI values quoted, field visit suggested, and `events.burnedAreaIntersects` stays false (no restructure review).
- Drop confirmed, or no clear view on one side → severity 1.0, and the text says which.
- **Effect:** Paine drops from 75.1 (high) to 30.5 (normal).

### D4. Irrigation rung 1 is relative to the zone (CONTRACT §E.11 v1.1)

- Order: lender declaration → CIREN irrigated polygon within 500 m → dry-season green relative to the zone (orchard Jan–Mar
  median ≥ 0.35, zone 25th percentile ≤ 0.35, gap ≥ 0.25) → "unknown".
- Copiapó now reads irrigated "yes" (0.42 against 0.01), so rung 1 and rung 5 no longer contradict each other.

### D5. Peers capped at 8

The contract asked for up to 20 nearest same-crop peers. The service uses at most **8** to bound cold Planetary Computer reads;
the provenance note says "N found, max 8 used" (CONTRACT §E.9 deviation, review finding ST-7). The peer reading is context and does
not change the score except through abandonment.

### D6. Provenance tells the truth about dates

- Vigour, water stress and peers report the date of the **last clear scene**, and `estimated: true` when any composite used was gap-filled.
- `dataAsOf` for NDVI, NDMI and imagery is the last clear acquisition; for tmin, tmax and precip it is the station week when a RAN week was used.
- "Last 7 days" anchor on the latest date ≤ as-of with data if at most 10 days old; a warning appears when it is more than 3 days old.

### D7. Driver wording names the cause

- The water driver puts the actual cause first (canopy moisture, NDMI z) and gives snowmelt as context ("…although the snowmelt
  forecast 169 % of normal…: supply is not the cause").
- Frost, heat and rain name the station and its distance ("Coldest hour 5.2 °C on 7 Nov (Requinoa station, 5.1 km away)").
- Table grapes north of 31° S carry a warning that the stage comes from the central-Chile calendar (ADR-0017 D5).

### D8. Performance and caching

- One `app.imagery.vigour_signals` call per farm (ADR-0014 D7) replaces per-peer series. Cold 12-farm portfolio: 25–94 s; warm: 1.0 s.
- Farm assessments are cached in DuckDB (kind `risk_farm`), keyed by a sha1 of farm, effective zone, template, country, currency,
  as-of, peer settings and code version (`risk-v1.6`). TTL 1 h, or 10 min when a source was missing; the demo-prep command raises both to 24 h.
- A farm whose assessment throws is ranked with score 0, tier normal and the headline "Assessment unavailable: …".

## Consequences

- **Sample result (snapshot 2026-11-07):** high 2 (Ovalle 100, Copiapó 69.6), watch 1 (Curicó 47.8), normal 9; 5 credit actions
  (Ovalle 3: watch before installment, field visit, restructure review; Copiapó 2: watch before installment, field visit). Total
  exposure USD 2,419,167; at watch or high USD 606,667.
- **Not built:** `canopyMinusAirC` (Landsat surface temperature, rung 4) is always null, with a provenance note. Rung 1's "rain-fed
  land browns" uses a zone percentile, not a land-cover mask.
- **Open:** Copiapó stays High from NDMI moderate stress plus the low-confidence flag; Paine now has no credit action at all. Both are
  product calls in ADR-0022.
