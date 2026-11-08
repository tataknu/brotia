# Verification of `chile-crops-perils` findings

Adversarial re-probe on 2026-11-07, 07:40–07:52 UTC. I used different points from the researcher:
Rengo, Linares, San Clemente, Buin, Marchigüe, an Andes control point, and Red Agroclimática station
82 "Requinoa" (FDF). I also used different date windows: June 2023, the 2023-24 and 2025-26 harvest
windows, Dec 2024–Feb 2025, and May–Oct 2026. I used no keys and created no accounts. Probe scripts
are in the session scratchpad, not in this repo.

## Summary

| Claim | Verdict |
|---|---|
| INIA API v2 needs a free key and is the only way to get station data | **Corrected.** A keyless path exists: `www.agromet.cl/ext/aux/getGraphData.php`, the endpoint the agrometR package uses. |
| ERA5-Land (Open-Meteo) is a fallback for heat and frost | **Refuted** for absolute thresholds. It is fine for chill percentiles. |
| Open-Meteo is CC-BY 4.0 | **Incomplete.** The free API is for **non-commercial use only**. |
| Harvest rain of 0 mm at Requínoa is "suspicious" | **Mostly refuted.** The station also shows about 0–1 mm. |
| CR2MET v2.5 / NRT | **Confirmed.** NRT access needs a contact form. Its et0 uses a modified Hargreaves formula, not FAO-56. |
| DGA decree XLS | **Confirmed**, with three fixes: the page URL, the latest decree, and date parsing. |
| CIREN cadastre: commune-level only | **Corrected.** Rows are per property. Queries must also filter by survey year. |
| CIREN irrigated polygons | **Confirmed, with weak spots.** The point-in-polygon test fails, and there is no coverage south of Maule. |
| FAO T10/T90 for cherry, avocado −1.6 °C | **Confirmed.** |
| Cherry harvest rain of 10 mm/day and 30 mm in 3 days is an "Agroseguros rule" | **Corrected.** notes.md itself says no insurer table was found. This is the researcher's own proposal. |
| Agroseguros grape thresholds, vanazón rule, coverage dates | **Unverifiable.** The exact PDF URLs are not recorded, and the INDAP landing pages return 404. |

## 1. INIA agromet / Red Agroclimática Nacional

- `GET agromet.inia.cl/api/v2/` returned **HTTP 403** in 0.45 s. The body is a generic Apache "Forbidden"
  page. `/api/v2/estaciones` and `/api/v2/estaciones/` returned 404. The 403 does **not** prove that a
  key is needed. It only means the directory index is forbidden.
- **The "per iniamet / agrometR" source does not hold up.** `iniamet` is not on CRAN (404). The
  agrometR package (`ODES-Chile/agrometR` on GitHub) does **not** call api/v2. It calls
  `https://www.agromet.cl/ext/aux/getGraphData.php?ema_ia_id=<ema>&dateFrom=<..>&dateTo=<..>&portada=false`,
  which needs **no key**.
- **Live probe of station 82 (FDF Requínoa, about 5 km from the researcher's point):**

  | Test | Result |
  |---|---|
  | Latest data | HTTP 200 in 0.4 s. XML of the form `fecha|2026-11-04 00:00:00|1|8.800|2|0.000|3|88.500|...`. The last valid hour was **2026-11-07 02:00 local time**, probed at 07:51 UTC. The lag is **about 3 h**. |
  | History start | Data exists for 2010 and 2012–2013 but not for 2007 or 2003. History starts **between 2008 and 2010**, so it is about 16–18 seasons long. |
  | Pull size | A 3.5-month hourly pull was 190 KB and took 0.9–6 s. |
- **Caveats:**
  - The endpoint is undocumented and internal to the website. No terms of use or rate limit are
    published.
  - `agromet.cl/` itself returns 403.
  - The TLS chain is incomplete for Python `requests` (`CERTIFICATE_VERIFY_FAILED`); curl works. Fix
    this with a proper CA bundle, not with `verify=False`.
  - The endpoint pads rows out to `dateTo`, so use the last *non-NaN* value as "latest".
  - Station 227 (Anakena, Requínoa) returned only NaN rows.
  - Station 82 had 201 of 2,952 hours missing in May–Aug 2026 (7 %).
  - The station list in the package is from 2022 (417 stations). The website lists 588.
  - The variable codes (1 = mean T, 2 = precip, 7 = Tmin, 8 = Tmax) are **inferred** from the column
    order in the README. Check them against `variables_agromet.rda`.

## 2. Open-Meteo Historical (ERA5-Land)

- Today's archive probe (June 2023, Requínoa, daily) returned **HTTP 429**: "Daily API request limit
  exceeded". `historical-forecast-api` also returned 429. The forecast API still returned 200 (cell
  elevation 428 m, 1.2 mm of rain on 2026-11-06). The cap is per IP and **shared by every team agent**.
