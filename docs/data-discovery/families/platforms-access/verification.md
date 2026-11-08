# Adversarial verification: Compute and access platforms

Second verifier pass: 2026-11-07, 07:30 to 07:45 UTC. No credentials were used and no accounts were created.
I used new coordinates. None of them is a sample farm or a point from the first pass (A and B):

- **C = (-62.80, -17.95)**, south of Las Londras. Sentinel-2 tile 20KNF, MODIS h12v10.
- **D = (-63.40, -17.35)**, near Portachuelo. Sentinel-2 tile 20KMF, MODIS h11v10.

I also used new date windows: the 2023 drought months, 2026-10-25 to 11-07, and the 1980/1981 boundary.
The probe scripts are in the session scratchpad, not here, because only this file may be written in this folder.
Where a row reuses evidence from the first pass (05:20 UTC, points A and B), it says so.

## Headline findings

1. **Open-Meteo archive is down for us right now, and our own usage caused it.**
   - At 07:41 UTC, `archive-api` and `historical-forecast-api` both returned **429 "Daily API request limit exceeded"**.
   - The headers were `X-RateLimit-Limit: 10000`, `Remaining: 0`, `Window: 86400` and `Retry-After: 58773`. The quota resets at **00:00 UTC**.
   - This is consistent with our own research agents using up the whole daily budget of weighted call units in under 8 hours. They share one IP. This is an inference, not an observation.
   - `api.open-meteo.com/v1/forecast` still answers 200, with cost 1.0. It seems to use a separate counter.
   - **Consequence:** do not call the Open-Meteo archive on the request path, even for the demo. Build the baselines once into DuckDB and the JSON snapshot, and use NASA POWER as the automatic fallback.
2. **The `where()` expression works.** The claim that it returns 500 is refuted. A one-call clear-sky NDVI recipe works on PC.
3. **CDSE Sentinel Hub allows 10,000 requests per month, not 50,000.** This was re-read live on Quotas.html. 50,000 is the limit for direct COG HTTP access.
4. **Open-Meteo's "no prototype carve-out" is wrong.** The pricing page says, verbatim: "Use the free tier for evaluation and prototyping."
5. **New:** NASA POWER solar radiation (`ALLSKY_SFC_SW_DWN`) ends on **2026-11-02**. Precipitation, temperature and `GWETROOT` end on 11-04. So FAO-56 ETo computed from POWER lags about 5 days, not about 3–4.

## Verdicts

