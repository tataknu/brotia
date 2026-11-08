# Verification: Global station archives for Chile (`chile-global-stations`)

Adversarial re-probe, 2026-11-07 08:25–08:45 UTC. Keyless only: no accounts were created and no
tokens were used. I used different stations, coordinates and date windows from the original
researcher. The probe scripts and raw files stayed in the session scratchpad. This file is the only
file written.

## Scope flag (read first)

The computed task frames the product around **Santa Cruz, Bolivia**. This family's
`coverage_santa_cruz` fields describe Chile's central valley. Santa Cruz (Colchagua) is a Chilean
wine valley, not the Bolivian soy belt. **None of these picks covers the 12 Bolivian sample farms**,
except OGIMET in general, which is a global source.

A side result from one call: OGIMET block 85 also carries **37 Bolivian SYNOP stations**.
- Viru Viru 85244 sent 7 bulletins in 21 h.
- El Trompillo 85245 sent 4.
- The 06Z Viru Viru bulletin had `iR=3`, so it carried no rain group.

That belongs to the `global-stations` / `bolivia-national` families.

## Verdict summary

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | DMC API (free token) is the way to fill the OGIMET 2001–2012 gap and the Jun 2023 / Jun 2024 holes | **corrected** | A **keyless** DMC path already fills them (see below). In documentation pages 0–32 I found **no daily-precipitation-history endpoint** in the token API. Pages 20–24 were empty, and the sibling `chile-national-met` notes list a token service with "daily precip for the last 30 y", so such an endpoint may exist. Precipitation history there is limited to 15-min EMA data per month. Temperature has a daily history per year. |
| 2 | DMC data services are blocked without a token | **confirmed** | `getDatosRecientesEma/330020` gave 200, 0.55 s, `"Este servicio ha sido bloqueda para el usuario que consulta"`. `getEstacionesRedEma` is open: 200, 0.81 s, 150 stations, even though the docs show a token in its URL. |
| 3 | DMC signup is free, approval speed untested | **confirmed** | `/application/usuario/registroUsuario` is a 200 self-service form (correo, nombres, apellidos, institución, ámbito, clave). Approval speed is still untested. |
| 4 | OGIMET keyless, ~1 h latency | **confirmed** (better) | Block 856 at 08:25Z: 200, 0.29 s, latest bulletin **08Z**, so latency is under 30 min. Block 85: 200, 0.65 s, 196 KB. |
| 5 | 85 Chilean stations on OGIMET (18–41.5 °S) | **confirmed** | Block 85, 2026-11-06 12Z → 11-07 09Z: **85 stations in 854–857**, 102 in 854–859. |
| 6 | DMC EMA stations on OGIMET only from 2021–2024 | **corrected** | Start dates differ by station and have holes. **85631 Panguilemo**: hourly in 2019-01 (167/wk), **0 in 2021-01 and 2021-07**, hourly again in 2022-01. **85704 El Huertón** is already hourly in **2022-07** (164/wk); the researcher had 2024. **85663 Retiro Copihue**: 0 in 2022-07 and 2023-01, then 142/wk in 2024-01. |
| 7 | 2001–2012: ~75 % of 00/12Z bulletins missing or NIL | **corrected (worse)** | Curicó 85629, 2008-06-01..14: 42 bulletins, **0 of 28** at 00Z or 12Z. Only 15, 18 and 21Z arrived. In that window main-hour Tmax, Tmin and 24 h rain are 100 % missing. |
| 8 | Curicó 12Z bulletins empty in Apr–Aug 2024 | **confirmed** | 2024-06-01..14: 14 of 14 12Z bulletins are `43/// /////=`. The same fortnight at **Chillán 85672 is intact** (`… 333 20087`, `60001`), so the holes are station-specific. |
| 9 | Jun 2023 flood month partial at Curicó | **confirmed** | 2023-06-20 12Z is `43/// /////=`. |
| 10 | OGIMET-derived station rain is "correct Chilean rain" | **corrected** | Against the DMC official daily table it is good when complete: Aug 2023 315.2 vs 316.8, Chillán Jun 2023 225.4 vs 225.6, Aug 2026 116.4 vs 115.8, Oct 2026 88.4 vs 88.6. It runs **10–20 % low in some "complete" months**: Chillán Jun 2024 349.3 (30/30 days) vs **387.7**, Curicó Jul 2026 208.4 vs **260.8**. In Mar 2026 it is 108.0 vs **95.0**, higher. |
| 11 | Mar 2026 Curicó 108 mm as the p90+ harvest-rain example | **corrected** | DMC table: **95.0 mm**. OGIMET and GHCNh: 108.0. The month is still extreme, but the mm value depends on the source. |
| 12 | OGIMET licence "none stated" | **corrected** | The getsynop help page has a **DISCLAIMER**: "No any critical mission should use this data". It also says "please, don't abuse", "No more than 200000 synops in a petition", and "© G. Ballester Valor 2005-2026". The home page says it runs on one PC with narrow bandwidth, using data "mainly from NOAA". No licence and no commercial-use terms are given. For a bank product, the data owner's terms (DMC) are the ones that matter. |
| 13 | OGIMET HTTP 501 sporadic even at 16–18 s | **unverifiable** | 19 getsynop calls (17 at ≥ 22 s spacing) all returned 200. No 501 was seen, so neither confirmed nor refuted. |
| 14 | 9/11 test farms have a station within 12 km | **corrected** | Using the researcher's own `farm_station_distances_km.csv`: 7 within 12 km, and 8 within 12.2 km (Requínoa 12.2). Osorno's listed nearest SYNOP is Puerto Varas at **84.9 km**. The notes credit 85782 Osorno at 7.5 km, but it sent only 7 bulletins in 54 h. So it is **8/11 plus one marginal**. |
| 15 | GHCNh keyless, latency ~2.5 days | **confirmed** | S3 list 200, 39 `GHCNh_CI*_2026.psv`, `IsTruncated=false`. Temuco CIN00380013: 200, 0.97 s, 3.7 MB, latest **2026-11-04 11Z**. Curicó SCIC: 200, 1.46 s, 5.1 MB, latest 2026-11-04 14Z. That is about 2.8–3 days. |
| 16 | No Chillán GHCNh 2026 file | **confirmed** | Prefixes `CIM00085672`, `CII0000SCCH` and `CIN0036` returned no keys for 2025 or 2026. Side note: Rancagua is `CII0000SCRG`; `CIN00340045_2026.psv` returns 404. |
| 17 | Temuco 135 mm hourly value is a mis-code | **confirmed** | 2026-08-04 00Z `precipitation=135.0`. The preceding hours since 12Z sum to about 0.4 mm, and `precipitation_24_hour` is 10.8. So it is not a since-12Z accumulation, and nothing flags it. |
| 18 | GHCNh Curicó Aug 2026: 24 h@12Z 13.8 vs OGIMET 116 means the fields disagree | **corrected** | It is a **completeness artifact**, not a value disagreement: only **7 of 31 days** have a 12Z 24 h value (Mar, Jul and Oct have 26 days each). Every other `precipitation_N_hour` column (3/6/12 h) is empty. Mar 2026 24 h@12Z = 108.0 exactly matches OGIMET. Rule: use GHCNh 24 h only on days where it is present, and mark the other days missing. |
| 19 | GHCN-D/GSOD Chilean precip undercounted, so do not use it | **confirmed** (independent) | Chillán CIM00085672 2023 GHCN-D is **219.7 mm** (343 days, source `S`). The independent DMC table gives **984.3 mm**. The record ends 2025-08-24. Nuance: it is not uniform "since 2010". 2015 = 961 mm and 2017 = 569, against 2013 = 94 and 2023 = 220. |
| 20 | Station records usable only from 2013; baseline must be gridded | **corrected** (true for OGIMET, not for DMC) | The keyless DMC annual tables `/application/anual/{aguaCaidaAnual,temperaturaMaximaAnual,temperaturaMinimaAnual}/{codigoNacional}/{year}` are complete for **Curicó 340031 in 2008**: Tmax 366/366 and Tmin 366/366 (demonstrated). Precip totals 673.9 mm, but its completeness is only inferred, because `s/p` cannot be told apart from an unreported day. The other `chile-national-met` verification shows them complete back to the 1960s. The megadrought-era argument for a fixed 1991–2020 window stays valid, but it can be met from the station itself. |
| 21 | CR2MET v2.5 ends 2021; 2.5 + 6.8 GB zips; baseline-only, too large to test | **corrected** (the Zenodo facts are right; the access path is wrong) | The Zenodo record 7529682 metadata is confirmed: CC BY 4.0, "1960–2021", 2.54 + 6.78 GB. But CR2 serves an **operational keyless mirror**: `https://ftp.cr2.cl/browse/cr2met/` with v2.5_R1, v2.5_NRT and v2.5_best. `v2.5_best/pr` has **813 monthly files from 1959-02 to 2026-10** (Last-Modified 2026-11-07 07:46Z, 9.5 MB each, NetCDF3). HTTP Range returns **206**. I read one pixel with about 30 range requests in 17 s, with no download. The Oct 2026 file runs through **day 27**, so latency is about 11 days. |
| 22 | CR2MET suitable as a baseline | **confirmed with caveat** | Pixel (−71.625, −35.425) next to Panguilemo 350028, Oct 1–27 2026: **CR2MET 144.5 mm vs DMC 83.6 mm, 1.7× wetter**. The daily timing matches: 27.8/26.8 vs 20.1/20.4 on Oct 5–6, and 19.8 vs 18.6 on Oct 20. So use percentiles of its own history, not absolute mm. Licence for the ftp NRT files was not checked; CC BY 4.0 is confirmed only for the Zenodo v2.5. |
| 23 | ERA5-Land frost/heat hit rates (27/58, 14/22, 40–50 % of hot days) | **unverifiable** | Not re-probed. The Open-Meteo shared quota is nearly exhausted. The figures are internally consistent with the notes (58/144 = 40 %, 48/97 = 49 %). |
| 24 | DMC licence | **confirmed** | The portal footer says: "Todos los datos e información publicados en este Portal son de acceso y uso público; no obstante, se solicita citar a la Dirección Meteorológica de Chile como la fuente". |
| 25 | (my own check) DMC `s/p` might hide reporting gaps | **checked, no gap found** | Curicó 340031 Jul 2024 = 0.8 mm (28 × `s/p`). The neighbours agree it was dry: Panguilemo 350028 = 1.6 mm, and Chillán 360011 = 23.8 mm, 21.2 of it on Jul 31. The ambiguity stays open in general, but this suspicious month is real. |
| 26 | GHCNh history start 1930s–1970s for airports | **unverifiable** | Not re-probed (only 2026 files fetched). |
| 27 | OGIMET history from 2000 at Curicó / Chillán | **unverifiable** (partly) | I did not re-pull 2000. The 2008-06 window shows bulletins exist but main hours are missing. |

