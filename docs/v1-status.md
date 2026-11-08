# BrotIA v1: status and demo guide

- **As of:** Saturday 2026-11-07, 17:20 Boston (22:20 UTC). Code freeze Sunday 07:00. Demo to Suyana Sunday 09:30.
- **Scope:** ADR-0013 (six fruit and nut crops, Chile). Build decisions: ADR-0014 to ADR-0021 and ADR-0023. UI (BrotIA, v1.1): ADR-0024. Open calls: ADR-0022.
- **Samples (v1.1, ADR-0026):** two demo books, 21 farms: `sample-cl` **CLSF1 · Chile Specialty Fruit Credit I** (lender "Banco Valle Andino", 12) and `sample-cl-sur` **CLSO2 · Southern Orchards Credit II** (lender "Cooperativa Agrícola del Sur", 9 real CIREN orchards in Maule, Ñuble and Biobío). Lenders, loans and schedules are illustrative; orchard polygons and climate data are real (ADR-0016 D2, ADR-0026 D6). The app loads both on its first start (live, or from the snapshot offline); Portfolios → "Restore sample portfolios" (small link at the bottom) adds back any deleted one; the offline snapshot exports both.
- **Checks at the last build (v1.1 UI integration, 2026-11-07 22:20 UTC):** service `pytest` 287 passed; app `typecheck`, `test`
  (276 passed, 2 skipped) and `build` green; browser e2e `app/scripts/e2e_check.py` live 25/25 and offline 23/23.
- **Offline snapshot:** re-exported 2026-11-08 03:32 UTC with both samples (asOf 2026-11-07, 21 farms, 5,751 files, 1,775 imagery frames, 0 warnings, 164 MB; sample-cl scores, tiers and credit actions unchanged, ADR-0026). Before that: 2026-11-07 22:13 UTC (12 farms, 3,308 files, 1,012 imagery frames, 0 warnings,
  109 MB). A copy of the 20:45 UTC export was kept in the integration session's temporary scratchpad (`backup/snapshot-before-v1.1-export`).
- **UI:** v1.1 "BrotIA" redesign: sidebar, Home, portfolio report, farm page in tabs (ADR-0024). Screenshots in `docs/v1-screens/`
  were captured after this re-export, in demo order.

## 1. What works end to end

All 12 sample farms run on real data; no contract fixture is served anywhere (`CLM_FIXTURE_FALLBACK=0`).

| Feature | State | Screens |
|---|---|---|
| Home: allocation performance across portfolios (KPIs, allocation by portfolio / country / crop coloured by weighted risk, repayment schedule, next 60 days, portfolio table) | works | `01-home.png`, `40-phone-home.png` |
| Portfolios list with the sample-portfolio card | works | `02-portfolios.png` |
| Portfolio report: header and KPIs always visible, incidents (last 24 h); tabs (`?tab=`): Overview (farm table (a)–(e) with TOTAL), Payments (next installments 6/12 months, due in 60 days, credit actions), Exposures (by tier, crop, zone, region), Risks (score distribution, water status, stress drivers, recent disasters), Demographics (crops and area, region, zone, growth stage, farm records, tier map) | works | `03-report-overview.png`, `04-report-payments.png`, `05-report-exposures.png`, `06-report-risks.png`, `07-report-demographics.png`, `08-report-incidents.png`, `41-phone-report.png` |
| Farm page header: crop, area, zone, data tier, score and tier, outstanding of loan, next installment, Live/offline | works | every `1x-ovalle-*` and `2x-paine-*` screen |
| Overview tab: headline, stage strip, credit actions, top drivers, mini map, loan card | works | `10-ovalle-overview.png` |
| Imagery tab: 13-month time-lapse, observed and interpolated frames, native 10 m NDVI and true colour, AI-enhanced 2.5 m opt-in with per-frame labels | works | `11-ovalle-imagery-native.png`, `12-ovalle-imagery-ai.png` |
| Water tab: irrigated, demand, supply (decree, snowmelt), getting enough (NDMI vs own and peers), abandonment; farm vs zone peers | works (rung 4 canopy temperature not built) | `13-ovalle-water.png` |
| Risk tab: C, D, G with weights, formula with numbers, all drivers with source badges, 13-month signals | works | `14-ovalle-risk.png`, `20-paine-risk.png` |
| Rules tab: effective credit and agronomic rules for the farm, farm-level edit and reset, audit trail with revert | works (live only; read-only offline) | `15-ovalle-rules.png` |
| Events tab: events overlapping the farm's zone, last 13 months | works | `16-ovalle-events.png`, `21-paine-events.png` |
| Farming agent: question → tool calls → 14-season backtest → proposals → Apply through the audit trail | works: exercised live from the app once before the grounding fix, not re-run from the app since; one live service run after the fix | `30-agent-panel.png` (panel open, no paid question) |
| Wizard: portfolio, CIREN cadastre search, zones on a map, three-level rules editor with audit | works with the live service (cadastre needs it); restyled by tokens only | not re-captured (`e2e_check.py live --wizard` checks the cadastre) |
| Offline snapshot: Home, report, farm tabs, imagery (native and AI) with no service | works; agent, cadastre, rule edits and new portfolios need the live service | `50-offline-report.png` |
| Provenance on every value (source, observed date, fetched date, resolution, licence tier, stale, estimated, data tier) | works | every farm screen |

