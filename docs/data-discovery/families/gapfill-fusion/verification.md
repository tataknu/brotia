# Adversarial verification of `gapfill-fusion` (methods family)

Date: 2026-11-07. Verifier: independent re-probe. No accounts and no keys were used.
I copied the researcher's scripts to my scratchpad and ran them there. The only file written in
this folder is this one.

**Test point, new and not a sample farm.** "newcrop" is at (-62.60, -17.50), between Pailón and
Cuatro Cañadas.
- MCD12Q1 calls it IGBP 12 (cropland) in all 25 years, 2001–2025.
- ESA WorldCover gives 92–94 % crop in a 500 m box.
- Same MODIS tile (h12v10) and S2 tile (20KNF) as Cuatro Cañadas.
- A second point, (-62.35, -17.12), was used for the STAC catalogue checks.

## Verdict summary

| # | Claim | Verdict |
|---|---|---|
| 1 | PC `modis-13Q1-061`: keyless, 2000-02-18 start, fast 26-year pull, 12 holes incl. 8 in a row Jul–Nov 2025 | **Confirmed** (holes are real: the COGs are missing in blob storage too) |
| 2 | PC latest = 2026-09-30, "one composite behind ORNL" | **Corrected**: STAC is behind, the data is not. The 2026-10-16 COG is already in blob storage (produced 2026-11-03) and is readable with the same anonymous token |
| 3 | ORNL MCD12Q1: keyless, 2.6–3.0 s, history 2001 | **Confirmed**. Correction: the latest year is **2025** (A2025001), and the researcher stopped at 2024. One call is capped at 10 years |
| 4 | 5 of 12 farm points are not cropland | **Confirmed, and worse** with ESA WorldCover 10 m. Las Londras is **water** (79–97 %), Los Tajibos is 100 % tree, Warnes Sur is 72–75 % tree. Arrocera Mineros, which MCD12Q1 calls cropland, is tree/bare/shrub with ≤ 5 % crop. That makes 6 doubtful points, not 5 |
| 5 | Weighted Whittaker λ=50 has the lowest leave-out error | **Corrected**: it does not replicate. On newcrop, SG (5,2) 0.0860 < WS λ500 0.0866 < WS λ50 0.0907. All methods within 0.005 are a tie. Envelope bias (−0.021) and harmonic failure (0.134) **confirmed** |
| 6 | As-of: hold the last good value (0.078) instead of WS extrapolation (0.137) | **Corrected**: on newcrop the two are equal (hold 0.084, WS λ50 0.087, WS λ5 0.073). Holding is still a fine and simple rule, but the "2× better" claim is a single-pixel result |
| 7 | Same-date NDVI sd 0.15–0.21 on cropland; the sd floor never binds | **Confirmed** (newcrop 0.08–0.19; dry season 0.08) |
| 8 | 2023-24 drought reaches z −1.5 to −3.4 | **Confirmed in sign, but the method exaggerates it.** See finding A |
| 9 | S2→MODIS cropland 0.117 + 0.815·S2, R² 0.945, pooled by class | **Corrected**: newcrop strict pairs give **0.168 + 0.719·S2**, R² 0.863, RMSE 0.061, n=27 |
| 10 | Pairing with smoothed MODIS biases the slope | **Confirmed** (newcrop 0.623 vs 0.719) |
| 11 | QM ERA5→CHIRPS fixes wet days and 72 h flood counts | **Corrected**: the wet-day fix holds out of sample, but the flood-tail fix does not |
| 12 | SPI-3 with climate_indices agrees with scipy at r=0.998 | **Confirmed** (re-run: r 0.998, max |Δ| 1.24 from the ±3.09 clip) |
| 13 | S1 RTC sparse in 2022–24 | **Confirmed** at newcrop: 60 days in 2020 (S1A+B), 23 in 2023 (S1A only), 34 in 2025 |
| 14 | Licences "NASA open data", method sources keyless | **Confirmed**: MODIS and S2 are open, and the methods need no keys. **Caveat on the upstream ERA5 source**: Open-Meteo's free API is non-commercial only |

