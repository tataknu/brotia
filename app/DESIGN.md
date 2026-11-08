# Climate Loan Monitor: app design and contracts (v1)

A lender sees which loans on **Chilean fruit and nut orchards** are under climate stress, why, and how much
money is exposed. Users are loan-book managers, not agronomists: money first, ranked lists, plain-language
reasons, and every number shows where it came from.

Binding sources, in order: `contracts/v1/CONTRACT.md` (names, shapes, endpoints, formulas, ownership),
`docs/adr/0013-v1-product-scope-fruit-crops-risk-imagery.md` (v1 scope), then this file. Bolivia is archived:
no Bolivian features. UI language: English (Spanish crop names where useful).

## v1 in one paragraph

Six crops (`cherry, blueberry, avocado, walnut, hazelnut, table_grape`), each with a crop template (stages,
thresholds, weights, credit rules) from `GET /crops`. Rules layer **template → portfolio crop → zone → farm**;
the most specific set value wins, per leaf. Zones are **35 km² circles** (radius 3,338 m): every farm has its own
auto zone `auto-<farmId>`; a user-placed shared zone captures farms whose centroid is inside it (nearest centre
wins). Risk is computed by the service per farm at its current stage (C climate/water, D disasters, G geography).
Every rule edit is versioned in the portfolio's audit trail; the farming agent only proposes, a person applies.
Imagery: observed + interpolated NDVI frames, AI-enhanced (or "resampled, not AI") for display only.

## Trust rule (applies to every screen)

- Every metric comes from the service, computed on native-resolution data. AI super-resolved pixels are
  display-only and always labelled (`FrameKindBadge`).
- Every value from a source shows its provenance (`ProvenanceBadge`): source, observed at, fetched at,
  resolution, licence tier, stale, estimated, data tier, note.
- Never invent data. `null` values render as "–" or "Not available" with `provenance.note`; never a made-up
  number, never a client-side re-computation of risk.
- Offline, the app shows the exported snapshot with the banner "Offline snapshot of <date>". Snapshot numbers
  are only valid for the exported portfolio, unchanged; otherwise the page says "Assessment needs the live
  service" (`UnavailableError`).

## Ownership

Edit **only** your area. Everyone may read everything. Requests go to `needs_from_others`.

| Owner | Paths |
|---|---|
| app foundation | `package.json`, lockfile, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `tailwind.config.cjs`, `postcss.config.js`, `index.html`, `src/{App.tsx,main.tsx,index.css,app.render.test.ts}`, `src/domain/**`, `src/data/**`, `src/state/**`, `src/shared/**`, `DESIGN.md`, `README.md` |
| app-wizard | `src/features/wizard/**` (entry: `WizardPage` in `WizardPage.tsx`) |
| app-farm | `src/features/farm/**` (entry: `FarmPage` in `FarmPage.tsx`) |
| app-portfolio | `src/features/dashboard/**`, `src/features/portfolios/**`, `src/features/agent/**` (entries: `PortfoliosPage`, `DashboardPage`, `AgentPanel`) |

Entry files currently hold foundation placeholders; replace them freely but keep the path and the named export.
The v0 code (fake engine, Bolivian demo, v0 features) is in `src/data/archive/v0/`: excluded from typecheck,
tests and the build; read it for reference, never import it.

**Only the foundation runs `npm install`.** Concurrent installs corrupt the lockfile.

## Stack