### Current sample result (snapshot 2026-11-07)

| Farm | Score | Tier | Exposure (USD) | Story |
|---|---|---|---|---|
| Ovalle table grapes | 100 | high | 120,000 (next 30,000 on 30 Nov) | Abandonment confirmed vs peers; DGA decree No. 177 in force |
| Copiapó valley table grapes | 69.6 | high | 226,667 (next 28,333 on 1 Jan) | NDMI moderate stress; "vigour loss, not a confirmed stop of irrigation" |
| Curicó cherries (new planting) | 47.8 | watch | 260,000 | 3 VIIRS active-fire detections in the zone since 6 Nov |
| Paine walnuts (replanting) | 30.5 | normal | 82,500 | Burned-area polygon on the orchard, contradicted by its own 10 m NDVI |
| Other 8 farms | 0–3.5 | normal | 1,730,000 | No significant stress |

Totals: USD 2,419,167 outstanding; USD 606,667 at watch or high; farms high 2, watch 1, normal 9. Credit actions: 5 (Ovalle:
watch before installment, field visit, restructure review; Copiapó: watch before installment, field visit).

## 2. What is fallback, estimated or approximate

Each item below is labelled in the app through provenance.

- **Crop rules:** every template is `approximate: true` (FAO frost T10/T90, FAO-56 Kc, Agroseguros rain, central-Chile calendars
  not verified against INIA). Hazelnut Kc is taken from walnut. Table grapes north of 31° S carry a "stage likely later" warning. (ADR-0017)
- **Weather baseline:** CR2MET 1991–2020 has 22 of 30 years; ETo has **no** baseline (bands null with the reason). CR2MET lags 6–11 days;
  frost, heat and rain use RAN stations first (11 of 12 farms; Curicó falls back to CR2MET and its last 7 days end on 1 Nov). (ADR-0018)
- **NDVI/NDMI:** gap-filled points and values are `estimated`; the baseline is Sentinel-2 only (about 5 seasons); spring z reads high
  (it can hide mild spring stress, never invents it). (ADR-0014)
- **Irrigation:** "unknown" from the CIREN mask for 4 farms; "yes, estimated" south of Maule for 3 farms; dry-season green test stands in
  for a land-cover mask. (ADR-0016 D5, ADR-0019 D4)
- **Peers:** at most 8 nearest same-crop CIREN orchards (contract says 20), disclosed in each note. (ADR-0019 D5)
- **Fire:** FIRMS hotspots are heat detections (often agricultural burns); a mapped burn contradicted by native NDVI is scored as a fire in
  the zone and marked estimated. Copernicus EMS shapes exist for 2 areas only. (ADR-0018 D9, ADR-0019 D3)
