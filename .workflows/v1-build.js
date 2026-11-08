export const meta = {
  name: 'v1-build',
  description: 'Build v1 of the climate loan monitor: Chilean fruit orchards, real data service (FastAPI + DuckDB), NDVI interpolation + AI super-resolution, water status, crop/stage/zone risk, farming agent; contract, 2 foundations, 10 parallel builders, integrate, 3 reviewers, fix, product owner ADRs',
  phases: [
    { title: 'Contract', detail: 'one canonical v1 contract shared by service and app, with fixtures' },
    { title: 'Foundation', detail: 'service scaffold (FastAPI, DuckDB, fetch layer, registry) and app scaffold (types, async api, store v2) in parallel' },
    { title: 'Build', detail: '7 service builders + 3 frontend builders in parallel, disjoint folders' },
    { title: 'Integrate', detail: 'wire service, run the real pipeline for the sample portfolio, export snapshot, wire app' },
    { title: 'Review', detail: 'spec/trust, runtime e2e, data correctness' },
    { title: 'Fix', detail: 'apply verified findings, final build and tests' },
    { title: 'Product owner', detail: 'record build-time decisions as ADRs, status and demo notes' },
  ],
}

const ROOT = '/Users/cristian/Documents/projects/energhack'
const APP = `${ROOT}/app`
const SVC = `${ROOT}/service`
const PY = `${SVC}/.venv/bin/python`

const COMMON = `
You are a senior engineer on a 4-person hackathon team (MIT Energy & Climate Hack 2026). Now: ${args.now}. Demo: Sunday 2026-11-08 9:30 AM to the sponsor Suyana (parametric ag insurance / early warning). Code freeze Sunday 07:00.
PRODUCT: "Climate Loan Monitor" v1 — shows a lender which loans on CHILEAN FRUIT AND NUT ORCHARDS are under climate stress, why, and how much money is exposed. Read these first, they are binding:
- ${ROOT}/docs/adr/0013-v1-product-scope-fruit-crops-risk-imagery.md  (THE v1 scope: 6 crops, zones = 35 km² circles, crop→zone→farm rules + audit, risk formula, water status ladder, NDVI interpolation + AI super-resolution with the trust rule, agent panel, D11 Must/Should)
- ${ROOT}/docs/adr/README.md (index) and the ADRs it lists for your area (0004–0012 hold the verified Chilean data decisions: CR2MET, RAN, CIREN, DGA, Sentinel-2 via Planetary Computer, GWIS, provenance, fetch patterns). Bolivia is ARCHIVED: do not build Bolivian features.
- ${ROOT}/docs/data-discovery/CATALOG.md and the family notes under docs/data-discovery/families/ (chile-* especially) — they contain working probe scripts (e.g. families/chile-satellite-fit/probe_s2_chile.py, families/chile-ag-stats-credit/probe_nearest_crop_polygon.py, families/chile-water/probe_dga_bulletins.py, families/chile-national-met/*, families/chile-agromet/*, families/chile-emergencies/*). REUSE their endpoints and parsing; do not rediscover.
- The v1 contract: ${ROOT}/contracts/v1/CONTRACT.md (once it exists) — it is binding for names, shapes and endpoints.
EXISTING CODE: ${APP} is the v0 React app (Vite, React 18, TS, Tailwind, lucide-react, recharts, zustand v5 persist, react-router v6, leaflet 1.9 + react-leaflet v4 + geoman, turf, vitest). Read ${APP}/DESIGN.md for its look and feel (brand green #2E7A55, Instrument Sans + JetBrains Mono, 8px cards, no gradients, sentence case, lucide 16–18px). Keep that look. zustand v5: selectors that build new arrays/objects need useShallow.
SERVICE: ${SVC} is a Python 3.12 FastAPI + DuckDB service. Python: ${PY} (uv-managed venv). Run tests with "${PY} -m pytest". Service port 8787; app dev port 5190.
HARD RULES:
- Trust rule: every metric (NDVI scores, anomalies, risk, water status) is computed from native-resolution data; AI super-resolved pixels are display-only and labelled. Every value carries provenance (source, observed_at, fetched_at, resolution, licence_tier, stale, estimated, data_tier). Never invent data: if a source fails, return stale cache or mark the value unavailable/estimated with the reason.
- Network etiquette (ADR-0012): honest User-Agent "climate-loan-monitor/0.1 (hackathon prototype)", per-source concurrency ≤ 2, timeouts, cache everything in DuckDB, never spoof headers, never bypass anti-bot checks or logins. Open-Meteo's free quota from this IP is exhausted until 2026-11-08 00:00 UTC (19:00 Boston): do not call Open-Meteo before then, and keep calls minimal after (it is a fallback only).
- Secrets: the Anthropic key is read from the environment (ANTHROPIC_API_KEY) or a gitignored ${SVC}/.env only; never print, log or write a key. No accounts or signups.
- This project is independent: never reference, read or copy any other company's product (no "agviewer", "sprout", "agv" anywhere in code, docs or names).
- Not a git repo: no worktrees, no git commands. Write ONLY inside the folders you own (stated below). If you need something from another owner, put it in needs_from_others instead of editing their files.
- Work pragmatically: a working, tested, honest minimal version beats an ambitious broken one. If a step will not converge (e.g. a model will not install), take the stated fallback, label it, and report it.
`

const BUILDER_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    summary: { type: 'string', description: 'what you built and verified, plain language' },
    files: { type: 'array', items: { type: 'string' } },
    verified: { type: 'array', items: { type: 'string' }, description: 'commands/probes you ran and their results' },
    gaps: { type: 'array', items: { type: 'string' } },
    needs_from_others: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' }, description: 'build-time decisions worth an ADR (e.g. which SR model, which threshold source)' },
  },
  required: ['ok', 'summary', 'files', 'verified', 'gaps', 'needs_from_others', 'decisions'],
}