| # | Claim | Verdict | Evidence (live this pass unless marked) |
|---|---|---|---|
| 1 | PC STAC is keyless and fast. S2 history starts 2015-10-21. Latest S2 is 2026-11-04 (2–3 day latency). | **Confirmed, with tile-dependent dates** | `POST /search` returned 200 in 0.18–0.50 s. **D/20KMF:** latest 2026-11-05 (cloud 100 %) and 11-02 (34 %); earliest **2015-08-25**. **C/20KNF:** latest **2026-11-02** (29 %). I infer from the orbit numbers that the 11-04 pass does not cover this tile; earliest 2015-10-21. CDSE returns the same latest granules. CDSE also has a **2015-10-01** scene on 20KNF that PC lacks. |
| 2 | PC S2 items carry the +1000 DN offset (baseline 04.00 or later) and expose no offset metadata. | **Confirmed. Correction: the offset is per item, not global.** | `raster:bands` is absent on PC items. The 2026 items are PB 05.13. The 2015 items are PB **02.12/03.00**. At D, the 2015-08-25 pixel has B04 = **587**. Subtracting 1000 there would give a negative reflectance, so the correction must be chosen per item by `s2:processing_baseline`. The first pass found `BOA_ADD_OFFSET -1000` in the item's `product-metadata` XML, so the offset can be discovered per item. CDSE serves 2015 as reprocessed **N0500 (PB 05.00)**, with a consistent offset across the archive. |
| 3 | PC Data API: "`where()` returned 500", so use the two-call SCL-histogram recipe. | **Refuted** | `where((SCL==4)\|(SCL==5),(B08-B04)/(B08+B04-2000.0),0);((SCL==4)\|(SCL==5))*1.0` returned **200 in 0.32–0.36 s** at both points. Only two variants fail. A `nan` fallback returns 500 with the body `Invalid band/asset name 'nan'`. A float fallback `-9999.0` with `nodata=-9999` returns 500. C, 11-02: band means 0.7617 / 0.8666, so clear NDVI = **0.879**. D, 11-02: 0.2244 / 0.4461, so clear NDVI = 0.503. The clear fraction of 0.446 agrees with the SCL categorical result: classes 4+5 = 1091/2450 at 20 m. Fully cloudy 11-05 scene: both means 0.0, so guard the division. |
| 4 | Data API point/statistics responds in about 0.5 s, keyless. | **Confirmed** | `/item/point` took 0.2–0.8 s. `/item/statistics` took 0.22–0.41 s. There are no rate-limit headers. The SAS token returned 200 in 0.12 s with no auth. |
| 5 | Offset-corrected NDVI is about 0.25 higher than raw. | **Confirmed (magnitude varies)** | C: raw 0.609 vs corrected 0.869 (+0.26). D: raw 0.220 vs corrected 0.290 (+0.07, partly cloudy). The bias is largest over dense vegetation. |
| 6 | The SCL screen "keep if >80 % class 4/5" | **Confirmed, with caveat** | C, 11-02: class 3 (**cloud shadow**) covers 327/2450 = 13 % of pixels, and the scene passes at 86.7 %. The rule must count class 3 as not clear, which it does. On scenes at 40–80 % clear, the one-call masked mean keeps data that the 80 % rule would throw away. |
| 7 | MOD13Q1 on PC matches ORNL | **Confirmed** | D, A2026273: PC `/item/point` = **5665** and ORNL = **5665** (ORNL took 5.8 s). |
| 8 | PC MODIS lags one composite (latest MOD A2026273, MYD A2026281) | **Confirmed, narrower than stated** | CMR MOD13Q1 latest is **A2026289**, produced 2026-307 (11-03), and ORNL serves it (5649 at D). PC still stops at A2026273, so **Terra lags**. **Aqua does not lag:** PC MYD A2026281 equals the CMR latest. |
| 9 | MODIS history starts 2000-02-18 | **Confirmed** | `MOD13Q1.A2000049` exists for h11v10 and h12v10. PC collection licence: "other". |
| 10 | Open-Meteo archive: keyless, 1940 start, about 7-day ERA5 lag, rate limits 600/min, 5000/h, 10000/day, 300k/month | **Corrected (material)** | This pass: **429 on archive and historical-forecast** (see headline 1). I could not re-test the 1940 start or the 7-day lag. The first pass confirmed both: 1939 returned 400; `era5` was non-null to 10-31. The terms page confirms 10,000/day, 5,000/h and 600/min. The pricing page says requests over 10 variables or over 2 weeks count as **multiple calls**. The first pass measured `X-RateLimit-Cost` = 391 for one 30-year, 5-variable request. The pricing FAQ says monthly limits "are not enforced" until a dashboard ships, so 300k/month is not a live limit. |
| 11 | `best_match` is interchangeable with ERA5 for baselines | **Refuted (first-pass evidence)** | The docs say `best_match` blends IFS HRES, ERA5 and ERA5-Land. At B, `best_match` and `era5` differed by 4.3 mm of precipitation on one day and 2.7 °C of Tmax on another. I could not re-test because of the 429. |
| 12 | Open-Meteo free tier is non-commercial with "no prototype carve-out" | **Corrected** | Terms (live): "You may only use the free API services for non-commercial purposes." Pricing (live): "**Use the free tier for evaluation and prototyping.**" The hackathon demo is allowed. A Suyana or bank production product needs a paid plan or self-hosting. |
| 13 | Standard €29 has no historical data; Professional €99 includes it | **Plan split confirmed; prices unverifiable** | Pricing says historical data needs Professional. It also states call budgets: Standard 1M/month, Professional 5M/month. The euro prices are rendered by JavaScript, so they are not in the HTML and I could not check them. `customer-archive-api` returned 401 "API key required". |
| 14 | Open-Meteo data is CC-BY 4.0 | **Confirmed** | The licence page: "API data are offered under Attribution 4.0 International (CC BY 4.0)". |
| 15 | Open-Meteo forecast reaches today | **Confirmed** | `/v1/forecast` with `past_days=3` returned 200 in 0.42 s. At C, 2026-11-07: P 33.6 mm, Tmax 31.6 °C, ETo 4.34. The forecast soil layer is named `soil_moisture_27_to_81cm` (0.145 m³/m³), not `28_to_100cm`. The 28–100 cm layer exists only in the ERA5-Land archive, which lags. |
| 16 | CDSE: STAC/OData/openEO discovery is keyless; processing needs signup | **Confirmed** | CDSE STAC returned 200 in 0.41–2.36 s. openEO capabilities returned 200 (0.74.0a4.dev20261026+283). `POST /result` returned **401** AuthenticationRequired. SH `/api/v1/statistics` returned **401**. STAC asset hrefs are `s3://eodata/...` (JP2), so pixels need S3 keys, not plain HTTP. |
| 17 | CDSE Sentinel Hub "50k requests/month, 300/min (other source says 10k)" | **Refuted: 10k is correct** | Quotas.html (live), Copernicus General Users. Requests per month: openEO "-", **Sentinel Hub 10,000**, direct COG HTTP 50,000. Requests per minute: S3 2000, openEO **12** (one request per 5 s), SH 300. PU per month: **10,000**. Footnote 15: openEO's 10,000 credits per month are a "**Temporary Boost**" (2024-09-03). |
| 18 | CDSE "commercial OK" | **Data licence confirmed; free-tier production use unverifiable** | The Sentinel data are free, full and open. Quotas.html sends users who need more capacity to "**commercial cloud credits**". I found no explicit statement that production commercial use of the free processing quota is allowed. Mark it `verified=false`. |
| 19 | PC runs under Preview terms: no SLA, not mission critical | **Confirmed (first pass, search snippet)** | `/terms` is a JavaScript shell, so it cannot be quoted from a fetch. In the collection metadata, `sentinel-2-l2a` licence = "proprietary", the STAC placeholder for the Copernicus licence. |
| 20 | Flood and land-cover collections on PC (recommendation rows) | **Confirmed, with staleness** | `sentinel-1-rtc` CC-BY-4.0, from 2014-10-10, open-ended (12-day revisit in the first pass). `jrc-gsw` **1984 to 2020**. `esa-worldcover` **2020 to 2021**. `io-lulc-annual-v02` **2017 to 2023**. These are static masks only. None of them can detect a flood in 2026. |
| 21 | NASA POWER: from 1981, about 4-day lag, licence-clean | **Confirmed, plus new lag detail** | A start of 1980-12-31 returned **422** "The data starts at 1981/01/01". At C, P, Tmax and GWETROOT end **2026-11-04**; from 11-05 the value is `-999` fill. **`ALLSKY_SFC_SW_DWN` ends 2026-11-02.** So POWER-derived FAO-56 ETo lags about 5 days. GWETROOT (0.35, a 0–1 wetness index) and Open-Meteo m³/m³ are different quantities and cannot be spliced. |
| 22 | SMAP L4 on CMR to 2026-11-04 and IMERG Late to 11-05 (Earthdata Login) | **Confirmed** | Keyless CMR, about 0.15 s. `SPL4SMGP` latest is 2026-11-04T21:00 (Vv8013). `GPM_3IMERGDL` latest is 20261105 (V07C). Downloads need Earthdata Login, which I did not test. |
| 23 | S2 fallback: Earth Search `sentinel-2-c1-l2a` COGs | **Confirmed, with a history gap** | At D: earliest **2018-01-06**, latest 2026-11-05. Response time 0.24–0.30 s. `red` `raster:bands` has `scale 0.0001, offset -0.1` on both the 2018 and the 2026 items, so the collection is consistent. It has **no 2015–2017 history**, so the MODIS cross-calibration overlap from this fallback starts in 2018. |

