# ADR-0005: Temperature, reference ET, frost, heat, harvest rain and hail

- **Status:** Accepted (D1–D4, D6). D5 thresholds and D7 score weights are Proposed and need the team's call.
- **Date:** 2026-11-06
- **Builds on:** [ADR-0001](0001-v0-product-and-risk-definitions.md) D3–D5, [ADR-0002](0002-v1-real-data-architecture.md) D5, [ADR-0003](0003-market-scope-and-sample-portfolios.md), [ADR-0004](0004-precipitation-and-station-data.md)
- **Evidence:** `CATALOG.md` (station histograms, refuted claims), `families/temp-eto`,
  `families/frost-heat-hail`, `families/chile-agromet`, `families/chile-crops-perils`,
  `families/chile-national-met`, `families/chile-satellite-fit`, `followups/06-hail-validation.md`

## Context

ADR-0001 set fixed thresholds: frost at 0 °C, heat at 35 °C. The data shows these do not work:

- **Frost at 0 °C never fires** in 35 years of lowland reanalysis for the Bolivian farms. Tmin ≤ 5 °C
  happens at most ~0.3 days a month in June (1991–2020, Viru Viru).
- **Heat counts depend on the source more than on the weather.** Days ≥ 35 °C in 2023 range from 29 to
  97 depending on the product. ERA5 undercounts them by ~45 % against stations (2023 at El Trompillo: 36
  against 65 days; at Viru Viru: 50 against 77).
- **Gridded minimum temperatures are biased on cold nights,** in a direction that depends on the site:
  ERA5 is +1.1 °C (El Trompillo) to +2.0 °C (Viru Viru) warm on the coldest 2 % of nights. CR2MET Tmin
  is −2.1 °C at Curicó and +0.1 °C at Temuco.
- **Ranks agree even when degrees do not:** ERA5 vs station Tmin rank correlation r 0.95, with 77 % of the
  coldest 5 % of nights caught (frost-heat-hail verifier: confirmed at a second station).

For a lender, "the coldest spring nights at this orchard in 15 years" is both more honest and more
useful than "−0.4 °C on a model grid 27 km wide". In Chile, frost at bloom and rain at harvest are the
perils that destroy fruit income, and both happen on specific weeks of the crop calendar.

## Decisions

### D1. Percentiles trigger; degrees are for display

| Signal | Trigger (severity ramp input) | Display |
|---|---|---|
| Frost | Same-window percentile of the season's minimum Tmin and of hours (or days) below a crop-stage threshold, against the farm's own 1991–2020 (gridded) or 2010–2025 (RAN station) history | Lowest °C and date, labelled with source and known bias |
| Heat | Same-window percentile of heat days (daily Tmax) above a display threshold; degree-hours only where hourly data exist (RAN in Chile). The v1 ERA5 build is daily only (ADR-0011 D3), so Bolivia uses days, not hours | Count of hot days, labelled "model count, stations typically see more" when gridded |
| ETo / water demand | Percentile of the 30-day ETo sum | mm and "% of normal" |

ADR-0001 D3 `frostC = 0 °C` and `heatC = 35 °C` stop being triggers. They stay as editable display
thresholds per zone. Absolute counts are shown only after a monthly station bias correction (Should,
backlog F-HEAT-2) or with the bias label.

### D2. Bolivia: ERA5 for Tmax, Tmin and ETo

| Variable | Primary | Fallback | Evidence |
|---|---|---|---|
| Tmax / Tmin | ERA5 daily, Open-Meteo `models=era5` for the demo, CDS/ARCO/NCAR for production | NASA POWER, **backtests only** (MERRA-2 period to 2026-09-30) | Verified live (temp-eto). ERA5 has values from 1940-01-01 (verifier: corrected). POWER switched to GEOS-IT on 2026-10-01, causing a Tmin step, so it cannot provide a same-stream current value |
| ETo (FAO-56) | ERA5 `et0_fao_evapotranspiration`, used as served | Hargreaves-Samani from ERA5 Tmax/Tmin, labelled "estimated" | A genuine Penman-Monteith: recomputing it from ERA5 inputs gives r 0.99, MAE 0.2 mm/d (temp-eto, confirmed) |
| Heat | ERA5, not ERA5-Land | — | ERA5-Land is worse for heat (245 vs 88 degree-hours > 35 °C; verifier: confirmed) |

### D3. Chile: CR2MET percentiles plus RAN hourly stations

| Variable | Primary | Fallback | Evidence |
|---|---|---|---|
| Tmax / Tmin percentiles | CR2MET `txn` R1 + NRT (0.05°, 1991–2020) | DMC annual tables (keyless, 1960s–) | Verified live (chile-national-met) |
| Frost and heat hours | RAN `agromet.cl` hourly, nearest station within ~12 km (8 of 11 sites), 2010–2025 | DMC tables + `monitoreoHeladasEstacion`; MODIS night LST as a cold-pool map only | Verified live (chile-agromet, verifier: keep). LST is valid on only 24–27 % of nights at Curicó |
| ETo | CR2MET `et0`, used as a percentile and labelled **"ETo (Hargreaves-Samani)"** | ERA5 FAO-56 against its own ERA5 baseline (registry, ADR-0011 D2). In-house FAO-56 from RAN hourly is a Could (RAN gives hourly *maximum* wind and radiation, so it reads high) | CR2MET et0 is Hargreaves-Samani, not FAO-56 (refuted list). INIA ETo returned 403 |

Do not use ERA5-Land or NASA POWER for Chilean absolute temperatures: ERA5-Land runs ~2 °C cold on
summer Tmax (58 against 144 hot days at Curicó; 1 day ≥ 32 °C at Requínoa against 41 at the station),
and the POWER cell for Requínoa sits at 1,766 m while the orchard is at ~430 m.