// ------------------------------------------------------------------ Contract
phase('Contract')
const contract = await agent(`${COMMON}
YOUR ROLE: CONTRACT AUTHOR. You own ${ROOT}/contracts/v1/** only. Write the single canonical v1 contract that the service (Python/pydantic) and the app (TypeScript) builders will both implement in parallel without talking to each other. Be precise and complete; ambiguity here becomes integration bugs later.

Write:
1. ${ROOT}/contracts/v1/CONTRACT.md containing:
   a. Domain model (names exactly as they will appear in JSON, camelCase in JSON):
      - Crop = 'cherry'|'blueberry'|'avocado'|'walnut'|'hazelnut'|'table_grape' (labels es/en, CIREN especie_01 values, evergreen, coveredDefault).
      - Country {code ISO-2, name, dataTier 'enhanced'|'standard'}: all South American countries; CL = enhanced; others standard; plus a 'GLOBAL' pseudo-entry flagged comingLater.
      - Peril keys: 'frost','heat','harvest_rain','water','chill','fire','flood','declared_emergency','abandonment','vigour'.
      - Stage {key, label, start 'MM-DD', end 'MM-DD', sensitivity: Record<Peril, number 0..1>}.
      - CropTemplate {crop, labels, evergreen, coveredDefault, stages[], rules: AgronomicRules, weights {a,b,c}, creditRules: CreditRule[], sources[] (citation strings), approximate: boolean}.
      - AgronomicRules: per-stage map of thresholds {frostCriticalC, frostSevereC, heatC, harvestRainMm72h, chillHoursMin (crop-level), kc} + baselineYears (NDVI).
      - Zone {id, name, center [lng,lat], radiusM (default 3338 = 35 km²), auto boolean, overrides: partial rules}. Every farm has an auto zone unless inside a shared zone (nearest centre wins).
      - Farm {id, name, crop, polygon GeoJSON Polygon (lng,lat), areaHa, centroid, zoneId, covered?: boolean, irrigatedDeclared?: boolean|null, plantingYear?: number|null, ciren?: {especie, variedad?, sourceLayer, objectId}, overrides: partial rules, creditRuleOverrides, loan?: Loan}. Loan/Installment/ScheduleType exactly as v0 (${APP}/src/domain/types.ts) — reuse.
      - Portfolio {id, name, lender, country, currency 'USD'|'CLP'|..., createdAt, zones[], farms[], creditRules (portfolio-level), audit: RuleChange[]}.
      - RuleChange {id, at ISO, actor {kind 'user'|'agent', name}, scope {level 'crop'|'zone'|'farm'|'portfolio', id}, path, oldValue, newValue, reason, status 'applied'|'proposed'|'dismissed'}.
      - CreditRule {id, name, enabled, when {metric e.g. 'risk.tier'|'risk.score'|'water.decreeActive'|'water.snowmeltPct'|'imagery.abandonment'|'events.burnedAreaIntersects', op, value, withinDaysBeforeInstallment?}, then 'watch'|'high'|'field_visit'|'restructure_review', message}.
      - Provenance {source, sourceLabel, observedAt, fetchedAt, resolution, licenceTier 'commercial_ok'|'demo_only'|'unresolved', dataTier 'enhanced'|'standard', stale, estimated, note?}.
      - SeriesPoint {date, value|null, p10, p50, p90, estimated?} and Series {variable, unit, points[], provenance}.
      - RiskComponent {key 'climate'|'disaster'|'geography', value 0..1, drivers: Driver[]}; Driver {peril, severity 0..1, text (plain language, numbers vs normal), value, normal, unit, provenance}.
      - Risk {score 0..100, tier 'normal'|'watch'|'high', stage {key,label}, components {climate, disaster, geography}, weights {a,b,c}, formula (string), headline, drivers (top, sorted), creditActions: {ruleId, action, message}[]}.
      - WaterStatus {irrigated {value 'yes'|'no'|'unknown', evidence, provenance}, demand {kc, eto7dMm, need7dMm, need30dMm, provenance}, supply {decreeActive, decreeId?, decreeUntil?, snowmeltPctOfNormal?, basin?, provenance}, stress {ndmiZ?, ndmiPeerDelta?, canopyMinusAirC?, level 'none'|'mild'|'moderate'|'severe'|'unknown', provenance}, abandonment {flag boolean, confidence, evidence, provenance}}.
      - PeerComparison {zoneId, nPeers, farmNdviZ, peerMedianNdviZ, reading 'zone_wide'|'farm_specific'|'normal'|'insufficient_peers', provenance}.
      - ImageryFrame {date, kind 'observed'|'interpolated', daysToClear, clearFraction?, ndviMean, ndviP10, ndviP90, urls {ndvi, rgb?, ndviSr?, rgbSr?}, srKind 'ai'|'resampled'|null, srModel?}; ImageryTimeline {farmId, bbox, crs, nativeResolutionM, frames[], legend {min,max,colormap}, coveredWarning?, provenance}.
      - ClimateEvent {id, kind peril, title, region, start, end, severity, source, evidenceKind 'observed_footprint'|'official_declaration'|'own_signal'|'narrative', geometry?, affectedFarmIds, affectedExposure, provenance}.
      - FarmAssessment {farmId, asOf, risk, water, peers, series {ndvi, ndmi, precip, tmin, tmax, eto, ...}, nextInstallment, exposure, stageBands [{stage,start,end}], dataAsOf: Record<variable, date>}.
      - PortfolioAssessment {asOf, totalExposure, exposureByTier, farmsByTier, ranked [{farmId, score, tier, exposure, headline}], byCrop, byZone, events: ClimateEvent[], creditActions [...]}.
      - AgentRecommendation {id, zoneId|farmId, question, answer (markdown), proposals: RuleChange[] (status 'proposed'), evidence [{kind 'backtest'|'history'|'event', summary, data}], toolCalls [{name, input, outputSummary}], model, createdAt}.
   b. REST API (FastAPI on http://localhost:8787, JSON, CORS for http://localhost:5190):
      GET /health; GET /countries; GET /crops (CropTemplate[]); GET /portfolios/sample (the Chilean sample Portfolio);
      GET /ciren/orchards?bbox=minLng,minLat,maxLng,maxLat&crop= (GeoJSON FeatureCollection of CIREN orchard polygons for "add farm from cadastre");
      POST /assess/portfolio {portfolio} -> PortfolioAssessment; POST /assess/farm {portfolio, farmId} -> FarmAssessment;
      POST /imagery/farm {portfolio, farmId, sr?: boolean} -> ImageryTimeline (frame images served under GET /files/imagery/...png);
      GET /events?bbox=...&since=YYYY-MM-DD -> ClimateEvent[];
      POST /agent/recommend {portfolio, zoneId?, farmId?, question} -> AgentRecommendation (503 {error:'no_api_key'} when ANTHROPIC_API_KEY is absent);
      POST /snapshot/export {portfolio?} -> writes the offline snapshot (default sample portfolio) to ${APP}/public/snapshot/ and returns its manifest.
      Error shape {error, detail}. All money in the portfolio currency. Dates ISO YYYY-MM-DD, timestamps ISO UTC.
   c. Offline snapshot layout under ${APP}/public/snapshot/: manifest.json, portfolio.json, crops.json, countries.json, assessment-portfolio.json, assessment-farm-<farmId>.json, imagery-<farmId>.json, imagery/<files>.png, events.json. The app falls back to these when the service is unreachable and labels the UI "offline snapshot of <date>".
   d. Folder ownership table for the build phase (copy from the BUILD OWNERSHIP section below) and the rule that only owners edit their folders.
   e. Formula appendix: the ADR-0013 D6 risk formula verbatim, tiers, the water ladder rungs, peer rule, zone radius, and the trust rule.
2. ${ROOT}/contracts/v1/fixtures/*.json — one realistic example per response type (crops, countries, sample portfolio with 2 farms, portfolio assessment, farm assessment, imagery timeline with 3 frames incl. interpolated + ai, events, agent recommendation). Both sides will test against these.
3. ${ROOT}/contracts/v1/README.md — 10 lines: how to use the contract and fixtures.

BUILD OWNERSHIP (include in CONTRACT.md):
- service foundation: ${SVC}/pyproject.toml, ${SVC}/.venv, ${SVC}/app/{main.py,config.py,models.py,provenance.py,store.py,http.py,registry.py,snapshot.py}, ${SVC}/app/routers/**, ${SVC}/tests/test_foundation*.py, ${SVC}/README.md
- svc-weather: ${SVC}/app/sources/weather/** (+ tests/test_weather*.py)
- svc-water-events: ${SVC}/app/sources/water/**, ${SVC}/app/sources/events/** (+ tests/test_water*.py, tests/test_events*.py)
- svc-portfolio: ${SVC}/app/domain/**, ${SVC}/app/sources/ciren/**, ${SVC}/data/** (+ tests/test_domain*.py, tests/test_ciren*.py)
- svc-imagery: ${SVC}/app/imagery/** (+ tests/test_imagery*.py)
- svc-superres: ${SVC}/app/superres/** (+ tests/test_superres*.py)
- svc-risk: ${SVC}/app/risk/** (+ tests/test_risk*.py)
- svc-agent: ${SVC}/app/agent/** (+ tests/test_agent*.py)
- app foundation: ${APP}/package.json, configs, ${APP}/src/{App.tsx,main.tsx,index.css}, ${APP}/src/domain/**, ${APP}/src/data/**, ${APP}/src/state/**, ${APP}/src/shared/**, ${APP}/DESIGN.md, ${APP}/README.md
- app-wizard: ${APP}/src/features/wizard/**
- app-farm: ${APP}/src/features/farm/**
- app-portfolio: ${APP}/src/features/dashboard/**, ${APP}/src/features/portfolios/**, ${APP}/src/features/agent/**
Return a short summary of the contract and any judgment calls you made.`, { label: 'contract', phase: 'Contract', schema: BUILDER_SCHEMA })

