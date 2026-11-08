# ADR-0004: Precipitation and weather-station data

- **Status:** Proposed. Chile (D2) and the shared rules (D1, D5, D6) are ready to accept. The Bolivia
  primary (D3) needs one team call: run follow-up 03 or accept CHIRPS v3 without it.
- **Date:** 2026-11-06
- **Builds on:** [ADR-0002](0002-v1-real-data-architecture.md) D3, D5; [ADR-0003](0003-market-scope-and-sample-portfolios.md)
- **Evidence:** `CATALOG.md` (matrix, station histograms, refuted claims), `families/gridded-precip`,
  `families/chile-national-met`, `families/chile-global-stations`, `families/global-stations`,
  `families/chile-agromet`, `families/gapfill-fusion`

## Context

Rain drives the drought signal, which carries the most weight in the stress score (ADR-0001 D5). A
lender needs to trust one sentence: "this field got less rain than in 9 of the last 10 years at this
time of year". That sentence is only honest if the "normal" and the "now" come from the same data
product, measured the same way.

What the discovery found:

- Gridded products disagree with each other more than expected. In Santa Cruz, CHIRPS and ERA5
  percentiles agree only weakly (r ≈ 0.51). In Chile, ERA5 rain is 53–68 % wetter than the gauges, and
  CR2MET is 24–32 % wetter at Temuco and Curicó, although the month-to-month pattern matches.
- Station networks are thin and partly broken. There is no WMO station in the eastern Bolivian soy
  belt. Global station archives (GHCN-D, GSOD, ISD) are frozen for both countries at 2025-08-24 and badly
  undercount Chilean rain.
- Chile's own sources are good: CR2MET (a 0.05° gridded product built from Chilean stations) and the
  national weather service's (DMC) keyless daily tables back to the 1960s.

## Decisions

### D1. Shared rules for every rain signal (both regions)

| Rule | Decision | Evidence |
|---|---|---|
| Same stream | The baseline and the current value of a signal always come from the same product and version. Never splice products (e.g. IMERG Early mm onto CHIRPS, Open-Meteo `best_match`) | CATALOG rule 1; IMERG is 26–47 % wetter than CHIRPS (gridded-precip, confirmed) |
| Baseline period | 1991–2020, current year excluded. The zone's `baselineYears` (ADR-0001 D1/D2, 3–10 y) now applies to NDVI only; weather baselines are fixed | CHIRPS v3 drops ~18 % before 1991 (gridded-precip verifier: corrected); Curicó averaged 602 mm/yr in 1985–2009 and 354 mm/yr in 2010–2022, so the period changes the answer (chile-global-stations) |
| Anomaly | Empirical percentile over a ±7-day window around the same calendar dates, ≥ 15 baseline years. SPI-3/6 by gamma fit for the drought-event detector (ADR-0009) | ADR-0002 D5; SPI-3 `climate_indices` vs scipy r = 0.999 (gapfill-fusion, confirmed) |
| Absolute mm | Shown for context only ("62 mm, normal 140 mm"). Never a trigger, except Chile harvest rain (ADR-0005 D5) | CATALOG rule 2 |
| Missing days | Unknown, never dry. IMERG missing days do not extend a dry spell | IMERG all of May 2024 missing (refuted list) |
| Time zone | UTC days throughout. Shift SYNOP 12Z 24 h rain back one day when comparing with gridded data | CATALOG gap-filling §6 |

### D2. Chile: CR2MET primary, DMC stations as truth

| Role | Source | Baseline | Latency | Evidence |
|---|---|---|---|---|
| Per-farm daily rain (primary) | **CR2MET v2.5 R1 + NRT**, `ftp.cr2.cl` monthly NetCDF via HTTP Range reads, `cl_mask` applied | R1 1991–2020. Never `v2.5_best` (it splices obs-adjusted years to 2021 and breaks in 2022) | NRT ~10 d; R1 to P−3 months | Verified live 2026-11-07 (chile-national-met). Point reads ~10 s per variable-month, so bulk-download months into DuckDB. The NRT file for 2026-10-31 was missing |
| Fallback | ERA5 (Open-Meteo `models=era5` for the demo; CDS/ARCO for production), percentile against its own ERA5 baseline only | ERA5 1991–2020 | ~6 d | Verified live; demo-only licence on Open-Meteo (ADR-0011) |
| Station truth and trust panel | **DMC annual tables** `climatologia.meteochile.gob.cl/application/anual/aguaCaidaAnual/{code}/{year}` (keyless HTML). "s/p" = 0 mm; "." = not yet | 1960s– | ~1 d | Verified live (chile-national-met). Fills OGIMET gaps 2001–2012, Jun 2023, Jun 2024 |
| Station hourly (frost, heat, harvest rain) | RAN `agromet.cl` nearest station 4–13 km (8 of 11 sites within ~12 km) | 2010–2025 (16 seasons) | 1.5–2.5 h | Verified live (chile-agromet, verifier: keep). Undocumented endpoint, WAF, `Crawl-delay: 10`, missing Sectigo intermediate certificate |

CR2MET is wetter than the gauges at some sites (+32 % Curicó, +24 % Temuco). Percentiles are not
affected by a constant bias, so v1 uses CR2MET percentiles and shows DMC station mm next to them.

### D3. Bolivia: CHIRPS v3 primary (Proposed), IMERG for dry spells, ERA5 fallback