- **Decree status:** if every DGA source fails, `decreeActive` is false, estimated, with "unavailable: decree status unknown". (ADR-0018 D7)
- **Super-resolution:** AI on observed frames only; interpolated frames are "Resampled, not AI". Display only. (ADR-0015)
- **Lender side:** bank, farm names, loans and seeded rule edits are illustrative; polygons and CIREN attributes are real. (ADR-0016)
- **Licences:** CR2MET and RAN have no stated licence ("unresolved"); Open-Meteo is `demo_only` and was never called live.

## 3. Known gaps

- `canopyMinusAirC` (Landsat surface temperature, water ladder rung 4) is not built; always null with a note.
- No Earth Search failover for Sentinel-2; no Landsat long baseline; no "still an orchard" gate; no Oct–Apr scoring window for deciduous crops.
- Agent: one curated reference event only (September 2013 frost, no primary citation); backtest weather history filled only for the Requínoa
  cells; credit-rule proposals not supported.
- Variety and planting year are null for all sample farms.
- Browser-checked by `e2e_check.py`: every report and farm tab, report tab arrow keys, the 6/12-month toggle, the water status after
  going back from a farm, the native/AI and layer toggles, the incidents list, the agent panel opening,
  and Home and the report at 390 px. Not checked: Play, slider scrubbing, image-load errors, and 390 px with the agent panel open.
- The reviewer's scratch test `.review/spec-trust/test_agent_grounding.py` now fails on purpose (it asserted the old, ungrounded behaviour).
- Cold assessments of new farms take minutes (5-minute app timeout). Demo only on warmed farms or the snapshot.
- Paine has no credit action; Copiapó shows High while its driver says "verify". See ADR-0022.
- **Outside Chile (ADR-0013 D11 "Should"):** the wizard offers other South American countries with USD only, but the standard tier is thin:
  ERA5 via Open-Meteo is registered and was never called live (quota until 19:00 Boston, then about 780 calls per new cell for a baseline),
  and CIREN peers, irrigation, DGA decrees and RAN are Chile-only. Do not demo a non-Chilean farm.

## 4. How to run

Full detail: `service/README.md` and `app/README.md`.

```bash
# Terminal 1: service (port 8787)
cd service
CLM_FIXTURE_FALLBACK=0 CLM_RISK_CACHE_TTL_S=86400 CLM_RISK_CACHE_DEGRADED_TTL_S=86400 \
  .venv/bin/python -m uvicorn app.main:app --port 8787
curl -s localhost:8787/health          # "agentAvailable": true when the key is found

# Terminal 2: app (port 5190)
cd app && npm run dev                  # http://localhost:5190 → BrotIA Home

# Checks (from the repo root)
(cd app && npm run typecheck && npm test && npm run build)
(cd service && .venv/bin/python -m pytest -q)
service/.venv/bin/python app/scripts/e2e_check.py live      # Home → Portfolios → load sample → report tabs → Ovalle and Paine tabs → agent panel → phone
service/.venv/bin/python app/scripts/e2e_check.py offline   # same path from the snapshot; the browser blocks :8787 itself
```

- **First run in a fresh browser:** the app loads both sample portfolios on its own; the sidebar lists **CLSF1 · Chile Specialty Fruit Credit I** and
  **CLSO2 · Southern Orchards Credit II** under Portfolios. If someone deleted them, Portfolios → "Restore sample portfolios" brings them back.
- **Navigation:** the sidebar has Home (`/`), Portfolios (`/portfolios`, with each report as a sub-item), New portfolio and Farming
  agent. The report keeps its tab in the URL (`?tab=overview|payments|exposures|risks|demographics`). Farm pages open from a report row
  and keep their tab too (`?tab=overview|imagery|water|risk|rules|events`), so a tab can be bookmarked for the demo.