## Recommendation changes

1. **Open-Meteo is a cached seed, not a live dependency.**
   - Fetch each farm's 30-year baseline once with `models=era5` (P, T, ETo) and `models=era5_land` (soil moisture). Store it in DuckDB and the snapshot.
   - `era5_land` returns all-null `precipitation_sum` (first pass). Always take precipitation from `era5`.
   - Make NASA POWER the automatic runtime fallback whenever a 429 appears.
   - Throttle all team and agent traffic. Today's archive quota is already gone (it resets at 00:00 UTC).
2. **Single-model baselines.**
   - Never use `best_match` for a same-time-of-year baseline.
   - Use `best_match` or the forecast API only for the last 5–7 days of P, T and ETo, labelled "estimated".
   - **Do not fill soil moisture this way.** The forecast API has a different model and layer (`27_to_81cm`) from the ERA5-Land `28_to_100cm` baseline. Splicing them makes the latest z-scores an artefact of the model switch. Show soil moisture up to the ERA5-Land latest date only.
3. **Licence wording.** Replace "no prototype carve-out" with: "free tier explicitly allowed for evaluation and prototyping; production use needs Professional (historical) or self-hosting; prices unverified".
4. **One-call S2 statistics on PC.**
   - Request `where(clear, ndvi_corr, 0);clear*1.0` with `asset_as_band=true`. NDVI = mean₁ / mean₂.
   - Skip the scene if mean₂ < 0.2. Guard against mean₂ = 0.
   - Never use `nan` or a float `-9999.0` fallback in the expression.
   - Treat SCL 3 (cloud shadow) as not clear.
