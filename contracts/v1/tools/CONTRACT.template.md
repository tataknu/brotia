# Climate Loan Monitor — v1 contract

- **Status:** binding for the v1 build (Sunday 2026-11-08 demo). Contract version `1`.
- **Scope source:** ADR-0013 (v1 scope), ADR-0004 to ADR-0012 (Chilean data), ADR-0001 D7 (credit context). Bolivia is archived: no Bolivian features.
- **Who implements it:** the service (Python 3.12, FastAPI, pydantic v2, DuckDB) and the app (React 18 + TypeScript), in parallel, without talking to each other. Where this document and your intuition differ, this document wins. If it is wrong or silent, do the simplest thing consistent with it and report it in `needs_from_others`; do not invent a variant.
- **Normative files:** this document, [`types.ts`](types.ts) (reproduced verbatim in §A) and [`fixtures/`](fixtures/). Fixture numbers are illustrative, except where a provenance note or this document cites a real source (CIREN polygons and object ids, DGA decree No. 177, GWIS fire 11749494, CEMS EMSR859).

## 0. Conventions (apply everywhere)

| Topic | Rule |
|---|---|
| JSON keys | **camelCase**, exactly as in §A. ADR-0012 names map as `observed_at → observedAt`, `fetched_at → fetchedAt`, `licence_tier → licenceTier`, `data_tier → dataTier`. Python: `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)` and responses serialised `by_alias=True` (FastAPI `response_model_by_alias` stays True). |
| Enum values | snake_case strings exactly as written (`'table_grape'`, `'harvest_rain'`, `'restructure_review'`). Never translate or re-case. |
| Optional | `x?: T \| null` in TS. The service SHOULD emit `null` rather than omit. Both sides MUST treat missing and `null` identically. Unknown extra keys MUST be ignored by readers (forward compatibility). |
| Dates | `'YYYY-MM-DD'`. Timestamps ISO 8601 UTC with `Z`. Month-days `'MM-DD'`. `asOf` defaults to today (UTC) when absent. |
| Coordinates | `[lng, lat]`, WGS84 (EPSG:4326), GeoJSON order everywhere (polygons, centroids, zone centres, bboxes `[minLng, minLat, maxLng, maxLat]`). |
| Money | Portfolio currency, plain numbers, ≤ 2 decimals. No FX conversion in v1. `Loan.currency` must equal `Portfolio.currency`. |
| Numbers | Scores 0–100 with 1 decimal. Severities, component values, sensitivities 0–1 with ≤ 3 decimals. °C and mm with 1 decimal. |
| Ids | Farm ids are slugs `[a-z0-9-]+`, unique in a portfolio. Auto zone id = `auto-<farmId>`. Rule ids kebab-case. |
| Provenance | Every value from a source carries a `Provenance` (§A). Values the service cannot obtain are returned as `null` (or `points: []`), with `provenance.note` saying why and `estimated`/`stale` set honestly. **Never invent data** (trust rule, §E.12). |
| Statelessness | The service persists **caches only** (DuckDB). It stores nothing about portfolios. Every POST carries the full `Portfolio`; the service recomputes effective rules and zones from it. The app owns persistence (zustand persist) and the audit trail. |

## A. Domain model

Names below are the JSON names. The TypeScript is normative; the Python models mirror it field by field.

Summary of the entities (details and comments in the code block):

