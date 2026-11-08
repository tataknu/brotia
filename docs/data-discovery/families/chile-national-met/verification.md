# Verification: Chile national met and gridded climate (adversarial re-probe)

Verifier run 2026-11-07, no account, no key. I re-probed with **different coordinates and dates** from those in notes.md: Temuco Maquehue (-38.77, -72.64) for 2019, Santiago Quinta Normal 330020, Concepción 360019, Araucanía region bulletins for 2005/2012/2015/2019, and the project's own Santa Cruz (Bolivia) farms. I used a scratch venv with `netCDF4` 1.7.5 (libnetcdf 4.10.1) for remote byte-range reads.

## 0. Headline: this family does not cover the project's test farms

- The task brief and ADR-0001/0002 make **Bolivia the flagship**: all 12 sample farms are in the Santa Cruz lowlands, and the D1 backtest target is the *2023–24 Bolivian drought*. notes.md says "Chile is the primary market" and validates on "11 Chilean farms". Those farms are not in this project's portfolio.
- **CR2MET grid:** lon -76.975…-66.025, lat -56.975…-17.025, confirmed live from the file coordinates. The nearest farm is **291 km** outside the east edge. Inside the box, Bolivian Altiplano pixels (-17.97, -67.1) are masked (`--`).
- **DMC:** the nearest of its 139 AWS to any farm is Colchane, **610 km** away (the farthest farm is 700 km from any station).
- **Result:** every variable this family recommends has **zero coverage** for the 12 test farms. At best, the family is a Chile-expansion appendix. It cannot supply primary or fallback sources for v1, and it does not help the Bolivian backtest. For the farms, the "fallback" (ERA5-Land) is effectively the only candidate here, and it has its own licence problem (see section 3).

The rest of this file checks the claims on their own terms, for Chile.

## 1. CR2MET v2.5 (ftp.cr2.cl)

