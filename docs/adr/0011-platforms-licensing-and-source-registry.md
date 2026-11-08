# ADR-0011: Access platforms, licensing and the source registry order

- **Status:** Proposed. D1–D4 can be accepted now; D5 needs three team calls (free accounts, licence
  requests, production ERA5 path).
- **Date:** 2026-11-06
- **Builds on:** [ADR-0002](0002-v1-real-data-architecture.md) D2; [ADR-0003](0003-market-scope-and-sample-portfolios.md) to [ADR-0010](0010-crop-masks-calendars-and-phenology.md); [ADR-0012](0012-source-access-patterns.md)
- **Evidence:** `CATALOG.md` (licence and commercial-use risks, operational risks, global and platform
  matrix), `catalog.json` (161 sources, 51 matrix rows), `families/platforms-access`,
  `families/soil-moisture/verification.md`

## Context

Every source in ADR-0004 to ADR-0010 is free and keyless today. That is enough for the demo. It is
not the same as being usable in a product that Suyana would sell to a bank:

- Some sources allow evaluation and prototyping but not commercial use: the Open-Meteo free API,
  OGIMET, Meteostat, the FAO Crop Calendar.
- Many government sources state no licence at all: SENAMHI, CR2MET R1/NRT, CIREN, RAN, DGA, INE,
  ANAPO, GLAD, CRC-SAS.
- Planetary Computer runs under preview terms: no SLA, "not for anything mission critical".

A lender who sees a number needs to know where it came from and whether it may rely on it. A sponsor
who might build on our work needs to know which parts would need a contract.

There is also a hard operational limit this weekend: **the Open-Meteo daily quota for the team's shared
IP was used up on 2026-11-07 and resets at 2026-11-08 00:00 UTC** (19:00 Saturday in Boston). A 30-year
single-variable daily pull costs 80.5 weight units against a 10,000-unit daily budget, a 5,000-unit
hourly budget and a 600-unit minute budget (Open-Meteo terms, soil-moisture and temp-eto verifiers).

## Decisions

### D1. Licence tier is part of provenance

Every source in the registry carries one of three tiers, shown in the provenance panel next to the
value:

| Tier | Meaning | Sources (CATALOG licence table) |
|---|---|---|
| `commercial_ok` | Free with attribution | CHIRPS v3; MODIS, VIIRS, NASA POWER, CMR, ORNL; Copernicus Sentinel-1/2, GFM, CEMS, GWIS, GDO; Landsat; JRC GSW; IEM METAR; NOAA CPC/GHCN; ODEPA CKAN; MapBiomas; WaPOR; CHIRTS-ERA5; CR2MET Zenodo archive (1960–2021); ERA5 from CDS / ARCO / NCAR |
| `demo_only` | Evaluation and prototyping allowed, production needs a paid plan or permission | Open-Meteo free API; OGIMET; Meteostat; FAO Crop Calendar API; Global Flood Database |
| `unresolved` | No licence found; cite the source, ask before production | SENAMHI; CRC-SAS SISSA; INE; ANAPO; GLAD soybean; CR2MET R1/NRT; RAN; INIA; CIREN / IDE Minagri; DGA; DMC; CONAF/SENAPRED; GDACS; INPE |

### D2. Registry order per variable and region

The FastAPI registry resolves a variable to the first wrapper that answers, then the next. The last
step is always the DuckDB cache/snapshot, served as `stale` (ADR-0012 D1–D2). Wrapper ids are the
`catalog.json` source ids where one exists.

