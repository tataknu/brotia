# v1 performance fixes (queued 2026-11-07, run after the v1 build workflow finishes)

Cold `POST /assess/portfolio` on the 12-farm sample ran for more than 20 minutes. Almost all of that time is
Sentinel-2 history fetched for zone peers. Target: a cold run takes about 2–3 minutes, and no request
waits on a network fetch.

| # | Fix | Where | Expected gain |
|---|-----|-------|---------------|
| P1 ✅ done by svc-integrator (`app.imagery.vigour_signals`, one call per farm; cold 25–94 s, warm 1 s) | Get peer comparison from a single grouped `peers(portfolio, farm, as_of) -> PeerComparison` call (about 40 Planetary Computer calls per peer group). Today `gather_peers` calls `vegetation_series` once per peer, about 330 calls each. | `service/app/imagery` (gather_peers), callers in risk | about 8× fewer requests |
| P2 ✅ done 2026-11-07 (ADR-0023): Planetary Computer `s2_l2a_pc` and `copernicus_dem` at 8, national sites ≤ 2, global pool 16 taken after the source slot, imagery worker pools sized from the source limit. Cold Sentinel-2 fetch of one non-cached orchard (266 calls): **95.8 s → 22.5 s** (4.3×, 0 failures). Tests: `tests/test_source_limits.py` | Set concurrency per source. Planetary Computer and Azure blob reads go up to about 8; small national sites (DGA, agromet.cl, CIREN, ftp.cr2.cl) stay at 2 or fewer, per ADR-0012. | `service/app/http` (source pool config) | about 4× faster Sentinel-2 reads |
| P3 ⏭ next step (deferred 2026-11-07: the demo runs on a warm cache or the snapshot) | A request never blocks on a cold fetch. Each farm gets a time budget. When it runs out, return the cached or partial values marked `estimated: true` with a warning, and keep filling the cache in the background. | `service/app/risk`, `/assess/*` routers | page load is always a few seconds |

Acceptance:
- The service tests pass.
- A cold assessment of the sample finishes in 5 minutes or less.
- A warm assessment answers in 5 seconds or less.
- Snapshot export still works.

Record the per-source concurrency change as an ADR (amends ADR-0012).

| P4 ⏭ next step (deferred; ETo bands feed no score, `water.demand` uses sums only) | ETo baseline (Hargreaves from the cached CR2MET tmin/tmax baseline years) so ETo bands are not null | `service/app/sources/weather` | water-demand rung gets 'vs normal' |
| P5 ⏭ do last, after the logo/design changes (`app/scripts/e2e_check.py`; also fix the duplicated `10-ovalle-04/05` and `20-paine-04/05` images) | Re-capture `docs/v1-screens/` from the current snapshot (the old screens predate the review fixes) | app | demo screens match the numbers |

## Status 2026-11-07 evening

- Done: P1, P2. Service tests 287 passed.
- Next steps, in order: design and logo changes, then re-export the snapshot (`POST /snapshot/export`, asOf 2026-11-07 or 08)
  and re-capture the screens (P5) once, after the last visual change. P3 and P4 after the demo.
- P3 design notes (agreed approach): split `gather` in `risk/assess.py` into submit and assemble; wait on the input futures until
  the per-farm deadline (env, default 20 s; portfolio total under 120 s); inputs still loading become `inp.missing` with a
  "still loading" reason (flows to unavailable drivers, provenance notes and warnings; no contract change); mark the result
  provisional and do not cache it; a background thread waits for the remaining futures, computes the full result and writes the
  risk cache. Raise `FARM_WORKERS` or pass a portfolio deadline so 12 farms fit the budget. Check byte identity against a warm
  cache and a frozen-clock offline recompute.
- P4 design notes: store Hargreaves-Samani ETo for the 22 cached baseline years (tmin ∩ tmax R1 years 1991–2020, 149 cells) in a
  separate table, not as `r1` rows (`r1_complete` would treat them as real); use it in `cr2met_bands` when no R1 ETo baseline
  exists, with a provenance note; first compare against the cached R1 ETo of 2025-26 (CR2MET `et0hsm` is also Hargreaves-Samani)
  to check for a calibration bias.
