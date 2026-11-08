# Climate Loan Monitor (v1)

Climate Loan Monitor shows a lender which loans on Chilean fruit and nut orchards (cherry, blueberry,
avocado, walnut, hazelnut, table grape) are under climate stress, why, and how much money is exposed. Risk is
computed per farm at its current growth stage inside a 35 km² zone, from real Chilean data (CR2MET, RAN,
CIREN, DGA, Sentinel-2, GWIS) by the companion service. Every value carries its provenance; AI-enhanced
imagery is display-only.

This folder is the web app (React + Vite). The data and risk engine is the Python service in `../service`.
The contract between them is `../contracts/v1/CONTRACT.md`.

## Run

Requires Node 20+ (developed on Node 26) and the service for live data.

Two terminals:

```bash
# 1. Service (see ../service/README.md for the authoritative command and env vars)
cd ../service
CLM_FIXTURE_FALLBACK=0 .venv/bin/python -m uvicorn app.main:app --port 8787   # http://localhost:8787/health

# 2. App
cd ../app
npm install          # once
npm run dev          # http://localhost:5190 (strict port: the service's CORS allows only 5190)
```

Point the app at another service URL with `VITE_SERVICE_URL=http://host:port npm run dev`.

**Farming agent.** The agent panel needs the service to have an Anthropic API key. Set it for the service, not
the app: either `export ANTHROPIC_API_KEY=...` in the service's terminal before starting uvicorn, or put the
line `ANTHROPIC_API_KEY=...` in `../service/.env` (gitignored). `GET /health` reports `agentAvailable: true`
when a key is found; without one the panel says the agent is unavailable. The key is never sent to the app.

**First assessment of a new portfolio is slow.** A portfolio built in the wizard with farms the service has
never seen fetches five years of Sentinel-2 history per farm: several minutes cold, under a second once cached.
The app waits up to 5 minutes and shows "The service is still computing this assessment" with Retry after
that. For a live demo, create the same farms once beforehand (or demo the wizard on cached farms).

## Offline snapshot

When the service is unreachable the app falls back to `public/snapshot/` and shows
"Offline snapshot of <date>". The snapshot is written by the service (`POST /snapshot/export`, default: the
sample portfolio). How it behaves offline:

- The exported portfolio, unchanged: dashboard, farm pages, imagery and events all come from the snapshot.
- The exported portfolio with **rule changes only** (overrides, credit rules, e.g. after applying an agent
  proposal): the snapshot numbers are still shown, with a banner "Offline: computed with the exported rules;
  your N rule changes since the export need the live service". They do not reflect the edits.
- Any other portfolio, or farms/polygons/loans changed: "Assessment needs the live service". Imagery for the
  exported farms still works.
- The farming agent, CIREN search and new portfolios' assessments are live only.
- While offline the app re-probes `/health` every 30 s and returns to live on its own. Data fetched live
  earlier is labelled "Live data from earlier (service offline now)".

To reset the sample to the exported state, press "Reload" on the sample card on the home page.

```bash
# with the service running; then stop it
curl -X POST http://localhost:8787/snapshot/export -H 'Content-Type: application/json' -d '{"asOf":"2026-11-07"}'
```

## Checks

```bash
npm run typecheck    # tsc, strict
npm test             # vitest (node): domain rules, zod schemas vs contract fixtures, state, data client
npm run build        # typecheck + production build into dist/
```

`src/domain/schemas.test.ts` parses every file in `../contracts/v1/fixtures/` and checks that
`src/domain/types.ts` is a byte-for-byte copy of `../contracts/v1/types.ts`.

## Storage

Portfolios, rule overrides, the audit trail and agent recommendations are stored in the browser
(localStorage key `clm-store-v2`). Clear site data to reset. The v0 key `clm-store-v1` is ignored.

See `DESIGN.md` for architecture, ownership, APIs and the visual system.