| Variable | Region | 1 (primary) | 2 (fallback) | 3 | ADR |
|---|---|---|---|---|---|
| `precip` | Chile | CR2MET R1+NRT | ERA5 (Open-Meteo `models=era5`) | cache | 0004 |
| `precip` | Bolivia | CHIRPS v3 (proposed) | ERA5 (whole portfolio, never per farm) | cache | 0004 |
| `dry_spell` | Bolivia | IMERG V07 Late (ClimateSERV) | CHIRPS v3 dry pentads (5-day resolution: CHIRPS daily values are split pentads, so daily runs are fake). v1 ships this until W-16 exists | cache | 0004 |
| `precip_station` | Chile | DMC annual tables | RAN hourly | OGIMET (validation) | 0004 |
| `precip_station` | Bolivia | OGIMET SYNOP 85244 / 85245 | GHCNh | — | 0004 |
| `tmax`, `tmin` | Chile | CR2MET `txn` | DMC tables | cache | 0005 |
| `tmax`, `tmin` | Bolivia | ERA5 | — no live same-stream fallback: POWER only to 2026-09-30 (backtests); CHIRTS-ERA5 is a 27 MB non-COG GeoTIFF per day, too heavy for a baseline build | cache (if the W-6 build itself fails, Bolivian frost, heat, ETo and soil moisture show "not available": the bucket fallback also needs ERA5 ETo from the same build) | 0005 |
| `temp_hourly` | Chile | RAN `getGraphData` | DMC tables (daily) | cache | 0005 |
| `eto` | Chile | CR2MET `et0` (Hargreaves) | ERA5 FAO-56 | cache | 0005 |
| `eto` | Bolivia | ERA5 `et0_fao_evapotranspiration` | Hargreaves from ERA5 T | cache | 0005 |
| `soil_moisture` | Bolivia, Chile rain-fed | ERA5-Land 0–100 cm | FAO-56 bucket on CHIRPS / CR2MET | GRACE-DA (display) | 0006 |
| `water_supply` | Chile irrigated | DGA decree XLS + snowmelt forecast | DGA weekly bulletin | MODIS MOD10A2 | 0006 |
| `ndvi`, `ndmi` current | both | S2 L2A PC `item/statistics` | Earth Search c1 | cache | 0007 |
| `ndvi` baseline | Bolivia | MOD13Q1 PC | ORNL subset | cache | 0007 |
| `ndvi` baseline | Chile | Landsat C2 L2 PC | S2 own history (2015–) | cache | 0007 |
| `flood_observed` | Bolivia | GFM (EODC) | — | cache | 0008 |
| `river_discharge` | Bolivia | GloFAS (Open-Meteo Flood API) | — | cache | 0008 |
| `fire_burned` | both | GWIS `nrt.ba.poly` | CEMS vectors | cache | 0009 |
| `fire_active` | both | FIRMS 7-day CSV | — | cache | 0009 |
| `decrees` | Chile | DGA decree XLS | DGA ArcGIS (history/geometry only) | cache | 0009 |
| `declarations` | Chile | Diario Oficial scraper | — | cache | 0009 |
| `warnings` | Chile / Bolivia | DMC `datos_AAA` / SENAMHI alerts (self-archived) | — | own archive | 0009 |
| `cropland` | Chile / Bolivia | CIREN / MapBiomas 2024 | CIREN land use `_2` / WorldCover 2021 | cached at farm creation | 0010 |

A fallback never mixes streams inside one signal's baseline and current value (ADR-0004 D1). When the
primary fails for the current value, the fallback computes **both** its own baseline and its own
current value, and the value is labelled `estimated`.

### D3. Pre-build every baseline; no live baseline fetch at demo time

- All baselines (CHIRPS, CR2MET, ERA5/ERA5-Land, MODIS, Landsat, RAN, DGA, FIRMS yearly) are built
  offline into DuckDB before the demo and exported in the offline snapshot (ADR-0002 D2).
- Open-Meteo calls are deduplicated by grid cell (ADR-0004 D6; for the sample fields this saves only
  one call: 21 ERA5 cells for 22 farms) and use `daily=` aggregates with an explicit `models=`, never
  `best_match`. Estimated budget for one full build, 1991 → now (~36 y ≈ 95 units per variable):
  ERA5 Tmax, Tmin, ETo and rain for 21 cells ≈ 8,000 units, plus ERA5-Land soil for 14 cells (12
  Bolivian + 2 Chilean rain-fed) ≈ 1,300 units: **≈ 9,300 of the 10,000 daily units**, with no margin
  for anyone else on the IP. This assumes the cost scales with the number of variables (80.5 was
  measured for one variable); read `X-RateLimit-Cost` on the first call and re-plan if it differs. It also exceeds the 5,000-unit hourly cap, so pace it over at least 2 hours
  (≤ ~6 calls a minute). Order: Bolivia first (V-1 depends on it), then the Chilean cells; skip Chilean
  ERA5 rain and T if the CR2MET spike (W-7) succeeds. No hourly data is budgeted, so heat
  degree-hours and frost hours exist only where RAN stations give them (ADR-0005 D1). Run it once, from
  one machine.