- **Agent key:** `export ANTHROPIC_API_KEY=...` in terminal 1, or one line in the gitignored `service/.env`. Never paste it anywhere else.
  Without it the panel says the agent is unavailable and everything else works. `e2e_check.py live --ask` makes one paid call; the
  default run does not.
- **Offline:** stop the service, or run the offline e2e, which blocks `:8787` in its own browser. The app reads `app/public/snapshot/`
  and shows "Offline snapshot of Nov 7, 2026" in the banner and the sidebar pill.
- **Screenshots:** `e2e_check.py live` writes `docs/v1-screens/01…41`, and `offline` writes `50-offline-report.png` (1440×900;
  `40-`/`41-` at 390 px; the report tabs `03`–`07` are full-page at 1440 px wide). Pass `--no-shots` to keep the committed set, or
  `--shots=report` to retake only the report screens. `E2E_CDP_PORT` and `E2E_CHROME_PROFILE` give a run its own browser.
- **DuckDB is single-writer:** stop the server before any CLI command.

### Sunday morning, before 07:00 code freeze

1. `cd service && PYTHONPATH=. .venv/bin/python -m app.sources.weather.backfill window` (CR2MET top-up, seconds).
2. `PYTHONPATH=. .venv/bin/python -m app.imagery.warm --as-of 2026-11-08` (new scenes, peers, vigour).
3. Start the service with the two TTL variables (above), then copy `app/public/snapshot/` aside and run
   `curl -s -XPOST localhost:8787/snapshot/export -H 'content-type: application/json' -d '{"asOf":"2026-11-08"}'`. This also warms the risk cache.
4. Ask the agent one question on zone Requínoa valley, so its weather windows are warm.
5. Re-capture `docs/v1-screens/` from the warmed app: `e2e_check.py live`, then `e2e_check.py offline` (both from the repo root).
6. If anything in steps 1–4 fails or the numbers move unexpectedly, restore the 11-07 snapshot and present that (ADR-0022 D4).
7. Open-Meteo opens at 19:00 Boston tonight; it stays a fallback only. Do not call it to "fill" anything.

## 5. Three-minute demo path (Sunday 09:30)

Run it live on the warmed service. The offline snapshot is the backup: stop the service and the app switches by itself within 30 s,
or reload. Before going on stage, load the sample once and open the agent panel on zone Requínoa valley in the rehearsal browser.
The numbers below are from the 11-07 snapshot; check them again after a Sunday re-export.