## What should change in the recommendations

1. **Daily precip, station truth.** Make the **DMC keyless annual table** (`aguaCaidaAnual`) the
   primary. It is official, long (1960s+), and has about 1 day of latency. QC level is not stated; `chile-national-met` quotes DMC saying AWS data have no quality control yet: last
   valid day 2026-11-06, "se actualiza diariamente a las 8 AM". Demote OGIMET to the intra-day
   (hourly) and same-day fallback. Keep GHCNh as the third source, using only days that are present.
   Parsing notes:
   - `s/p` means 0 mm.
   - `.` means not yet available.
   - Missing data and 0 mm cannot be told apart, so cross-check against OGIMET wet days.
2. **Tmax / Tmin and frost / heat.** Same pattern: make the DMC `temperaturaMaximaAnual` /
   `temperaturaMinimaAnual` tables (and `anualb/monitoreoHeladasEstacion`) primary for history and
   yesterday. Use OGIMET for today and the last hours.
3. **Baseline.** A station-based 1991–2020 same-time-of-year baseline is possible at the main DMC
   stations. "Station only from 2013" is an artefact of OGIMET.
   - Keep CR2MET as the gridded per-farm baseline, but use **the ftp.cr2.cl monthly NetCDF with HTTP
     Range** (R1 + NRT, current to about 11 days), not the Zenodo zips.
   - CR2MET is about 1.7× wetter than the gauge at Panguilemo, so compare percentiles only.