5. **Offset per item.**
   - Apply −1000 DN only when `s2:processing_baseline >= 04.00`. PC 2015–2021 items are PB 02.xx/03.xx and must not be offset.
   - For a consistent S2 history from 2015, prefer the CDSE N0500 reprocessed archive.
6. **MODIS freshness.** Use CMR to detect the newest Terra composite. Fill it from ORNL (about 5 s here, up to 60 s in the first pass, so cache only) until PC catches up.
7. **CDSE quotas.**
   - Size the processing path for 10,000 SH requests and 10,000 PU per month, and 12 openEO sync requests per minute.
   - The openEO credits are a temporary boost.
   - This is fine for 12 farms. It is not enough for a bank portfolio without commercial credits.
8. **ETo fallback lag.** POWER-derived ETo is limited by solar radiation, which lags about 5 days. Label the last 5 days "estimated", or fill them from the Open-Meteo forecast ET0.
9. **Soil-moisture fallback.** POWER `GWETROOT` is a 0–1 index. If you fall back, switch the whole baseline and z-score to POWER. Never splice it with Open-Meteo m³/m³.
10. **Flood and land-cover rows.** JRC GSW (to 2020), WorldCover (2020–21) and IO LULC (to 2023) are static context only. Current flood detection depends on S1 RTC (12-day revisit) or CDSE S1 GRD.

## Open risks

- **The Open-Meteo shared-IP quota.** Every agent and teammate behind the same NAT draws from the same 10,000 daily units. At the venue, the demo network could hit 429 at any time. The snapshot must be the default.
- The CDSE openEO and Statistical API paths are still **not tested end-to-end**, because they need signup.
- The PC Preview terms are quoted from a search snippet only.
- The Open-Meteo euro prices are unverified.
- S2 latency depends on the tile: 20KNF had no 11-04 pass. "Latest scene" must be computed per farm, not globally.
