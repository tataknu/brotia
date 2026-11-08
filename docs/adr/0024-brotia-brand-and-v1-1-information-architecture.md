# ADR-0024: BrotIA brand and v1.1 information architecture

- **Status:** Accepted
- **Date:** 2026-11-07
- **Scope:** the app (`app/`) only. The service, `contracts/` and `domain/types.ts` are unchanged.
- **Inputs:** `docs/design/v1.1-ui-spec.md` (the builders' shared spec), `docs/design/brotia-slide-1.html` (brand reference).
- **Amends:** ADR-0021 D4 and its Consequences, where they say "the dashboard": that page is now the portfolio report (D4, D6 below). ADR-0021's display
  rules still hold: the app never computes a metric, native imagery comes first, rule edits are audited, and the offline snapshot
  is a first-class mode.

## Context

v1 shipped as "Climate Loan Monitor": a top header, a portfolio dashboard, and one long farm page. Two problems came up in rehearsal.
First, a lender's first question is how the money is spread and how each slice is doing, and no page answered that across portfolios.
Second, the farm page was a long scroll, and the demo lost time hunting for the imagery, the water ladder and the rules. The product
also needed a name and a look that reads as finance software, not as a GIS tool.

## Decisions

### D1. Name and palette

The product is **BrotIA** ("brote" + IA), tagline "Climate risk · Agricultural lending". The wordmark is "Brot" + "IA", with "IA" in
the accent colour, set in IBM Plex Mono 600. The mark is a 7×7 pixel grid (`shared/brand/BrotiaMark.tsx`): two leaves, a stem and a
soil row. The favicon is `public/brand/brotia-mark.svg` and the document title is "BrotIA".

The white theme keeps the old Tailwind token **names**, so feature code did not change; only the values did (`app/tailwind.config.cjs`,
mirrored as CSS variables in `app/src/index.css`):

| Token | Value | Use |
|---|---|---|
| `ink` | #0E1914 | body text, headings, dark buttons |
| `brand` / `brand-hover` | #1F6B43 / #18573A | primary actions, active nav, links (the mark's stem) |
| `brand-soft` / `brand-ink` | #E9F3EC / #0E2A23 | selected rows, active nav; text on brand-soft |
| `accent` | #2FA05A | "IA" in the wordmark, positive deltas, live dot |
| `muted` | #6A766F | secondary text (4.7:1 on white) |
| `surface` | #F6F8F7 | table headers, zebra rows, subtle fills |
| `line`, `faint` | #E4EBE6 | hairlines; empty cells of the mark |
| `warn` / `warn-soft` | #E8933A / #FDF1E4 | watch |
| `danger` / `danger-soft` | #D0533A / #FBECE8 | high stress |

The old v1 green #2E7A55 is gone from the app. Its last uses were map drawing, zone circle and zone fallback colours in four files, and integration changed them to `brand`.

### D2. The risk ramp comes from the logo

The mark's soil row is the risk ramp, used for tiers and score scales and **nowhere else**:
#1F6B43, #2FA05A, #8CC63F, #E3C93B, #E8933A, #D0533A, #9E2F3A (`risk-0` … `risk-6`).

- Tiers: normal #2FA05A, watch #E8933A, high #D0533A (`tier-*` tokens; `TIER_COLORS` in `shared/chartColors.ts`).
- A continuous 0–100 score maps linearly across the seven stops (`RISK_RAMP`; `riskColor()` in `shared/chartColors.ts`). The
  report's weighted-risk squares, portfolio-risk KPI and score histogram use `riskColor()`; Home's allocation bars and risk swatches
  use the same interpolation (`rampColor()` in `features/home/homeModel.ts`), which a unit test pins to the ramp's ends and middle.
- Crop colours (`CROP_META`) and chart series colours stay separate from the ramp, so a colour that means "risk" never means "walnut".

### D3. IBM Plex Mono for every number

Every number in tables, KPI tiles and chart axes is IBM Plex Mono with tabular figures (`font-mono` sets `"tnum" 1`). It replaces
JetBrains Mono as `font-mono`, and matches the wordmark. Body and UI text stay Instrument Sans. Both load from Google Fonts in
`index.html`; the font stack falls back to `ui-monospace` offline.

### D4. Sidebar information architecture and routes

No top header on desktop. A 240 px left sidebar (icons only from 640 to 1023 px; a drawer behind a top bar below 640 px) holds, from top
to bottom: the logo; **Home**; **Portfolios**, with each saved portfolio as a sub-item that opens its report; **New portfolio**;
**Farming agent** (toggles the existing side panel with the current route's portfolio and farm as context); and, at the bottom, the
connection pill (Live data or Offline snapshot of a date) and the data-as-of date. The offline banner stays above the main content.

| Route | Page |
|---|---|
| `/` | Home: portfolio overview, payments due by tier and risk per portfolio (D5a) |
| `/portfolios` | Portfolio list, with the sample-portfolio card |
| `/portfolios/new` | Wizard (unchanged; restyled by tokens only) |
| `/portfolios/:portfolioId` | Portfolio report (replaces the v1 dashboard route) |
| `/portfolios/:portfolioId/farms/:farmId?tab=…` | Farm page with tabs |

Pages share one container: `max-w-7xl`, 16 / 24 / 32 px side gutters at phone / tablet / desktop.

### D5. Home is allocation performance, and it shows no invented history (layout superseded by D5a)

The headline is "Multiple allocation performance": how the lender's money is spread across portfolios, countries and crops, and
how each slice is performing on risk. It shows:

- KPIs: total outstanding; exposure at watch or high, with its share; portfolios and farms; credit actions open; incidents in the
  last 24 h (D7);
- allocation bars by portfolio, country and crop, each slice coloured on the ramp by its exposure-weighted risk;
- risk by portfolio and tier mix of outstanding;
- the repayment schedule, both the outstanding step curve and the repayments due per month;
- installments in the next 60 days with each farm's current tier;
- a portfolio table with a TOTAL row.

Two rules:

1. **No invented history.** The service keeps no risk history. Risk numbers are shown at their as-of date and labelled "Risk as of
   <date>"; there is no risk trend line. The only time series is the loan schedule from `domain/schedule.ts`, which is
   labelled "Scheduled, not observed payments".
2. **No cross-currency sums.** There is no FX in v1 (`homeModel.ts`). Portfolios are grouped by currency, and Home shows one currency
   group at a time, with a picker when there is more than one. A total is never added across currencies, and the same rule applies
   to the TOTAL row on the Portfolios page.

### D5a. v1.4: home re-prioritised

Feedback: a lender opens Home to see what money comes due and how risky the farms behind it are. Allocation is secondary. The
page was also stuck on "Assessing 1 of 1", with "–" KPIs and "$0 at watch", while a cold assessment ran. Home is now
"Portfolio overview" (`features/home/`), from top to bottom:

1. **KPIs:** due in the next 90 days (amount, installments, farms); due at watch or high (amount, and its share of the 90-day
   amount that has a tier); total outstanding; credit actions; incidents.
2. **Payment schedule** (full width): scheduled installments per calendar month, stacked by each farm's **current** tier
   (`TIER_COLORS`, high at the base), for 6, 12 or 24 months. The first month holds only what falls after the as-of. A tooltip
   gives the month's amount per tier, the count and the largest farms. A summary row shows the amount due, the part at watch or
   high and the outstanding today. Outstanding is a number, not a second axis. The installments of the next 60 days are listed
   underneath: farm, portfolio, date, amount, tier. Model: `paymentSchedule()`, `dueWithin()` and `duePayments()` in
   `homeModel.ts`, with the same plan rule as `outstandingAt` (an empty plan is one payment at maturity). A unit test reconciles
   the months with `repaymentCurve`. Loans in another currency than the group's are left out and counted, never converted.
3. **Risk per portfolio** (full width): one rich row per portfolio, so a single portfolio does not look empty. Each row has the
   name and country; the exposure-weighted score on a 0–100 ramp gauge with the 35 and 60 cut-offs; the tier mix of outstanding
   with amounts; the amount at watch or high and its share; credit actions; the amount due in 90 days; the three largest farms at
   watch or high; and a link to the report.
4. **Allocation** is a collapsed disclosure. The portfolio table stays at the bottom. The outstanding step curve and the separate
   risk and tier-mix bar charts were dropped.

**While assessing:** the schedule and outstanding come from the local loan data, so they render at once. Amounts without a tier
are grey and labelled "Tier pending", or "Not assessed" when the assessment failed. "Due at watch or high" shows "–" and never
"$0". After 15 s a note says "Still assessing… (elapsed)". The wait is bounded by the data layer: `TIMEOUTS.assess` is 300 s,
then a `NetworkError` occurs, the status becomes 'error', and the Retry notice appears. The e2e check holds `/assess/portfolio`
to prove each step.

**Trust:** a payment due next year is coloured by today's tier, which the chart subtitle states. Screens: `01-home` (full page)
and `40-phone-home`.

### D6. The report table: (a)–(e) and its TOTAL

One report per portfolio. It has a title block (lender, country, currency, data as of), five compact charts (since v1.2 spread over tabs, D8a: tier mix, exposure by
crop, next installments, water status counts, risk-score distribution) and four KPI tiles, then the main table, styled as a finance
investment table:

| Column | Definition |
|---|---|
| (a) Farm | name, crop and current stage |
| (b) Outstanding | the farm's exposure from the assessment (outstanding principal on the as-of) |
| (c) % of portfolio | (b) ÷ Σ(b) |
| (d) Risk score | 0–100 from the service, with the tier chip |
| (e) Weighted risk | (c) × (d) |

Water status, next installment and credit action follow as extra columns. Under the headers sits a thin row of column letters,
"(a) (b) (c) (d) (e)=(c)×(d)". Rows are zebra-striped, sortable, and open the farm on click.

The **TOTAL** row, framed by a brand-coloured double rule, shows Σ(b), 100.0 % and Σ(e). Σ(e) = Σ(outstanding × score) ÷ Σ outstanding
is the portfolio's exposure-weighted risk, and the "Portfolio risk" KPI shows the same number. On the sample: USD 2,419,167, 100.0 %,
18.12. The app computes only these identities from service numbers (ADR-0021 D1 still holds: no risk metric is computed in the browser).

### D7. Incidents (last 24 h)

The spec's literal reading, "every event and rule trigger dated within 24 h", counts every hotspot in the portfolio's 25 km event box.
On a fire-season day that buries the incidents that matter. The definition is therefore (`features/report/reportModel.ts`,
`incidents()`):

- **events that touch a farm** (`affectedFarmIds` not empty) whose start date is the as-of day or the day before. Contract dates are
  day-resolution, so a 24 h window has to hold yesterday;
- **plus every credit rule that fired.** Rules have no date of their own; the service evaluates them on the as-of.

Events in the same window that touch no farm are shown separately, as context: "+N nearby events touching no farm" on Home, and a line
above the incidents list in the report. They are not counted.

On the sample (as-of 7 Nov 2026) this gives **6 incidents**: 1 fire touching Curicó and 5 credit rules. The literal reading gives
**83** on the 20:45 UTC snapshot (78 events in the window plus 5 rules), and 85 on the live service and the 22:13 UTC re-export
(80 events plus 5 rules); 79 of those events touch no farm. Clicking the KPI tile lists the incidents with their exposure and date.

### D8. Farm page: a compact header and six tabs

The header is always visible. It shows the crop, area and zone (the data tier moved to the Overview in v1.3, D8b); the risk score and tier; the outstanding amount against
the loan amount; the next installment; and a Live/offline badge. The tabs are synced to `?tab=` (WAI-ARIA tabs with arrow, Home and
End keys):

| Tab | Content |
|---|---|
| Overview | v1.3 (D8b): verdict, what to do, why (evidence cards), details (season, loan, map, "About this data") |
| Imagery | 13-month time-lapse; native 10 m first; "Enhanced 2.5 m" opt-in with Observed / Interpolated / AI-enhanced / Resampled labels (ADR-0015) |
| Water | five-rung water ladder and the farm-vs-zone-peers comparison |
| Risk | C / D / G breakdown with weights, the formula with numbers, all drivers, 13-month signal charts |
| Rules | effective credit and agronomic rules for this farm, and the audit trail |
| Events | events whose area overlaps the farm's 35 km² zone, last 13 months |

**What Rules-tab editing allows** (`features/farm/RulesTab.tsx`):

- **Credit rules:** each rule can be turned on or off for this farm only, as a farm override that can be reset to the portfolio setting.
  Rule conditions are not edited here.
- **Agronomic rules:** farm-level values for the whole-season fields (winter chill, NDVI baseline length, weights a, b and c) and the
  per-stage thresholds (frost T10 and T90, heat, damaging rain, Kc). Each value shows where it comes from (crop template, portfolio,
  zone or farm). Stage windows are shown but not edited here; that stays in the wizard.
- Every edit goes through the store's audited `applyRuleChange` with an optional reason, and re-runs the farm's assessment.
- **Revert:** only for the latest applied change made at this farm's own level. Changes inherited from the zone, portfolio or
  template are listed in the audit trail but are not revertible here.
- **Offline:** all editing is disabled, because the snapshot holds assessments only for the saved rules.

### D8a. v1.2: report tabs

The report's single page became tabs, synced to `?tab=` like the farm page. The header and the KPI strip (with the Incidents list)
stay above them; the recomputing, offline and error notices and the data warnings stay outside the tabs too.

| Tab | Content |
|---|---|
| Overview (default) | the (a)–(e) finance table with its TOTAL row (D6), unchanged |
| Payments | next installments by month and current tier, 6 or 12 months; installments due in (as-of, as-of + 60 days]; credit actions |
| Exposures | outstanding by tier, by crop, by zone (shared zones by name, own zones in one row) and by region, each split by tier |
| Risks | risk score distribution; water status counts; stress drivers (leading driver per farm and top-driver counts); recent disasters |
| Demographics | farms by crop with total and median area; farms by region and by zone; growth stage now; which optional farm fields are recorded; the farms map by tier with zone circles |

- **Shared tab bar.** `shared/ui/Tabs.tsx` (WAI-ARIA tabs, arrows, Home and End, one tab stop, `useTabParam`) replaces the farm page's own
  bar, so both pages behave the same. This was an explicit request, an exception to the spec's rule that only the shell builder edits `shared/ui`.
- **Exposure by crop** is now summed from `ranked` per tier. `byCrop.stressedExposure` merges watch and high, which painted both amber.
  The per-crop totals still equal `byCrop`, and a unit test checks this on the 12-farm snapshot.
- **Region** comes from the CIREN cadastre layer the farm was picked from (`Farm.ciren.sourceLayer`, one layer per region; the table
  mirrors the service's `ORCHARD_LAYERS`). Farms without a cadastre reference show as "No cadastre match". The farm record has no commune,
  so none is shown.
- **Water status and stress drivers** come from the farms' own assessments, read two at a time by a page-level lookup that runs whatever
  tab is open. The table's water icons share its cache. The v1.1 counts stuck at "0 of 12 farms checked" when the farm assessments were
  already cached (for example after going back from a farm page). Cause: the page cleared its counts in a mount effect, React runs child
  effects first, and so the rows' cached answers were wiped and never re-sent. Results are now tagged with the assessment fingerprint
  instead (`recordProbe` in `reportModel.ts`), and failed lookups are shown as "could not be read".
- **Payments** use the same plan rule as `outstandingAt`: an empty installment list is a bullet at maturity.
- The four chart tabs are lazy-loaded; the Demographics map loads lazily inside its tab.

### D8b. v1.3: farm overview

Feedback on the v1.1 Overview: it was overloaded and had no priority. The first thing on it was a grey caveat box. The headline was
analyst text ("NDVI z ≤ −2.0 for 30 composites…"). The score appeared twice. The credit actions were buried mid-card. The stage strip,
data dates, map and loan all had equal weight.

The tab now follows **decision first, evidence second, detail on demand**. A credit officer reads it top to bottom:

1. **Verdict.** One plain sentence, built in the app from structured fields: tier, the leading driver, the abandonment flag and its
   confidence, the decree, fire drivers, peer reading and snowmelt. It is never taken from `risk.headline`. A confidence word appears
   where the data supports one: abandonment confidence high → Confirmed, medium → Likely, low → Verify on site. The tier colour is an
   accent bar. The next payment and its due date sit under the sentence. The score appears only in the sticky header.
2. **What to do.** The fired credit actions, most severe first (restructure review > high > field visit > watch). Each message
   "Reason: instruction." is split into a verb-first title and a one-line reason. The top action is emphasised. If no rule fired:
   - tier normal → "No action needed" with a green tick;
   - tier watch or high → "Keep on watch", marked "From the score", never as a rule.
3. **Why.** Up to three evidence cards: vigour, water, fire, frost, heat, rain, chill or flood. Drivers are grouped by theme, and
   themes are ranked by their **largest** driver impact (a sum would put Ovalle's three water drivers above its abandonment). A card
   needs impact ≥ 0.2. Each card has a plain title and one big number or fact with a comparison, for example "NDVI 0.20 vs 0.27 usual
   for Oct 28" or "Decree No. 177 active". It also has a sparkline over the series' p10–p90 band, and then-vs-now thumbnails:
   - a year ago vs the latest observed frame, for vigour;
   - before vs after the burn date, for a mapped burn.

   The thumbnails use native true colour, never SR, and keep the Observed / native 10 m label. Each card ends with a `?tab=` link. z
   scores and peer counts are only in the hover/popover and the linked tab.
4. **Details**, below the fold and quieter: a compact stage strip, the loan, a smaller map. "About this data" is a collapsed
   disclosure with the data-as-of dates, the data tier, the service's warnings (formerly the top grey box), the CIREN record and the
   service's technical headline.

A normal farm shows "All clear: vigour, water and weather within normal for <stage>", with three small green cards. Each part is
claimed only when its drivers were assessed.

Two driver cases needed rules:

- A burn footprint that native Sentinel-2 contradicts (Paine) is recognised by `burned_area` with "contradicted" in the provenance note.
  The service's other severity-0.4 fire branch, "burned area inside the zone circle", is not a contradiction. Paine reads calm: "No fire
  damage seen…", no action, an optional routine-visit note.
- Drivers below the 0.2 bar cannot lead the verdict. Snowmelt at 88–89 % of normal (impact 0.02–0.03) no longer reads as "Water supply
  is short".

The logic is in the pure `features/farm/overviewModel.ts`, unit-tested on inline fixtures that mirror the 7 Nov 2026 assessments for
Ovalle, Copiapó, Paine, Curicó and Requínoa cherry. A smoke test also checks a jargon-free verdict for every snapshot farm. The header
lost its duplicated chips: the Spanish crop name, the CIREN record and the data tier moved to "About this data". On phones, the
metrics sit in a 2-column grid and the agent button label is short. Screens: `10-ovalle-overview`, `17-copiapo-overview`,
`22-paine-overview`, `25-normal-farm-overview` (full page at 1440 px) and `42-phone-farm-overview` (390 px).

### D9. Tailwind config is CommonJS (`tailwind.config.cjs`)

Node 22+ loads an ESM config through `require(esm)`, and Tailwind cannot evict that from its module cache. Edits to an ESM config
therefore never reach a running dev server. A `.cjs` config reloads on save. (The reason is also recorded in the config's header
comment.)

### D10. Contrast tokens `warn-ink` and `danger-ink`

`warn` and `danger` are fill colours. As text on their soft backgrounds they fail WCAG AA: `warn` on `warn-soft` is 2.2:1 and `danger`
on `danger-soft` is 3.7:1. Two darker text tokens were added:

- `warn-ink` #8A4E0F, 5.9:1 on `warn-soft`;
- `danger-ink` #9E2F3A, 6.3:1 on `danger-soft`. It is the same value as `risk-6`, the darkest stop of the ramp.

Text on a soft fill (chips, notices, the incidents count) uses the `-ink` token. The base colours stay for fills, bars and icons.

### D11. v1.4: incidents page

The sidebar has an **Incidents** item directly under Home (`/incidents`, lucide `Siren`). Its badge is the number of incidents in the
last 24 h across every portfolio in the store. It shows only above 0: `danger` when any of them is critical, `warn` otherwise; in the
icon rail it shrinks to a dot on the icon. The sidebar reads the same cached assessments as Home (`useAssessments`).

The page lists all portfolios' incidents in one table (`features/incidents/`, pure logic in `incidentsModel.ts`):

- **Definition:** D7 unchanged, by calling `incidents()` and `nearbyEventCount()` from `reportModel.ts`, so the numbers match the report
  KPI and Home. The window filter (24 h default, 7 days, 30 days) only widens `hours`: events touching a farm that started on the as-of
  day or the 1, 7 or 30 days before. Credit rules are dated the as-of, so they appear in every window and only events grow.
- **Groups:** critical (a fired restructure review or high), then warning (field visit or watch), then events. Inside a group: the most
  serious action, then newest, then largest exposure. Exposure is shown in each portfolio's currency and never summed across portfolios.
- **Filters:** portfolio, kind (credit rule or event) and window, synced to `?portfolio=&kind=&window=`. The badge stays on 24 h.
- **Rows:** what happened in plain words (the rule's reason with its next step, or the event title with the sensor detail moved to a quieter
  line), farm, portfolio, exposure, date, a severity chip (the action, or the event's peril and severity) and the source. Events open their
  `Provenance` popover. Fired rules carry no provenance in the contract, so their popover states only what is known: the rule, the action,
  "evaluated by the service on the as-of", and live or snapshot. Farm links go to `?tab=events` for events and to the Overview for rules.
- **Context and states:** a quiet line counts the nearby events in the window that touched no farm (not counted). The empty state is
  "No incidents in the last 24 h" with a calm tick. Loading, offline-snapshot and unassessed portfolios are handled as on Home: an
  unassessed portfolio adds no incidents and is named in a notice with Retry.

On the sample snapshot (as-of 7 Nov 2026): 24 h → **6** (1 critical: Ovalle restructure review; 4 warnings; 1 event: the Romeral fire
touching Curicó), 79 nearby; 7 days → **8** (adds the Ovalle 4 Nov and Paine 1 Nov fire detections), 184 nearby; 30 days → 8, 205
nearby. The live service had already rolled to an as-of of 8 Nov (UTC). It showed 24 h → 5, the five rules with no event, because the
6 Nov fire is now two days old; 13 nearby; 7 days → 8. Screen: `09-incidents` (full page at 1440 px, live).

## Consequences

- Demo navigation becomes Home → report → Ovalle tabs → agent. `docs/v1-status.md` §4–5 and `docs/v1-screens/` follow this order
  (report screens since v1.2: `03-report-overview` … `07-report-demographics`, `08-report-incidents`; since v1.4 `09-incidents`).
- `app/scripts/e2e_check.py` walks the new pages in both modes. In offline mode it blocks `:8787` with CDP request interception, so the
  offline check no longer needs the service stopped.
- The brand grep (a short list of banned words, kept outside the repo) is part of integration. Left over from the old name:
  - the npm package name `climate-loan-monitor` and its description;
  - the `clm-` localStorage keys;
  - the service's user agent and logger names.

  Renaming the storage keys would orphan saved drafts, so they stay.
- The risk ramp is reserved for risk. Adding a seventh tier or a new scale means reusing these stops, not new colours.
