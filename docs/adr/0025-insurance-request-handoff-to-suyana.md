# ADR-0025: Insurance request handoff to Suyana

- **Status:** Accepted
- **Date:** 2026-11-07
- **Scope:** the portfolio report's finance table (`app/src/features/report/**`), a new service package (`service/app/insurance/`,
  `service/app/routers/insurance.py`) and an additive contract change (CONTRACT §0, §A, §B, §D, §G).
- **Amends:** CONTRACT §0 "Statelessness" (one exception: the insurance outbox). ADR-0024 D6 (the report table gains an Insurance column).

## Context

The lender asked for a way, from the list of farms, to ask Suyana for insurance on a farm: "we simply send the request". Suyana sells
parametric climate insurance, priced and paid on an index (rainfall, temperature, a satellite signal) rather than on an adjuster's
visit. BrotIA already knows, per farm, what a parametric product needs to start a quote: the location, the crop and area, the
exposure, and which perils are driving the risk now.

There is no Suyana API that BrotIA can call, and the team has no credentials. A button that says "Sent" would therefore be a lie, and
a lender who believes a farm is covered when it is not carries an unhedged loss. The feature has to be useful today and honest about
what it does.

## Decisions

### D1. Outbox, not integration

"Send to Suyana" writes the request to an **outbox** in the service, with status `queued`. Nothing leaves BrotIA. The lender's team
forwards queued requests to Suyana by its own channel (email, partner portal). When a real integration exists, a sender reads the
outbox and changes the status; the app and the payload stay as they are.

- `POST /insurance/requests` (`CreateInsuranceRequest` → `InsuranceRequest`) validates the payload and stores it. No outbound call;
  a test makes any HTTP call during these endpoints fail.
- `GET /insurance/requests?portfolioId=` lists a portfolio's requests, newest first. The app reads it when the report opens and shows
  the latest request per farm.
- DuckDB table `insurance_requests(id, created_at, portfolio_id, farm_id, payload JSON, status)`, created by the insurance package
  (`CREATE TABLE IF NOT EXISTS`, as store.py asks of builders). Ids are `ins-` + 12 hex characters.
- `InsuranceRequestStatus` has one value, `'queued'`. Values such as `forwarded`, `quoted` or `declined` are added only when
  something can set them truthfully.

This is the one exception to CONTRACT §0 "the service stores nothing about portfolios": the outbox keeps the farm name, location
and loan figures that the lender chose to queue. The app still owns the portfolio itself.

### D2. What is sent

The app assembles `InsuranceRequestPayload` from data it already shows; the service stores it **as sent** and does not recompute it.

| Part | Fields | Source |
|---|---|---|
| Addressing | `partner: 'suyana'`, lender, portfolio name | portfolio |
| Farm | name, crop, area (ha), centroid `[lng, lat]`, country code, zone id and name | portfolio farm record; zone name, or "Own zone (35 km² around the farm)" |
| Loan | currency, loan amount, outstanding on the as-of, maturity date; `null` without a loan | loan record; outstanding = `RankedFarm.exposure` |
| Risk | as-of, score 0–100, tier, the top 3 drivers in plain words (`{peril, text}`) | portfolio assessment; drivers from the farm assessment (`Driver.text`), impact > 0 |
| Perils | requested perils (≥ 1) and `uncoveredPerils` | the lender's checkboxes; driver perils with no requestable peril |
| Note | optional, ≤ 1000 characters | the lender |

**Requestable perils** (`INSURANCE_PERILS`): frost, water (drought / water supply), harvest rain (excess rain) and fire. These are
the Chilean orchard perils with an index a parametric product can trigger on. Defaults are the perils the farm's top 3 drivers point
to. A `declared_emergency` driver in v1 is always a DGA water-scarcity decree (metric `decree_active`), so it points to drought /
water supply. Drivers that point to nothing requestable (abandonment, vigour, chill, heat) are still listed in `uncoveredPerils`, so
the request tells Suyana what is left uncovered. A farm with no requestable driver still gets the button; the lender ticks the
perils.

The modal shows the whole payload read-only before sending. Coordinates are shown as "lat, lng" and stored `[lng, lat]` (CONTRACT §0).

### D3. Where it lives in the UI

An **Insurance** column is the last column of the report's finance table, after Credit action. Its header carries Suyana's logo mark
(16 px) and the word "Insurance". Each row shows one of:

- **Request**: a small button that opens the request dialog. The cell stops the row click, so it does not open the farm.
- **Requested · <date>** with a **Queued** chip (neutral grey, not green: nothing is covered yet). It opens the queued request.
- Offline (snapshot mode): a disabled **Request** with "Needs the live service". Both endpoints are live only; the snapshot has no
  outbox file.

The TOTAL row shows "N queued". The logo is the mark from the header of suyana.io, saved unchanged as
`app/public/partners/suyana.svg`. It is a partner asset, not part of the BrotIA brand, and the risk ramp is not used for this column.

If the running service has no outbox (404, for example before a restart), the buttons stay enabled and a failed send says so in the
dialog. Nothing is shown as queued unless the service confirmed it.