### D4. Bolivia frost stays, at low weight

Frost remains a Bolivian signal for winter crops (wheat, sunflower), but it is scored by percentile only
and keeps ADR-0001's weight 0.4. It is not expected to fire in most years.

### D5. Chile crop-window perils (Proposed thresholds)

Each indicator is scored against the farm's own history inside the crop's window (ADR-0010 calendar).
Insurer rules are quoted as context; they are not our triggers.

| Indicator | Window (crop) | Our proposed measure | Insurer reference (Agroseguros / INDAP sheets: **unverifiable**, exact PDF URLs not recorded and INDAP pages 404; quoted as context only, never on screen as an insurer rule until the URLs are recorded) |
|---|---|---|---|
| Spring frost | Budbreak–bloom, ~late Aug–early Oct (cherry, apple, grape, blueberry) | Hours ≤ −2 °C and seasonal minimum, percentile | Frost < 0 °C with visible necrosis; latent bud < −1.5 °C at an official RAN station in the commune or a neighbour; coverage never starts before 5–25 Sep |
| Rain at harvest | Cherry mid-Nov–early Jan; table grape veraison to harvest | Days ≥ 10 mm and max 3-day rain, percentile; display "major rain" days | "Lluvia mayor" 8 / 12 / 5 mm by grape variety group, average of the 3 nearest official stations |
| Heat / sunburn | Dec–Feb | Days with Tmax ≥ 32 °C, percentile | Not covered by standard policies |
| Chill deficit (Could) | May–Aug | Chill portions (Dynamic model), percentile | — |
| Rice cold sterility, "vanazón" (Could) | 15 Jan–20 Feb (Parral) | Longest run of Tmean < 18 °C | ≥ 5 consecutive days with Tmean < 18 °C |

**One exception to "percentiles trigger" (D1):** where a RAN station within ~12 km measures the
temperature, its °C values are real measurements, not a model grid. For those farms the spring-frost
severity can also ramp from the crop's critical temperature at full bloom (FAO Frost Protection Tables
4.7–4.9, T10 → T90; e.g. cherry −2.4 → −3.9 °C, apple −2.9 → −4.7 °C), and the farm page shows an
"insurer frost" flag at ≤ −1.5 °C. Severity = the higher of the percentile ramp and the
critical-temperature ramp. Farms with gridded data only use the percentile.

The cherry harvest-rain rule (10 mm/day, 30 mm in 3 days) is **our proposal, not an Agroseguros rule**
(refuted list). Harvest rain must come from DMC/RAN stations or CR2MET, not from Open-Meteo (ERA5 is 53–68 % wetter
than the gauges in Chile; `era5_land` precipitation is null). The earlier "zero harvest-window rain at
Requínoa in every year" was a mislabelled count of days ≥ 10 mm; near-zero harvest rain there is real
(station 82: 0.6–1.2 mm in 15 Nov–15 Jan; chile-crops-perils verifier).

**Team call:** accept these windows and measures for the demo, or limit Chile weather perils to spring
frost and harvest rain (PO default: frost + harvest rain Must, heat Should, chill and vanazón Could).

### D6. Hail is not a scored peril in v1

- Follow-up 06 found **no dated, located hail event on lowland crops** near Cuatro Cañadas, Okinawa or
  Mineros. The GLM lightning and Sentinel-2 parts of a detection chain work, but the NDVI-drop rule has
  no true-positive check.
- No Chilean hail source was found either.
- v1 keeps an **"unexplained NDVI drop"** flag (a sudden drop that frost, harvest or fallow does not
  explain), shown as a note with no hail label and no score weight.

This supersedes ADR-0001 D4 ("perils: … hail") and the hail weight in D5 for v1.

### D7. Score weights for Chile fruit (Proposed)

ADR-0001 D5 weights frost at 0.4, so frost alone reaches "watch" at most. For Chilean orchards and
vines, a severe bloom frost or harvest rain is a loss of the season's income. Proposal: inside the crop
window, frost and harvest rain weigh **0.8** for orchard and vine crops in Chile. Everywhere else, keep
ADR-0001 weights.

**Team call:** accept 0.8, or keep 0.4 and accept that a Chile cherry farm cannot reach "high" on frost
alone.

## Rejected / refuted

- `frostC = 0 °C` and `heatC = 35 °C` as triggers (never fire / source-dependent counts).
- A flat ERA5 cold-night bias of +2.0 °C ("ERA5 5 °C ≈ 2.5–3 °C screen"): it is site-dependent
  (+1.06 °C at El Trompillo).
- A flat IEM-to-SYNOP offset of +1.27 °C: recent offsets are +0.2 to +0.7 °C.
- NASA POWER WS2M: broken in some cells (0.00–2.45 m/s). If POWER is ever used for FAO-56, derive u2
  from WS10M.
- CHIRTS-ERA5 as the best Tmax at El Trompillo: not the best; its Tmin anomaly carries the Tmax
  correction, and it has missing days.
- WaPOR RET as a validator of ERA5 ETo: October ratio 0.76–1.17.
- MODIS night LST as the frost sensor: valid on 24–27 % of nights; frost F1 ~0.7 at 0 °C.
- "A 30-year CAPE baseline needs CDS": refuted; NCAR `nsf-ncar-era5` on AWS is keyless (unused in v1
  because hail is out).

## Consequences

- ADR-0001 D3 `frostC` and `heatC` become display settings. The zone editor shows them as "display
  threshold", not "alert threshold".
- RAN is undocumented, firewalled and asks for 10 s between requests: pull the 10 Chile stations once
  into DuckDB, then refresh only the last 2 days.
- The demo can say "coldest bloom nights in 16 years at the nearest official station, 6 km away",
  which a Chilean credit officer can check.