- I could not check the 1950 history start or the 5-day latency today, so both are **unverifiable**.
- **Licence:** the Open-Meteo terms say: "You may only use the free API services for non-commercial
  purposes … Less than 10'000 API calls per day, 5'000 per hour and 600 per minute". Commercial use
  needs a paid plan. That matters for a product aimed at banks. The data itself is CC-BY 4.0.
- **Data quality, checked against station 82 for the same seasons:**

  | Indicator | ERA5-Land (researcher) | Station 82 | Verdict |
  |---|---|---|---|
  | Days with Tmax ≥ 32 °C, Dec 2025–Feb 2026 | 1 (median 0) | **41** (≥ 35 °C: 8). In 2024-25: 48 (≥ 35 °C: 4). | ERA5-Land is badly cold-biased **even though the cell elevation matches**. Do not use it for absolute heat thresholds. |
  | Spring minimum, Sep–Oct 2026 | −1.6 °C | Tmin **+1.5 °C**, 0 hours ≤ −1.5 °C | ERA5-Land is colder than the station, the opposite of the claim that grids "smooth out cold-air pooling". The insurer flag at −1.5 °C would fire falsely. (One season only.) |
  | Chill hours < 7.2 °C, May–Aug 2026 | 862 h | 746 h (7 % of hours missing) | Roughly consistent, so chill percentiles are OK. |
  | Harvest rain, 15 Nov–15 Jan | 0 "mm" in every year | 1.2 mm (2023-24), 0.6 mm (2025-26), 0 days ≥ 10 mm | Near-zero rain is **real** at Requínoa. The researcher's "0 mm" was probably the count of days ≥ 10 mm. NASA POWER gives a nonzero 3-day maximum in the same script. |

## 3. CR2MET

- **Zenodo API:** HTTP 200 in 0.36 s. Record 7529682, v2.5, `cc-by-4.0`, open access. Files are
  `CR2MET_pr_v2.5.zip` (2.54 GB) and `CR2MET_txn_v2.5.zip` (6.78 GB). The concept DOI 7529681 always
  points to the latest version. **Confirmed.**
- **Readme** (`ftp.cr2.cl/download/cr2met/readme.pdf`, HTTP 200), version table:

  | Version | Period / latency | Notes |
  |---|---|---|
  | v2.5 | **1960-01-01 → 2021-01-01** | Data runs to the end of 2020. The title says "1960–2021". |
  | v2.5_R1 | P − 3 months | Operational. The researcher did not mention this version. |
  | v2.5_NRT | **2023-01-01 → P − 9 days** | Confirmed. |
  | v2.5_best | 1960 → P − 9 days | Adds `spi_x` and `spei_x`. |

  File names follow `CR2MET_${var}_${version}_day_${year}_${month}_005deg.nc`. Note that **`et0` is a
  modified Hargreaves-Samani formula, not FAO-56 Penman-Monteith**. ADR-0002 asks for FAO-56 ETo.
- **NRT access:** 11 paths built from the readme naming convention on ftp.cr2.cl all returned 404, and
  the directory listings returned 404. `www.cr2.cl/datos-productos-grillados/` returned **200** for me,
  so the researcher's 403 was intermittent. That page lists only the v2.5 and v2.0 zips plus a
  registration form ("formulario … enviar acceso"). **Confirmed:** NRT needs contact or a form.

## 4. DGA water-scarcity decrees

- **The page moved.** `dga.mop.gob.cl/decretos-de-escasez/` now redirects (301) to
  `/derechos-de-agua/proteccion-de-las-fuentes/decretos-de-escasez-2/`. Scrape the new URL for the dated
  XLS link.
- **The XLS** returned HTTP 200 in 1.17 s. It is 90,112 bytes and was last saved 2026-09-04.
  - I independently counted **249 decrees**, starting in 2008.
  - Per year: 2019: 21, 2020: 33, 2021: 38, 2022: 35, 2023: 7, 2024: 5, 2025: 6, 2026: 5. These
    match the researcher's CSV exactly.
  - Petorca 25, Quillota 14, Aconcagua 14 (area text) and Maule 19 (*region* column; 8 by area text)
    are confirmed. Cachapoal and Colchagua appear only twice each.
- **Correction:** the latest decree is **No. 185 (Choapa, 24 Jul 2026)**, followed by No. 184 (Lluta, 24
  Jul) and No. 179 (Elqui, 10 Jul). No. 177 (Limarí) is only the last *row*. The page's "vigentes"
  table lists 5 decrees in force, and it dates No. 185 as 28 Jul.
- **Parsing gotchas:**
  - Header rows repeat for each year.
  - The year column is sparse, so forward-fill it.
  - `caducidad` (expiry) is mixed: 244 values are Spanish text dates and 5 are datetimes.
- **Licence:** no data licence is stated. The only licences on the page are for WordPress and JS, so
  the licence is **unverifiable**.