Vite 8 + React 18 + TypeScript 7 + Tailwind CSS 3 + lucide-react + recharts 3 + zustand 5 (persist) + clsx +
zod 4 + react-router-dom 6 + leaflet 1.9 + react-leaflet 4 (React 18; do **not** use v5) +
@geoman-io/leaflet-geoman-free 2 + @turf/area + @turf/centroid + vitest 5. Import alias `@/` → `src/`.
Dev server: port **5190, strictPort** (the service's CORS allows exactly `localhost:5190` / `127.0.0.1:5190`).

## Routes (`src/App.tsx`)

| Path | Page |
|---|---|
| `/` | `PortfoliosPage` (list, "New portfolio", "Load sample portfolio") |
| `/portfolios/new` | `WizardPage` |
| `/portfolios/:portfolioId` | `DashboardPage` |
| `/portfolios/:portfolioId/farms/:farmId` | `FarmPage` |
| anything else | redirect to `/` |

Shell: `h-14` header (logo, product name, `ConnectionPill`, "Farming agent" toggle on portfolio routes),
`OfflineBanner` under it, then `main` (scrolls, reset on route change) and, when open, the **agent side panel**
(`AgentPanel`, `max-w-md`, right side; overlays the page under `lg`). Open the panel from anywhere with
`useStore.getState().openAgent({ portfolioId, zoneId?, farmId? })`; the panel reads `useStore(s => s.agentPanel)`.

## Domain (`src/domain/**`, pure TS, node-testable)

- `types.ts`: **verbatim copy** of `contracts/v1/types.ts` (a test fails if they differ). All contract names:
  `Crop, CROPS, Peril, PERILS, Tier, Provenance, Country, CropTemplate, Stage, RulesPatch, Zone, Farm, Loan,
  Portfolio, RuleChange, Series, Risk, Driver, WaterStatus, PeerComparison, ImageryFrame, ImageryTimeline,
  ClimateEvent, FarmAssessment, PortfolioAssessment, AgentRecommendation, Health, SnapshotManifest, …`.
- `schemas.ts`: zod schema per response (`HealthSchema, CountryListSchema, CropTemplateListSchema,
  PortfolioSchema, CirenOrchardCollectionSchema, PortfolioAssessmentSchema, FarmAssessmentSchema,
  ImageryTimelineSchema, ClimateEventListSchema, AgentRecommendationSchema, SnapshotManifestSchema,
  ApiErrorSchema`). Unknown keys are stripped; missing and null are the same (`x?: T | null` parses to `null`).
  Each schema is typed against its contract type. `schemas.test.ts` parses every fixture.
- `constants.ts`: `ZONE_RADIUS_M` (3338), `autoZoneId`, `DEFAULT_WEIGHTS`, `TIER_CUTOFFS`, `tierOf`, `maxTier`,
  `CROP_META` (labels + colours, same as `crops.json`), `PERIL_COMPONENT`, `DEFAULT_COUNTRY` ('CL'),
  `DEFAULT_MAP_CENTER_LNGLAT` ([-71.3, -34.6]) / `DEFAULT_MAP_ZOOM` (8), `FARM_ID_RE`, `slugify`,
  `COUNTRIES_FALLBACK` (static copy of `/countries`, used until the service or snapshot answers).
- `rules.ts` (CONTRACT §E.2–E.4, tested against the sample audit):
  - layering: `resolveRules`, `effectiveRulesForCrop | ForZone | ForFarm` → `{stages, rules, weights}`;
    `resolveFarmLeaf | resolveZoneLeaf | resolveCropLeaf(…, path)` → `{value, layer}` where `layer` is
    `'template' | 'crop' | 'zone' | 'farm'` (anything but `template` is shown as **Custom** with a reset).
  - credit rules: `effectiveCreditRules`, `effectiveCreditRulesForFarm` (template → portfolio → farm per field;
    each result has `source` and `farmOverridden`).
  - stages: `currentStage(stages, date)` (`{stage, gap, overlap}`), `checkStageTiling(stages)`, `inWindow`.
  - zones: `assignZoneId`, `effectiveZoneId`, `makeAutoZone`, `makeSharedZone`, `syncZones` (idempotent),
    `activeZones` (shared + used auto zones), `farmsInZone`, `zoneColor`.
  - audit: `getAtPath`, `setAtPath`, `effectiveValueAt` (= `oldValue`), `makeChange`, `applyChange`,
    `commitChange` (apply + append), `makeRevert` (null when the layer was inherited before), `proposalState`,
    `makeProposalDecision`.
- `schedule.ts` (`generateInstallments`, `outstandingAt` (= CONTRACT §E.8), `nextInstallment` (same plan),
  `installmentsTotal`, `SCHEDULE_LABELS`), `dates.ts` (UTC-safe `'YYYY-MM-DD'` helpers, `todayUTC`),
  `geo.ts` (`polygonAreaHa`, `polygonCentroid`, `haversineM`).

Nothing under `src/domain`, `src/data` (except hooks), or `src/state` imports leaflet or any `.tsx`.

## Data (`src/data/**`): the only module that talks to the service

`api.ts` (async; every call → `ApiResult<T> = { data, source: 'live' | 'snapshot', snapshotDate }`):

```ts
getHealth(); getCountries(); getCrops(); getSamplePortfolio();
getCirenOrchards(bbox, crop?)                 // live only, bbox ≤ 0.25° per side
assessPortfolio(portfolio, asOf?); assessFarm(portfolio, farmId, asOf?)
getFarmImagery(portfolio, farmId, { sr?, asOf? })
getEvents(bbox, { since?, portfolioId? })     // bbox: portfolioBBox(portfolio) (+25 km); offline only for the exported portfolio
recommend(agentRequest)                       // live only; 503 → ApiRequestError code 'no_api_key'
exportSnapshot(req?)                          // live only
imageUrl(frame.urls.ndvi, source)             // live: SERVICE_URL + url; snapshot: /snapshot/<url minus /files/>
portfolioBBox(portfolio, padKm = 25); assessmentFingerprint(portfolio)
```

- Base URL `import.meta.env.VITE_SERVICE_URL` (default `http://localhost:8787`). Timeouts: health 3 s, static
  20 s, events/CIREN 45 s, assess 120 s, imagery 120 s, agent 90 s. A timeout re-probes `/health`: if the
  service is up the timeout surfaces as an error (retry), it does not switch the app to the snapshot.
- Mode (`connection.ts`): `/health` decides live vs snapshot; a network failure on any live call switches to the
  snapshot; offline is re-probed every 30 s. The snapshot is `app/public/snapshot/` (written only by the
  service's `POST /snapshot/export`; nobody edits it by hand). No snapshot → `UnavailableError`.
- Errors: `UnavailableError` (`.reason`, UI text; `NEEDS_LIVE` = "Assessment needs the live service"),
  `ApiRequestError` (`.status`, `.code`, `.detail`, from the service; no fallback), `ContractError` (response
  breaks the contract), `NetworkError`.

`hooks.ts` (cache keyed by endpoint + canonical inputs; rule edits refetch, renames and audit-only edits do not):

```ts
const { data, source, snapshotDate, error, loading, refetch } = usePortfolioAssessment(portfolio, asOf?);
useConnection()  → { mode, manifest, health, offlineReason, recheck }
useCountries(); useCrops(); useSamplePortfolio(enabled?); useCirenOrchards(bbox, crop?)
useFarmAssessment(portfolio, farmId, asOf?); useFarmImagery(portfolio, farmId, { sr?, asOf? })
useEvents(bbox, { since?, portfolioId? }); usePortfolioEvents(portfolio, since?)
useRecommend() → { run(req), data, error, loading, reset }
useQuery(key, fetcher); invalidate(prefix?)
```

## State (`src/state/store.ts`)

zustand v5 + `persist`, key **`clm-store-v2`** (v0's `clm-store-v1` is ignored). The app owns persistence and
the audit trail; the service is stateless. Zones, overrides, credit rules and the audit live **inside**
each `Portfolio`. Every portfolio action takes `pid`; pass `DRAFT` (`'draft'`) to edit the wizard draft.

```ts
state:   portfolios, draft, wizardStep, recommendations: Record<pid, AgentRecommendation[]>, userName, agentPanel
draft:   startDraft({country?, currency?}) → id · commitDraft() → id · discardDraft() · setWizardStep(n)
pf:      addPortfolio(p) (replaces same id; syncZones) · deletePortfolio(id) · updateMeta(pid, {name,lender,country,currency})
farms:   addFarm(pid, {polygon, crop?, name?, id?, ciren?, covered?, irrigatedDeclared?, plantingYear?, loan?}) → farmId
         updateFarm(pid, farmId, patch) · removeFarm(pid, farmId) · setLoan(pid, farmId, loan | null)
zones:   addSharedZone(pid, [lng, lat], {name?, color?}) → zoneId · updateZone(pid, zoneId, {name, center, radiusM, color})
         removeZone(pid, zoneId)   // shared only; auto zones follow their farm
rules:   applyRuleChange(pid, {scope, path, newValue, reason, actor?}, templates) → RuleChange   // audited
         revertChange(pid, changeId, templates)
agent:   addRecommendation(pid, rec) · applyProposal(pid, recId, proposalId, templates)
         dismissProposal(pid, recId, proposalId, templates) · clearRecommendations(pid)
ui:      openAgent({portfolioId, zoneId?, farmId?}) · closeAgent() · setUserName(name)
helpers: usePortfolio(pid) (stable; DRAFT works), useRecommendations(pid), newId(prefix)
```

- Farm ids are slugs from the name (`'Requínoa cherries'` → `requinoa-cherries`, unique). Every farm/zone
  reducer runs `syncZones`, so `Farm.zoneId` always follows §E.4.
- Rule edits **must** go through `applyRuleChange` (path examples in CONTRACT §E.2:
  zone `overrides.cherry.rules.stages.bloom.frostCriticalC`, farm `overrides.weights.c`,
  farm `creditRuleOverrides.cr-abandonment.enabled`, crop `rules.baselineYears`, portfolio
  `creditRules.pf-new` with a whole rule). `newValue: null` = reset to inherited. Pass the templates from
  `useCrops().data`.
- Pure reducers live in `src/state/portfolio.ts` (tested).

**zustand v5 rule:** never return a freshly built array/object from a selector without `useShallow`
(infinite render loop). Select raw state (`useStore(s => s.draft)`) and derive with `useMemo`.

## Shared UI (`src/shared/**`)

- `ui/` (import from `@/shared/ui`): v0 primitives `Button` / `buttonClass`, `Card`, `Input`, `Textarea`,
  `Select`, `Field`, `Badge` / `Pill`, `TierBadge`, `Stepper`, `EmptyState`, `Stat`, `Modal` (z 1100), plus v1:
  - `ProvenanceBadge` (`provenance`, `iconOnly?`, `title?`): chip with short source + worst flag; click opens
    `ProvenancePopover` (all provenance fields + note). Put one next to every sourced value.
  - `FrameKindBadge` (`frame` or `kind`): Observed / Interpolated (n days from a clear image) / AI-enhanced /
    Resampled, not AI.
  - `DataAsOf` (`value`, `label?`): "Weather data as of Nov 6, 2026".
  - `TierPill` (`tier`: risk tier or data tier; values are disjoint), `DataTierPill`.
  - `OfflineBanner` (in the shell), `ConnectionPill` ("Live data" / "Offline snapshot of …").
  - `CountrySelect` (`value`, `onChange(code, country)`): South America from `/countries`, Chile default,
    GLOBAL disabled "coming later".
  - `CropPill` (`crop`, `lang?`), `cropLabel`, `cropColor`.
  - `Popover`, `Placeholder`.
- `format.ts`: `money(n, currency, {compact})` (USD `$`, CLP `CLP`), `date`, `localDate`, `timestampUTC`, `pct`,
  `pctPoints`, `number`, `signed` (real minus sign), `withUnit`, `hectares`, `TIER_LABELS`, `PERIL_LABELS`
  (10 perils), `COMPONENT_LABELS`, `CREDIT_ACTION_LABELS`, `LICENCE_LABELS`, `DATA_TIER_LABELS`.
- `labels.ts`: `provenanceFlags`, `provenanceRows`, `frameKindLabel`, `srLabel`, `frameConfidence`.
- `chartColors.ts`: `CHART_COLORS`, `chartColor(i)`, `SEMANTIC`, `TIER_COLORS`, `PERIL_COLORS`,
  `COMPONENT_COLORS`, `STRESS_COLORS`, `CROP_COLORS`, `NDVI_STOPS`.
- `testing/fixtures.ts` (tests only): `loadFixture(name)`, `fixtureNames()` over `contracts/v1/fixtures`.

### Map (`src/shared/map/**`)

- `BaseMap` (Esri World Imagery + labels; parent must give it a height; `fitTo`, `center` [lat, lng]).
  Default view: **central Chile**, `DEFAULT_CENTER` = [-34.6, -71.3] (Leaflet order), `DEFAULT_ZOOM` = 8.
- **Coordinate order:** the contract is `[lng, lat]` everywhere; Leaflet is `[lat, lng]`. Convert with
  `toLeaflet([lng, lat])` and `fromLeaflet(latLng)`. `toLatLngs(polygon)` converts a GeoJSON polygon.
- `ZoneCircle` (`zone`, `color?`, `selected?`, `onClick?`): 35 km² circle, auto zones dashed. `ZonesLayer`
  (`portfolio`, `selectedId?`, `onSelect?`, `all?`).
- `CirenOrchardsLayer` (`crop?`, `onSelect(feature)`, `onStatus?`, `selectedObjectId?`, `minZoom` 12): CIREN
  orchard polygons in view (≤ 0.25°, debounced, crop-coloured).
- Native-resolution imagery PNGs: add the `pixelated` class (`image-rendering: pixelated`, in `index.css`).
- `geoman.ts` (polygon drawing), `geojson.ts` (`toLatLngs`, `farmsFeatureCollection`). Leaflet CSS is imported
  once in `BaseMap`.
- **Leaflet needs `window` at import time.** Pages must not import `@/shared/map` statically: put the map in its
  own component and load it with `React.lazy(() => import('./XxxMap'))` inside `<Suspense>` (as the wizard's
  map steps, `features/farm/ImageryMap.tsx` and `features/dashboard/DashboardMap.tsx` do). Otherwise the node
  server-render smoke test (`src/app.render.test.ts`) crashes.

## Look and feel (unchanged from v0)

White, clean, product-grade. Tailwind tokens (`tailwind.config.cjs`):

| Token | Value |
|---|---|
| `brand` | #2E7A55 (hover #256646, soft #E6F1EB, ink #1F5A3E) |
| `ink` | #141A17 |
| `muted` | #56615B |
| `surface` | #F4F6F5 |
| `line` | #DDE3E0 |
| `danger` | #B4382F (soft #FBEAE8) |
| `warn` | #A86A12 (soft #FBF1E1) |
| `rounded-card` | 8px |
| `shadow-panel` | 0 1px 2px rgba(20,26,23,0.06) |
| fonts | Instrument Sans (sans), JetBrains Mono (mono), Google Fonts in `index.html` |
| chart palette | #2e7a55, #3a6ea5, #c07a2c, #7a5aa6, #5f8f3e, #a5463f |
| crops | cherry #A5463F, blueberry #3A5BA5, avocado #5F8F3E, walnut #8A6B4E, hazelnut #B89B3E, table grape #7A5AA6 |

Tier colours: normal = brand green, watch = warn amber, high = danger red. Rules: no gradients; no tiny
uppercase eyebrow labels; sentence case everywhere; lucide icons at 16–18px; generous spacing; numbers in
`tabular-nums`; money before agronomy; every stress number explained against its normal or threshold; stage
windows and thresholds labelled "approximate" (all v1 templates are `approximate: true`).

## Rules for everyone

- Edit only your area. Never run `npm install` (foundation only).
- Use the contract types from `@/domain/types`; never redefine them. Use the data client and hooks; never
  `fetch` the service directly.
- Tests: vitest, node environment, `*.test.ts` next to the code; test pure logic. Use `loadFixture()` for data.
- Must pass: `npm run typecheck && npm test && npm run build`.
- No network calls other than the service, the snapshot, map tiles and fonts.
- Never read or print secrets or `.env` values. The Anthropic key lives only in the service environment.
- This project is independent: no references to any other company's product in code, docs or names.