| Role | Source | Baseline | Latency | Evidence |
|---|---|---|---|---|
| Rain deficit / percentile (primary, **proposed**) | **CHIRPS v3** CHC COGs: final `rnl` → prelim `sat` → last days labelled "estimated". Prefer pentad totals (daily values are split pentads) | 1991–2020, built offline from pentads (~3.5 h for Oct–Apr) | final ~5 weeks; prelim ~6 d; pentad 2–4 d | Confirmed live (gridded-precip verifier). CHC returns 429 even at 6 s spacing: budget ~10 s per request, offline build only. COGs declare no nodata: mask values < 0. Commercial OK (CC BY 4.0 / public domain) |
| Dry spells, heavy rain | **IMERG V07 Late** via ClimateSERV dataset 226, with its own percentile thresholds | IMERG 2000-06– | ~3 d | Confirmed live (jobs 8–62 s). No SLA; continuity after the USAID wind-down is uncertain |
| Fallback | ERA5 against its own ERA5 baseline; CPC Unified as a cross-check | 1991–2020 | ~6 d | Verified live. ERA5 put 11 of 12 farms at p0 for 2023/24 (gridded-precip notes, original points; not re-verified) |
| Validation only | OGIMET SYNOP Viru Viru 85244 / El Trompillo 85245; GHCNh; CRC-SAS SISSA station SPI (El Trompillo 1962 → 2025-02) | station | 1–3 h (OGIMET) | Verified live. OGIMET licence: "no critical mission" (demo only) |

**Team call:** follow-up 03 (3 points, with 2024/25 as the control season) has not run. Backtest so far:
CHIRPS v3 puts 2023/24 at the 3rd and 0th percentile at 2 points (verifier: confirmed); ERA5 puts 11 of 12
farms at p0 (researcher notes, not re-verified).
Both show the drought; the open question is false alarms in a normal year.

- **Option A (PO default):** accept CHIRPS v3 as primary now, with ERA5 shown as a "second opinion"
  on the farm page. Run the 2024/25 control check in the validation story (backlog V-1).
- **Option B:** run follow-up 03 first. Costs about half a day, which v1 does not have.

If the CHIRPS baseline build fails before the demo, the registry falls back to ERA5 for the whole
Bolivian portfolio (never mixed per farm) and labels it.

### D4. Role of stations

Stations are **never** the per-farm rain primary in Bolivia: the nearest gauge is 11–110 km away and
convective rain is not representative at that distance. In both regions stations are used for:

1. the trust panel: "nearest official station, distance, record start" (SENAMHI WFS `senamhi:estaciones`
   for Bolivia, 147 stations in Santa Cruz; DMC EMA catalogue for Chile);
2. sign and percentile checks of gridded rain (backlog validation);
3. Chile only: hourly frost, heat and harvest-rain counts where a RAN station is within ~12 km
   (ADR-0005).

### D5. Weather histograms on the farm page

The farm page shows, per signal, the field's same-season distribution as a histogram (1991–2020) with
the current value marked. Station histograms (Viru Viru, Curicó) appear in the trust panel only, not as
the farm's own normal. Evidence: station histograms built for 85244, 85629 and 85672
(global-stations, chile-global-stations).

### D6. Gridded aggregation rule

Sample fields are 1–81 ha, smaller than any weather grid cell (0.05° ≈ 5 km; ERA5 0.25° ≈ 27 km). v1
uses **the grid cell that contains the field centroid**, falling back to the nearest valid land cell.
Farms in the same cell get the same weather values, and the UI says so ("weather shared with 1 nearby
farm"). For the relocated sample fields this is rare: 12 Bolivian fields fall in 11 ERA5 0.25° cells
(Arrocera Mineros and Canaveral San Antonio share one) and the 10 Chilean parcels in 10 (reviewer
check by nearest node, 2026-11-07); the rule matters mostly for user-drawn farms. Polygon-weighted
averaging is out of v1.

## Rejected / refuted

- **GHCN-D / GSOD / ISD as Chile or Bolivia rain:** frozen at 2025-08-24; Curicó 2023 is 175 mm in
  GHCN-D against 674 mm at DMC; GHCN-D labels Chilean values one day late.
- **Meteostat:** fills precipitation with model forecasts (100 % of 2026 at SLVR and Curicó); CC BY-NC.
- **IEM precipitation:** always 0 or None for both countries.
- **IRI Data Library as a keyless CHIRPS extractor:** now requires sign-in.
- **CHIRPS v2:** not homogeneous at Santa Cruz (2023/24 only p13–p23) and ends in Dec 2026.
- **CHIRPS v3 back to 1981:** drops ~18 % before 1991.
- **ClimateSERV IMERG V06:** stopped silently in 2024-06.
- **Open-Meteo `era5_land` precipitation** (null) and `best_match` (splices IFS).
- **Station kriging / IDW:** 9 stations at 11–109 km in Bolivia; no benefit.
- **ERA5 quantile-mapped to CHIRPS for absolute thresholds:** fixes wet-day counts only; the 72 h tail
  fails out of sample.

## Consequences

- The CHIRPS v3 and CR2MET baselines must be built offline into DuckDB before the demo. Neither can be
  fetched live at demo time.
- ERA5 percentiles appear as a labelled second opinion, so disagreement between products is visible,
  not hidden.
- Production needs a CR2 licence clearance for R1/NRT (only the Zenodo 1960–2021 archive is CC BY) and
  a licence-clean ERA5 path (ADR-0011).