## 5. CIREN-ODEPA fruit cadastre (ArcGIS, owner `ideminagri`, public)

- **Confirmed, keyless:** HTTP 200 in 0.3 s, `maxRecordCount` 2000, no geometry.
  - The O'Higgins cherry figures for 2024 reproduce exactly: drip 27,408 ha, furrow 1,371, micro-sprinkler
    1,029, rain-fed 1. The researcher left out flood irrigation (`TENDIDO`), 126 ha.
  - San Fernando, a new commune I tested: cherry 3,226 ha (2024).
  - Maule is 87 % drip and 0.01 % rain-fed (all years).
- **Correction 1, double counting.** Every region has 2–3 survey years. Without an `anoinfor` (survey
  year) filter, O'Higgins cherry drip comes out at 47,361 ha instead of 27,408. The researcher's
  "67,751 rows" for O'Higgins is 2021 + 2024 combined. Always filter to the latest survey per region,
  which varies:
  - 2024 for most regions;
  - 2025 for Valparaíso and RM;
  - 2022 for Arica, Tarapacá and Aysén.
- **Correction 2, not commune-level only.** Each row carries the property name (`nombpred`), the
  property tax roll number (ROL, `rolpredi`), the district (`numedist`) and owner type (`descsexo`). A
  lender's collateral ROL can therefore be joined for species, variety, planting year and irrigation
  method per farm. These are personal or business identifiers, so this note records no values.
- **Licence:** `copyrightText` and `licenseInfo` are empty, so the licence is unverifiable.

## 6. CIREN irrigated areas (`HIDRICO_PUBLICO`)

- **Confirmed, keyless:** about 4 s per query.
- **Coverage gap.** The layers cover only Atacama, Coquimbo, Valparaíso (2016), O'Higgins, Maule and RM.
  Ñuble, Biobío, Araucanía and Los Lagos have no area layer, so the Chillán, Los Ángeles, Temuco and
  Osorno sites get no flag.
- **The point-in-polygon test fails:**

  | Buffer | Linares | San Clemente | Rengo | Buin | Andes control | Marchigüe control |
  |---|---|---|---|---|---|---|
  | 0 m | 0 | 0 | 0 | 0 | 0 | 0 |
  | 500 m | 5 | 3 | 2 | 2 | 0 | 0 |

  The layer works only as a proximity test with a buffer. The polygons have no attributes (`objectid`
  and `id` only). `returnGeometry=true` returned no geometry, so the polygons cannot be cached locally.

## 7. Thresholds

- **FAO Frost Protection Table 4.7** (Spanish PDF, HTTP 200): Bing cherry at full bloom is −2.4 / −3.9 °C
  (T10 / T90), and the other stages match. Avocado Fuerte/Hass freezes at −1.6 °C. **Confirmed.**
- **Agroseguros/INDAP thresholds and crop calendars:** notes.md records only a glob
  (`2022-05/*.pdf`), and the INDAP service pages I tried return 404. These are **unverifiable**, and
  the missing URLs are a reproducibility defect. The cherry harvest-rain numbers (10 mm/day, 30 mm in
  3 days) are presented as an "Agroseguros rule" in the recommendations, but they are the researcher's
  own proposal (notes.md: "no insurer table found").

## Recommended changes

1. **Frost, heat and harvest rain:**
   - For the hackathon and for validation, use station data from the keyless agromet.cl endpoint,
     nearest valid station, with a NaN check.
   - For production, request the INIA API v2 key or a written OK.
   - Drop ERA5-Land and POWER as fallbacks for *absolute* heat and frost thresholds. Keep them only
     for percentiles (chill) and for flat sites validated against a station.
2. **Open-Meteo:** record the "non-commercial free tier" in the source registry, budget a paid plan for
   any bank pilot, and cache hard. The shared-IP daily cap is already exhausted today.
3. **Harvest rain:** downgrade the "0 mm suspicious" risk. Near-zero rain is real in O'Higgins
   Nov–Jan. Re-label the indicator units (days vs mm).
4. **Irrigated flag:**
   - Use CIREN with a 500 m proximity rule.
   - From Ñuble southward, fall back to the cadastre irrigation-method share or the default by crop.
   - Never treat a 0 m miss as "rain-fed".
5. **Cadastre:** always filter to the latest `anoinfor` per region. Offer a ROL join when the lender has
   the ROL. Handle the identifiers as personal data.
6. **CR2MET:** its `et0` is Hargreaves, so do not use it as FAO-56 ETo. List v2.5_R1 (P − 3 months) as
   an operational option. NRT needs the CR2 form.
7. **DGA:** scrape the new page URL, normalise `caducidad`, and read the "vigentes" table for current
   status. The XLS lags the decrees by about 6 weeks.
8. **Thresholds:** label the cherry 10/30 mm rule as our own proposal. Record exact PDF URLs for the
   Agroseguros thresholds before demo claims.
