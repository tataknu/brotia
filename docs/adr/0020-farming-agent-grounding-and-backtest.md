# ADR-0020: Farming agent: grounded proposals, backtest truth and failure handling

- **Status:** Accepted
- **Date:** 2026-11-07
- **Builds on:** ADR-0013 D4 (audit) and D9 (farming agent), CONTRACT §E.2
- **Decided by:** the svc-agent builder; grounding hardened by the review-fix pass (finding ST-1)

## Context

ADR-0013 D9 set two rules: the agent never invents values (every number comes from a tool) and it only
recommends. The first build enforced the first rule only through the prompt: a proposal's own new value
counted as its own evidence. The backtest also needed a definition of "truth" with almost no curated
damage events for Chile.

## Decisions

### D1. Proposals come from a tool, and the server fills the bookkeeping

- Proposals come from a `propose_change` tool, not from parsing the answer.
- The server fills id, time, `actor {kind: agent, name: 'Farming agent'}`, `status: proposed`, `recommendationId` and `oldValue`
  (the effective value through farm → zone → portfolio crop → template).
- Paths are checked against the CONTRACT §E.2 leaf table, values against sanity bounds. Numbers sent as text ("-2.0", "−2,5") are
  accepted; NaN is rejected.
- Scope: agronomic leaves only (stage windows, sensitivities, thresholds, chill, baseline years, weights) at zone, crop or farm level.
  Credit-rule proposals are not supported in v1.

### D2. The agent cannot propose a number it made up

- `propose_change` **refuses** a frost or harvest-rain threshold that no earlier `backtest` or `get_history` output contains (exact sign;
  a flipped sign is refused). Other numeric leaves must appear in some earlier tool output.
- A proposal's own new value no longer counts as evidence in the answer's number check.
- Numbers in the final answer that appear in no tool output, the question or the request context get a footnote in the question's
  language. The answer is not blocked.
- The check cannot detect a cited number being misused.

### D3. Backtest truth

- A damaging season is a **curated reference event** overlapping the stage window, or a **station damage proxy** that does not depend on the candidates:
  - Frost proxy: a night with Tmin ≤ the stage's `frostSevereC` (T90).
  - Rain proxy: a 72 h sum ≥ 1.5 × the template `harvestRainMm72h` (severity 1 in §E.5).
- Counts are per season. Seasons with under 70 % valid days are skipped and listed. The current and template values are always among the candidates.
- Only one curated event exists: the **September 2013 central-Chile frost** (16–21 Sep 2013, lat −32.0 to −38.5; source: project notes, no primary citation).
- The February 2023 fires and decree periods are shown as **context only**, not scored. This narrows ADR-0013 D9, which listed them as backtest events.

### D4. Model, time limits and failures

- Model: `CLM_AGENT_MODEL`, else `ANTHROPIC_MODEL`, else `claude-opus-5-5`. Effort medium; adaptive thinking; tool choice never forced.
- Internal 80 s deadline inside the contract's 90 s; each tool waits at most min(45 s, remaining − 20 s).
- No key, or a key rejected with 401/403 → 503 `no_api_key`; the panel says the agent is unavailable. Other upstream errors → 200 with no
  proposals, the tool calls made so far and the error class only. Tool failures never escape `recommend()`, so the fixture can never be
  served as if it were the agent.
- The key is read from the environment or the gitignored `service/.env` and is never printed, logged or sent to the app.

### D5. Applying a proposal

The app writes it through the audit trail: the proposed entry stays, and on Apply a copy is appended with `status: applied`, the user as
actor and the same `recommendationId`. The audit trail shows "Proposed by Farming agent · applied by <user>". Undo is offered only while the
applied change is still the latest at its path.

## Consequences

- **Verified live (service only):** on zone-requinoa, a 14-season frost backtest (including September 2013) led to bloom frost −2.4 → −2.0 °C
  for cherry (1 hit, 0 false alarms, 0 misses) and walnut harvest rain 30 → 40 mm, with no unverified-number footnote. About 15 s warm.
- **Cold start:** a frost plus harvest-rain backtest makes about 28 season-window requests; the first question on an unwarmed zone may come
  back partly unavailable. Run one `recommend()` on the demo zone after the server starts.
- **Weather history for backtests** is filled (CR2MET Tmin and rain, 2013–2025) only for the 12 Requínoa cells. Other zones answer from
  whatever is cached.
- The flagship proposal does not change the Requínoa cherry farm, which already has its own −2.0 override (ADR-0016 D4, ADR-0022 D3).