> **Round 2 (at the end of this file) updates rows 3, 5, 6, 7, 9 and the footprint rule with results from 4 cropland pixels and a second rain site.** Row 3: ORNL latency is 2.6–7.6 s. Row 5: λ=500 is the most stable choice. Row 6: holding wins or ties on all 4 pixels (1.0–1.8×). Row 7: sd is 0.09–0.16 and pixel-specific. Row 9: pooled cropland fit 0.156 + 0.770·S2, RMSE 0.055. Round 2 also replaces the blanket `rel=3` weight of 0.1 from Finding A. Where the two rounds disagree, Round 2 wins.

## Probes (live, 2026-11-07)

| Probe | Status / latency | Result |
|---|---|---|
| PC STAC `modis-13Q1-061`, point search, 2025-05..12, two new points | 200, 0.6–0.7 s | Terra items: 04-23 … 06-26, then **11-17**. Same hole at both points. Aqua (MYD13Q1) has the same hole (06-18 → 11-25), so Terra+Aqua does **not** fill it |
| PC anonymous SAS token `modiseuwest/modis-061-cogs` | 200, 0.18 s, expires in about 1 h (`msft:expiry` 06:26Z) | Container listing works anonymously. `MOD13Q1/12/10/2025`: the DOY folders jump from 2025177 to **2025321**, so the COGs are absent, not just unindexed. `…/2026`: up to **2026289**. STAC stops at 2026273 |
| Direct blob read of `MOD13Q1.A2026289…2026307125816_NDVI.tif` | 200 | NDVI raw 3984 (0.398) at newcrop. This is today's newest Terra composite, without ORNL |
| PC full Terra history at newcrop (researcher's script) | 610 items, STAC 6.1 s, 3 bands read in 159 s, 0 errors | 602 distinct dates. The 8 duplicate dates are reprocessings with identical pixel values (checked 2024-11-16 and 2022-04-07), so they do no harm |
| PC Aqua latest | — | MYD13Q1 **2026-10-08** on PC, against **2026-09-06** on ORNL. PC is ahead for Aqua |
| ORNL `/dates`, MOD13Q1, MYD13Q1, MCD12Q1 | 200, 1.3–1.4 s each | MOD13Q1: 614 dates, 2000-02-18 → **2026-10-16**. MCD12Q1: 25 years, 2001 → **2025** |
| ORNL MCD12Q1 subset, 4 new points, 2001–2025 | 200, 2.7–3.0 s. A 25-year request is refused: "exceeds maximum subset tiles support of 10" | (-62.62,-17.08) was deciduous forest until 2004, savanna, then cropland from 2007. **Baseline years before clearing must be masked**, which is the use the researcher proposes |
| PC `esa-worldcover` 2020/2021, 13 points | token 200 in 0.3–0.9 s, 0.7–2.5 s per point | See verdict 4 |
| Earth Search `sentinel-2-c1-l2a` over the newcrop MODIS cell, 2021-07 → 2026-11 | 184 scenes cc<60, 141 ≥ 80 % clear, 0 errors | Latest 2026-09-28 in the run log |
| PC `sentinel-1-rtc` counts at newcrop | 200, 0.5–0.7 s | 2020 60 days, 2023 23 days, 2025 34 days |

## Finding A: Whittaker overshoots in long gaps, and S2 had clear scenes inside the gap

At newcrop, MOD13Q1 has **10 consecutive composites with `pixel_reliability = 3`** from 2023-11-01
to 2024-03-05 (140 days). With the recommended weight of 0, the λ=50 curve dips to **0.099**. That is
below both good observations at the edges of the gap (0.389 and 0.362) and below every raw value
inside it (0.117–0.413).
The z-score from the curve then reaches **−4.1** (raw pooled z is −3.2).

Sentinel-2 on the same cell had clear scenes inside the window (2024-01-27 cc 2 %, 2024-02-01 cc 0.1 %).
That shows optical data existed in the gap. It does not prove that the day MODIS chose for each composite was clear.
S2 shows a bare or fallow field at NDVI 0.14–0.20 from Oct 2023 to Feb 2024.
- Calibrated to the MODIS scale, that is 0.27–0.31.
- That is close to most of the `rel=3` raw MODIS values (0.22–0.33).
- Two `rel=3` values were not usable: 0.117 on 2023-11-17 is cloud-contaminated, and 0.413 on 2024-03-05 is at the edge of the gap.
- All of these are far above the Whittaker value of 0.10.

So:
- The drought or failed sowing is real.
- The QA weight 0 threw away data that was mostly usable.
- The smoother invented a value about 0.17 NDVI too low.

**Tested fix** (same pixel, λ=50):

| `rel=3` weight | gap minimum | gap mean |
|---|---|---|
| 0 (researcher) | 0.099 | 0.194 |
| **0.1** | **0.188** | **0.266** (matches calibrated S2, 0.27–0.31) |
| 0.2 | 0.176 | 0.268 |

Clipping to the good observations at the edges of the gap would give 0.362. That hides the failed season, so **do not clip**.

**Recommendation changes:**
- Put calibrated S2 into the series as a real observation, not as an optional extra.
- Give `rel=3` a weight of 0.1 instead of 0. This was tested on one pixel only.
- Mark any curve value more than about 32 days from a good observation (rel 0/1 or clear S2) as "gap-filled". Do not let a gap-filled value alone trigger `ndviAnomalyZ`.

## Finding B: cross-calibration coefficients do not transfer exactly

Fits are strict pairs within ±2 d, rel=0, exact MODIS cell:

| pixel | n | OLS | R² | RMSE | Theil-Sen |
|---|---|---|---|---|---|
| Cuatro Cañadas (researcher) | 30 | 0.117 + 0.815·S2 | 0.945 | 0.037 | 0.129 + 0.801 |
| **newcrop (verify)** | 27 | **0.168 + 0.719·S2** | 0.863 | 0.061 | 0.097 + 0.775 |
| newcrop, 3×3 box | 27 | 0.105 + 0.914·S2 | 0.654 | 0.098 | — |

The slope moves by about 0.1.
- The predictions differ by 0.00–0.035 over S2 NDVI 0.2–0.9, which is inside both RMSEs.
- So a pooled cropland fit is usable.
- "R² 0.945" is the better of two pixels, not a class value. Expect R² of about 0.86 and RMSE of about 0.06.

The 3×3 box is clearly worse on cropland here too, which **confirms** the footprint-matching rule.

Theil-Sen and OLS differ more at newcrop (intercept 0.097 against 0.168). Use Theil-Sen for the pooled
class fit, which is less sensitive to one bad pair.

## Finding C: quantile mapping, out-of-sample

The researcher's counts are in-sample: fitted on 1991–2020 and scored on 1991–2026. I re-ran the
same mapping on Los Tajibos with a split sample. The data are the gridded-precip samples, read-only.

| fit → test | ERA5 raw wet % / 72h≥120 days | ERA5 QM | CHIRPS |
|---|---|---|---|
| 1991–2010 → 2011–2026 | 35.7 % / 13 | 21.4 % / **1** | 23.8 % / 2 |
| 2006–2026 → 1981–2005 | 39.9 % / 15 | 25.8 % / **12** | 25.1 % / **0** |

- **The wet-day correction is robust.**
- **The flood-tail correction is not.** In the second split, QM still gives 12 exceedances, against 0 for CHIRPS. Its 72 h maximum rises from 186 to 199 mm, because above q99 the mapping is ratio scaling, and the tail is unstable.
- Dry spells of at least 21 days in 2011–2026 overshoot: QM 35, CHIRPS 28, raw ERA5 20.
- So QM does not make ERA5 a trustworthy input for `flood72hMm` or `dryDays`. Prefer CHIRPS for absolute thresholds.
  - The gridded-precip family found CHIRPS v3 prelim with about 6 days of latency, so CHIRPS covers the window.
  - Or convert the thresholds to percentiles.
  - Keep QM only as an "estimated" stopgap for the last few days.
- The daily correlation between ERA5 and CHIRPS is only 0.47 (0.53 for 3-day sums). Event timing disagrees, and no mapping fixes that.

## Finding D: licences and terms

- **Open-Meteo free API: "You may only use the free API services for non-commercial purposes."**
  - Limits: < 10,000 calls a day, 5,000 an hour, 600 a minute, and 300k a month (https://open-meteo.com/en/terms, fetched today).
  - A bank-facing Climate Loan Monitor is commercial once it leaves the hackathon.
  - The ERA5 → CHIRPS QM and the ERA5 percentiles depend on this path.
  - Fine for the demo. For production, use an Open-Meteo API subscription, or ERA5 from Copernicus CDS (free account, CC-BY 4.0).
- CHIRPS: "in the public domain as registered with Creative Commons" (chc.ucsb.edu/data/chirps, fetched). Commercial use is allowed. The CHC FAQ page did not answer (connection refused). The gridded-precip family quotes CHC's own advice to prefer pentad or monthly totals over daily values. That is one more reason not to judge 72 h events finely on CHIRPS daily.
- MODIS (MOD13Q1, MCD12Q1): NASA open data, no restriction (not re-fetched today).
- The Planetary Computer SAS docs page rendered empty, so the token terms are *unverified*. Measured: the anonymous token lives about 1 h, so a long backfill must refresh it. The researcher's 8-thread, 3-minute run and mine both had 0 throttling errors.
- ESA WorldCover: CC-BY 4.0 (known; page not fetched today).

## Finding E: conflicts with the ADRs

- **This is a blocking conflict, not a parameter tweak.**
  - ADR-0001 D1/D2 sets the zone `baselineYears` at **3–10, default 5**.
  - ADR-0002 D3 says "MODIS NDVI: since 2000, using the zone's `baselineYears`".
  - The researcher's rule, "NDVI ≥ 8 years, else insufficient baseline", would therefore mark every NDVI anomaly in a default zone as insufficient.
  - The weather rule (≥ 15 years, base 1991–2020) also exceeds the zone limit. ADR-0002 says "up to 30 y", but does not raise the zone limit.
  - Either the ADR changes or the rule does. The PO phase must record this explicitly. Either raise `baselineYears` (recommended: weather 30 and NDVI ≥ 15 when available), or keep 5 and accept noisier percentiles. With n = 5, ±0 d percentiles can only move in steps of 20 points.
- ADR-0001 D2 already fixes "pooled ±7 days" for every series point. The ±7 d weather window agrees. The NDVI ±8 d per-year mean is a small, harmless difference.
- ADR-0002 D4 names Sentinel-2 "via Planetary Computer". The fits used Earth Search c1, which has different offset handling. The coefficients must be re-fitted on the source the service actually reads.

## Recommendation changes

1. NDVI history:
   - Whittaker or SG are both fine. They tie, so choose by code simplicity, and use λ 50–500, not "λ=50 is best".
   - Give `rel=3` a weight of 0.1, not 0. This was tested on one pixel; do not clip.
   - Add calibrated S2 observations.
   - Flag gap-filled values (more than 32 d from a good observation) and never alarm on them alone.
2. NDVI as-of: holding the last good value stays as the rule, for simplicity and honesty, not because it is twice as accurate.
3. Cross-calibration:
   - Pool over the cropland farms with Theil-Sen.
   - Expect RMSE of about 0.06 and R² of about 0.86. Do not quote 0.945.
   - Re-fit on PC `sentinel-2-l2a` if that is the production source.
4. Absolute rain thresholds:
   - CHIRPS (final + prelim) is the primary.
   - ERA5-QM is not a valid fallback for `flood72hMm`. Use percentiles instead. QM is only good for wet-day or dry-day counts, and it overshoots dry spells.
5. Planetary Computer MODIS:
   - Read the newest composite straight from the blob path when STAC lags. The anonymous container listing works.
   - The Jul–Nov 2025 hole is in the data itself, so fill it from ORNL (which has it) during the history backfill.
6. Farm points: replace at least 6 points (add Arrocera Mineros). Las Londras sits on water.
7. Licensing: flag Open-Meteo as non-commercial in the ADR. The production path needs CDS ERA5 or a paid Open-Meteo plan.
8. Record the `baselineYears` conflict with ADR-0001 as a decision for the PO.

## Not verified

- The S2 footprint code was reused verbatim from the researcher (`fetch_s2_modis_pixel.py`). Its sinusoidal-cell reconstruction, the UTM bounding box (about 35 % larger than the cell, by their own note) and the c1 scale and offset handling are *not independently checked*. Only the results that come out of it are.
- ORNL MOD13Q1 subset slowness (26–58 s per call under load) was not re-probed. Only `/dates` (1.4 s) and MCD12Q1 subsets (about 3 s) were.
- Whittaker or SG leave-out errors on the savanna pixel.
- The S2 "own 2017+ baseline" alternative.
- The `vam.whittaker` and `whittaker-eilers` wheel claims.
- The Planetary Computer token rate limits.
- The CHIRPS FAQ (site unreachable).

---

# Round 2: re-verification on two more cropland pixels (2026-11-07, about 07:30–07:45 UTC)

Round 1 used one test pixel (newcrop). Most of its corrections were therefore single-pixel results too.
Round 2 repeats the main experiments on two new points that are not sample farms, with the researcher's
scripts copied unchanged (only the coordinates added) to the scratchpad. No keys, no accounts. Nothing
new was written to this folder except this section.

**Points.** ORNL MCD12Q1 says IGBP 12 (cropland) in all 25 years, 2001–2025, for both:
- **v2n** (-62.30, -16.95), north of Los Tajibos. S2 tile 20KNG.
- **v2s** (-62.38, -17.62), east of Pailón. S2 tile 20KNF.
- Two other candidates were rejected: (-62.20, -17.70) switches between cropland and grassland, and
  (-62.95, -16.75) was forest until 2003, then grassland, then savanna.

## Round 2 probes

| Probe | Status / latency | Result |
|---|---|---|
| ORNL MCD12Q1 subset, 4 points × 3 calls | 200, **2.6–7.6 s** per call (not 2.6–3.0) | Latest year 2025. A call for A2021001–A2026001 returns 5 years, so there is no 2026 map yet. The documented limit is "a maximum ten MODIS dates per request" (modis.ornl.gov/data/modis_webservice.html), which explains the 10-year cap |
| PC STAC `modis-13Q1-061` collection | 200, 0.5 s | `license: "other"`, no licence link; licensor is LP DAAC. Temporal extent starts 2000-02-18 |
| PC STAC point search, v2n and v2s, 2025-05 → 2026-11 | 200, 0.7 s | Terra: 06-26 → **11-17** (the same 8-composite hole). Newest Terra in STAC is still **2026-09-30** (A2026273), 7 h after round 1. Aqua newest 2026-10-08 |
| PC anonymous SAS token | 200, 0.37 s | Valid for about 1 h (expiry 08:20Z) |
| Blob listing `MOD13Q1/12/10/2026`, `MYD13Q1/12/10/2025-26` | 200 | Terra goes up to DOY **2026289** (2026-10-16), Aqua up to 2026281. **Aqua 2025361 (2025-12-27) is in blob storage but missing from STAC.** So STAC has holes that the data does not |
| PC full Terra history at v2n and v2s (researcher's script) | 610 items, STAC 6.1 s, 3 bands read in 163 s and 158 s, **0 errors** | Same as the claim |
| ORNL `/dates` MOD13Q1 and MYD13Q1 at v2n | 200, 1.5 s and 2.4 s | MOD 2000-02-18 → **2026-10-16** (614). MYD 2002-07-04 → 2026-09-06 |
| ORNL MOD13Q1 subset at v2n, A2025193–A2025305 (the PC hole) | 200, NDVI **20.0 s**, reliability 2.9 s | All 8 composites present (NDVI 0.35–0.71, rel 0 except 2025-11-01 rel 3). **Filling the hole from ORNL works** |
| Earth Search `sentinel-2-c1-l2a`, MODIS cell at v2n and v2s, 2021-07 → 2026-11 | 214 and 185 scenes, 0 read errors, 5–10 s per scene | 156 / 151 scenes ≥ 80 % clear on the cell (v2n) |
| Earth Search and PC `sentinel-2-l2a` collection licence | 200 | `proprietary`, linked to the Copernicus Sentinel data legal notice (free, commercial use allowed with attribution). Not stated before in this file |

## Round 2 results by claim

**Smoother leave-out RMSE (claim: "WS λ=50 lowest").** Lower is better.

| method | Cuatro Cañadas (researcher) | newcrop (round 1) | **v2n** | **v2s** |
|---|---|---|---|---|
| WS λ=50 | **0.090** | 0.091 | 0.093 | 0.099 |
| WS λ=500 | 0.091 | 0.087 | **0.083** | **0.093** |
| SG (5, 2) | 0.095 | **0.086** | 0.087 | 0.096 |
| WS + envelope, bias | −0.025 | −0.021 | −0.022 | −0.020 |
| 3-harmonic | 0.146 | 0.134 | 0.102 | 0.152 |

- λ=50 is best on 1 of 4 cropland pixels and worst of the three usable choices on the other 3.
  **λ=500 wins on 2 of 4 and is within 0.004 of the best on all 4.**
- The envelope bias of about −0.02 is confirmed on all 4 pixels. The harmonic fit is worst on all 4.

**As-of value (claim: WS extrapolation 0.137 against holding 0.078).** RMS of as-of minus final, from 2023.

| pixel | WS λ=50 extrapolated | hold last good |
|---|---|---|
| Cuatro Cañadas | 0.137 | 0.078 |
| newcrop (round 1) | 0.087 | 0.084 |
| v2n | 0.035 | 0.025 |
| v2s | 0.078 | 0.058 |

Holding wins or ties on all 4 pixels: 1.0× on newcrop and 1.3–1.8× elsewhere. The 0.137 is the worst pixel, not a typical value.

**Same-date sd and jitter (claim: sd 0.15–0.21, jitter about 0.7).**
- v2s: median sd 0.144 (smoothed) and 0.159 (pooled), jitter 0.77–0.85. **Matches.**
- v2n: median sd **0.091** (smoothed) and 0.110 (pooled), jitter **1.03–1.37**. The sd range is pixel-specific.
- At v2n on 2024-01-17, the smoothed sd was 0.053 and z reached **−6.5**. The 0.03 floor never binds, but
  it is too low to stop extreme z values. A floor near 0.05 would be safer. This is untested beyond that one composite.

**2023-24 drought (claim: z −1.5 to −3.4).**
- v2s: smoothed z −1.66 to −2.10 from 2023-11-17 to 2024-02-02, 6 of 15 composites below −1.5. **Confirmed.**
- v2n: z −2.3, −3.1 and −6.5 from 2023-12-19 to 2024-01-17, then **+0.5 on 2024-02-02**. That looks like a late
  sowing, not a lost crop. The persistence rule is needed here.
- **Possible smoke artefact.** v2n 2024-09-29 has NDVI **0.052 with `pixel_reliability = 1`** (weight 0.5).
  It pulls the smoothed curve to 0.17 and gives z −2.9. September 2024 was the peak fire and smoke month in
  Santa Cruz. A marginal (rel=1) value this far below its neighbours should be down-weighted or rejected
  by a spike test, so it does not raise an alarm.

**`rel=3` weight (round 1 Finding A proposed 0.1 instead of 0).** Tested on the longest cloudy run of each new pixel:

| pixel, run | rel=3 raw NDVI | w=0 curve (λ50) | w=0.1 curve (λ50) | reading |
|---|---|---|---|---|
| v2s, 2011-09-14 → 11-17, 5 composites | 0.24–0.25, flat | 0.28–0.31 (above every raw value) | 0.24–0.25 | flat bare-field values look real; 0.1 helps |
| v2n, 2023-11-01 → 12-03, 3 composites | 0.36, **0.24**, 0.42 | 0.38–0.40 | 0.29–0.34 | 0.24 looks cloudy; 0.1 pulls the curve down by about 0.06 |

The evidence is mixed. Use 0.1 only inside runs of **4 or more** cloudy composites (about 64 days or longer)
and keep 0 for shorter runs. That keeps both pixels in this table, and newcrop, on the better side.

**S2 → MODIS cross-calibration (claim: cropland 0.117 + 0.815·S2, R² 0.945).** Strict ±2 d pairs, rel 0, clear ≥ 80 %.

| pixel | n | exact cell OLS | R² | RMSE | 3×3 box R² / RMSE |
|---|---|---|---|---|---|
| Cuatro Cañadas | 30 | 0.117 + 0.815·S2 | 0.945 | 0.037 | 0.918 / 0.042 |
| newcrop | 27 | 0.168 + 0.719·S2 | 0.863 | 0.061 | 0.654 / 0.098 |
| **v2n** | 36 | **0.047 + 0.951·S2** | 0.809 | 0.058 | 0.750 / 0.067 |
| **v2s** | 31 | **0.216 + 0.701·S2** | 0.938 | 0.041 | **0.953 / 0.036** |
| **pooled 4 pixels** | 124 | **0.156 + 0.770·S2** (Theil-Sen 0.149 + 0.785) | 0.884 | 0.055 | — |

- Predictions spread by **0.12 at S2 = 0.2** (bare soil: 0.24–0.36), 0.04 at 0.5 and 0.07 at 0.8.
  Low-NDVI cases (failed sowing) are where the spread is largest.
- **Leave-one-pixel-out test of the pooled fit.** Each pixel is predicted from the other three:

| pixel | own fit | pooled OLS | no calibration |
|---|---|---|---|
| Cuatro Cañadas | 0.037 | 0.043 | 0.054 |
| newcrop | 0.061 | 0.064 | 0.095 |
| v2n | 0.058 | 0.064 | 0.061 |
| v2s | 0.041 | 0.057 | 0.099 |

  **The pooled class fit works.** It beats no calibration on 3 of 4 pixels and ties on v2n. The cost
  against a per-pixel fit is 0.003–0.016. Theil-Sen gives the same result as OLS (0.041–0.064),
  so round 1's preference for Theil-Sen is neutral, not an improvement.
- **The footprint rule is pixel-dependent.** On v2s the 3×3 box fits *better* than the exact cell
  (R² 0.953 against 0.938). On newcrop and v2n it is worse. The rule "use the MODIS cells inside the polygon"
  still stands, but "the 3×3 box is always worse on cropland" does not.
- Pairing with the smoothed MODIS curve again biases the slope (v2n 0.714, v2s 0.589 against 0.951 and 0.701). **Confirmed.**

**Quantile mapping ERA5 → CHIRPS at a second location**, Arrocera Mineros (-63.29, -17.20), about 80 km
west of Los Tajibos. Data: the read-only gridded-precip samples.

| fit → test | ERA5 raw wet % / 72h≥120 days | ERA5 QM | CHIRPS |
|---|---|---|---|
| 1991–2020 → 1991–2026 (the researcher's in-sample setup) | 46.6 % / 37 | 24.2 % / 5 | 24.7 % / 5 |
| 1991–2010 → 2011–2026 | 44.2 % / 7 | 22.9 % / 2 | 24.6 % / 5 |
| 2006–2026 → 1981–2005 | 50.2 % / 24 | 26.9 % / **23** | 26.1 % / **2** |

- ERA5 is **+43 %** wetter than CHIRPS here (claim +31 % at Tajibos; site-specific).
- **The wet-day fix is robust at both sites. The flood-tail fix fails out of sample at both sites**
  (Tajibos 12 against 0, Mineros 23 against 2).
- Dry spells of at least 21 days: QM 26 against CHIRPS 22 (2011–26), but 19 against 40 (1981–2005). Unstable.
- Percentile agreement r = **0.52** (claim 0.51), the same dry < p20 flag on 74.7 % of dates. **Confirmed.**
- Daily correlation 0.50 (0.56 for 3-day sums).

**SPI-3, climate_indices against scipy, at Mineros.** r = **0.999**, max |Δ| 0.80 (the ±3.09 clip). **Confirmed** at a second site.

## Round 2 changes to the round 1 recommendations

1. **Smoother: λ = 500** (or SG 5,2) instead of λ = 50. λ = 500 is the most stable choice across 4 cropland pixels.
2. **`rel=3` weight (proposed, untested beyond 3 pixels; the evidence is 2 against 1):** 0 for short runs and 0.1 inside runs of 4 or more cloudy composites. This replaces
   round 1's blanket 0.1. Add a spike test on rel=1 values: reject a value that is more than about 0.2 below
   both neighbours, which covers the smoke case.
3. **sd floor (proposed, untested):** raise it from 0.03 to about 0.05. Smoothed z below −4 should be shown as "very low", not as a number.
4. **Cross-calibration:** use the pooled cropland fit **0.156 + 0.770·S2** (124 pairs, 4 pixels, RMSE 0.055).
   Expect a leave-out RMSE of 0.04–0.065. Do not quote R² 0.945. Re-fit on the S2 source the service reads.
5. **Quantile mapping:** round 1 stands, and Mineros confirms it. QM is not a fallback for `flood72hMm`.
6. **PC MODIS:** round 1 stands. The STAC index also misses composites that are in blob storage
   (Aqua 2025-12-27), so list blob storage for the newest DOY rather than trusting STAC alone.

## Round 2 not verified

- Earth Search S2 against PC S2 coefficients. All 4 fits use Earth Search c1.
- The spike-test threshold and the 0.05 sd floor. They are reasoned from one composite each, not backtested.
- Whether the 2024-09-29 v2n low value is smoke. Fire or smoke data for that date were not checked.
- PC SAS terms of use (docs page still renders as an empty shell, 2.5 kB) and rate limits.
- NASA Earthdata data-use page returned 403 to a script.