| Claim | Verdict | Evidence (live 2026-11-07) |
|---|---|---|
| Keyless HTTPS, Range reads, `#mode=bytes` works | **confirmed** | `/browse/cr2met/` 200 in 0.53 s. Remote `netCDF4.Dataset(url+"#mode=bytes")` opened every file in 1.3–1.7 s. `/download/…2026_11` pr json → 404 (no Nov pr file yet) |
| Versions and ranges: v2.5 1960-01→2021-12; R1 1959-02→2026-07; best to 2026-10 | **confirmed** | 744 / 810 / 813 pr files. R1 json `end_date 2026-07-31`, mtime 2026-10-08. best pr last file 2026_10; best et0 has 2026_11 |
| NRT pr latency ~10 d, refreshed daily | **confirmed** | Oct json: `end_date 2026-10-27`, mtime 2026-11-07 06:02 UTC (11 d lag; readme says "aprox. 9 días") |
| NRT txn ~6 d (2026-11-01) | **confirmed, plus a gap** | Nov txn file: time 1 = 2026-11-01. **But the Oct NRT txn and et0 files hold only 30 days (Oct 1–30): 2026-10-31 is missing.** The pr Oct file ends 10-27. The reader must detect day gaps, not just read the last date |
| Partial-month NRT file can be 2-D | **confirmed** | Nov txn/et0: `time (1,)` but `tmin (800,220)` |
| File sizes "pr ~10 MB/month, txn 20.2 MB" | **corrected** | json `nc_file_size_bytes`: NRT pr Oct = **19.2 MB** (27 days), R1 pr Jul = **22.0 MB**. pr is about 2× the claim |
| Point read ~4–6 s per var-month | **corrected** | Temuco 2019, 24 R1 var-months: **median 9.9 s, max 14.8 s** |
| `cr2met_version` attribute gives provenance | **corrected** | Missing on R1 2019 pr/txn files. The NRT et0 file says `'v2.5'`. Derive the version from the URL path instead |
| Licence CC-BY-4.0 | **corrected (only partly verified)** | Zenodo API: `license.id = cc-by-4.0`, but only for record 7529682 = **v2.5 1960–2021 zips**. The ftp readme.pdf (R1/NRT/best) has a *citation* section and **no licence statement**. CC-BY for operational files is an inference, so ask CR2 before commercial use |
| "Long homogeneous history from 1960" for baseline | **corrected** | Readme: for events before 1980 (pre-satellite) and long-term trends, "CR2MET puede presentar sesgos mayores". Use **1991–2020 or ≥1981** R1, not 1960→ |
| best mixes versions | **confirmed** | Readme priority: v2.5 → R1 → NRT. So best = obs-adjusted v2.5 up to 2021, then unadjusted. That is a homogeneity break inside the 2022 index |
| SPI/SPEI 3–48 months, daily files | **confirmed** | best/spi: spi3, 6, 12, 24, 36, 48 (4743 files, 1960-03→2026-10). spi12 Oct json end 2026-10-27, 4.9 MB. spei 3–48 present (spei3 1959-06→2026-10) |
| et0 R1/best 1959→ | **confirmed** | R1 et0hsm 1959-02→2026-07 (810 files). best et0 →2026-11 |
| Station agreement: precip daily corr ~0.89, wet bias | **confirmed (with a caveat)** | Temuco 2019 vs DMC 380013 (359 days): daily corr **0.92**, monthly **0.97**, total **+24 %** (974 vs 786 mm). The wet bias is repeated. **Caveat:** CR2MET is *calibrated on* DMC/INIA/FDF stations (readme + `obs_file MERGE5_QC_tmin_day_1979_2021.csv`), so station agreement is not an independent validation |
| Tmax corr 0.975 / Tmin 0.94; "Tmin ~2 °C cold → over-counts frost" | **refuted as a general rule** | Temuco 2019: Tmax bias -0.22, corr 0.976. Tmin bias **+0.10**, MAE 1.44, corr 0.914. Frost days Tmin<0: **CR2MET 15 vs station 34**, so it **under**-counts frost by more than half here. The bias sign is site-specific (Curicó cold, Temuco warm-ish at the low tail) |
| Values only over Chile | **corrected (caveat)** | A Mendoza (AR) pixel returned tmax 26.8 °C while `cl_mask` was masked. Apply `cl_mask` explicitly |
| Santa Cruz coverage "n/a for Bolivia" | **confirmed, and it is decisive** | See section 0 |

## 2. DMC (climatologia.meteochile.gob.cl)

| Claim | Verdict | Evidence |
|---|---|---|
| Geoservicios keyless, HTTP 200 | **confirmed** | getRiesgoIncendio 1.2 s, 150 features (`temperaturaMaximaManana` present, momento 2026-11-07 06:40). getOlasDeCalorRecientes 2.9 s, 35 features. getOlasDeFrioRecientes 2.6 s, 16 features. getEmaResumenDiarioGeo 1.3 s, 139. `application/vnd.geo+json`, no CORS header (fine server-side), no rate-limit headers |
| Heat/cold waves = last 90 d | **partly confirmed** | Starts range 2026-08-18…2026-11-03. Odd record: Arica heat wave 18-08→05-11, `diasSobreUmbral` 80. The wave definition must be read before using it as an "event" |
| Updated 08:00 local | **unverifiable** | Not observed |
| Regional bulletins: "any historical date" | **corrected** | HTTP 200 for any date, but **empty values** before ~2013–2015. Region 9 2005-07-10 and 2012-07-10: **0/58 filled (DMC 0/9)**. 2015: DMC 5/9. 2019: 8/9. 2026-11-05: 8/9. FDF/INIA precip is blank in every year tested (0/49) |
| getBoletinClimatologicoDiarioGeo only for the latest day | **corrected** | 2026-11-05 also returned 26 features. It covers recent days, not only the latest one |
| Annual HTML tables keyless, 1-day latency | **confirmed** | Santiago Q. Normal 330020 2026: last valid **2026-11-06**, 310 days, 1.5–1.9 s |
| History from 1965 (Curicó), 1975 (Temuco etc.) | **corrected: longer** | **330020: 1960 complete (366/366)**. **380013 Temuco: 1966 complete**. **360019 Concepción: 1972 complete**. 2019 at 380013: 364/365 precip |
| Licence "public use, cite DMC" | **confirmed for DMC data** | Portal footer: "Todos los datos… son de acceso y uso público; no obstante, se solicita citar a la DMC". Third-party FDF/INIA series shown through DMC may have their own terms (unverified) |
| Coverage near Bolivian farms | **refuted** | Nearest AWS 610 km |

