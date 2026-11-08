# Climate Loan Monitor service (v1)

FastAPI + DuckDB data service for the v1 contract. **Binding spec:** [`contracts/v1/CONTRACT.md`](../contracts/v1/CONTRACT.md)
(names, shapes, endpoints, formulas). Scope: ADR-0013; data decisions: ADR-0004 to ADR-0012.

## Run

```bash
cd service
.venv/bin/python -m uvicorn app.main:app --port 8787          # add --reload while developing
curl localhost:8787/health
.venv/bin/python -m pytest                                    # all tests (foundation + builders)
.venv/bin/python -m pytest tests/test_foundation*.py          # foundation only
.venv/bin/python -m app.snapshot --as-of 2026-11-07           # offline snapshot -> app/public/snapshot/
```

**Run both (live demo).** Terminal 1: `cd service && CLM_FIXTURE_FALLBACK=0 .venv/bin/python -m uvicorn app.main:app --port 8787`.
Terminal 2: `cd app && npm run dev` (http://localhost:5190). Stop both with Ctrl-C when done. DuckDB is single-writer:
stop the server before running any of the CLI commands below.

**Anthropic key for the farming agent** (`POST /agent/recommend`). Either export it in the terminal that starts
uvicorn (`export ANTHROPIC_API_KEY=...`) or add one line `ANTHROPIC_API_KEY=...` to `service/.env` (gitignored;
read at startup by `app.config`). Do not commit, print or paste the key anywhere else. Check with
`curl -s localhost:8787/health` → `"agentAvailable": true`. Without a key the endpoint answers 503 `no_api_key`
and the app says the agent is unavailable; everything else works.

**Offline snapshot fallback.** `POST /snapshot/export` (or `python -m app.snapshot`) writes the sample portfolio,
its assessments, imagery (PNG frames) and events to `app/public/snapshot/`. When the app cannot reach the
service it reads those files and labels them "Offline snapshot of <asOf>". Re-export after any change to risk
code or data (the risk cache key includes `CACHE_VERSION` in `app/risk/assess.py`; bump it when the risk output
changes so stale cached assessments are not exported). See `app/README.md` for what the app shows offline.

The venv is uv-managed (Python 3.12). To recreate it:
`uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r pyproject.toml --group dev`
(exact versions are pinned in `pyproject.toml`; torch 2.15.0 and torchvision 0.29.2 are included).

| Env var | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | from env or gitignored `service/.env` | Enables `/agent/recommend`. Never printed, logged or returned. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Agent model id |
| `CLM_DB_PATH` | `service/data/clm.duckdb` | DuckDB cache file |
| `CLM_FILES_DIR` | `service/data/files` | Served at `/files` (imagery PNGs under `imagery/<farmId>/`) |
| `CLM_SNAPSHOT_DIR` | `app/public/snapshot` | Snapshot export target |
| `CLM_OFFLINE` | off | `1` = never call upstream, serve cache (stale-marked) |
| `CLM_FIXTURE_FALLBACK` | on | `0` = placeholder builders give 500 instead of fixtures (use before the demo) |
| `CLM_AGENT_MODEL` | — | Agent model id; wins over `ANTHROPIC_MODEL` |
| `CLM_SR_WARM` | on | `0` = do not load the super-resolution model in a background thread at startup |
| `CLM_RISK_PEERS` | on | `0` = skip zone peers (§E.9) in the risk assessment |
| `CLM_WEATHER_BACKGROUND` | on | `0` = never start background CR2MET fetches for cells not yet cached |

Ports: service 8787, app dev 5190 (CORS allows `localhost:5190` and `127.0.0.1:5190`).

## Demo notes after the review fixes (2026-11-07, snapshot re-exported 20:45 UTC)

- Sample tiers: high 2 (Ovalle 100, Copiapó 69.6), watch 1 (Curicó 47.8), normal 9. Credit actions: 5
  (Ovalle 3, Copiapó 2: watch before installment, field visit). No restructure review for Copiapó or Paine.
- Copiapó: "vigour loss, not a confirmed stop of irrigation" (low confidence, severity 0.4): the canopy stayed
  green (NDVI ~0.47) in the 2025-26 dry season and has recovered (z −0.7). Still high because of NDMI moderate
  stress. Present it as "verify with a field visit", not abandonment (CONTRACT §E.10 v1.1 guard).
- Ovalle: confirmed abandonment (NDVI 0.17–0.21 through the dry season, still z −1.6). The Aug–Sep 2026 green
  frames are weeds or a cover crop, not vines.
- Paine: the GWIS burned-area polygon covers the orchard but native S2 NDVI is flat across the fire date
  (0.87 → 0.86): scored as a fire in the zone (0.4), normal tier (CONTRACT §E.5 v1.1 fire note).
- Curicó: watch from FIRMS active-fire hotspots (metric `active_fire`, small detections, max FRP 7.6 MW).
- Agent flagship (Requínoa cherry bloom frost −2.4 → −2.0 °C at zone level) does not change the Requínoa
  cherry farm, which already has its own −2.0 override (audit chg-0002); the agent says so. Applying it changes
  no number on the dashboard. `propose_change` now refuses a frost/rain threshold that no earlier backtest or
  get_history output contains.
- Table grapes north of 31° S carry a warning that the stage comes from the central-Chile calendar.

## Demo prep (v1 integration, 2026-11-07)

Everything below is incremental and resumes from the cache. DuckDB is single-writer: run these one at a
time, with the server stopped.

```bash
cd service
PYTHONPATH=. .venv/bin/python -m app.sources.weather.backfill window        # CR2MET NRT top-up (seconds)
PYTHONPATH=. .venv/bin/python -m app.imagery.warm --as-of 2026-11-08        # new scenes, peers, vigour
CLM_FIXTURE_FALLBACK=0 CLM_RISK_CACHE_TTL_S=86400 CLM_RISK_CACHE_DEGRADED_TTL_S=86400 \
  .venv/bin/python -m uvicorn app.main:app --port 8787                        # then warm the risk cache:
curl -s -XPOST localhost:8787/snapshot/export -H 'content-type: application/json' -d '{"asOf":"2026-11-08"}'
```

The risk cache defaults to 1 h (10 min when any input was unavailable), so without the two TTL variables a
07:00 warm-up is cold again by 09:30. The export runs `/assess/portfolio`, `/assess/farm` and `/imagery/farm` for every sample farm, so it also
warms the risk cache; after it the live endpoints answer in well under a second. Offline demo: the app reads
`app/public/snapshot/` (or run the service with `CLM_OFFLINE=1`, which serves everything from the cache).

Risk uses `app.imagery.vigour_signals` for zone peers (§E.9), abandonment (§E.10), the exact §E.6 z and
the dry-season irrigation test (one call per farm, shared peer grids). Peers stay Chile-only (CIREN).

## Layout

```
app/main.py            FastAPI app, error handlers ({error, detail}; 422 -> 400 invalid_request), CORS, /files
app/config.py          paths, flags, User-Agent, Open-Meteo embargo, key access (agent_available / anthropic_api_key)
app/models.py          pydantic mirror of contracts/v1/types.ts (camelCase aliases; use models.dump(x) to serialise)
app/store.py           DuckDB helpers (http_cache, series, assessments, audit, source_status)
app/http.py            the one cached fetch path (ADR-0012)
app/provenance.py      Provenance builders + source registry with licence tiers (ADR-0011 D1)
app/registry.py        variable -> ordered providers with fallback (ADR-0011 D2)
app/snapshot.py        offline snapshot export (CONTRACT §C)
app/routers/           thin endpoints; dispatch.py calls the builder functions below
app/{domain,imagery,superres,risk,agent}/, app/sources/{weather,water,events,ciren}/   builder packages
```

## Builder interface (routers call exactly these)

The contract does not name Python functions, so the foundation fixed them. Builders own their
package and replace the placeholder, but **keep these names and signatures** (add anything else you
like). `as_of` is always a `datetime.date` (routers resolve the default = today UTC). Return
`app.models` objects (or camelCase dicts); routers validate the result against the contract and a
mismatch is a 500, never silently passed through.

| Endpoint | Function | Owner |
|---|---|---|
| `GET /countries` | `app.domain.get_countries() -> list[Country]` | svc-portfolio |
| `GET /crops` | `app.domain.get_crop_templates() -> list[CropTemplate]` | svc-portfolio |
| `GET /portfolios/sample` | `app.domain.get_sample_portfolio() -> Portfolio` | svc-portfolio |
| `GET /ciren/orchards` | `app.sources.ciren.get_orchards(bbox, crop: str \| None) -> CirenOrchardCollection` | svc-portfolio |
| `GET /events` | `app.sources.events.list_events(bbox, since: date, until: date \| None = None) -> list[ClimateEvent]` | svc-water-events |
| `POST /assess/portfolio` | `app.risk.assess_portfolio(portfolio: Portfolio, as_of: date) -> PortfolioAssessment` | svc-risk |
| `POST /assess/farm` | `app.risk.assess_farm(portfolio: Portfolio, farm_id: str, as_of: date) -> FarmAssessment` | svc-risk |
| `POST /imagery/farm` | `app.imagery.farm_imagery(portfolio, farm_id, sr: bool = True, as_of: date \| None = None) -> ImageryTimeline` | svc-imagery |
| `POST /agent/recommend` | `app.agent.recommend(request: AgentRequest) -> AgentRecommendation` | svc-agent |
| `GET /health` (srMode) | `app.superres.status() -> tuple['ai' \| 'resampled', str \| None]` (cheap) | svc-superres |

Cross-builder helpers declared in the placeholders (owners implement; others call):
`app.domain.{get_crop_template, effective_zone, effective_template, current_stage, stage_bands, outstanding_at, next_installment}`,
`app.sources.ciren.find_peers(farm, zone, max_peers=20)`,
`app.sources.water.{water_supply(portfolio, farm, as_of), decree_history_years(farm, since_year=2008)}`,
`app.sources.weather.get_series(variable, farm, start, end, country='CL') -> Series`,
`app.imagery.vegetation_series(farm, variable, start, end, baseline_years=5) -> Series`,
`app.superres.super_resolve(image, scale=4) -> (array, srKind, srModel)`.

Routers already handle: request validation (400), unknown `farmId`/`zoneId` (404), bbox limits
(0.25° CIREN, 25° events → 400 `bbox_too_large`), `zoneId`+`farmId` both set (400), missing key (503
`no_api_key`, checked before `recommend` is called), default `since` = asOf − 13 months.

**Fixture fallback.** While a function is missing or raises `NotImplementedError`, its endpoint serves
the matching `contracts/v1/fixtures` file with header `X-CLM-Fixture: 1` and a warning saying it is
not real data. Any other exception is a 500 (fixtures never hide bugs). A package that fails to
import makes only its own endpoints 500.

**Registration.** `app.main` imports every builder package at startup (`registry.load_providers()`), so
`registry.register(...)` and `http.register_source(...)` calls at import time in your `__init__.py` run.

## Fetching data (ADR-0012) — use `app.http`, never raw requests

```python
from app import http, provenance as prov
http.register_source("cr2met_nrt", max_concurrency=2, min_interval_s=1.0, timeout_s=30)
try:
    r = http.get_json("cr2met_nrt", url, params={...}, ttl=http.TTL_DAY)   # get_bytes / get_text / post_json
    p = prov.from_fetch("cr2met_nrt", r, observed_at="2026-11-06")         # carries fetched_at + stale
except http.FetchError as e:                                              # failed and nothing cached
    p = prov.unavailable("cr2met_nrt", e.reason)                          # value null, never invented
```

- Cache in DuckDB keyed by source + method + url + params/body; `ttl=None` never expires (old history).
- Stale-on-error: a failed refresh returns the last good copy with `stale=True`, `error` set; that key
  is not retried for 60 s.
- Empty is not success (`None`, `{}`, `[]`, blank body) unless `allow_empty=True`; `validate=fn` adds checks.
- Per-source concurrency (default 2; Planetary Computer 8, national sites ≤ 2, ADR-0023) and min interval; global cap 16, taken after the source slot; retries with backoff on 429/5xx
  (Retry-After honoured); honest User-Agent `climate-loan-monitor/0.1 (hackathon prototype)`. No
  header spoofing, no login or anti-bot bypass.
- `open-meteo.com` is refused before 2026-11-08 00:00 UTC (quota). After that it is a fallback only.
- Sync API (FastAPI runs `def` routes in a threadpool). Async wrappers: `aget_json`, `aget_bytes`, `apost_json`.

## Storing data — `app.store`

Short-lived DuckDB connection per call under a process lock, so a script can use the same file while
the server runs. Helpers: `series_put/series_get/series_latest_date`, `assessment_put/assessment_get`
(any JSON blob by `(kind, key)`, optional `max_age_s`), `audit_put/audit_list`, `loc_key(lng, lat)`,
`polygon_hash(geojson)`, and `execute/query` for your own tables (prefix them with your package name,
`CREATE TABLE IF NOT EXISTS`). **Scripts and notebooks must close DuckDB connections promptly (or set
`CLM_DB_PATH` to a separate file):** the server's cache reads wait on the file lock. Tests get a private DB via `tests/conftest.py` (`CLM_DB_PATH` in a tmp dir).

## Provenance and the registry

- `provenance.build(source, observed_at=..., stale=..., estimated=..., note=..., data_tier=...)`;
  `from_fetch`, `unavailable`, `derived(note, inputs=[...])` (propagates stale/estimated, weakest licence),
  `fixture()`, `data_tier_for(country)`. Licence tiers per source id are in `provenance.SOURCES`
  (ADR-0011 D1); add new ids with `provenance.register(id, label, tier, resolution)` from your package.
- `registry.register(variable, 'enhanced'|'standard'|'any', provider, priority, source=...)`;
  `registry.resolve(variable, farm, country='CL', **kw)` tries providers in priority order, marks a
  fallback answer `estimated`, and returns `Resolution(ok, value, provenance, source, reasons)`;
  unavailable results carry `provenance.note = 'unavailable: <reasons>'`. Providers raise
  `registry.ProviderUnavailable(reason)` to fall through.

## Test fixtures for builders (`tests/conftest.py`)

`client` (TestClient), `fixture_json(name)`, `sample_portfolio`, `tmp_root`. Mock upstreams with
`respx` (see `tests/test_foundation_http.py`); call `http.reset_state()` between tests that reuse a source.