if (!contract?.ok) { log('Contract step failed; stopping.'); return { stage: 'contract', contract } }

// ------------------------------------------------------------------ Foundation
phase('Foundation')
const [svcFound, appFound] = await parallel([
  () => agent(`${COMMON}
YOUR ROLE: SERVICE FOUNDATION. Own: ${SVC}/pyproject.toml, ${SVC}/.venv, ${SVC}/app/{__init__.py,main.py,config.py,models.py,provenance.py,store.py,http.py,registry.py,snapshot.py}, ${SVC}/app/routers/**, ${SVC}/tests/test_foundation*.py, ${SVC}/tests/conftest.py, ${SVC}/README.md, ${SVC}/.gitignore. Create empty packages (with __init__.py and a placeholder module exposing the contract-specified function names that raise NotImplementedError or return fixture data) for every builder folder so imports work: app/sources/{weather,water,events,ciren}, app/domain, app/imagery, app/superres, app/risk, app/agent.
Steps:
1. Create the venv: "uv venv --python 3.12 ${SVC}/.venv" then "uv pip install --python ${PY}" with: fastapi, "uvicorn[standard]", "pydantic>=2", duckdb, httpx, requests, numpy, scipy, pandas, xarray, netCDF4, h5netcdf, rasterio, pystac-client, planetary-computer, shapely, pyproj, pillow, matplotlib, openpyxl, xlrd, pdfplumber, beautifulsoup4, lxml, anthropic, python-dotenv, pytest, pytest-asyncio, respx, torch, torchvision. (torch/torchvision preinstalled for the super-resolution builder; if torch fails to install, report it.) Record exact versions in pyproject.
2. models.py: pydantic v2 models for EVERY contract type with camelCase JSON aliases (populate_by_name). Test: every fixture in ${ROOT}/contracts/v1/fixtures validates.
3. store.py: DuckDB at ${SVC}/data/clm.duckdb (thread-safe connection per call or a lock), tables: http_cache(key, source, url, params_hash, status, body BLOB, content_type, fetched_at, expires_at, ok), series(source, variable, loc_key, date, value, meta JSON), assessments(kind, key, json, created_at), audit(id, json). Helper functions documented for builders.
4. http.py: ADR-0012 cached fetch path: get_json/get_bytes/post_json(source, url, params, ttl, timeout) with DuckDB cache, in-flight dedup, stale-on-error (returns body + stale flag), empty-is-not-success, per-source concurrency semaphore (default 2) and min-interval, honest User-Agent, retries with backoff on 429/5xx. Returns a FetchResult {body, fetched_at, stale, from_cache, source}. Unit tests with respx: failing source returns stale cached value.
5. provenance.py: build Provenance objects; licence tiers per source (from ADR-0011).
6. registry.py: variable registry: register(variable, region_tier, provider_callable, priority); resolve(variable, farm) tries providers in order, returns (Series, Provenance) or an 'unavailable' result with reasons. Builders register their providers at import time in their package __init__.
7. routers/: every contract endpoint implemented as a thin router that calls a function in the owning builder package (import by name, e.g. app.risk.assess_farm(portfolio, farm_id)); while builders are stubs, endpoints return fixture data from contracts/v1/fixtures so the app can integrate early. CORS for http://localhost:5190. Static files at /files from ${SVC}/data/files.
8. snapshot.py: export function per the contract snapshot layout (calls the same functions as the routers, copies imagery PNGs).
9. main.py + "${PY} -m uvicorn app.main:app --port 8787" works; README with run instructions; .gitignore for .venv, data/*.duckdb, .env, data/files.
10. Run pytest (green) and curl /health and /crops on a running server; stop the server afterwards.`, { label: 'svc-foundation', phase: 'Foundation', schema: BUILDER_SCHEMA }),
  () => agent(`${COMMON}
YOUR ROLE: APP FOUNDATION. Own: ${APP}/package.json and configs, ${APP}/src/{App.tsx,main.tsx,index.css}, ${APP}/src/domain/**, ${APP}/src/data/**, ${APP}/src/state/**, ${APP}/src/shared/**, ${APP}/DESIGN.md, ${APP}/README.md. Do not edit src/features/** except to keep the build green with minimal shims (record each shim).
Steps:
1. Domain: replace v0 domain types with the v1 contract types (TS, camelCase), keeping Loan/Installment/ScheduleType and schedule.ts/geo.ts/dates.ts utilities. Add zod schemas for every API response and a vitest that parses every fixture in ${ROOT}/contracts/v1/fixtures. Add rules.ts: effective rules (crop template → zone → farm), zone assignment (auto circle per farm with radiusM 3338 vs shared zones, nearest centre wins), audit helpers (applyChange, revert), with tests.
2. Data: ${APP}/src/data/api.ts becomes an ASYNC client for the contract endpoints at import.meta.env.VITE_SERVICE_URL (default http://localhost:8787) with timeouts, and an automatic fallback to the offline snapshot under /snapshot/ when the service is unreachable (for the sample portfolio), exposing { data, source: 'live'|'snapshot', snapshotDate }. Provide React hooks (src/data/hooks.ts) with a small cache keyed by request (or add @tanstack/react-query if you prefer — you are the only one allowed to npm install). Remove the v0 fake engine from the data path (move it to src/data/archive/ or delete; it must not be used).
3. State: zustand store v2 (persist key 'clm-store-v2'): portfolios, draft wizard state, zones, rule overrides, credit rules, audit log, agent proposals, actions for all of these (pure reducers + tests). Old 'clm-store-v1' data is ignored.
4. Shared UI: keep v0 primitives; add ProvenanceBadge/ProvenancePopover (source, observedAt, fetchedAt, resolution, licence tier, stale/estimated, data tier), FrameKindBadge (observed / interpolated / AI-enhanced / resampled), DataAsOf, TierPill, OfflineBanner ("offline snapshot of <date>"), CountrySelect (South America list from /countries, Chile default, GLOBAL disabled 'coming later'), CropPill for the 6 crops with colours, and map helpers: ZoneCircle layer (react-leaflet Circle) and a CIREN orchards layer component. Default map centre central Chile (-71.3, -34.6), zoom 8.
5. App shell/routes: same routes as v0 plus an agent side panel slot in the shell (the panel content belongs to app-portfolio; mount a placeholder export from src/features/agent/AgentPanel.tsx — create that placeholder file once, then it belongs to app-portfolio).
6. Placeholder pages in src/features/* must compile against the new types (minimal shims).
7. DESIGN.md: update to v1 (ownership, contracts, rules). README: how to run app + service.
8. npm run typecheck, npm test, npm run build all green. Check the dev server serves / (curl) and stop it.`, { label: 'app-foundation', phase: 'Foundation', schema: BUILDER_SCHEMA }),
])
if (!svcFound?.ok || !appFound?.ok) {
  log(`Foundation not green: service=${svcFound?.ok} app=${appFound?.ok}. Stopping before builders.`)
  return { stage: 'foundation', contract, svcFound, appFound }
}