- **Crop**: `'cherry' | 'blueberry' | 'avocado' | 'walnut' | 'hazelnut' | 'table_grape'`. Each has a `CropTemplate` with Spanish/English labels, CIREN `especie_01` values (`cirenEspecie: string[]`; hazelnut has two candidates `AVELLANO`, `AVELLANO EUROPEO`), `evergreen` (avocado only), `coveredDefault` (false for all six) and `coverLikelihood` (`table_grape: 'often'`, cherry and blueberry `'sometimes'`).
- **Country**: the 12 sovereign South American countries (AR, BO, BR, CL, CO, EC, GY, PY, PE, SR, UY, VE); `CL` is `dataTier: 'enhanced'`, the others `'standard'`; plus the pseudo entry `GLOBAL` with `comingLater: true` (shown, not selectable).
- **Peril**: `frost, heat, harvest_rain, water, chill, fire, flood, declared_emergency, abandonment, vigour`. C (climate) uses `frost, heat, harvest_rain, water, chill, vigour, abandonment`; D (disaster) uses `fire, flood, declared_emergency`; G (geography) drivers reuse `frost` (frost pocket), `fire` (recurrence) and `water` (basin water security).
- **Stage**, **StageThresholds**, **AgronomicRules**, **RiskWeights**, **CreditRule**, **CropTemplate**: crop defaults (§E.2–E.3, §E.7).
- **RulesPatch** (one shape for every override layer), **ZoneOverrides** (per crop), **CreditRuleOverrides** (per rule id).
- **Zone** (35 km² circle), **Farm**, **Loan / Installment / ScheduleType** (unchanged from v0 `app/src/domain/types.ts`; `Currency` is now `'USD' | 'CLP'`), **Portfolio**, **RuleChange** (audit).
- **Provenance**, **SeriesPoint / Series**, **Driver / RiskComponent / Risk**, **WaterStatus**, **PeerComparison**, **ImageryFrame / ImageryTimeline**, **ClimateEvent**, **FarmAssessment**, **PortfolioAssessment**, **AgentRecommendation**.
- API envelopes: **ApiError**, **Health**, **CirenOrchardCollection**, request bodies, **SnapshotManifest**.

```ts
<<TYPES_TS>>
```

## B. REST API

Base URL `http://localhost:8787`. JSON in and out (`Content-Type: application/json`), UTF-8. CORS allows origins `http://localhost:5190` and `http://127.0.0.1:5190`, methods GET/POST/OPTIONS, header `Content-Type`.

| Method + path | Request | 200 response | Notes |
|---|---|---|---|
| `GET /health` | — | `Health` | Cheap, no upstream calls. The app uses it to pick live vs offline (timeout 3 s). `agentAvailable` = `ANTHROPIC_API_KEY` present. |
| `GET /countries` | — | `Country[]` | Static. 13 entries (12 + `GLOBAL`). |
| `GET /crops` | — | `CropTemplate[]` | The six templates, in the order of `CROPS`. Static defaults; lender edits live in `Portfolio.cropOverrides`. |
| `GET /portfolios/sample` | — | `Portfolio` | The Chilean sample portfolio. **Must** cover all six crops on real CIREN polygons with loans (ADR-0013 D11). The 2-farm fixture is only a subset for tests. |
| `GET /ciren/orchards?bbox=minLng,minLat,maxLng,maxLat&crop=<Crop>` | query | `CirenOrchardCollection` | CIREN Catastro Frutícola polygons for "add farm from cadastre". `crop` optional (filters by `cirenEspecie`; without it, all species, `properties.crop` null for species outside the six). Max bbox 0.25° per side → else 400 `bbox_too_large`. Max 300 features, nearest to the bbox centre first, `truncated: true` when capped. Chile only: outside Chile returns an empty collection with a note. Upstream down and nothing cached → 200, empty `features`, `provenance.note` with the reason. |
| `POST /assess/portfolio` | `AssessPortfolioRequest` | `PortfolioAssessment` | One `ranked` entry per farm. Farm-level failures become warnings and estimated values, never a failed request. |
| `POST /assess/farm` | `AssessFarmRequest` | `FarmAssessment` | 404 `not_found` if `farmId` is not in the portfolio. |
| `POST /imagery/farm` | `ImageryRequest` (`sr` default true) | `ImageryTimeline` | PNGs served by `GET /files/imagery/<farmId>/<YYYY-MM-DD>_<layer>.png`, `layer ∈ ndvi, rgb, ndvi_sr, rgb_sr`. May take tens of seconds cold; results are cached. App timeout 120 s. |
| `GET /files/imagery/...` | — | `image/png` | Static files from the service cache. 404 when missing. |
| `GET /events?bbox=minLng,minLat,maxLng,maxLat&since=YYYY-MM-DD` | query | `ClimateEvent[]` | Newest `start` first. `since` default asOf − 13 months. Max bbox 25° per side. `affectedFarmIds: []`, `affectedExposure: 0` (no portfolio here). Providers queried in parallel; the list is empty only if all fail and nothing is cached (ADR-0012 D4). |
| `POST /agent/recommend` | `AgentRequest` | `AgentRecommendation` | 503 `{error:'no_api_key'}` when `ANTHROPIC_API_KEY` is absent. Exactly one of `zoneId` / `farmId` may be set (both null = portfolio-level question). Timeout 90 s. Proposals are `status: 'proposed'`; nothing is applied server-side. |
| `POST /snapshot/export` | `SnapshotExportRequest` | `SnapshotManifest` | Writes §C into `app/public/snapshot/` (default: the sample portfolio, `sr` true). Overwrites the previous snapshot. |

