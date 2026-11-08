# ADR-0021: App display, rule editing and offline behaviour in v1

- **Status:** Accepted
- **Date:** 2026-11-07
- **Builds on:** ADR-0002 (offline snapshot), ADR-0013 D4, D8, D11; CONTRACT §C, §E.2, §E.8, §E.12
- **Decided by:** the app-wizard, app-farm and app-portfolio builders and the review-fix pass

## Context

The app must show the service's numbers without adding its own, let a lender edit rules with an audit trail,
and still work in the room if the service or the network fails. Several build-time choices shape what a
judge sees.

## Decisions

### D1. The app never computes a metric

- The ETo chart shows the service's ETo and `need7dMm` / `need30dMm` only; there is no client-side Kc × ETo line.
- The watchlist water icon comes from the farm assessment (one `POST /assess/farm` per row, at most two at once, after the portfolio
  assessment). It is display only. A `RankedFarm` water summary would be cheaper and is a candidate additive contract field.
- Rain is shown as monthly totals; the normal is the sum of the daily-rate p50 and the range (p10/p90 sums) is labelled approximate.

### D2. Imagery viewer: native first, enhancement opt-in

- Default: native NDVI at the latest observed frame, enhancement off. Each frame is labelled Observed or Interpolated (n days), and
  when enhanced, AI-enhanced or "Resampled, not AI".
- True colour on an interpolated date shows that date's NDVI with a note, never another date's picture.
- The NDVI legend uses discrete swatches (no gradients, per DESIGN.md). The app draws the polygon outline, because native PNGs have none.

### D3. Rule editing and audit

- Three levels: a crop for all farms, a zone with a crop, a farm. "Custom" means set at the level being edited.
- Only agronomic and credit rule values go through the audit trail; shared-zone geometry goes through `updateZone`, so farms are
  reassigned at once. `covered` and `irrigatedDeclared` are audited farm paths.
- Each rules tab has one optional reason field; number fields save on blur or Enter, so one edit gives one audit entry.
- "At harvest" installments fall on the start of the farm's effective harvest stage (maturity for avocado, which has no harvest stage),
  one equal payment per yearly harvest up to maturity, identically in the app and the service.

### D4. Offline snapshot is a first-class mode

- When the service is unreachable the app reads `app/public/snapshot/` and labels everything "Offline snapshot of <asOf>".
- With **rule changes only** since the export (for example after applying an agent proposal), the snapshot numbers are still shown with a
  banner that says the changes need the live service. Changed farms, polygons, loans or zones show "needs the live service".
- The app re-checks `/health` every 30 s and returns to live on its own; data fetched live earlier is labelled as such.
- After a rule edit online, the dashboard keeps the last good assessment, labelled "from before your latest rule change", while the new one computes.

### D5. Timeouts

The app waits up to 5 minutes for an assessment and says a first run can take several minutes. The demo runs on a warm cache or the snapshot.

## Consequences

- **Not exercised in a browser:** Play, layer and resolution toggles, slider scrubbing, the image error path, and the CSS fixes at 390 px
  and 1440 px with the agent panel open. Their logic is unit-tested (218 app tests pass).
- Credit-rule "and" conditions are read-only in the editor (their elements have no id for an audit path).
- The farm chip in the agent panel appears only on a farm page; from the dashboard, open a farm to ask "Why is this farm at …?".
- Zone circles (3.3 km wide) are not visible at country zoom; farm markers are drawn at centroids for that reason.