// ------------------------------------------------------------------ Build
phase('Build')
const BUILDERS = [
  { key: 'svc-weather', own: `${SVC}/app/sources/weather/** and ${SVC}/tests/test_weather*.py`, task: `Chilean weather providers registered in the registry (enhanced tier) plus standard-tier fallbacks:
- CR2MET (ADR-0004 D2, ADR-0005 D3; families/chile-national-met): daily pr, tmin/tmax (txn), et0 for a farm's 0.05° cell; R1 + NRT only (never v2.5_best); HTTP Range reads of the monthly NetCDF on ftp.cr2.cl; 1991–2020 same-day-of-year percentiles (±7 days) and the last 13 months; cache everything in DuckDB. Time-box: if a full 1991–2020 pull is too slow, build the baseline from the years you can fetch in ≤ 40 min for the sample cells and label n_years.
- RAN stations (families/chile-agromet; agromet.cl keyless endpoints): nearest station within ~12 km, hourly Tmin/Tmax for frost hours and heat degree-hours, ≥ 10 s between requests, station name/distance in provenance.
- Standard tier (other South American countries): ERA5 via Open-Meteo archive ONLY AFTER 2026-11-08 00:00 UTC (check the clock; before that, register the provider but return 'unavailable: quota window' so nothing calls it), deduplicated by grid cell, minimal calls.
- Expose: series(variable in {precip, tmin, tmax, eto}, farm, start, end) -> Series with p10/p50/p90 bands and provenance; frost_events(farm, window); heat_events(farm, window); harvest_rain(farm, window) (72 h sums). Golden tests on small cached samples.` },
  { key: 'svc-water-events', own: `${SVC}/app/sources/water/**, ${SVC}/app/sources/events/** and tests/test_water*.py, tests/test_events*.py`, task: `Water supply and disaster events for Chile (ADR-0006, ADR-0009; families/chile-water, families/chile-emergencies):
- DGA water-scarcity decrees: parse the official XLS (header rows inside, mixed date formats) + scrape the decree page for the current XLS link and new decree PDFs; map province/commune to farms; active = expiry after as-of; decree history since 2008 per basin/commune (also used for geography water security).
- DGA snowmelt forecast (season 2026–27, % of 1991–2020) for the gauges serving the sample farms; weekly bulletin reservoirs as Could. Fallback: a seed CSV hand-entered from the PDF with the PDF URL as provenance, labelled.
- Fire: GWIS nrt.ba.poly WFS burned-area polygons 2012→latest for Chile (note the axis-order trap in ADR-0009); CEMS vectors EMSR715 and EMSR859; FIRMS 7-day CSV as 'fire detected nearby'. Fire recurrence per zone circle (for geography).
- Flood in Chile is not scored (ADR-0008): DGA alerts as context only if cheap.
- Expose: water_supply(farm) -> supply part of WaterStatus; decree_history(farm); events(bbox, since) -> ClimateEvent[] with evidenceKind and geometry; burned_area_intersections(farm, since); fire_recurrence(center, radius_m). Tests with saved samples.` },
  { key: 'svc-portfolio', own: `${SVC}/app/domain/**, ${SVC}/app/sources/ciren/**, ${SVC}/data/** (except clm.duckdb and data/files) and tests/test_domain*.py, tests/test_ciren*.py`, task: `Crops, rules, zones and the Chilean sample portfolio:
- CIREN client (families/chile-ag-stats-credit probes; esri.ciren.cl ArcGIS REST, keyless, ~4 s/query, polite): orchards by bbox and crop (Catastro Frutícola layers per region; especie_01 values from ADR-0013 D1 — confirm the hazelnut spelling live), irrigated-area polygons (HIDRICO_PUBLICO) within 500 m, nearest orchard of a crop to a point. Serves GET /ciren/orchards.
- Crop templates for the 6 crops (ADR-0013 D5): stages with month-day windows and per-peril sensitivity, critical temperatures by stage (frost critical/severe, heat/sunburn), harvest-rain trigger, chill requirement, Kc per stage, weights a=0.65 b=0.35 c=0.30, default credit rules (ADR-0013 D4 examples), citations (use families/chile-crops-perils notes and FAO-56 Kc in families/crop-masks-phenology/sample_kc_fao56.json), approximate flags. Serve GET /crops.
- Rules engine (Python mirror of the app's rules.ts): effective rules crop→zone→farm, zone assignment (auto 3,338 m circle per farm; shared zones; nearest centre wins), credit rule evaluation helpers, audit change application.
- Sample portfolio "Banco Demo — huertos Chile" in USD: 12 REAL CIREN orchard polygons, 2 per crop, chosen live from CIREN in fitting areas (e.g. cherry: Requínoa and Curicó; blueberry: Chillán and Los Ángeles; avocado: Quillota and Cabildo/Petorca (decree story); walnut: Requínoa/Paine/Buin; hazelnut: Parral and Los Ángeles/Temuco; table grape: Ovalle/Limarí and Los Andes or Copiapó). Prefer blocks of 2–30 ha that are on farmland (not urban). Store polygons in ${SVC}/data/sample_portfolio_cl.geojson with CIREN ids/especie/variedad/planting year if available. Add realistic loans (mix of schedule types incl. at_harvest, 50k–900k USD, some multi-year establishment loans) using the same schedule semantics as the app (port generateInstallments from ${APP}/src/domain/schedule.ts). 2–3 shared zones where farms cluster; others auto. Serve GET /portfolios/sample and GET /countries.` },
  { key: 'svc-imagery', own: `${SVC}/app/imagery/** and tests/test_imagery*.py`, task: `Sentinel-2 imagery pipeline for a farm (ADR-0007, ADR-0013 D8; reuse families/chile-satellite-fit/probe_s2_chile.py and families/sentinel2-landsat-hls notes):
- Planetary Computer STAC (sentinel-2-l2a), anonymous signing; for the farm bbox (+ ~60 m buffer) read B02,B03,B04,B08,B8A,B11 and SCL windows for the 13-month window (cap scenes sensibly; use cloud metadata to skip near-100% cloudy scenes); apply the DN offset rule by processing baseline; SCL mask (clear = 4,5,6 per ADR-0007); per-pixel NDVI and NDMI stacks; cache arrays (npz) under ${SVC}/data/files/imagery/<farmId>/.
- Temporal interpolation: per-pixel Whittaker smoother (lambda tuned, weights from clear mask) → frames every 5 days; each frame kind observed|interpolated and daysToClear; polygon stats (mean/p10/p90) computed on native pixels inside the polygon.
- Render PNGs: NDVI with a fixed colormap (legend in the timeline), true colour (B04,B03,B02) with sane stretch, both clipped to the polygon with a thin outline; call app.superres.upscale(frame_array, kind) if available to produce ndviSr/rgbSr PNGs, else omit.
- Also: farm NDVI/NDMI z-scores vs the farm's own same-date history (S2 history since 2017 via cheap per-scene polygon statistics, ADR-0007 D1) and vs zone peers (other CIREN orchards of the same crop inside the zone circle: get polygons from app.sources.ciren; compute their polygon stats from the same scenes — cap peers at ~8) → PeerComparison; dry-season vigour test for 'irrigated?' rung and an abandonment signal (sustained dry-season vigour loss vs history and peers).
- Expose: timeline(portfolio, farm, sr) -> ImageryTimeline; ndvi_series(farm) / ndmi_series(farm) -> Series; peers(portfolio, farm) -> PeerComparison; vigour_signals(farm) -> {irrigatedEvidence, abandonment}. Keep a single farm under ~3 min cold and fast when cached. Tests on a tiny synthetic stack + one cached real scene.` },
  { key: 'svc-superres', own: `${SVC}/app/superres/** and tests/test_superres*.py`, task: `AI super-resolution for display (ADR-0013 D8):
- Time-boxed evaluation (≤ 75 min) of open pretrained Sentinel-2 super-resolution models that run locally on an Apple M5 laptop (32 GB, MPS or CPU): candidates SEN2SR (ESA / IPL-UV, 10 m → 2.5 m), Satlas super-resolution (Allen AI), DSen2 (20→10 m only, as a component), any other reputable open model you find. Criteria: licence allows our use (record it), installs cleanly into ${PY} (you may "uv pip install --python ${PY}" model-specific packages; you are the only builder allowed to install), runs a 256×256 RGBN chip in seconds, output looks plausible on a real Chilean orchard chip (save before/after PNGs under ${SVC}/data/files/superres_eval/ and a short eval.md there).
- Implement upscale(array, kind) -> (array, meta {model, scale, kind 'ai'|'resampled'}) with a lazy model load and a cache; a clean fallback to Lanczos resampling labelled 'resampled' if the model is unavailable.
- Never feed SR output back into metrics; document that in the module docstring.
- Report the chosen model, licence, speed, and the decision for an ADR.` },
  { key: 'svc-risk', own: `${SVC}/app/risk/** and tests/test_risk*.py`, task: `Risk engine, water status ladder and assessments (ADR-0013 D6, D7; ADR-0005, ADR-0006):
- Stage resolution: farm's crop template + zone/farm overrides → current stage and stage bands for the 13-month window.
- Climate component C (0..1): per-peril severities from the sources (frost vs stage critical temps using RAN hourly if available else CR2MET tmin; heat/sunburn; harvest rain 72 h; water supply/stress; chill shortfall in winter), each weighted by stage sensitivity; combine with 0.5·weighted-mean + 0.5·max.
- Disaster component D: burned area intersecting farm/zone, active official declarations/decrees, recent events (from app.sources.events / water).
- Geography component G: frost-pocket index (farm elevation relative to its zone circle from Copernicus DEM GLO-30 on Planetary Computer), fire recurrence in the zone since 2012, basin water security from decree history; each 0..1 with drivers.
- Risk = 100·min(1, (0.5·(a·C + b·D)/(a+b) + 0.5·max(C,D))·(1 + c·G)); tiers 35/60; plain-language drivers with value vs normal and provenance; headline sentence; credit rule evaluation (portfolio + crop + farm overrides) with loan context (next installment, outstanding).
- WaterStatus ladder: irrigated (CIREN irrigated polygon + vigour evidence), demand (Kc(stage)·ETo 7 d/30 d), supply (decree + snowmelt), stress (NDMI z vs history and peers; canopy-minus-air from Landsat ST when a clear pass exists — optional), abandonment.
- assess_farm(portfolio, farm_id) -> FarmAssessment and assess_portfolio(portfolio) -> PortfolioAssessment (exposure by tier/crop/zone, ranked, events, credit actions), caching results in DuckDB keyed by inputs + as-of.
- Code against the contract interfaces of the other builder packages (they are being built in parallel; use their declared function names; write tests with fixtures/mocks). Golden tests for the formula (hand-computed cases: single severe frost at bloom → high; frost in dormancy → normal; geography amplifies but never alone; disaster alone reaches high).` },
  { key: 'svc-agent', own: `${SVC}/app/agent/** and tests/test_agent*.py`, task: `Farming agent (ADR-0013 D9):
- Claude tool-use loop with the Anthropic Python SDK. Model from env CLM_AGENT_MODEL, default "claude-opus-5-5" (also allow "claude-sonnet-5-5" for speed). Key from env only; if absent, recommend() raises a typed NoApiKey error → router returns 503 {error:'no_api_key'}.
- Tools (thin wrappers over other builders' functions, called by name): get_zone(portfolio, zoneId), get_crop_template(crop), get_history(farm, variable, years) (CR2MET/RAN/NDVI series summaries), list_events(bbox, since), backtest(params, zone, years): replays the frost and harvest-rain rules over past seasons for the zone and reports hits/false alarms against known events (September 2013 frost; February 2023 fires; decree periods; plus frost nights from station history) — implement backtest yourself on top of the weather series.
- System prompt: agronomist + credit-risk analyst; must cite tool outputs for every number ("never invent values"); output proposals as RuleChange objects (status 'proposed', actor agent) with reasons and evidence; short markdown answer in Spanish-or-English matching the question language.
- Max ~8 tool turns, timeouts, transcript of tool calls in the response.
- Tests with a fake Anthropic client (no network) covering: tool loop, proposals schema, no-key path.` },
  { key: 'app-wizard', own: `${APP}/src/features/wizard/**`, task: `Update the v0 wizard to v1 (keep its UX quality; read its current code first):
- Step 1 Portfolio: name, lender, CountrySelect (Chile default; others show 'standard data tier' hint; GLOBAL disabled), currency (USD, CLP, local).
- Step 2 Farms: map with satellite base; "Add farm" draw polygon (as v0) AND "Add from cadastre": shows CIREN orchard polygons in view (GET /ciren/orchards, crop filter) — click to add with crop/especie prefilled; crop select limited to the 6 crops with CropPill; covered/netted toggle; planting year.
- Step 3 Zones & rules: zone circles on the map (auto 35 km² per farm shown dashed; "Add shared zone" by clicking a centre; radius editable, default 3,338 m; nearest centre wins); rules editor with layered values crop template → zone → farm (shows inherited value, 'Custom' badge, reset), grouped by stage; credit rules editor (enable/disable, edit threshold/action) at portfolio level with per-farm overrides; every change goes through the audit helpers (actor user, reason optional).
- Step 4 Credit: keep v0 loan step working against new types.
- Step 5 Review: summary incl. zones, overrides and audit entries.
- Commit creates the portfolio in the store. Typecheck/test/build green; check in a browser (headless Chrome via a script or Playwright if available) that drawing and the cadastre layer render.` },
  { key: 'app-farm', own: `${APP}/src/features/farm/**`, task: `Farm page v1 (the hero screen of the demo):
- Header: crop, stage now (with stage bands timeline), tier pill + score, headline, exposure/next installment, DataAsOf, Live/Offline badge.
- Imagery viewer (POST /imagery/farm): large map/canvas of the farm with the frame image (NDVI or true colour toggle; 'AI-enhanced' toggle when ndviSr exists), time slider + play button over the 13 months, FrameKindBadge (observed / interpolated with "N days from a clear image" / AI-enhanced / resampled), stage bands under the slider, legend, coveredWarning, and a small NDVI mean/p10/p90 chart synced to the slider. Clear statement: "Numbers use native 10 m data; AI images are for viewing".
- Risk breakdown card: formula, C/D/G bars with weights a,b,c, top drivers with ProvenancePopover, credit actions triggered.
- Water status ladder card: 5 rungs with status icons, values and provenance.
- Peers card: farm vs zone peers reading.
- Series charts (recharts, as v0 quality): NDVI/NDMI vs own band, precip, Tmin with frost critical line for the stage, Tmax with heat line, ETo/demand; stage bands shaded; installments as lines.
- "Ask the agent about this farm/zone" button opening the agent panel with context.
- Loading skeletons, error states, offline snapshot label. Typecheck/test/build green; verify against the fixtures and the running service if available.` },
  { key: 'app-portfolio', own: `${APP}/src/features/dashboard/**, ${APP}/src/features/portfolios/**, ${APP}/src/features/agent/**`, task: `Portfolios list, dashboard and the agent panel:
- Portfolios page: "Load Chilean sample portfolio" (GET /portfolios/sample), New portfolio (wizard), cards with country flag/name and data tier.
- Dashboard (POST /assess/portfolio): KPIs (exposure, exposure at watch/high, farms by tier), map with farm polygons coloured by tier and zone circles, ranked watchlist with crop pill, stage, score, water status icon, next installment; exposure by crop and by zone charts; recent disasters panel for Chile with evidenceKind badges (observed footprint / official declaration / own signal) and 'most exposure' vs 'most recent' toggle; credit actions list (watch, field visit, restructure review) from credit rules; Live/Offline banner.
- Agent panel (src/features/agent/AgentPanel.tsx, mounted by the shell): chat-style side panel with suggested prompts ("Recomienda parámetros de helada y lluvia de cosecha para esta zona", "Why is this farm at watch?"), shows the answer markdown, the tool-call trace collapsed, evidence (backtest table), and each proposal as a diff card (path, old → new, reason) with Apply / Dismiss → store audit (actor agent proposed, user applied). Handles 503 no_api_key with a friendly setup message (set ANTHROPIC_API_KEY for the service). Typecheck/test/build green.` },
]