**Errors.** Every non-2xx body is `ApiError` `{error, detail}`:

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_request` | Body or query fails validation (the service replaces FastAPI's default 422 handler with this shape and status). |
| 400 | `bbox_too_large` | bbox exceeds the endpoint limit. |
| 404 | `not_found` | Unknown `farmId` / `zoneId` in the posted portfolio, unknown file. |
| 503 | `no_api_key` | Agent called without `ANTHROPIC_API_KEY`. |
| 500 | `internal_error` | Bugs only. |

**Standard tier.** A portfolio whose country is not `CL` is assessable: `/assess/*` and `/imagery/farm` return 200 with `dataTier: 'standard'`, using global sources only (ERA5, CHIRPS, Sentinel-2/Landsat, GWIS, GFM); Chile-only signals (DGA decrees, snowmelt, CIREN irrigation and peers) are `null`/`unknown`/`insufficient_peers` with a note, never an error. v1 build effort goes to Chile; standard-tier values may be mostly unavailable.

**Upstream failures never produce a 5xx.** They produce stale cache (`stale: true`), estimated values (`estimated: true`) or `null` with `provenance.note`, plus a plain-language entry in `warnings`.

**App client rules.** One module (`app/src/data/**`) wraps every call, resolves image URLs (`base + url` live, `/snapshot/` + `url.slice('/files/'.length)` offline) and falls back to the snapshot when `/health` fails or times out. Requests carry no auth.

## C. Offline snapshot

Written by `POST /snapshot/export` (and by the service CLI `python -m app.snapshot` if the foundation provides one) to `/Users/cristian/Documents/projects/energhack/app/public/snapshot/`. This is a sanctioned runtime write by the service into the app's `public/` folder; no service builder edits app source files.

```
app/public/snapshot/
  manifest.json                        SnapshotManifest
  portfolio.json                       Portfolio (the exported one; default the sample)
  crops.json                           CropTemplate[]
  countries.json                       Country[]
  assessment-portfolio.json            PortfolioAssessment
  assessment-farm-<farmId>.json        FarmAssessment, one per farm
  imagery-<farmId>.json                ImageryTimeline, one per farm (urls keep the '/files/imagery/...' form)
  imagery/<farmId>/<YYYY-MM-DD>_<layer>.png
  events.json                          ClimateEvent[] for the portfolio bbox + 25 km, since asOf − 13 months
```

- The app falls back to these files when the service is unreachable and labels the UI **"Offline snapshot of <manifest.asOf>"** (date formatted for display).
- Snapshot assessments are valid only for the portfolio whose `id === manifest.portfolioId`. For any other portfolio, or after rule edits, the app shows "Assessment needs the live service" instead of stale numbers. The agent is unavailable offline.
- `manifest.files` lists every file written, relative to `snapshot/`. The app never lists the directory.

## D. Folder ownership (build phase)

Only the owner edits a folder. Everyone may read everything. Requests for changes in someone else's folder go into `needs_from_others`. Contract changes go through the contract author (`contracts/v1/**`).

| Owner | Owns (absolute paths under `/Users/cristian/Documents/projects/energhack/`) |
|---|---|
| contract author | `contracts/v1/**` |
| service foundation | `service/pyproject.toml`, `service/.venv`, `service/app/{main.py,config.py,models.py,provenance.py,store.py,http.py,registry.py,snapshot.py}`, `service/app/routers/**`, `service/tests/test_foundation*.py`, `service/README.md` |
| svc-weather | `service/app/sources/weather/**` (+ `service/tests/test_weather*.py`) |
| svc-water-events | `service/app/sources/water/**`, `service/app/sources/events/**` (+ `service/tests/test_water*.py`, `service/tests/test_events*.py`) |
| svc-portfolio | `service/app/domain/**`, `service/app/sources/ciren/**`, `service/data/**` (+ `service/tests/test_domain*.py`, `service/tests/test_ciren*.py`) |
| svc-imagery | `service/app/imagery/**` (+ `service/tests/test_imagery*.py`) |
| svc-superres | `service/app/superres/**` (+ `service/tests/test_superres*.py`) |
| svc-risk | `service/app/risk/**` (+ `service/tests/test_risk*.py`) |
| svc-agent | `service/app/agent/**` (+ `service/tests/test_agent*.py`) |
| app foundation | `app/package.json`, configs, `app/src/{App.tsx,main.tsx,index.css}`, `app/src/domain/**`, `app/src/data/**`, `app/src/state/**`, `app/src/shared/**`, `app/DESIGN.md`, `app/README.md` |
| app-wizard | `app/src/features/wizard/**` |
| app-farm | `app/src/features/farm/**` |
| app-portfolio | `app/src/features/dashboard/**`, `app/src/features/portfolios/**`, `app/src/features/agent/**` |

Runtime outputs not owned by anyone: the DuckDB cache and image cache (paths chosen by the service foundation under `service/`), and `app/public/snapshot/**` (written only by the service's snapshot export).

Implementation hints that follow from ownership: the pydantic mirror of §A lives in `service/app/models.py`; the TS copy of `types.ts` lives in `app/src/domain/`; the crop templates seed from `fixtures/crops.json` into `service/data/` (svc-portfolio may refine values but must keep keys, stage keys and shapes); the layering, stage lookup and zone rules (§E.2–E.4) are implemented in `service/app/domain/` and mirrored in `app/src/domain/` for the editors.

## E. Formula appendix

### E.1 Risk (ADR-0013 D6, verbatim)

```
C = climate component      (0..1)  current external climate stress, weighted by stage sensitivity:
                                     frost, heat/sunburn, harvest rain, water supply/stress, chill
D = disaster component     (0..1)  natural disasters touching the farm or zone: burned area, flood,
                                     official emergency/scarcity declarations
G = geography component    (0..1)  static vulnerability: frost-pocket position (relative elevation
                                     in the zone, Copernicus DEM), fire recurrence in the zone
                                     (2012–), basin water security (decree history since 2008)

base = 0.5 · (a·C + b·D) / (a + b) + 0.5 · max(C, D)     # one severe peril alone can reach "high"
Risk = 100 · min(1, base · (1 + c·G))                    # geography amplifies, never acts alone
defaults: a = 0.65, b = 0.35, c = 0.30   (per crop; editable per stage, zone and farm)
tiers:    normal < 35 ≤ watch < 60 ≤ high            (ADR-0001 D5)
```

Contract definitions of the components (expert defaults, labelled approximate):

- `x_p` = severity of peril p (0..1, §E.5); `s_p` = sensitivity of the farm's **current stage** to p (effective, §E.2).
- **C** = 1 − ∏ over climate perils (1 − s_p · x_p) (noisy-OR).
- **D** = 1 − ∏ over disaster perils (1 − s_p · x_p).
- **G** = mean of the available geography factors (§E.5); 0 when none is available (then a warning).
- `score = round(100 · min(1, base · (1 + c·G)), 1)`; `scoreTier`: score < 35 normal, 35 ≤ score < 60 watch, score ≥ 60 high.
- `tier` = max(`scoreTier`, credit-action floor) (§E.7). Order normal < watch < high.
- Weights a, b, c are crop-level, overridable per portfolio crop, zone and farm (per-stage weights are out of v1).
- `formula` is a display string with numbers substituted, 2 decimals for components, e.g. `base = 0.5·(0.65·0.36 + 0.35·0.60)/(0.65+0.35) + 0.5·max(0.36, 0.60) = 0.52; risk = 100·min(1, 0.52·(1 + 0.30·0.40)) = 58.6`. Never parsed.
- `Driver.impact` = s_p · x_p for C and D drivers, c · x for G drivers. `Risk.drivers` = top 5 by impact desc with impact > 0. Each component lists all evaluated drivers.
- `headline` = `"<stage label>: <text of the top C or D driver>"` when that driver's impact ≥ 0.1 (geography drivers never headline: geography amplifies, never acts alone), else `"No significant stress at <stage label, lower case>."`.

### E.2 Rule layering and change paths

Effective value of any agronomic leaf = first value that is set (not missing, not null) in:

1. `farm.overrides` (RulesPatch)
2. `zone.overrides[farm.crop]` of the farm's **effective** zone (§E.4)
3. `portfolio.cropOverrides[farm.crop]`
4. the service template (`GET /crops`)

Merging is per leaf (deep). Leaf paths in a `RulesPatch` and in the template use the same names:

| Leaf | Path in a RulesPatch | Template location |
|---|---|---|
| stage window | `stages.<stageKey>.start`, `stages.<stageKey>.end` | `stages[key=stageKey].start/end` |
| stage sensitivity | `stages.<stageKey>.sensitivity.<peril>` | `stages[key=stageKey].sensitivity[peril]` |
| stage thresholds | `rules.stages.<stageKey>.<frostCriticalC\|frostSevereC\|heatC\|harvestRainMm72h\|kc>` | same |
| crop rules | `rules.chillHoursMin`, `rules.baselineYears` | same |
| weights | `weights.a`, `weights.b`, `weights.c` | same |

Credit rules: effective set = template `creditRules` (by id), then `portfolio.creditRules` (same id replaces, new id appends), then `farm.creditRuleOverrides[id]` merged per field (`when` merged per field, so `{when:{withinDaysBeforeInstallment:90}}` changes only that field). Disabled rules are skipped.

`RuleChange.path` is a dot path from the scope root:

| `scope.level` | `scope.id` | Root | Example path |
|---|---|---|---|
| `crop` | a Crop | `portfolio.cropOverrides[crop]` | `rules.stages.bloom.frostCriticalC` |
| `zone` | Zone.id | the Zone | `overrides.cherry.rules.stages.bloom.frostCriticalC` |
| `farm` | Farm.id | the Farm | `overrides.rules.stages.bloom.frostCriticalC`, `creditRuleOverrides.cr-abandonment.enabled`, `covered`, `irrigatedDeclared` |
| `portfolio` | Portfolio.id | the Portfolio | `creditRules.pf-score-80.when.value`, `creditRules.pf-new-rule` (newValue = whole CreditRule) |

Applying a change: walk the path, creating missing objects; set the leaf to `newValue`; `newValue: null` deletes the leaf (reset to inherited) and prunes empty parent objects. In `portfolio.creditRules` (an array) the segment after `creditRules` selects the element by `id`. `oldValue` records the **effective** value before the change (it may be inherited). The app appends every applied, proposed-then-applied or dismissed change to `portfolio.audit` (append-only). Agent proposals arrive as `status: 'proposed'` with `actor.kind: 'agent'`; on apply the app appends a copy with `status: 'applied'`, `actor` = the user, the same `path`/`newValue` and `recommendationId` set. The UI marks any value set at the farm, zone or portfolio-crop level as "Custom" with a reset (= a change with `newValue: null`).

### E.3 Stages and the current stage

- Windows are inclusive `'MM-DD'` and may wrap the year end (`start > end`). Template windows tile the year with no gap and no overlap (the fixture crop templates are checked for this).
- Current stage at date d: compare `MM-DD` of d (29 Feb counts as 28 Feb); the stage whose window contains it. If edits leave overlaps, the first matching stage in `stages[]` order wins; if they leave a gap, the stage with the latest start before d wins. The service adds a warning in either case.
- `stageBands`: concrete dated bands covering the 13-month window ending asOf, clipped to the window, ascending.
- Template calendars (ADR-0013 D5, trimmed to tile the year): see `fixtures/crops.json`. All six templates are `approximate: true`.

### E.4 Zones

- A zone is a circle of **35 km²**: `radiusM = 3338` (√(35 000 000 / π) = 3337.8 m).
- Every farm has an auto zone `auto-<farmId>` centred on its centroid, unless its centroid lies inside one or more **shared** zones (`auto: false`, haversine distance ≤ radiusM): then the nearest shared centre wins (tie → smallest id).
- The app sets `Farm.zoneId` with this rule when it creates or moves farms or zones. The service recomputes the rule on every request and reports the result as `FarmAssessment.zoneId` / `RankedFarm.zoneId`; if an auto zone is missing from `portfolio.zones` it is synthesised (`center` = centroid, `radiusM` 3338, `overrides` {}) with a warning.
- `baselineYears` (default 5) applies to the NDVI/NDMI baseline only; weather baselines are fixed at 1991–2020 (ADR-0004 D1).

### E.5 Severities (expert defaults)

`ramp(v, v0, v1) = clamp((v − v0) / (v1 − v0), 0, 1)` (works with v1 < v0 for decreasing ramps). "Last 7 days" = the 7 days ending asOf (or the latest date with data, reported in `dataAsOf`).

| Peril | Component | Input | Severity |
|---|---|---|---|
| frost | C | min daily Tmin, last 7 days | `ramp(Tmin, frostCriticalC + 1, frostSevereC)` (FAO T10 + 1 °C → 0, T90 → 1) |
| heat | C | max daily Tmax, last 7 days | `ramp(Tmax, heatC − 2, heatC + 3)` |
| harvest_rain | C | max 72 h rain sum within the last 7 days | `ramp(R, 0.5·T, 1.5·T)`, T = `harvestRainMm72h` (0.5 at T) |
| chill | C | chill hours < 7.2 °C from 1 May to min(asOf, 31 Aug) of the latest winter | `ramp(H, chillHoursMin, 0.5·chillHoursMin)`; 0 when chillHoursMin = 0 |
| water | C | water ladder (§E.11) | irrigated yes/unknown: `max(ramp(snowmeltPctOfNormal, 90, 40), stressMap)`; irrigated no: `stressMap`. stressMap: none 0, mild 0.33, moderate 0.66, severe 1, unknown 0. Null snowmelt → 0 for that term |
| vigour | C | latest persistent NDVI z (§E.6) | `ramp(z, −1.0, −2.5)` |
| abandonment | C | §E.10 | flag ? {high 1.0, medium 0.7, low 0.4}[confidence] : 0 |
| fire | D | fire events | 1.0 if an `observed_footprint` intersects the farm polygon in the 13-month window; else 0.6 if any fire event (incl. FIRMS `own_signal` hotspots) inside the zone circle started in the last 7 days; else 0.4 if an `observed_footprint` intersects the zone circle in the window; else 0 |
| flood | D | flood events | 1.0 footprint intersects the farm; 0.4 footprint intersects the zone circle; else 0 (Chile: not scored beyond this, ADR-0008) |
| declared_emergency | D | official declarations | 0.6 when an `official_declaration` (DGA scarcity decree or emergency declaration) is active on asOf (`start ≤ asOf` and `end` null or ≥ asOf) and covers the farm's commune, province or basin; else 0. With the defaults an active decree alone gives a watch-level score (ADR-0006 "decree floors at watch") |

Geography factors (each 0..1, G = mean of available ones):

| Factor (`metric`) | Peril | Input | Value |
|---|---|---|---|
| `frost_pocket` | frost | farm centroid elevation − mean elevation of the zone circle (Copernicus DEM GLO-30), m | `ramp(relElev, 0, −30)` |
| `fire_recurrence` | fire | number of calendar years since 2012 with GWIS burned area intersecting the zone circle | `min(1, years / 5)` |
| `basin_water_security` | water | number of calendar years since 2008 with a DGA scarcity decree covering the farm's commune/province | `min(1, years / 10)` |

### E.6 Baselines and anomalies

- NDVI/NDMI: Sentinel-2 L2A, SCL-masked, polygon mean of native 10 m pixels, 5-day grid, Whittaker-smoothed gap fill (ADR-0007); gap-filled points have `estimated: true`; dates with no usable value are `null`.
- NDVI/NDMI baseline band: same day of year ± 8 days over the previous `baselineYears` seasons (Landsat + S2 history for Chile, ADR-0007). `z = (v − mean) / max(sd, floor)`, floor 0.05 (deciduous) and 0.035 (avocado). "Persistent z" = the mean of the last 2 composites if both are below −1, else the 32-day mean z.
- Weather bands (tmin, tmax, eto): same day of year ± 7 days, 1991–2020. Precip band: 30-day running totals over 1991–2020, expressed as a daily rate (as v0), so weekly/monthly sums of p50 are meaningful.
- `p10/p50/p90` are `null` when no baseline exists; the value is still shown.

### E.7 Credit rules

- Evaluated per farm after the risk score, on the effective rule set (§E.2). A rule fires when `when` and every `when.and[]` condition hold. A condition on a null metric is false.
- Metrics: `risk.tier` and `risk.score` read `scoreTier` / `score` (not the final tier, to avoid circularity); `water.decreeActive` = `water.supply.decreeActive`; `water.snowmeltPct` = `water.supply.snowmeltPctOfNormal`; `water.stressLevel` = `water.stress.level` (ordered none < mild < moderate < severe; unknown → false); `imagery.abandonment` = `water.abandonment.flag`; `events.burnedAreaIntersects` = any fire `observed_footprint` intersecting the farm polygon in the window.
- `withinDaysBeforeInstallment: N` additionally requires the next installment (§E.8) to be due within N days after asOf.
- Tier floor from fired actions: `watch` and `field_visit` → watch; `high` and `restructure_review` → high. `Risk.tier` = max(scoreTier, floor).
- Default template rules (all six crops): `cr-risk-high-before-installment` (risk.tier ≥ high within 60 days → watch), `cr-abandonment` (→ field_visit), `cr-decree-low-snowmelt` (decree active and snowmelt < 70 % → watch), `cr-burned-area` (→ restructure_review).

### E.8 Exposure and installments (identical on both sides, from v0 `app/src/domain/schedule.ts`)

```ts
export function outstandingAt(loan: Loan, dateISO: string): number {
  if (dateISO < loan.originationDate) return 0;
  const plan = loan.installments.length ? loan.installments : [{ dueDate: loan.maturityDate, amount: loan.amount }];
  const paid = plan.filter((i) => i.dueDate <= dateISO).reduce((s, i) => s + i.amount, 0);
  return Math.max(0, round2(loan.amount - paid));
}
```

- `exposure = outstandingAt(loan, asOf)`, 0 without a loan. `nextInstallment` = the earliest installment of the same `plan` with `dueDate > asOf`, or null.
- `stressedExposure` = exposure of farms whose final `tier` is watch or high. `exposureByTier` and `byCrop`/`byZone` sums equal `totalExposure`.
- `ranked`: score desc, ties exposure desc.

### E.9 Peer comparison

- Peers: CIREN Catastro Frutícola polygons whose `especie_01` is in the crop's `cirenEspecie`, centroid inside the farm's effective zone circle, excluding the farm's own `objectId`; max 20 nearest. Their NDVI/NDMI z is computed with the same native-resolution method and dates as the farm.
- `reading`: `insufficient_peers` if nPeers < 3; else `zone_wide` if peerMedianNdviZ ≤ −1.0; else `farm_specific` if farmNdviZ ≤ −1.0 and farmNdviZ − peerMedianNdviZ ≤ −1.0; else `normal`.
- "Whole zone down" reads as weather and "only this farm down" as management or water (ADR-0013 D3). Both appear as drivers on the farm page; the peer reading is context and does not change the score in v1 (except via abandonment, §E.10).

### E.10 Abandonment (water ladder rung 5)

In the most recent dry season (1 Dec – 30 Apr) inside the window: `flag = true` when NDVI z ≤ −2.0 for ≥ 3 consecutive 5-day composites **and** the peer reading for that period is not `zone_wide`. `confidence` when flagged: high if farm z − peer median z ≤ −1.5 with nPeers ≥ 3; medium if peers are insufficient; low otherwise. When not flagged, `confidence` is the reliability of the "no" reading: high if nPeers ≥ 3 and ≥ 80 % of the dry-season composites are valid; medium if peers are insufficient; low if < 80 % are valid.

### E.11 Water status ladder (ADR-0013 D7)

| Rung | Field | Rule |
|---|---|---|
| 1 Is it irrigated? | `irrigated.value` | `irrigatedDeclared` when not null (evidence also states the CIREN result); else `'yes'` when a CIREN irrigated-area polygon is within 500 m or the orchard stays green in the dry season while rain-fed land in the zone browns; else `'unknown'`. In Ñuble (no HIDRICO layer) default `'yes'` with `estimated: true` (ADR-0010 D2). |
| 2 Demand | `demand` | `kc` = effective Kc of the current stage; `need7dMm = kc × eto7dMm`; `need30dMm = kc × ETo 30-day sum`. |
| 3 Supply | `supply` | `decreeActive` from DGA decrees (XLS + decree-page scrape, ADR-0006); `snowmeltPctOfNormal` from the DGA Sep–Mar snowmelt forecast vs 1991–2020 (null where no forecast basin applies, e.g. south of Ñuble). |
| 4 Getting enough? | `stress` | `level` from `ndmiZ`: > −0.5 none; (−1.0, −0.5] mild; (−1.5, −1.0] moderate; ≤ −1.5 severe; null → unknown. `canopyMinusAirC` only when a clear Landsat pass exists in the last 16 days. |
| 5 Has irrigation stopped? | `abandonment` | §E.10. |

### E.12 Imagery and the trust rule (ADR-0013 D8)

- **Trust rule:** every metric (NDVI/NDMI values and scores, anomalies, z, peers, risk, water status, frame `ndviMean/P10/P90`) is computed from **native-resolution** data. AI super-resolved pixels are **display-only**, never read by any computation, and always labelled. Every value carries provenance. If a source fails: stale cache, or `null`/estimated with the reason. Never invent data.
- Frames: every observed date (Sentinel-2 acquisition with polygon `clearFraction ≥ 0.8`, `daysToClear = 0`) plus interpolated frames on the 5-day grid where no observed frame lies within ±2 days, over the 13-month window, ascending. `daysToClear` = days to the nearest observed frame.
- Labels in the UI: **Observed**, **Interpolated (n days from a clear image)**, **AI-enhanced** (`srKind 'ai'`), **Resampled, not AI** (`srKind 'resampled'`). `trustNote` is shown next to the viewer.
- True colour (`rgb`, `rgbSr`) exists only for observed frames. `ndviSr`/`rgbSr` exist only on frames where SR ran (any subset; at least the latest observed frame when SR is available). SR target ≈ 2.5 m (`srResolutionM`); fallback = plain resampling, `srKind: 'resampled'`.
- PNGs: RGBA, north-up, EPSG:4326 grid exactly covering `bbox` (= polygon bounds + 20 m padding), pixels outside the polygon transparent. NDVI colour: `legend.stops` (`rdylgn`, 0 → `#a50026` … 1 → `#006837`), linear between stops. Native PNGs are ~10 m per pixel: the app renders them with `image-rendering: pixelated`.
- `coveredWarning`: when the effective covered flag is true → "This orchard is under covers or nets: NDVI reads the cover, not the trees."; when `Farm.covered` is null and `coverLikelihood` is `'often'` → the softer text in the imagery fixture; otherwise null.

### E.13 Windows and as-of (ADR-0002 D3, ADR-0013 D10)

13-month display window ending asOf. asOf = request `asOf` or today (UTC); each signal reports its own latest date in `dataAsOf`. Open-Meteo is a last-resort fallback only (quota exhausted until 2026-11-08 00:00 UTC); its values are `licenceTier: 'demo_only'`.

## F. Fixtures

All in [`fixtures/`](fixtures/), checked against `types.ts` with strict `tsc` (`python3 contracts/v1/tools/check_fixtures.py`). Regenerate with `python3 contracts/v1/tools/gen_fixtures.py` (the generator implements §E.1, §E.5 and §E.8, so fixture scores are consistent with the formulas).

| File | Type | Endpoint |
|---|---|---|
| `health.json` | `Health` | `GET /health` |
| `countries.json` | `Country[]` | `GET /countries` |
| `crops.json` | `CropTemplate[]` | `GET /crops` (also the seed for `service/data/`) |
| `portfolio-sample.json` | `Portfolio` (2-farm subset: Requínoa cherry CIREN 22722, Ovalle table grape CIREN 663) | `GET /portfolios/sample` shape |
| `ciren-orchards.json` | `CirenOrchardCollection` | `GET /ciren/orchards` |
| `assessment-portfolio.json` | `PortfolioAssessment` | `POST /assess/portfolio` |
| `assessment-farm-cl-ovalle-table-grape.json` | `FarmAssessment` (series truncated to 3 points) | `POST /assess/farm` |
| `imagery-cl-ovalle-table-grape.json` | `ImageryTimeline` (observed + AI, interpolated + AI, observed without SR) | `POST /imagery/farm` |
| `events.json` | `ClimateEvent[]` | `GET /events` |
| `agent-recommendation.json` | `AgentRecommendation` | `POST /agent/recommend` |
| `manifest.json` | `SnapshotManifest` | `POST /snapshot/export` |
| `errors.json` | `ApiError[]` | error bodies |

The agent tool names in `agent-recommendation.json` (`get_crop_template`, `get_zone_history`, `list_events`, `backtest`) are illustrative; svc-agent names its own tools, but must provide a backtest (ADR-0013 D9) and report every call in `toolCalls`.

Fixture story: Ovalle (Limarí) is under DGA decree No. 177 until 2027-07-10 → D = 0.60, water C driver from low snowmelt → score 58.6, watch, `cr-decree-low-snowmelt` fires. Requínoa is in fruit growth with a mild heat day → 13.4, normal. The audit shows a zone override (Flame Seedless harvest rain 5 mm), a farm override and a farm credit-rule override; the agent proposes two zone changes.

## G. Changing the contract

Only the contract author edits `contracts/v1/**`. Builders who need a change list it in `needs_from_others` with the exact field and reason. Additive optional fields are the preferred kind of change; renames and removals are not allowed after the build starts.
