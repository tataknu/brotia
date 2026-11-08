# Soil moisture and water balance: adversarial verification

Verifier probe date: 2026-11-07 (one day after the original notes). Probe scripts and raw outputs are in the verifier's scratchpad, not in this folder. Only this file was written here.

**Coordinates (different from the researcher's):**

- SLVR / Viru Viru (-17.64, -63.14), ERA5-Land cell (-17.60, -63.10).
- "San Julian N" (-16.60, -63.00).
- "East Pailon" (-17.80, -62.40).

I re-ran Tajibos only to reproduce the researcher's numbers. I used new date windows too: Aug, Sep and Oct, and 2019–2020 alongside 2023–2024.

## Verdict summary

| Claim | Status | Evidence |
|---|---|---|
| ERA5-Land via Open-Meteo is keyless and starts 1950-01-01 | Confirmed | Three new points: 200, 0.42–0.44 s. 1949-12-28 to 1949-12-31 return null; 1950-01-01 = 0.476 at SLVR |
| Latency ~5 days | Confirmed (6 d on 11-07) | Last non-null 2026-11-01 at all three points. 2026-11-01 has all 24 hourly values, so the last day is complete, not partial |
| 30-y daily pull ~8 s | Confirmed | 12.1 s cold, 0.64 s warm (cache), 214 KB for one variable 1996-01-01..2026-11-07 |
| 5 nulls in 11,268 days | Corrected (minor) | 0 nulls in `soil_moisture_0_to_100cm_mean` daily at SLVR and Tajibos through 2026-11-01 |
| Tajibos Oct7–Nov1 pct 2023 = 7, 2024 = 0, 2025 = 17, 2026 = 87 | Confirmed (exact) | Same. SLVR: 3 / 7 / 37 / 97 |
| Rate limit "~600/min, 10k/day" | Corrected (incomplete) | Terms page: < 600/min, 5,000/h, 10,000/day, 300,000/month (monthly limit not enforced yet). **Each 30-y daily single-variable call costs `X-RateLimit-Cost` = 80.5**, so about 7 cold farm pulls per minute. I hit HTTP 429 "Minutely API request limit exceeded" after about 7 such calls |
| Licence: CC-BY data, free tier non-commercial | Confirmed | terms: "You may only use the free API services for non-commercial purposes." A bank product needs the paid tier, or ERA5-Land straight from the CDS (free key) |
| ERA5-Land "correctly flags the 2023 and 2024 droughts" | Confirmed for 2023–24; **corrected** in general | It missed a large August 2020 rain event that CHIRPS, NASA POWER and CPC all show (see Finding 1) |
| SoilGrids keyless, CC-BY 4.0, ~5 calls/min | Confirmed | rest.isric.org entry page: "Fair use is defined as 5 API calls per 1 minute period". FAQ: "SoilGrids is available under a CC BY 4.0 license" |
| SoilGrids "6–13 s per call" | Corrected | SLVR 12.9 s; East Pailon **67.6 s** for the same 4-property × 5-depth query |
| SoilGrids units (wv raw/1000 = m³/m³; clay, sand raw/10 = %) | Confirmed | Response metadata: wv `d_factor` 10, mapped units "(10-2 cm³/cm³)*10"; clay/sand `d_factor` 10, g/kg → % |
| SoilGrids TAW ~126–147 mm per 0–100 cm | Confirmed (plausible range) | SLVR 128 mm, East Pailon 116 mm |
| SoilGrids suits per-farm TAW | Corrected | ISRIC FAQ: "we do not advise to use SoilGrids at the local or farm level". The REST API is "beta stage … Occasional issues and downtimes may occur" |
| NOAA CPC keyless, 1948-01 → 2026-10, 0.5°, mm | Confirmed | DDS: time = 946 months, 1948-01-01..2026-10-01; units mm, valid_range 0–1000; missing value -9.97e36 (none in 1996–2026 at either cell) |
| CPC Tajibos May–Oct 2026 = 423/384/334/313/271/299; Oct-2026 pct 60; Oct-2024 = 159 mm | Confirmed (exact) | Same values. Oct-2023 pct = 13 (they said 14; a rank-convention difference) |
| CPC latency "0.2–1.3 s" | Corrected | That was a 6-month slice. A 1996–2026 point subset took **25.9 s** (SLVR) and **34.5 s** (Tajibos). A full 1948–2026 point request **timed out at 60 s**. The file is chunked one time step per chunk |
| CPC is an independent "second opinion" | Corrected | Monthly anomaly r vs ERA5-Land is only **0.40** (SLVR) and **0.42** (Tajibos); Jul–Nov 0.43 / 0.52. That is no better than NASA POWER (0.38), which the researcher demoted |
| SMAP L4 SPL4SMGP v008: 2015-03-31 → 2026-11-04, ~2-day latency, open licence | Confirmed | CMR at (-17.80, -62.40): hits 33,913, latest 2026-11-04T21:00, first 2015-03-31. UMM-C: "freely, openly, and fully available … without restrictions" (cite NSIDC) |
| SMAP L4 needs only a "free signup" | Confirmed, with a caveat | The HTTPS data link returns 303 to a protected CloudFront/S3 URL, so it needs an Earthdata login. **Each granule is ~139–143 MB, at 8 granules per day.** Direct download is not a viable per-request fallback |

## Finding 1 (most important): ERA5-Land can show a false drought when ERA5 misses a rain event

At Tajibos, August rain in 2020 by source:

| Source | Aug 2020 | Note |
|---|---|---|
| ERA5 (Open-Meteo `models=era5`) | **11.9 mm** | Largest day 4.7 mm |
| CHIRPS v2.0 monthly COG | **122.6 mm** | Wettest August of 2010–2025 by far; the median August is 23 mm |
| NASA POWER PRECTOTCORR | **205.7 mm** | 68 mm on 08-16, 52 mm on 08-19 |

How the soil series respond:

- **ERA5-Land 0–100 cm:** declines steadily through Jul–Oct 2020 (0.379 → 0.317) and shows no wetting at all. Its percentiles are Sep 2020 = 7th (Tajibos) and Oct7–Nov1 2020 = 3rd (Tajibos) / 0th (SLVR).
- **CPC:** Sep 2020 = 97th pct (z = +2.0) at Tajibos and 87th at SLVR.

CHIRPS and POWER disagree on the size of the event (123 vs 206 mm), so neither one is ground truth. The claim I can defend is narrower. Three independent products (CHIRPS, POWER, CPC) show a large mid-August 2020 event, and ERA5 shows none. ERA5-Land runs on ERA5 rain, so it carries that miss.

This does not make ERA5-Land unusable. It still matches the other sources on 2023 and 2024. But it is a single point of failure: the bucket fallback runs on the same ERA5 forcing, which explains much of its r = 0.89.

## Finding 2: a cold 12-farm backfill will hit Open-Meteo's rate limit

- One 30-year daily call costs about 80 weighted calls, so 12 farms × 1 variable ≈ 970 weighted calls.
- That is more than the 600/min allowance and about 20% of the 5,000/h allowance.
- If the ERA5 precip and ETo pulls are added, plus the other families, the 10,000/day limit is reachable in one dev day of cache misses.

The DuckDB cache is therefore required. The backfill must be throttled, about 6 calls/min, with retry on 429. One option is the multi-coordinate request (comma-separated lat/lon lists). I did not test whether it lowers the cost (verified = false).

## Finding 3: the absolute ERA5-Land values differ widely between nearby cells

On 2026-11-01:

- East Pailon: 0.145 m³/m³.
- SLVR: 0.426 m³/m³.
- San Julian N: 0.331 m³/m³.

At East Pailon, SoilGrids gives field capacity ≈ 0.27–0.29, while ERA5-Land reads half that. ERA5-Land uses its own coarse texture class. This confirms the researcher's rule: use percentiles only, and never compare θ with SoilGrids FC or WP.

## Recommendation changes

1. **Make the bucket fallback independent.** Run the FAO-56 bucket on CHIRPS rain instead of ERA5 P. I verified the keyless CHIRPS v2.0 monthly COGs on data.chc.ucsb.edu, read through `/vsicurl`.
   - **Verified use:** the baseline and the 2020–2024 backtest.
   - **Not verified (verified = false):** whether CHIRPS can cover the last few weeks of the 13-month window. That depends on CHIRPS latency; the final product usually lags more than a month, and I did not probe the prelim product. I also did not confirm a daily COG path. Check both with the precip family.
   - Throttle CHIRPS to about 1 request per 5 s. I got HTTP 429 from the CHC server when sampling quickly.
   - Note: CHIRPS moved to `/products/CHIRPS/v2.0/`; the old `/products/CHIRPS-2.0/` path returns 404.
   - The IRI Data Library CHIRPS mirror now redirects to a login.
2. **Add a cross-source rain check to the WHY panel.** If ERA5 and CHIRPS rain disagree a lot for the window (for example, the ratio is above 3 and the difference is above 50 mm), label the soil-moisture signal "low confidence".
3. **Tag CPC by tier.** When CPC is the active fallback, show "fallback: CPC monthly 0.5°". Do not show its percentile as if it were the primary's (anomaly r is only 0.4–0.5). Keep CPC in the chain: it has no key, it is public domain, and it caught Aug 2020.
4. **Soften the NASA POWER demotion.** Its rain matched CHIRPS (where ERA5 did not) in Aug 2020 and in Jul–Oct 2024 (POWER 213 mm, CHIRPS 201 mm, ERA5 99 mm). Keep it as validation only, but drop the wording "disagrees with every other source".
5. **SoilGrids: fetch once and ship in the snapshot.**
   - Fetch all 12 farms once, at ≤ 5 calls/min, into DuckDB and the offline snapshot. Never call SoilGrids at request time: the API is beta and calls took 13–68 s.
   - Label TAW as "regional estimate (SoilGrids 250 m)", because ISRIC advises against farm-level use.
   - The pitch claim that "TAW varies by farm" should be soft.
6. **Treat SMAP L4 as a cross-check only.** Use it through AppEEARS point extraction or a Harmony subset, behind an Earthdata login. Do not list it as a runtime fallback, because each granule is ~143 MB.
7. **Licence.** The Open-Meteo free tier blocks commercial (bank) use. The production path is ERA5-Land from Copernicus CDS (free key, CC-BY 4.0) or the Open-Meteo paid tier. Write this into the ADR now.

## Open risks found during verification

- **Primary missed a rain event.** ERA5-Land missed the Aug 2020 event (Finding 1). If the 2023–24 backtest is the only validation, this risk stays hidden.
- **CPC response time.** A CPC request takes 26–35 s for 30 years, and a full-length request can time out. Cache the series and fetch only increments: the last 2–3 months, indices 943:945.
- **SoilGrids slowness.** Calls are slow (up to 68 s), and the service is beta.
- **Unverified pre-window artefact.** The researcher's "window-boundary artefact" (Oct 5–6 rain lifting the Oct7–Nov1 percentile) is plausible, but I did not re-test it (verified = false).

## Second pass (2026-11-07, ~07:30 UTC): freshness spot-check

I ran a small re-check (about 7 requests) at a new farm, Granja Las Londras (-17.74, -62.76), plus the Tajibos cell for the Aug 2020 rain. I did not repeat the 30-year pulls.

| Check | Result | Effect on verdicts |
|---|---|---|
| Open-Meteo archive, Las Londras, 9 days, `models=era5_land` | **HTTP 429 "Daily API request limit exceeded. Please try again tomorrow."** (0.43 s) | Finding 2 is no longer a projection. The daily quota for this machine's IP is already spent (the research agents share one IP). Today I could not re-check latency or the "era5_land returns null precip/ETo" note (verified = false for this pass) |
| NASA POWER PRECTOTCORR, Tajibos, Aug 2020 | HTTP 200, 0.39 s, **205.7 mm** (68.3 mm on 08-16, 52.0 mm on 08-19) | Same as the first pass. Finding 1 stands: ERA5 had 11.9 mm in the first pass. I could not re-pull ERA5 today because of the 429 |
| NOAA CPC DDS + tail slice `soilw[943:945]` at cell (-16.75, 297.25) | HTTP 200, 0.22 s / 0.38 s. time = 946 steps, last = 82818 days since 1800-01-01 = **2026-10-01**. Values Aug–Oct 2026 = 312.8 / 271.5 / 299.5 mm | Confirms history 1948-01, latency (Oct 2026 out by early Nov) and the researcher's numbers. A short tail slice is fast; only long slices are slow |
| CMR SPL4SMGP v008 at Las Londras, newest first | HTTP 200, 0.12 s, hits 33,913, latest 2026-11-04T21:00Z, granule_size **142.9 MB** | Confirms ~2–3-day latency and that granules are too large for runtime use. No new granule since the first pass (its latency is now ~3 days) |
| SoilGrids `wv0033`+`wv1500`, 5 depths, Las Londras | **No response within 120 s** (curl timeout, HTTP 000) | Makes the "beta, slow" risk worse: 13 s, then 68 s, now a timeout. Fetch once, retry offline, ship in the snapshot. A pre-baked fallback (Saxton-Rawls from cached texture, or HWSD v2) must be in place before the demo |

### Additions to the recommendations

8. **Open-Meteo quota is shared across the team.** All agents and the dev service hit the free tier from the same IP. The daily cap is now exhausted (429 until tomorrow, UTC). Before more pulls, the team should:
   - build the DuckDB cache and snapshot first;
   - set a per-IP budget;
   - for development, consider one bulk ERA5-Land pull from the CDS (free key) for the 12 farms.

   The "primary" depends on a quota we already exceeded once in discovery.
9. **SoilGrids needs a static fallback in the repo.** Store per-farm TAW values (computed once) in the snapshot. Do not rely on a live SoilGrids call, even for the one-time backfill on demo day.