const builderPrompt = (b) => `${COMMON}
YOUR ROLE: BUILDER ${b.key}. You own ONLY: ${b.own}. The contract (${ROOT}/contracts/v1/CONTRACT.md + fixtures) and the foundations are in place (service foundation: ${svcFound.summary.slice(0, 1500)} — app foundation: ${appFound.summary.slice(0, 1500)}).
TASK:
${b.task}
Finish by running your tests (service: "${PY} -m pytest ${SVC}/tests -q -k <yours>" and the full suite; app: "npm run typecheck && npm test && npm run build" in ${APP}). Report honestly what works, what is stubbed, and decisions worth an ADR.`

const built = await parallel(BUILDERS.map(b => () =>
  agent(builderPrompt(b), { label: b.key, phase: 'Build', schema: BUILDER_SCHEMA }).then(r => ({ key: b.key, ...(r || { ok: false, summary: 'no result', files: [], verified: [], gaps: ['agent returned nothing'], needs_from_others: [], decisions: [] }) }))
))
const builders = built.filter(Boolean)
log(`Builders done: ${builders.map(b => `${b.key}:${b.ok ? 'ok' : 'FAIL'}`).join(', ')}`)

// ------------------------------------------------------------------ Integrate
phase('Integrate')
const builderDigest = JSON.stringify(builders.map(b => ({ key: b.key, ok: b.ok, summary: b.summary, gaps: b.gaps, needs: b.needs_from_others })))
const INTEG_SCHEMA = {
  type: 'object',
  properties: {
    build_passes: { type: 'boolean' }, tests_pass: { type: 'boolean' },
    summary: { type: 'string' }, fixes: { type: 'array', items: { type: 'string' } },
    pipeline_results: { type: 'string', description: 'what the real-data run produced per farm (risk, frames, sources live vs fallback)' },
    run_instructions: { type: 'string' }, gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['build_passes', 'tests_pass', 'summary', 'fixes', 'run_instructions', 'gaps'],
}
const svcInteg = await agent(`${COMMON}
YOUR ROLE: SERVICE INTEGRATOR. You may edit anything under ${SVC} (and ${ROOT}/contracts/v1 only to fix contract errata, documenting each). Builder reports: ${builderDigest}
1. Apply needs_from_others for service builders; wire every router to the real implementations (no fixture responses left except where a builder explicitly failed — then keep the fixture but mark provenance estimated/unavailable honestly).
2. Full pytest green.
3. Start the service and RUN THE REAL PIPELINE for the Chilean sample portfolio: /portfolios/sample, /assess/portfolio, /assess/farm for every farm, /imagery/farm with sr=true for every farm, /events. Time-box ~90 min total; it is fine if some sources fall back — record which. Fix crashes and obviously wrong numbers (units, signs, dates, NaN). Sanity-check risk tiers are plausible and drivers read well.
4. POST /snapshot/export to write the offline snapshot to ${APP}/public/snapshot/ (check the manifest and that PNGs exist; keep total size reasonable, < 150 MB).
5. Leave the service STOPPED at the end. Report per-farm results, live vs fallback sources, and run instructions.`, { label: 'svc-integrator', phase: 'Integrate', schema: INTEG_SCHEMA })

const appInteg = await agent(`${COMMON}
YOUR ROLE: APP INTEGRATOR. You may edit anything under ${APP} (not ${SVC}, except to start/stop it). Builder reports: ${builderDigest}. Service integration: ${JSON.stringify(svcInteg)}
1. Apply needs_from_others for app builders; make the routes, shell, agent panel mount and data hooks work end to end against the contract.
2. npm run typecheck, npm test, npm run build green.
3. Start the service (${PY} -m uvicorn app.main:app --port 8787 from ${SVC}) and the app dev server (port 5190). In headless Chrome (puppeteer/playwright if installed, else Chrome --headless --screenshot / --dump-dom) check: home → load sample portfolio → dashboard renders with tiers → open 2 farms → imagery viewer shows frames with kind badges and AI toggle → water ladder and risk breakdown render → agent panel opens (no-key message expected) → new portfolio wizard steps render (map, cadastre layer, zones). Save screenshots to ${ROOT}/docs/v1-screens/. Then stop the service and check the app falls back to the offline snapshot with the banner.
4. Brand grep (agviewer|sprout|\\bagv\\b) over app, service, contracts, docs (excluding node_modules, .venv, dist): must be clean.
5. Stop both servers. Report.`, { label: 'app-integrator', phase: 'Integrate', schema: INTEG_SCHEMA })

// ------------------------------------------------------------------ Review
phase('Review')
const FIND_SCHEMA = {
  type: 'object',
  properties: { findings: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, severity: { type: 'string', description: 'blocker|major|minor' }, area: { type: 'string' },
    file: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
    required: ['id', 'severity', 'problem', 'evidence', 'fix'] } } },
  required: ['findings'],
}
const integDigest = JSON.stringify({ svcInteg, appInteg })
const REVIEWS = [
  { key: 'spec-trust', prompt: `Review v1 against ADR-0013 (every Must in D11; D3 zones, D4 rules + audit, D6 formula exactly, D7 ladder, D8 trust rule: confirm in code that NO metric reads SR output, frames are labelled, provenance on every value; D9 agent never invents values and only proposes). Also check contract conformance (service responses vs pydantic vs zod) and the brand rule.` },
  { key: 'runtime-e2e', prompt: `Run the system (service on 8787 from ${SVC} with ${PY} -m uvicorn app.main:app, app on 5190) and exercise it like a judge in headless Chrome: sample portfolio, dashboard, 3 farms (imagery slider/AI toggle, ladder, risk, charts), wizard end to end (draw a farm, add from cadastre, add a shared zone, override a rule, set a loan, create), agent panel, offline fallback (stop the service). Report broken interactions, console errors, slow screens (> 5 s), layout bugs at 1440 px and 390 px, confusing copy. Stop servers at the end.` },
  { key: 'data-correctness', prompt: `Audit the data and math: pick 3 sample farms and recompute by hand/independent script from the cached DuckDB data: NDVI polygon stats on native pixels, interpolation daysToClear, stage resolution for today, frost/harvest-rain severities, C/D/G and the final score per the formula, decree status, units (mm, °C, %), date alignment (UTC days, CR2MET timing), percentile bands, and that 'estimated'/'stale' flags are honest. Flag any number shown in the UI that cannot be traced to a source.` },
]
const reviews = await parallel(REVIEWS.map(r => () => agent(`${COMMON}
YOUR ROLE: REVIEWER (${r.key}). Read-only on code (you may write scratch scripts under ${ROOT}/.review/${r.key}/ and start/stop servers). Integration reports: ${integDigest.slice(0, 6000)}
${r.prompt}
Return concrete, verified findings only (with evidence: file:line, command output, screenshot path).`, { label: `review:${r.key}`, phase: 'Review', schema: FIND_SCHEMA })))
const findings = reviews.filter(Boolean).flatMap((r, i) => (r.findings || []).map(f => ({ ...f, reviewer: REVIEWS[i].key })))
log(`Review findings: ${findings.length} (${findings.filter(f => f.severity === 'blocker').length} blockers, ${findings.filter(f => f.severity === 'major').length} major)`)

