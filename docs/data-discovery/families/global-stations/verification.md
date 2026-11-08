# Adversarial verification: global station archives (family `global-stations`)

Verifier probes ran on 2026-11-07, 05:40–06:10 UTC. I used no keys and no accounts. I worked on
different stations from the researcher where I could: El Trompillo 85245/SLET, Concepción
85196/SLCP and the whole 852xx block. I also used different date ranges: 1996–1999, Mar 2012,
Jan 2018, Aug 2026 and Oct–Nov 2026. I re-used SLVR only to re-check headline numbers. The
probe files are in the session scratchpad; none are kept here. I reused the researcher's
`probes/ogimet_synop.py` parser without changing it, and I wrote my own quick decoders to
cross-check it.

## Re-check, 2026-11-07 07:23–07:35 UTC (time-sensitive claims only)

| Row | What I re-probed | Result | Effect on verdict |
|---|---|---|---|
| 1 | OGIMET `block=85244`, 2026-11-04 00Z → 11-07 12Z | 200, 0.30 s, 2.5 KB, 26 bulletins, latest **11-07 06Z** (at 07:25Z). **No 00Z or 12Z bulletin since 11-04 12Z has a `333` section.** 11-04 00Z is still missing. The few `333` sections that do appear (11-05 09Z/18Z, 11-06 03Z) carry only `5xxxx`/`8xxxx` groups, with no `1sTTT`, `2sTTT` or `7RRRR`. | The outage of the section-3 Tx/Tn groups is now **~3 days**, and it is still on. Row 1 stands. Precip still flows through section 1: 11-05 12Z `60154` (15 mm), 11-06 12Z `60024` (2 mm), and 11-04 12Z `iR=3` (dry). |
| 3 | OGIMET `block=85244` (one station, not the block), 1999-01-01..05 and 1999-04-01..05 | Both **200 with 0 B in 2.3 s**. The reply was fast, so this was probably not a timeout. My inference: the 1999 table exists, but it has no SLVR rows for these dates. 1999-07 and 1999-10 returned **501**. | The history start is now **between 1999-04 and 1999-10** for SLVR. "2000-01" is still too late by at most one quarter. Exact month unresolved. |
| 5 | OGIMET pacing | **501 came back even with 16 s and 30 s gaps** (3 of 4 calls) after only ~6 calls in this session. | The rule "501 only if < ~10 s apart" is **too optimistic**. After a 60 s pause, a *recent* request (85245, 11-06..07) returned 200 in 0.32 s, but 85245 1999-10 returned **501 again** (block 852 gave data for it in the 05:40Z pass). So old-archive requests seem to have their own, tighter budget. Back off for minutes or hours after a 501, and plan the 1999–2023 cache job with retries and resume. |
| 8/9 | GHCNh S3 listing `hourly/access/by-year/2026/psv/GHCNh_BLI0000S*`; SLET 2026 parquet | Listing 200, 0.13 s. All 14 `BLI0000S*` files are **still LastModified 2026-11-06 00:41Z**: there was no 11-07 00:41Z rewrite. SLET parquet 200, 0.31 s, 320 KB, Last-Modified 11-06 00:42Z. | "Rewritten daily" is **not reliable**: one daily refresh was skipped. Latency today is **~3 days** (latest SLVR row is still 11-04 14Z), not ~2. Treat GHCNh as a lagging archive. |
| 13 | IEM `asos.py` SLET 2026-11-06..08 | 200, 0.20 s. Latest **2026-11-06 23:00Z** at ~07:30Z. | "≤ 1 h latency" holds for SLVR only. **SLET lags ~8–10 h** in both IEM and OGIMET (OGIMET 85245 latest 11-06 21Z at 07:33Z). The airport probably does not report overnight. |

## Verdict summary

