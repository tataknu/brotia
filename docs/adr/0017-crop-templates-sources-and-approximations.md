# ADR-0017: Crop templates: sources, approximations and absolute severity ramps

- **Status:** Accepted (all values approximate); D5 Proposed
- **Date:** 2026-11-07
- **Builds on:** ADR-0005 (temperature perils), ADR-0010 D4 (calendars), ADR-0013 D4 and D5, CONTRACT §E.3, §E.5
- **Supersedes:** ADR-0005 D1 percentile triggers, for v1 in Chile (D3 below)
- **Decided by:** the contract author and the svc-portfolio builder; templates served by `GET /crops` from `service/data/crop_templates.json`

## Context

ADR-0013 D4/D5 asked for one template per crop with stages, per-stage sensitivities, critical temperatures,
harvest-rain triggers, chill requirement, Kc per stage, a covered flag and risk weights. Discovery found
sources for most leaves (`families/chile-crops-perils`, Agroseguros policy sheets) but no verified INIA
calendar. Every template therefore carries `approximate: true`, and every leaf cites its source.

## Decisions

### D1. Sources per leaf

| Leaf | Source | Status |
|---|---|---|
| Frost `frostCriticalC` / `frostSevereC` per stage | FAO Frost Protection Vol. 1 (2005), Tables 4.7–4.9, after Proebsting & Mills (1978): T10 / T90 | cited |
| Avocado fruit frost | Hass fruit freezing point −1.6 °C (FAO Frost Protection, Table 4.9) | cited |
| Kc per stage | FAO-56 (Allen et al. 1998), Table 12 | cited; **hazelnut has no row, Kc taken from walnut** |
| Harvest rain (72 h) | Agroseguros "lluvia mayor" (INDAP sheets 2016–2022); table grape: white 8 mm, red 12 mm, Flame Seedless 5 mm | cited for grape; others approximate |
| Heat / sunburn | `chile-crops-perils` notes (walnut sunburn > 35 °C) | approximate |
| Chill hours | Trade and INIA-derived ranges (cherry Lapins 400–500 h, Santina 600–800 h) | approximate |
| Stage calendar | ADR-0013 D5 central-Chile windows, trimmed to tile the year | **not verified against INIA** |
| Weights a, b, c | 0.65, 0.35, 0.30 for all crops (ADR-0013 D6) | expert default |

The fixture values are kept; the build only refined citations (FAO-56 Kc, cherry cracking, hazelnut species name).

### D2. Representative values (bloom-type stage)

| Crop | Stage | Frost T10 / T90 (°C) | Heat (°C) | Harvest rain 72 h (mm) | Chill (h) | Cover |
|---|---|---|---|---|---|---|
| Cherry | bloom 09-01..10-05 | −2.4 / −3.9 | 30 | 30 (harvest 20) | 500 | sometimes |
| Blueberry | bloom 08-15..10-15 | −1.0 / −2.2 | 32 | 30 (harvest 20) | 400 | sometimes |
| Avocado | flowering 09-01..10-31 | −1.1 / −2.5 (winter −1.6 / −3.5) | 35 | 40 | 0 | rarely |
| Walnut | budbreak & bloom 09-10..10-20 | −1.1 / −2.8 | 35 | 40 (harvest 30) | 700 | rarely |
| Hazelnut | budbreak 09-01..10-31 | −2.0 / −4.0 | 35 | 40 (winter bloom 30) | 800 | rarely |
| Table grape | bloom 10-01..11-15 | −1.1 / −2.2 | 35 | 15 (harvest 8) | 150 | often |

### D3. Absolute ramps replace percentile triggers in v1

- ADR-0005 D1 proposed percentile triggers with degrees for display. v1 uses the **absolute ramps** of CONTRACT §E.5
  (e.g. frost severity = `ramp(Tmin, T10 + 1, T90)`, heat `ramp(Tmax, heatC − 2, heatC + 3)`, harvest rain `ramp(R, 0.5·T, 1.5·T)`).
- **Why:** the crop thresholds are physiological (bud kill), not climatological, and a RAN percentile baseline cannot be
  built in time (RAN history starts in 2009, ADR-0004 D1 same-stream rule). Weather baselines (CR2MET 1991–2020) are still
  shown as context bands.
- **Chill:** while as-of falls inside May–Aug, the requirement is prorated by days elapsed out of 123 (a small deviation from
  the literal §E.5; it does not affect a November demo). Chill hours are estimated from daily Tmin/Tmax with a linear daily
  curve and marked estimated.

### D4. Cover

- `coverLikelihood` per crop: table grape "often", cherry and blueberry "sometimes", the rest "rarely".
- When `Farm.covered` is null and the crop is "often" covered, the farm assessment and the imagery viewer carry a soft warning
  that NDVI and NDMI may read the plastic or mesh. Both sample table-grape farms show it.

### D5. Northern table-grape calendar (Proposed)

- The calendar is central-Chile. North of about 31° S (Atacama, Coquimbo) vines run 4–6 weeks earlier, so Ovalle and Copiapó
  are probably past bloom on 7 Nov while the template says "Bloom". The service warns on both farms.
- **Call:** add a northern zone shift for table grape (bloom about mid-Sep to mid-Oct, harvest from late Nov) as a zone override, or leave the warning.
- **Product owner default:** leave the warning for the demo; it changes no current score (no frost, heat or rain at either farm).
  Add the shift in v2 from an INIA or ODEPA source.

## Consequences

- All six templates are labelled approximate in the UI, and every value can be overridden per portfolio crop, zone and farm with an audit entry.
- Calibration of thresholds and weights against losses (Agroseguros by commune, the September 2013 frost) remains out of v1 (ADR-0013 D6).
- The farming agent (ADR-0020) can propose stage-threshold changes, but only values that its own backtest or history tools produced.