4. **The DMC token API is not the gap-filler.** Its documented services are mostly recent data
   (12 h / 15-min EMA, daily summary) and daily temperature by year. The free signup is optional for
   v1.
5. **The GHCNh precip rule** should be "use the 12Z `precipitation_24_hour` only where present, and
   treat absent days as missing". It should not be "cross-check because the values disagree".
6. **Coverage** should be stated as 8/11 farms with an hourly station within about 12 km, and EMA
   OGIMET start dates as "station-specific, 2019–2024, with holes".
7. **OGIMET's own disclaimer** ("no critical mission") rules it out as the only production source
   for a bank product. Use DMC as the source of record, with attribution.
8. **Ranking conflict to reconcile.** `chile-national-met` ranks CR2MET first and the DMC tables third for per-farm daily precip. Here the DMC tables are proposed as *station truth* primary. Both can hold: CR2MET is the per-farm gridded value, and the DMC tables are the station truth used for validation and bias correction. The orchestrator should pick one framing.

## Probes run (all keyless)

| Call | Status | Latency | Note |
|---|---|---|---|
| `ogimet getsynop?block=856&begin=202611070000&end=202611071200` | 200 | 0.29 s | 10 stations, latest 08Z |
| `ogimet getsynop?block=85&begin=202611061200&end=202611070900` | 200 | 0.65 s | 196 KB; Chile 102 stations, Bolivia 37 |
| OGIMET 85631 one week each of 2010-01, 2015-01, 2019-01, 2021-01, 2021-07, 2022-01, 2022-07, 2023-01, 2023-07 | 200 ×9 | 2.3–3.3 s | 0, 0, 167, 0, 0, 167, 100, 167, 168 bulletins |
| OGIMET 85663 2022-07 / 2023-01 / 2024-01; 85704 2022-07 | 200 ×4 | 2.3–3.1 s | 0 / 0 / 142; 164 |
| OGIMET 85629 2008-06-01..14, 2024-06-01..14, 2023-06-20..27; 85672 2024-06-01..14 | 200 ×4 | 2.4–5.0 s | 42 bulletins with 0 at main hours; 12Z empty; 12Z empty on 06-20; Chillán intact |
| `ogimet.com/`, `getsynop_help.phtml.en`, `index.phtml.en` | 200 | 0.3 s | disclaimer and limits quoted above |
| DMC `getDocumento/0..32` | 200 | 1–3 s | service catalogue; no daily-precip history service found |
| DMC `getEstacionesRedEma` / `getDatosRecientesEma/330020` | 200 / 200 (blocked) | 0.8 / 0.55 s | |
| DMC `anual/aguaCaidaAnual/{340031: 2008, 2023, 2024, 2026; 360011: 2023, 2024; 350028: 2026}` | 200 ×7 | 1.5–2.1 s | 220 KB HTML each |
| DMC `anual/temperatura{Maxima,Minima}Anual/340031/2008` | 200 ×2 | 1.5–1.9 s | 366/366 days |
| DMC `usuario/loginUsuario`, `usuario/registroUsuario` | 200 | – | licence footer; signup form fields |
| GHCNh S3 list `by-year/2026/psv/GHCNh_CI` and the Chillán prefixes for 2025/2026 | 200 | 0.1–0.2 s | 39 keys; no Chillán |
| GHCNh `GHCNh_CIN00380013_2026.psv` / `GHCNh_CII0000SCIC_2026.psv` / `GHCNh_CIN00340045_2026.psv` | 200 / 200 / 404 | 0.97 / 1.46 / 0.11 s | 3.7 MB / 5.1 MB |
| GHCN-D `access/CIM00085672.csv` | 200 | 0.48 s | 1.36 MB, 1957-07-01 → 2025-08-24 |
| Zenodo `api/records/7529682` | 200 | 0.46 s | cc-by-4.0, v2.5, 2 zips |
| `ftp.cr2.cl/browse/cr2met/` and `…/v2.5_best/pr/v2.5_best_day/` | 200 | 0.6 / 2.4 s | 813 files, 1959-02 → 2026-10 |
| `ftp.cr2.cl/download/…/CR2MET_pr_v2.5_best_day_2026_10_005deg.nc` HEAD + Range | 200 / 206 | – | 9.5 MB, `CDF\x01`; pixel read in 17 s |

## Open risks after verification

- **DMC table semantics.** `s/p` (sin precipitación) cannot be told apart from an unreported day.
  Monthly totals sometimes differ from SYNOP by 10–20 %, in both directions. Which is right was not
  established; DMC is the official record.
- **HTML scraping.** The DMC annual pages are about 220 KB each and have no API contract. Cache them
  per station-year in DuckDB.
- **OGIMET** has no SLA, a "no critical mission" disclaimer, and runs on one PC. Use it as a
  fallback only.
- **The CR2MET ftp licence and terms** for the NRT/R1 files were not read. Only the Zenodo v2.5 is
  confirmed CC BY 4.0.
- **ERA5-Land station-comparison numbers** were not independently re-run.