| # | Claim | Verdict | Evidence (live unless noted) |
|---|---|---|---|
| 1 | OGIMET SYNOP 00 UTC sec-3 `1sTTT` / 12 UTC `2sTTT` is the primary for Tmax/Tmin | **Refuted as of today: the primary is broken right now** | **Since 2026-11-04 12Z, SLVR bulletins have no `333` section at 00Z or 12Z** (checked through 2026-11-07 06Z). The 2026-11-04 00Z bulletin is missing entirely. Across block 852, every Bolivian station shows the same pattern: 1–2 of 8 bulletins with `333` on 11-05, 0–1 on 11-06 and 0 on 11-07. The researcher's own `slvr_daily.csv` already switched silently: Tmax on Nov 3–6 is `iem_metar_biasadj`. The notes do not mention it. It may be transient (3 days so far), but it is the state today. |
| 2 | Precip via 12Z `7RRRR` > `6RRR4` > `iR=3` → 0 | **Confirmed, but the order matters more than stated** | Nov 2023 SLVR re-decoded: **19.7 mm, 30/30 days** (an exact match). SLET Nov 2023 gives 21.2 mm, which corroborates the drought. Since 2026-11-04, only the section-1 `6RRR4` path works (`60154` = 15 mm on 11-05). It must be first-class, not just "secondary". In 2012 and 2018, iR=1 is common, so section 1 is the main carrier there too. |
| 3 | OGIMET history starts 2000-01 (1995 gives "SELECT denied") | **Corrected: SLVR data starts between 1999-04 and 1999-10** (07:25Z re-check) | `block=852`, 1999-10-01..05: 200, 8.8 KB, 9 SLVR bulletins. 1999-12-01..05: 200, 23 KB, 21 SLVR plus 13 SLET bulletins. 1996-01 and 1998-01 give `503 SELECT command denied … synops2_1996_1 / 1998_1`. 1999-01 and 1999-07 returned 0 B, but 0 B also came back for a *valid* range (block 852 Nov 2023, 38 s), so the exact start is unresolved. Treat it as ≤ 1999-10. |
| 4 | OGIMET latency ~1 h | **Confirmed (1–3 h)** | At 05:40Z, SLVR had 03Z. At 05:56Z it had 03Z, and 06Z appeared by ~06:05Z. SLET was ~8 h behind (latest 21Z at 05:40Z). |
| 5 | OGIMET limits: 501 if requests come < ~10 s apart; slow requests come back empty | **Corrected: the spacing rule is needed but not enough** (07:25Z re-check: old-archive calls got 501 at 16–30 s gaps and after a 60 s pause) | A request 16 s after a 2.4 s one returned **501** (2 B). Block 852 for Nov 2023 returned **200 with 0 B after 38 s**. The same month per single station returned 200 in 3–5 s. The block query also returns duplicate bulletins (SLVR 03Z twice), so de-duplicate. |
| 6 | OGIMET licence "none stated" | **Corrected: stricter than stated** | The getsynop help page says: *"must be taken as merely informative … **No any critical mission should use this data** … © Copyright G. Ballester Valor 2005-2026"*. For a bank risk product, this is a real blocker for production use, not a footnote. |
| 7 | OGIMET gap 2007–Jun 2023 is fillable | **Confirmed** | Mar 2012: 200, 4.5 s, 242 bulletins, 30 12Z reports, 103.4 mm. Jan 2018: 200, 5.7 s, 243 bulletins, 400.9 mm (sec-1 `61184` / sec-3 `71184` agree at 118 mm on 2 Jan). |
| 8 | GHCNh SYNOP feed stops after Mar 2026, so it is unusable for recent rain | **Refuted** | FM12 (TAC) stops after March, but SYNOP continues as **FM94_1 (BUFR)**. SLVR 2026 psv (200, 1.6 s, 5.9 MB): `precipitation_24_hour` rows by month Apr–Oct are 16/5/14/5/4/8/12, all FM94_1, and hourly `precipitation` has 57–71 rows a month through Nov. SLET 2026 shows the same: p24 up to 2026-10-31 12Z, from source `WMO-85245`. The Aug 2026 values 0.3, 1.0, 33.5, 6.6 and 20.9 (on 09-01 12Z) match OGIMET exactly. **Caveat:** the FM94 p24 rows are sparse and wet-day-only. Aug 9–11 rain (11.6 / 6.6 / 1.8 mm) is missing, so missing ≠ 0. |
| 9 | GHCNh latency ~2 days, files rewritten daily | **Corrected: ~3 days at 07:30Z; the 11-07 rewrite did not happen** | SLET and SLVR 2026 both end 2026-11-04 14:00Z. All 18 BL files have LastModified 2026-11-06 00:41Z. |
| 10 | GHCNh SLVR history starts 1985 | **Corrected: 1984** | `by-year/1984/parquet/GHCNh_BLI0000SLVR_1984.parquet` returns 200; 1983 returns 404. SLET files exist from 1973. |
| 11 | GHCNh passes 911 mm (2024-01-11) through with no flag | **Confirmed, and worse** | The 2024 SLVR psv has `precipitation_24_hour` = 911.0 with **Quality_Code = 1**, FM12. ISD's legacy code 1 means "passed all QC". The GHCNh column PDF does not define the code, so that meaning is unverified here. |
| 12 | GHCNh coverage includes BLU00085245 and BLU00085196 | **Partially refuted for 2026** | The 2026 listing holds only 18 BL files: BLI0000SLVR, SLET and others, BLU085175-1 and BLM00085264. There is **no BLU00085245 or BLU00085196 in 2026**. SLET is covered by BLI0000SLET. SLCP/85196 has no 2026 GHCNh file. |
| 13 | IEM: keyless, ≤ 1 h latency, 429 on back-to-back requests | **Confirmed for SLVR** (SLET lags 8–10 h) | SLVR asos.py: 200, 0.19 s, latest 05:00Z at 05:56Z. A daily.py request 0.2 s after a 200 got **429** ("Too many requests from your IP address, slow down"), and so did the third. After a ~60 s pause, requests worked again. SLCP hourly has only ~12 obs a day (not 24/7). |
| 14 | IEM precip is always 0 and must be treated as missing | **Confirmed (with a variant)** | SLVR 2012–2026: 551 non-null values, 0 above 0. SLET 2023–2026: precip_in is **None on every row**, not 0. Treat both cases as missing. |
| 15 | IEM Tx offset +1.27 °C, Tn −0.22 °C | **Corrected: offset is smaller and depends on the period; the Tn sign convention needs confirming** | SYNOP − IEM, Tx: Mar 2012 +0.71, Jan 2018 +0.30, Nov 2023 +0.17, Aug 2026 +0.34 °C. Tn: +0.22, +0.94, +0.06, +0.07 °C (4 sample months only; if the researcher's −0.22 is added to IEM the same way +1.27 is, the sign differs, but this rests on thin evidence). A single +1.27 offset **over-corrects recent data by ~1 °C**. The current window is the one now filled from IEM: Nov 3–6 2026 Tmax 36.3 / 37.3 / 29.3 / 35.3 are likely ~1 °C too high, which inflates the heat-day counts. Day labelling is confirmed correct: shifted vs unshifted correlation is 0.98–1.00 vs 0.43–0.65. |
| 16 | IEM licence: none formal, attribution expected | **Corrected (in favour)** | disclaimer.php says: *"in the public domain and may be used freely by anyone for any lawful purpose. Attributing the IEM … would be appreciated."* Commercial use is OK. |
| 17 | GHCN-D frozen for Santa Cruz at 2025-08-21..24 | **Confirmed** | BLM00085245 ends 2025-08-24, BLM00085196 ends 2025-08-22 and BLM00085244 ends 2025-08-24 (all 200, < 1 s). ADS JSON for SLET 2025-08-15..09-10: 200, 0.27 s, last 2025-08-24. Every 2025 value has source flag `S` (GSOD). |
| 18 | SLVR PRCP absent 1999 and 2009–2018; dry days omitted after 2019 | **Mostly confirmed, overstated** | 1999 has 60 values (partial, not absent). 2009–2018 have 3–64 values a year (2010 none). After 2019 the series is *not* dry-day-free: about 35–40 % of the values present are zeros (2019: 62 zeros of 167). The days are missing a mix of dry and wet. Missing ≠ 0 stands. |
| 19 | GHCN-D 1985–1998 "dense years" are a valid precip baseline | **Plausible flaw: needs QC** | 100 % of 1985–98 SLVR PRCP has source `S`, and the readme says: *"S values derived from GTS synoptic reports … may differ significantly from 'true' daily data, particularly for precipitation (use with caution)"*. 57 % have mflag `D` (a sum of four 6-h totals) and 746 zeros have a blank mflag. Scaled annual totals range **576 mm (1985), 684 (1998), 754 (1997) up to 1,940 (1992)**. On days both stations report, SLVR is 30–45 % below SLET in 1985 (364 vs 584 mm), 1986 (430 vs 757) and 1997 (572 vs 869). These look like missing wet amounts stored as zeros. The 1,314 mm/yr mean and the p10 tails may be biased. |
| 20 | WMO OSCAR: 56 BOL stations, 6 in the farm box, keyless | **Confirmed** | 200, 2.6 s, 53 KB. Viru-Viru, El Trompillo, San Javier, Concepción, Guarayos, Vallegrande, all "operational". |
| 21 | Hail: a single station is useless (4 hail reports in ~10 y) | **Confirmed in spirit** | In 418 decoded ww groups (SLVR Mar 2012, Jan 2018, Nov 2023, Aug 2026; SLET Nov 2023): 16 thunder, **0 hail**. |
| 22 | Farm distances 11–109 km from SLVR | **Confirmed** | Recomputed: Agricola Warnes Sur ~11 km, Estancia Los Tajibos ~108 km. |
| 23 | Nov 2023 heatwave: 16–17 days ≥ 35 °C | **Confirmed** | Re-decoded 85244 Nov 2023: Tx mean 34.4 °C, max 39.1 °C, 17 days ≥ 35 °C (one edge day differs from the researcher's 16). |

## Not an error (checked)
The researcher's Aug 2026 SLVR total (82.3 mm on 29 days) differs from my 61.4 mm only by Aug 31
(20.9 mm). That amount sits in the 2026-09-01 12Z bulletin, which my pull excluded. GHCNh FM94
also has 20.9 on 09-01 12Z, so the researcher is right.

## Recommended changes
1. **Tmax/Tmin: make the OGIMET section-3 dependency detectable and promote IEM to co-primary.**
   Per day, record whether `333 1sTTT` (00Z) and `2sTTT` (12Z) are present. When they are
   absent, use the max/min of the 3-hourly SYNOP `1sTTT` (section 1) and the hourly METAR, with
   a bias offset. Surface the source on the card. SLVR has had no section 3 since 2026-11-04 12Z.
2. **Refit the IEM → SYNOP offset per year, or on the 2023–2026 overlap** (about +0.2…+0.7 °C
   Tx, about 0…+0.2 °C Tn recently). Do not use the global +1.27 / −0.22. Re-check the Nov 2026
   heat-day counts.
3. **Precip: treat section-1 `6RRR4` as a first-class path**, cross-checked against `7RRRR`
   when both exist. Keep the 250 mm/day cap. Today `6RRR4` is the only path that works.
4. **GHCNh is a live keyless precip fallback** through FM94 (BUFR), not a dead feed. Use the
   `precipitation_24_hour` rows (FM12 + FM94_1) with own QC. Never infer zeros from missing rows.
   Ignore Quality_Code = 1 as a validity signal.
5. **Precip baseline:** mark GHCN-D 1985–1998 as provisional. Add a per-year neighbour (SLET)
   ratio filter and drop 1985, 1997 and 1998 unless they pass. **Make caching OGIMET
   1999-10 → 2023-06 the first priority** (2012 and 2018 verified complete) and rebuild the
   baseline from SYNOP `iR`-aware data only.
6. **Percentiles:** with 12–17 baseline years, empirical percentiles move in ~6–8-point steps,
   and 0/100 come up often (7 of 40 months in the researcher's table). Fit a gamma/SPI per
   calendar month, or report pct-of-normal next to the percentile.
7. **Licences:** OGIMET is "not for critical missions", © held by the author. Fine for a
   hackathon demo and for validation. For a bank product, replace it with GHCNh FM94 or
   SENAMHI-direct. IEM is public domain. NOAA products are US Gov open data. The GHCN-D
   readme says nothing about WMO Res 40, so that caveat is not verified.
8. OGIMET history start: write it as **≤ 1999-10**. Block queries need de-duplication and
   per-station calls for long ranges (block calls time out with 0 B).
9. GHCNh station IDs for 2026: use **BLI0000SLVR / BLI0000SLET**. BLU00085245 and BLU00085196
   have no 2026 file.
10. (Re-check, 07:30Z) **Start the OGIMET back-fill now, and make it resumable.** Old-archive
    requests get 501 even at 30 s spacing, so the "~1–2 h job" may take longer. Store each month
    as soon as it arrives, back off for minutes after a 501, and retry later.
11. (Re-check, 07:30Z) **Show GHCNh as a lagging archive (2–3+ days)**, not as a near-real-time
    source. The daily rewrite did not happen on 11-07. Check `LastModified` before you trust the
    latest date.

## Open risks the researcher did not flag
- Bolivian SYNOP section 3 may stay off. If so, there is no Tx/Tn or `7RRRR` from OGIMET for
  any Bolivian station. Watch it for a week.
- GHCNh FM94 drops some rain days (3 of 7 in Aug 2026), so a GHCNh-only fallback undercounts.
- SLET daily data in IEM has 222 of 1,136 days with max == min (single observations), so its
  quality is worse than SLVR's.