| Time | Screen | Do | Say (to a lender) |
|---|---|---|---|
| 0:00–0:25 | **Home** (`/`) | Point at the KPI strip, then the "By crop" allocation bar | "This is the lender's book: USD 2.4 million across twelve real orchards from Chile's fruit cadastre, all six crops. A quarter of it, USD 607,000, sits on loans at watch or high climate risk. Each slice is coloured by its exposure-weighted risk: table grapes are the hot slice. Six incidents in the last 24 hours, five credit actions open. Every number on screen has a source and a date. There is no made-up risk history; the only curve is the real repayment schedule." |
| 0:25–0:55 | **Report** (sidebar → CLSF1 · Chile Specialty Fruit Credit I) | Overview tab: read the (a)–(e) letters and the TOTAL row; click the Incidents tile. If time, Payments (Ovalle's USD 30,000 due 30 Nov, high stress) and Risks (water status: Ovalle and Copiapó under stress) | "One row per loan, read like an investment table: outstanding, share of the portfolio, risk score, and share × score. Copiapó is 9 % of the book at 69.6, so it adds 6.5 points. Ovalle is only 5 % but scores 100. Together they give a portfolio risk of 18.1 out of 100. Incidents: one fire touching the Curicó orchard and five credit rules that fired today. Another 85 hotspots within 25 km touched no farm; we show them as context, not as alarms." |
| 0:55–1:55 | **Ovalle table grapes**: Overview → Imagery → Water → Risk → Rules tabs | Click the Ovalle row. Overview: the headline and the three credit actions. Imagery: play at native 10 m, then switch to Enhanced 2.5 m and point at the "AI-enhanced" label. Water: the decree and "Only this farm is below its peers". Risk: the formula line. Rules: the credit rules with their per-farm switches and the audit-trail entry | "Through the whole dry season this vineyard read 0.18 NDVI, bare soil, for 30 images in a row, while its seven neighbouring vineyards were normal. That is not weather; irrigation stopped. It is also under DGA water-scarcity decree 177 until July 2027, although snowmelt is 169 % of normal, so the cause is the farm, not the basin. A USD 30,000 installment is due on 30 November: the system asks for a field visit and a restructuring review. The sharp image is AI for viewing only; every score comes from the native 10 m pixels. The score is a formula you can read, and every rule behind it is editable per farm with an audit trail." |
| 1:55–2:15 | *(optional, if time)* **Copiapó** and **Paine** from the report table | Copiapó: Water tab, abandonment rung. Paine: Risk tab, fire driver | "The same rule fired at Copiapó, but the canopy recovered, so the system says 'vigour loss, verify' and asks for a visit, not a restructuring. In Paine a coarse burned-area map covers the orchard, but its own pixels read 0.87 before and 0.86 after: a fire nearby, not a lost asset." |
| 2:15–2:50 | **Farming agent** (sidebar), zone Requínoa valley | Set "Asking about" to zone Requínoa valley and ask "Recommend frost and harvest-rain settings for this zone". Show the backtest table and read the proposed value from it (a live run can land on −1.8 or −2.0; both score 1 hit, 0 false alarms), then Apply | "The agent tests settings against 14 seasons of history, including the September 2013 frost. It proposes a bloom frost threshold around −2.0 °C, read off the table: one hit, no false alarms. It can only propose numbers its own backtest produced, and nothing changes until a person applies it. The audit trail now reads 'proposed by Farming agent, applied by' the user." |
| 2:50–3:00 | Any source badge, then **Home** | Hover a source badge | "Chilean national data where it exists, global data elsewhere, every value with its source, date and licence, and it keeps working offline. For an insurer, the same signals become triggers you can audit." |

**Who tells which story**

- **Bloom frost:** no farm is frost-stressed this week (coldest hour 1.9–8.0 °C across the 12 farms; Requínoa 5.2 °C), so bloom frost is told through the agent's
  backtest on zone Requínoa valley (cherry bloom, September 2013 reference frost).
- **Water decree:** Ovalle (decree No. 177 of 9 Jul 2026, until 10 Jul 2027; decrees in force in 13 of the years since 2008).
- **Fire:** Curicó (active-fire hotspots, watch) and Paine (mapped burn contradicted by native NDVI, normal).
- **Abandonment and peers:** Ovalle (confirmed, 7 peers normal) against Copiapó (guarded: "vigour loss, verify").

**Likely judge questions**

- *"Why is Copiapó High if you are not sure?"* Moderate canopy-moisture stress plus a low-confidence vigour flag and a frost-pocket position;
  the action is a visit, not a restructuring (ADR-0022 D1).
- *"Is the 2.5 m image real?"* No: it is labelled AI, display only; metrics use native 10 m pixels (ADR-0015 D5).
- *"How were the weights calibrated?"* They are expert defaults; calibration against Agroseguros losses and the 2013 frost is the next step (ADR-0013 D6).
- *"Table grapes are often under plastic."* The app warns that NDVI may read the cover until the lender confirms (ADR-0017 D4).
- *"Were Ovalle's green frames in August–September vines?"* No: weeds or a cover crop; the dry-season record and the current z (−1.6) still show no vines.

**If something fails during the demo**

- Agent slow or unavailable: show the backtest from a warmed earlier answer (keep the panel open from the rehearsal). There is no captured
  agent answer in `docs/v1-screens/`: the default e2e does not make the paid call. Capture `31-agent-answer.png` during the rehearsal with
  `e2e_check.py live --ask` (one paid call).
- Service down: the app switches to the offline snapshot with the label "Offline snapshot of <date>". Home, the report and every farm tab
  still work; the agent, the cadastre and rule edits do not.
