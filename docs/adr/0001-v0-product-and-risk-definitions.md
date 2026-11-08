# ADR-0001: v0 product and risk definitions

- **Status:** Accepted
- **Date:** 2026-11-06
- **Scope:** Climate Loan Monitor v0 (`app/`), Suyana challenge track, MIT Energy & Climate Hack 2026

## Context

Suyana asked for a platform that uses satellite and weather data to show a lender which farm
loans in its portfolio are under climate stress, and why. The team agreed the following
clarifications before building v0:

1. A loan is: origination date, maturity date, amount, and payment schedule.
2. Banks want to know the top recent climate disasters so they can adjust their portfolios.
3. Insurance payout triggers are out of scope; this is a credit-risk monitor, not an insurance product.
4. There is no historical yield data. Stress must be inferred from satellite and weather signals only.

v0 was built to agree on the product shape. All climate and satellite data in v0 is fake but
deterministic.

## Decisions

### D1. Core entities

| Entity | Definition |
|---|---|
| **Portfolio** | A lender's book: name, lender, one currency (USD or BOB). The currency locks once loans exist; amounts are never converted. |
| **Farm** | One drawn polygon (GeoJSON, lng/lat) with a crop, optional sowing date, area (ha, computed), centroid, zone, optional threshold overrides, and one loan. A portfolio can have many farms. |
| **Crop** | One of: soy, maize, wheat, sorghum, sunflower, rice, sugarcane, quinoa, potato, chia. Each has a typical calendar (sowing day, season length). |
| **Zone** | A named set of baseline settings shared by several farms: baseline length (3–10 years, default 5), stress window (month-day range, may cross the year end), irrigated flag, and seven thresholds. |
| **Override** | A per-farm replacement for any single zone threshold. Effective threshold = zone value unless the farm overrides it. |
| **Loan** | Origination date, maturity date, amount, currency, schedule type, installments. |
| **Schedule type** | Bullet, monthly, quarterly, semiannual, at harvest (sowing date + crop season length), or custom (editable rows). Generated schedules split principal in whole cents, with leftover cents on the last installments. |

### D2. Baseline: compare each field with itself

"Normal" means **this field's own history for the same time of year**, over the zone's
`baselineYears`. It does not mean a fixed regional threshold. Every series point carries `mean`,
`p10` and `p90` for that day of year (pooled ±7 days). This follows Suyana's guidance and
reduces basis risk between farms in different microclimates.

### D3. Thresholds (zone defaults)

| Key | Meaning | Default |
|---|---|---|
| `ndviAnomalyZ` | NDVI standard deviations below the field's normal for the date | −1.5 z |
| `rainDeficitPct` | 30–60-day rain below the field's normal | 40 % |
| `dryDays` | Consecutive days with < 1 mm rain | 21 days |
| `frostC` | Minimum temperature at or below | 0 °C |
| `heatC` | Maximum temperature at or above | 35 °C |
| `soilMoisturePctile` | Soil moisture below this percentile of the field's history | 20th |
| `flood72hMm` | Rain in 72 h at or above | 120 mm |

### D4. Perils and signals

- **Perils:** drought, flood, frost, hail, heat.
- **Separate signal:** vegetation (crop greenness, NDVI) is tracked as a signal in its own right, not as a peril.
- **Drought** combines three parts: rain deficit, dry spell, and soil moisture.
  `drought = 0.5·max(parts) + 0.5·mean(parts)`.
- **Hail** is low confidence. It is inferred only from a sudden NDVI drop that frost doesn't explain and that happens outside maturity or fallow.

Each signal has a severity from 0 to 1, adjusted as follows:
- × 1.5 inside the zone's stress window (capped at 1);
- drought parts × 0.4 when the zone is irrigated;
- drought parts × 0.6 when no crop is in the ground and none is about to be sown.

### D5. Stress score and tiers

```
score = round(100 · (0.5 · weighted_mean + 0.5 · max))     over {perils, vegetation}
weights: drought 1.0, vegetation 0.8, flood 0.5, frost 0.4, hail 0.4, heat 0.4
tiers:   normal < 35 ≤ watch < 60 ≤ high
```

A fully saturated drought on its own gives a high score. Frost or hail on its own reaches watch
at most.

### D6. "Why": drivers

Every farm assessment returns up to six drivers sorted by severity. Each driver has plain-language text
that compares the current value with the field's normal (e.g. "rain 38 % of normal over 60 days"),
plus `metric`, `value` and `normal`. Statistical jargon (σ, z) stays out of the sentence and
appears only on the detail line. There is also a one-sentence headline per farm.

### D7. Money at risk

- **Exposure** = outstanding principal on the as-of date (installments due on or before the
  as-of date count as paid).
- **Stressed exposure** = exposure of farms in the watch or high tier.
- The farm view flags **installments due inside the stress window**.

### D8. Recent climate disasters

The portfolio shows recent climate events (drought, heatwave, frost, flood, possible hail). Each
event has a region, dates, severity (moderate, severe or extreme), the farms affected, and the
affected exposure. The panel ranks the top 6 by money exposed by default, with a "most recent" toggle.
Events near the book that hit no farm are labelled as such, rather than showing $0.

### D9. Data window and as-of date

- Series cover the 24 months before the as-of date.
- Signals: NDVI every 5 days (null on cloudy dates), NDMI, ETo, precipitation, soil moisture, Tmax, Tmin.
- The as-of date is fixed at **2026-11-06** in v0.
- The trend is weekly, over the last 26 weeks.

### D10. Product flow

The wizard has five steps:

1. Portfolio.
2. Farms: draw many polygons on a satellite map, with a crop for each.
3. Zones & baselines: settings and per-farm overrides.
4. Credit: a loan for each farm.
5. Review.

After the wizard:
- **Dashboard:** KPIs, a stress map, the recent disasters panel, a ranked watchlist, exposure by crop and by zone, and alerts.
- **Farm page:** drivers, a 26-week trend, 24-month charts against the field's band, the stress window shaded, and installment due dates.
- **Sample portfolio:** 12 farms in the Santa Cruz soy belt, available for demos.

### D11. Technology and boundaries

- **Stack:** Vite, React 18, TypeScript, Tailwind, Leaflet with a polygon-drawing plugin, Recharts, zustand (saved to localStorage), and vitest.
- **Storage:** no backend in v0.
- **Data boundary:** the UI only talks to `src/data/api.ts`. Replacing the fake engine with real data must not change that API.
- **Branding:** this project is independent. No names, branding, data, endpoints or credentials from any other company's product.

## Consequences

- **Data:** the fake engine bakes in Santa Cruz climatology. A farm drawn elsewhere gets Santa Cruz-like weather, except ETo, which uses the farm's latitude.
- **Fixed for now:** tier cut-offs and weights are expert guesses. They are not calibrated against defaults or losses, because no repayment or yield data is available.
- **Next iteration (v1):** v1 replaces the fake series with real public data behind the same `api.ts` contract, and makes every formula traceable to its inputs.