### D4. Honest copy, verbatim

- Before sending: "BrotIA will queue this request for Suyana. Suyana's integration is not live yet; your team forwards it."
- After sending: "Request queued · ID <id> · not yet sent to Suyana."

No UI text, payload field or status may say "sent to Suyana", "received", "insured", "covered" or "approved".

## What a real integration would need

1. **An agreed channel and contract with Suyana:** an API endpoint or a partner inbox, a request schema (ours, mapped onto theirs),
   and their product catalogue, to map `INSURANCE_PERILS` and crops to products and indices.
2. **Credentials and identity:** an API key or OAuth client per lender, kept in the service environment (as `ANTHROPIC_API_KEY` is),
   never in the app. Requests are signed with the lender's identity.
3. **A sender:** a background job that reads `queued` rows, sends them with retries and an idempotency key (the request `id`), and
   moves them to `forwarded` with a `forwardedAt` timestamp only on a confirmed receipt.
4. **Status back from Suyana:** a webhook or polling for `quoted`, `declined` and `bound`, with the premium, the trigger and the
   policy id, so the credit side can see the hedge next to the exposure. Each new status is an additive contract change.
5. **Consent and data minimisation:** the farmer's consent to share farm location and loan figures with an insurer; send the
   centroid and area, not the polygon, unless Suyana's index needs it.
6. **Outbox hygiene:** cancel or supersede a queued request, and a portfolio-level view of all requests.

## Consequences

- The report gains a column and a dialog; the table stays pure (`ReportTable` takes an optional `insurance` column prop, so its
  server-render tests are unchanged).
- To fit nine columns in the 1136 px content width at a 1440 px window without sideways scrolling, every table cell's side padding
  went from 12 to 10 px, and the "% of portfolio" (c) and "Weighted risk" (e) headers may wrap to two lines. Below that width the
  table scrolls sideways, as before.
- The service needs a **restart** to load the router. Until then the column reads 404 and keeps working as described in D3.
- Contract change is additive: six types in §A (identical in `contracts/v1/types.ts` and `app/src/domain/types.ts`), two endpoints in
  §B with a v1.1 note, an ownership row in §D and a change log in §G. `CONTRACT.template.md` was already behind `CONTRACT.md` and
  was not updated; do not rebuild `CONTRACT.md` from it.
- Tests: `service/tests/test_insurance.py` (validation, storage, listing, no outbound calls) and
  `app/src/features/report/insurance/insurance.test.ts` (payload, defaults, api client, rendered states).
- Screens: `docs/v1-screens/03-report-overview.png` (the column), `03-report-insurance-request.png` (the dialog),
  `03-report-insurance-queued.png` (after sending) and `50-offline-report-insurance.png` (offline).

## Amendment (2026-11-07): the dialog reads as an email draft

Lender feedback: the dialog was a long form with a tiny logo and analyst jargon. It is now laid out as an email from the lender
to Suyana (`features/report/insurance/`: `EmailDialog`, `EmailParts`, `EmailFigure`, `emailModel`). The payload, the endpoints,
the statuses and the honest copy (D4) are unchanged.

- **Pinned envelope and footer, scrolling body.** To: Suyana's mark at 36 px and "Suyana · parametric climate insurance";
  From: the lender, via BrotIA; Subject: "Cover request: <farm>, <area>, <region> region · <perils>". The region comes from the
  farm's CIREN cadastre layer (`farmRegion`), else the country. The footer holds the D4 line as a quiet note beside Send.
- **Body in plain words:** the farm's tier and score, then the farm Overview's verdict (`buildVerdict`, the same wording as the
  farm page), the loan (amount, outstanding, next payment, maturity) and the cover asked for. The service's driver texts move
  to a "Technical detail" disclosure.
- **One small figure, chosen by the farm's leading driver (largest impact):** abandonment or vigour → NDVI with its usual band;
  water or a declared emergency → NDMI with its band, or the snowmelt forecast vs normal; frost or heat now → daily low or high
  with the damage or stress level; harvest rain → daily rain; anything else, or a series too short to draw, → the C, D, G
  components. The figure is not part of the payload, and the dialog says so.
- **Attachments are the payload, not files.** The chips (`farm.json`, `loan.json`, `risk-assessment.json`, `request.json`)
  open the matching part of the payload as queued; together they still show the whole payload read-only (D2). There is no
  `farm-outline.geojson` or NDVI series attachment: the payload sends the centroid, not the polygon (see "What a real
  integration would need" §5), and the service's models ignore unknown payload fields (`extra="ignore"`), so adding them would
  need a contract change first.
- **Perils are toggle chips;** the ones suggested by the drivers carry a dot, and drivers with no requestable peril are a
  muted note. The optional note is the email's P.S.
- **Column header:** Suyana's mark is 22 px (was 16 px).
- Tests: `app/src/features/report/insurance/insuranceEmail.test.ts`. Screens: `03-report-insurance-request.png` (Ovalle),
  `03-report-insurance-request-copiapo.png`, `03-report-insurance-queued.png`, `43-phone-insurance-request.png`.