// ------------------------------------------------------------------ Fix
phase('Fix')
const fix = await agent(`${COMMON}
YOUR ROLE: FIXER. You may edit ${APP}, ${SVC}, ${ROOT}/contracts/v1. Findings (verify each against the code before fixing; skip false positives with a reason): ${JSON.stringify(findings)}
Fix all blockers and majors, then minors as time allows. Afterwards: full pytest, npm typecheck/test/build green; if any data-producing code changed, re-export the offline snapshot (start the service, POST /snapshot/export, stop it). Update ${APP}/README.md and ${SVC}/README.md run instructions (how to set ANTHROPIC_API_KEY for the agent, how to run both, how the snapshot fallback works). Leave all servers stopped.`, {
  label: 'fixer', phase: 'Fix',
  schema: { type: 'object', properties: {
    build_passes: { type: 'boolean' }, tests_pass: { type: 'boolean' }, summary: { type: 'string' },
    applied: { type: 'array', items: { type: 'string' } }, skipped: { type: 'array', items: { type: 'string' } },
    remaining_issues: { type: 'array', items: { type: 'string' } } },
    required: ['build_passes', 'tests_pass', 'summary', 'applied', 'skipped', 'remaining_issues'] },
})

// ------------------------------------------------------------------ Product owner
phase('Product owner')
const po = await agent(`${COMMON}
YOUR ROLE: PRODUCT OWNER. Record what the v1 build decided and learned. Only write inside ${ROOT}/docs/.
Inputs: builder decisions ${JSON.stringify(builders.map(b => ({ key: b.key, decisions: b.decisions, gaps: b.gaps })))}; integration ${integDigest.slice(0, 5000)}; review findings ${JSON.stringify(findings).slice(0, 5000)}; fixer ${JSON.stringify(fix)}.
1. Write new ADRs from 0014 upward (style of ADR-0013: Status, Date, Builds on, Context, Decisions D1.., Consequences) for each significant build-time decision: the super-resolution model choice (licence, speed, fallback), the imagery interpolation parameters, the sample portfolio composition, crop template sources/approximations, and any deviation from ADR-0013. Status Accepted when implemented and verified; Proposed when the team must decide. Update ${ROOT}/docs/adr/README.md index.
2. Write ${ROOT}/docs/v1-status.md: what works end to end (with screenshot paths from docs/v1-screens), what is fallback/estimated, known gaps, how to run, and a 3-minute demo path for Sunday 9:30 (screen by screen, what to say for a lender, which farm tells which story: bloom frost, water decree, fire, abandonment/peer).
Return a short summary.`, { label: 'product-owner', phase: 'Product owner' })

return {
  contract: contract.summary,
  foundations: { service: svcFound.summary, app: appFound.summary },
  builders: builders.map(b => ({ key: b.key, ok: b.ok, summary: b.summary, gaps: b.gaps, decisions: b.decisions })),
  integration: { service: svcInteg, app: appInteg },
  review: { total: findings.length, blockers: findings.filter(f => f.severity === 'blocker').length, major: findings.filter(f => f.severity === 'major').length },
  fix,
  product_owner: po,
}
