# ADR-0012: Source access patterns for the data service

- **Status:** Accepted
- **Date:** 2026-11-07
- **Builds on:** [ADR-0002](0002-v1-real-data-architecture.md) D2 (source wrappers, registry, fallback)
- **Reference studied:** [simplifaisoul/osiris](https://github.com/simplifaisoul/osiris) (MIT licence), a real-time OSINT dashboard that aggregates keyless public feeds

## Context

ADR-0002 commits to per-source wrappers behind a variable registry with fallback, and to values
that are traceable and resilient. Before building the wrappers we studied how an existing open
project consumes many keyless public APIs reliably.

That project is not a climate or crop tool. It has no history, baselines or anomaly maths. Its
value to us is how it fetches data. Its fetch layer is a set of thin server routes, each calling one or more
public APIs, with these patterns:

- `src/lib/sourceCache.ts`: time-limited caching, shared in-flight requests, stale data served on error, and an
  empty result treated as a failure.
- `src/app/api/sentinel/route.ts`: a fallback chain (Earth Search Sentinel-1 → Sentinel-2 →
  Copernicus), with the provider recorded as `source` in each response.
- `src/app/api/wind/route.ts` and `src/lib/fetch-pool.ts`: limits on concurrent requests per
  upstream and globally. Their notes show that most upstream "failures" were caused by their own
  fan-out exhausting connections, not by the providers.
- `src/app/api/weather/route.ts`: queries several event providers in parallel, keeps whatever
  succeeds, and fails only if all of them fail.

## Decisions

### D1. Every wrapper fetch goes through one cached fetch path

| Behaviour | Rule |
|---|---|
| Persistent cache | Raw responses are stored in DuckDB, keyed by source, variable, location or polygon hash, and date range. Unlike an in-memory cache, this survives restarts and feeds the offline snapshot. |
| TTL by data type | History that no longer changes, such as reanalysis older than about 3 months or final CHIRPS, never expires. Recent or preliminary data expires according to the source's latency, typically every few hours to a day. |
| In-flight dedup | Concurrent requests for the same key share one upstream call. |
| Stale on error | If a refresh fails, we serve the last good value, mark it `stale: true` with its `fetched_at`, and retry after a short backoff (60 s) rather than after the full TTL. |
| Empty is not success | An empty or obviously truncated response never overwrites cached data. |
| Timeouts | Every upstream call has an explicit timeout of 10–30 s, depending on the source. |

### D2. The registry tries sources in order and records which one answered

For each variable the registry tries the primary wrapper, then the fallbacks. Every value
returned carries provenance:
- `source`: which wrapper answered;
- `observed_at`: the date of the observation;
- `fetched_at`: when we retrieved it;
- `resolution`;
- `stale`;
- `estimated`: true when a fallback or gap-fill produced the value.

The UI shows this provenance.

### D3. Polite concurrency limits

- **Per upstream:** each wrapper declares its own maximum number of concurrent requests (default 2) and its
  minimum interval between requests.
- **Global:** a single pool caps total outbound requests.
- **Batching:** sample-portfolio runs fetch farm by farm through the pool instead of all at once.
- **Identification:** requests carry an honest `User-Agent` naming the project and a contact address.

### D4. Event sources are queried in parallel and merged

- **Parallel queries:** the recent-disasters panel calls all of its event providers in parallel and merges
  whatever comes back. Each event keeps its provider.
- **Failures:** the panel is empty only if every provider fails *and* nothing is cached.
- **Candidate keyless feeds:** GDACS, NASA EONET and NASA FIRMS.
  - FIRMS keyless NRT files cover the last 24 hours or 7 days (the NOAA-20/21 South America
    7-day CSVs were verified keyless on 2026-11-07, ADR-0009). Older fire history needs the free FIRMS
    key or the yearly archive downloads.
  - EONET has thin coverage of drought and floods in South America.

  Final source choices belong to the data-discovery ADRs.

### D5. Rejected: header spoofing to get around rate limits

The reference project's `src/lib/stealthFetch.ts` sends randomised spoofed "residential"
`X-Forwarded-For` IP addresses and browser fingerprints to spread requests and avoid rate limits.
**We will not do this.**

- **Terms:** it breaks providers' terms of use.
- **Trust:** it undermines the trust story we are selling to a lender.
- **Licensing:** it would not survive the move to Suyana's commercial product.

If a source's limits are too tight, we cache more aggressively, use a registered key, or switch
to another source.

## Consequences

- **Service:** the FastAPI service needs a small shared HTTP layer covering cache, dedup, stale-on-error,
  pools and timeouts, built before the individual wrappers. Each wrapper then only knows its URL, its
  parsing and its limits.
- **API:** provenance fields become part of the API contract and of the `api.ts` types.
- **Demo:** the demo stays usable when the network is offline or degraded. Cached values show as stale or estimated
  instead of disappearing.
- **Attribution:** no code is copied verbatim. If we later port code from the reference project, we keep its MIT
  notice.