## 3. ERA5-Land via Open-Meteo (the proposed fallback)

- **Still unusable from this IP:** HTTP 429. Headers: `X-RateLimit-Limit: 10000`, `Window 86400`, `Remaining 0`, `Retry-After 58017` s (~16 h). The quota is per shared IP, so a server on a shared host or cloud egress can lose it to other users.
- **Licence: refuted for our use.** The terms say the free API is **non-commercial only** ("You may only use the free API services for non-commercial purposes"). "Commercial products" are listed as commercial use. A bank-facing loan monitor is commercial, so production needs the paid Standard plan or a direct Copernicus CDS download (free signup, Copernicus licence allows commercial use; not tested here). A hackathon demo is arguably fine.
- **Docs:** ERA5-Land 0.1°, from 1950. This is confirmed from the docs page only, not from data.
- **Not verified:** latency (~5 d) and Chile bias. verified=false stands.

## 4. Temuco 2019 comparison (CR2MET v2.5_R1 pixel -38.775, -72.625 vs DMC 380013)

| metric | value |
|---|---|
| days compared | 359 |
| precip total CR2MET / station | 974 / 786 mm (+24 %) |
| precip daily / monthly corr | 0.92 / 0.97 |
| Tmax bias / MAE / corr | -0.22 / 0.96 / 0.976 |
| Tmin bias / MAE / corr | +0.10 / 1.44 / 0.914 |
| frost days (Tmin<0) CR2MET / station | 15 / 34 |
| remote read latency per var-month | median 9.9 s, max 14.8 s |

## 5. Recommended changes

1. **Re-scope the family.** It provides **no coverage for the 12 Santa Cruz farms**. Remove CR2MET/DMC from the v1 primary/fallback slots for precip, Tmax/Tmin, ETo and drought. Treat them as a "Chile expansion" appendix only. Bolivia needs its own family (SENAMHI Bolivia plus global gridded data).
2. **ERA5-Land via the free Open-Meteo API** cannot be the production fallback: it is non-commercial only and the shared-IP quota is already exhausted. Use CDS ERA5-Land (free registration) or a paid Open-Meteo plan. Keep the free API for the demo snapshot at most.
3. **If CR2MET is kept for Chile:**
   - Baseline from **R1 1991–2020** (not 1960→; the readme warns about pre-1980 bias).
   - Compute SPI/SPEI ourselves from R1+NRT pr. Do not use `best` SPI, which has the v2.5→R1 break at 2022.
   - Bulk-download month files (~20 MB pr, ~20 MB txn), not remote point reads (~10 s each).
   - Detect missing days (2026-10-31 is absent in NRT txn/et0).
   - Take the version from the URL path.
   - Apply `cl_mask`.
4. **Frost:** do not hard-code "CR2MET is cold, so raise the frost threshold". The bias sign flips by site (Curicó -2 °C, Temuco ~0 with half the frost days). Use percentiles, or a per-farm correction from the nearest station.
5. **DMC bulletins** are only usable from ~2015, and for DMC stations only. Historical station truth must come from the annual tables, which go back to 1960 at main stations.
6. **CR2MET licence for R1/NRT/best:** confirm with CR2 before any commercial use. CC-BY is stated only for the Zenodo v2.5 archive.
