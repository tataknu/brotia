# ADR-0018: v1 weather, water-supply and event sources as built (Chile)

- **Status:** Accepted
- **Date:** 2026-11-07
- **Builds on:** ADR-0004 (precipitation, stations), ADR-0005 (temperature, ETo), ADR-0006 (water supply), ADR-0009 (events), ADR-0011, ADR-0012
- **Decided by:** the svc-weather and svc-water-events builders during the v1 build; verified on the 12 sample farms

## Context

ADR-0004 to ADR-0009 chose the Chilean sources (CR2MET, RAN, DGA, GWIS, FIRMS, Copernicus EMS). The build had to
decide how to read them within the network rules of ADR-0012, how to keep a 1991–2020 baseline homogeneous, which
source wins for a given peril, and how to turn decrees and fire products into scored events.

## Decisions

### Weather

#### D1. CR2MET is read with byte ranges

- Our own NetCDF-3 header parser and **one byte-range read per (file, day)** covering all kept cells.
- Rejected: netCDF4 `#mode=bytes` (about 10 s per variable-month per point) and downloading whole files (about 20 MB per
  month per variable). `ftp.cr2.cl` does not support multi-range requests.
- Durable cache: decoded daily values in `weather_cr2met_daily`, with bookkeeping per (version, variable, cell, month) keyed by
  the file's sidecar mtime. Raw bodies are not stored.

#### D2. Homogeneous baseline: R1 for 1991–2020, R1 then NRT for current days

- Baseline from **CR2MET v2.5_R1 1991–2020 only**. Current values from R1 where it exists and NRT for the days R1 lacks,
  per day. Never `v2.5_best` or the obs-adjusted final.
- Years were fetched in bisection order (1991, 2020, 2005, 1998, 2012, …) so a partial baseline is evenly spread.
- **Result: 22 of 30 years** (missing 2004, 2007, 2009, 2011, 2013, 2015, 2017, 2019). ADR-0004's minimum of 15 is met. `n_years`
  is in provenance; bands with fewer than 15 years are labelled "indicative"; no bands below 5 years.
- Precip bands: 30-day running totals divided by 30, pooled over the same day ± 7 d; each year also reads the preceding December.
- **ETo has no baseline** (precip, tmin and tmax took priority). ETo values are present; their bands are null with the reason.

#### D3. Stations first for short-window perils

- Frost, heat and 72 h harvest rain: **RAN station within 12 km with data** (hourly, local time converted to UTC "Z") →
  CR2MET daily (estimated, "gridded daily, not hourly") → ERA5 daily (frost and heat only) → unavailable.
- A station week is used when its coverage is ≥ 80 %. 11 of 12 sample farms use a station; Curicó has none within 12 km and falls
  back to CR2MET, whose last 6–11 days are null (lag), so its "last 7 days" end on 1 Nov with a warning.
- RAN is used for event measurements only, not for series or percentile baselines (ADR-0004 D1 same-stream rule).
- Chilean harvest rain never uses Open-Meteo.

#### D4. ERA5 via Open-Meteo is the last resort

- Registered as the "any"-tier fallback (priority 90): the standard-tier primary outside Chile and the Chile fallback (marked
  estimated), compared with its own ERA5 1991–2020 baseline, deduplicated by 0.25° cell.
- Refused before the quota embargo ends (2026-11-08 00:00 UTC). **Never called live in v1**; tested with mocks. About 780 weighted calls
  per new 0.25° cell for the 30-year baseline. Licence tier `demo_only`.

#### D5. agromet.cl TLS is fixed, not bypassed

The real Sectigo "Public Server Authentication CA DV R36" intermediate is pinned and added (SHA-256 of DER 8c54c334…22e0,
valid to 2036-03-21) instead of disabling verification. Honest User-Agent; 10 s between requests per robots.txt.

#### D6. Grid cell

The 0.05° cell containing the farm centroid; if that cell is outside the Chile mask, the nearest land cell in its 3 × 3
neighbourhood, with a note. A farm in a never-fetched cell gets "unavailable" plus a background window fetch; its baseline
only comes from the backfill CLI.

### Water supply and events

#### D7. DGA scarcity decrees

- The decree page's current anchors win over the history spreadsheet for the same number and year (the spreadsheet lags by
  weeks); the spreadsheet link is taken from the page.
- History: DGA map-layer shapes are authoritative to 2023-04-21; later decrees are matched by text (commune > province >
  basin > region), filtered by the regions named in the decree.
- `basin_water_security` counts calendar years since 2008 in which a decree covering the farm was **in force** (not issued).
- Farm → commune/province/region uses the CONAF communes layer, fetched once and cached, with a labelled fallback copy of 2026-11-07.
- `decreeActive` is a non-null boolean in the contract: when every decree source fails it is `false`, estimated, with a note
  starting "unavailable: decree status unknown". Credit rules treat it as null and do not fire.

#### D8. Snowmelt forecast

% of normal = 100 + DGA anomaly, checked against the volume ratio; several gauges per basin are volume-weighted (Limarí =
Grande + Hurtado). Farm → gauge via a province table; south of Ñuble and coastal dryland provinces → null.

#### D9. Fire

- **GWIS burned area:** severity by area (< 500 ha moderate, < 5,000 ha severe, ≥ 5,000 ha extreme), labelled "burned area"
  (it includes agricultural burning); polygons under 21 days old are provisional. Stable server-side date bounds, filtered locally,
  so stale-on-error and offline mode survive a change of as-of date.
- **FIRMS:** VIIRS N20 and N21 7-day files, low-confidence detections dropped, grouped into 0.05° cells. Scored as an own signal
  with metric **`active_fire`**, and the text says these are heat detections, often small agricultural burns; titles carry the
  detection count and max FRP. Without a key only the last 7 days exist, so this rule cannot be backtested.
- **Copernicus EMS:** activations are narrative events with no shape; activation map-area outlines are never used as burned area.
  Mapped burnt-area shapes exist only for EMSR715 AOI01 and EMSR859 AOI02 (each product zip is about 120 MB).
- **Decree events** are drawn as the union of the communes the decree covers (approximate).

## Consequences

- **Not built:** DMC station tables, INIA, CEAZA, SPI/SPEI, a RAN 2009+ percentile baseline, polygon-weighted cells, hail, weekly bulletin
  reservoirs, DGA river flood alerts (flood is not scored in Chile, ADR-0008).
- **Licences:** CR2MET R1/NRT and RAN have no stated licence (tier "unresolved"); Open-Meteo is non-commercial (`demo_only`).
- **To complete the baseline:** `backfill all --db <file> --minutes 20`, then `backfill merge`; ETo: `backfill baseline --variables eto --minutes 40`.
- Commune boundaries are simplified to about 200 m, so a farm within 200 m of a border can be assigned to the neighbour.
