# ADR-0023: Per-source concurrency

- **Status:** Accepted
- **Date:** 2026-11-07
- **Amends:** [ADR-0012](0012-source-access-patterns.md) D3 (polite concurrency limits)
- **Backlog:** [`docs/backlog/v1-perf-fixes.md`](../backlog/v1-perf-fixes.md) P2

## Context

ADR-0012 D3 gave every source the same default of 2 concurrent requests, with a global cap of 8. That default protects small
national sites, but it also applied to Microsoft Planetary Computer. Planetary Computer is a cloud service built for parallel reads.
Its STAC search and data API read Cloud-Optimised GeoTIFFs from Azure blob storage on the server side.

Sentinel-2 history is almost all of a cold assessment's time. At 2 concurrent calls, one orchard that is not in the cache took
95.8 s to fetch: 266 calls, made up of 80 window scenes, 179 history scenes and the STAC searches.

The code had two more limits:
- **Worker pools:** the imagery worker pools (`obs.collect`, `timeline.build_stack`) were hard-coded to 2 workers, so raising
  the source limit alone would have changed nothing.
- **Slot order:** `app.http` took a global slot before the source slot. Calls queued on a 1-slot government source (DGA, RAN)
  each held a global slot while they waited, which could leave Planetary Computer with fewer slots than its own limit.

## Decision

### D1. Planetary Computer runs 8 at a time

`s2_l2a_pc` (STAC and data API) and `copernicus_dem` (Copernicus DEM GLO-30, also on Planetary Computer) are registered
with `max_concurrency=8`. The imagery worker pools size themselves from the source limit (`http.source_limit(s2.SOURCE)`).
Retries with back-off on 429 and 5xx, honouring Retry-After, are unchanged.

### D2. National and government sites stay at 2 or fewer

| Source | Site | Limit |
|---|---|---|
| `dga_decrees`, `dga_snowmelt` | DGA | 1 |
| `dga_arcgis` | DGA ArcGIS | 2 |
| `ran_station` | agromet.cl (RAN) | 1, 10 s apart |
| `ciren_catastro`, `ciren_irrigated` | CIREN | 2 |
| `cr2met_r1`, `cr2met_nrt` | ftp.cr2.cl | 2 |
| `cems` | Copernicus EMS | 1 |
| `gwis_ba` | GWIS | 2 |
| `firms` | NASA FIRMS | 2 |
| `conaf_comunas` | CONAF | 1 |
| `open_meteo` | Open-Meteo (embargoed until 2026-11-08 00:00 UTC) | 1 |

### D3. The global pool never caps a source below its own limit

- **Pool size:** `GLOBAL_MAX_CONCURRENCY` is 16. This is at least Planetary Computer's 8 plus the national sites that can usefully
  run at the same time.
- **Slot order:** a request takes its source slot first and only then a global slot, so a request queued on a slow source
  never holds a global slot.

### D4. Unchanged

- **Etiquette:** the User-Agent stays honest (`climate-loan-monitor/0.1 (hackathon prototype)`) and there is no header spoofing
  (ADR-0012 D5).
- **Other rules:** timeouts, pacing (`min_interval_s`), the cache and stale-on-error are unchanged.

## Evidence

Cold Sentinel-2 fetch of one orchard that is not in the cache: 13-month window plus 5 baseline years. Each run used a fresh
private DuckDB file and files directory. The orchards are adjacent La Cruz avocado orchards of similar size, both outside the
sample portfolio and its peers.

| Run | Orchard | Calls | Window | History | Total | Failures |
|---|---|---|---|---|---|---|
| Before (2 concurrent) | CIREN 10496, 7.2 ha | 266 | 32.5 s | 63.4 s | **95.8 s** | 0 |
| After (8 concurrent) | CIREN 12735, 6.8 ha | 266 | 8.1 s | 14.3 s | **22.5 s** | 0 |

That is 4.3× faster, with no 429 responses and no failed scenes.

Tests in `service/tests/test_source_limits.py` check:
- the limits in D1 and D2;
- that the global pool is at least the largest source limit;
- that calls queued on a 1-slot source do not block another source. This test fails with the old slot order.

## Consequences

- **Speed:** a cold assessment's Sentinel-2 phase is about 4× shorter.
- **Rate limits:** Planetary Computer may answer 429 under heavy load. `app.http` backs off, and a failed scene is skipped and
  counted in provenance, never invented.
- **New sources:** a new source keeps the default of 2 unless it is a cloud service documented for parallel reads. Any source
  raised above 2 needs a line in this ADR.