- If the quota is still exhausted, fall back to the keyless ARCO-ERA5 Zarr on GCS (ERA5T to
  2026-10-31). That path is **untimed** (follow-up 01 not run) and the store holds one global chunk per
  hour, so a 30-year point series means reading hundreds of thousands of chunks: treat it as a risk, not
  a plan. NCAR `nsf-ncar-era5` (AWS) is monthly global files (~0.7 GB each) and lags ~2 months.
- Throttled sources keep their own pacing: CHC ~10 s per request (429 at 6 s), RAN `Crawl-delay: 10`,
  CIREN ~2 concurrent, SoilGrids ~5 calls/min, IEM and OGIMET back off on 429/501.

### D4. Catalog hygiene before seeding the registry

`catalog.json` uses 19 free-text values in `verification`. Before it seeds the registry, map them to a
fixed set — `confirmed`, `corrected`, `partial`, `unverified`, `refuted`, `blocked` — and move the
detail to a note field. Only `confirmed`, `corrected` and `partial` sources may be a primary.
Two sources this ADR uses are tagged `refuted` today, but the refutation is of a claim about them, not
of the source: `pc-modis-13q1` (holes in the catalogue; used here with the ORNL backfill, ADR-0007 D1)
and `dga-monthly-bulletin` (the first parser read the wrong station). Re-tag both `corrected` during the
mapping, or the rule above would remove the Bolivian NDVI baseline primary.

### D5. Team calls (Proposed)

| # | Call | Evidence | PO default |
|---|---|---|---|
| 1 | **Free accounts** by a team member (not by an agent): CDS (ERA5, ERA5-Land, GloFAS EWDS), FIRMS MAP_KEY, Earthdata | All free; CDS is the licence-clean ERA5 path; FIRMS fills Jan–Oct 2026 fire | Do not depend on any key for the demo. One teammate may create a CDS account for the production story only |
| 2 | **Licence requests** after the hackathon: SENAMHI, CR2 (R1/NRT), CIREN, GLAD (glad@umd.edu), FAO (copyright@fao.org), INIA/RAN, CRC-SAS | No licence stated | List them in the pitch's "path to production" slide; send nothing before Sunday |
| 3 | **Production ERA5 path:** CDS, ARCO Zarr, NCAR AWS, or paid Open-Meteo Professional | Follow-up 01 not run: 30-year × 22-farm build time unknown | Say "CDS or ARCO (CC BY)" in the pitch; decide after timing |

## Rejected / refuted

- **Header spoofing or IP rotation to get around limits:** rejected (ADR-0012 D5).
- **Google Earth Engine:** a company counts as commercial (paid); noncommercial tiers became
  quota-limited on 2026-04-27. Not used.
- **"PC `where()` returns 500, use a two-call recipe":** refuted; only `nan` and `nodata=-9999`
  fallbacks fail.
- **"Open-Meteo free tier has no prototype carve-out":** corrected; the pricing page allows evaluation
  and prototyping, so the demo is allowed. Production needs a paid plan.
- **"PC MODIS lags one composite":** narrower: Terra lags, Aqua does not; CMR is the latency oracle.

## Consequences

- The provenance panel shows the licence tier. In the demo, "demo-only" values are visible as such,
  which is a trust point for the sponsor, not a weakness.
- The service cannot promise an SLA while it depends on Planetary Computer preview terms. PC Pro or
  CDSE are the production options.
- Nobody on the team runs ad hoc Open-Meteo calls on Saturday evening: the budget is for one baseline
  build.
