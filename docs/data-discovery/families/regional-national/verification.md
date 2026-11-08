# Verification: regional-national family (CRC-SAS / SISSA top picks)

Second adversarial re-probe, 2026-11-07, about 07:20-07:30 UTC, from the same laptop, with no credentials and
no sign-up. Point probes used two off-farm coordinates, (-62.6, -17.1) and (-63.3, -17.5). Date windows were
2003, 2020-24, 2021-24, 2025-05 to 2026-11, and map dates 2015-10-31, 2023-10-31, 2024-12-31, 2025-02-28,
2025-05-31 and 2026-09-30. Stations checked: El Trompillo 85245, San Javier 85195, Viru Viru 85244 and
**Concepcion 85196** (the original report missed this station). Scratch files stayed in the session scratchpad.
This file replaces the earlier verification from 05:30 UTC. It overrides that file on two points: the
`distribuciones` route and how much the 2023-24 drought signal changes across stations.

Base URL: `https://dashboard.crc-sas.org/api-sissa/v0.1.0/`

## Verdict summary

| # | Claim | Verdict |
|---|---|---|
| 1 | SISSA API needs no key or auth | **confirmed** |
| 2 | The server sends no intermediate cert, so Python needs a CA-bundle fix | **confirmed**: `requests` with the default CA gives SSLError, curl works |
| 3 | Station SPI history 1942, index dates from 1947 | **corrected**: the station metadata says 1942, but index values start in 1961 |
| 4 | Bolivia stale since 2025-02-26 | **corrected** in detail: the last values differ by station and index (see table) |
| 5 | Viru Viru "has few values" | **corrected**: it has 0 index values, but raw 3-month precip mm is present |
| 6 | El Trompillo SPI-3 event 2023-10-16 to 2024-02-25, min -3.0 | **confirmed**, but -3.0 is the clip value |
| 7 | El Trompillo SPI-3 2023-10 = -1.39 (111.2 mm) | **confirmed** exactly (2023-10-31 pentad, percentile 8.2) |
| 8 | Bolivian stations with values: 21/33 in 2015-10, 10/33 in 2023-10, 0 now | **confirmed** |
| 9 | GRACE-DA point percentile: weekly, 2003-02-03 to 2026-11-02, keyless | **confirmed** |
| 10 | GRACE product labels look swapped | **confirmed and resolved**: the ids match upstream, only the Spanish `nombre` text is swapped |
| 11 | GRACE 6-9 s per year, 61 s per 10 years | **confirmed** in scale: 3.6 s for 6 months, 5.2 s for 1 year, 26 s for 5 years. The 10-year call was not repeated |
| 12 | Province NDVI series 2023-11 to 2026-10-16, resumen from 2001 | **confirmed** |
| 13 | Province NDVI "one fill row" | **corrected**: a fill value occurs every November (2023-11-17, 2024-11-16, 2025-11-17) |
| 14 | NDVI access path `distribuciones/BO/545/{prov}/ndvi` | **corrected**: 404 as written. It needs `/{historico or fecha_especifica}` and then returns a PNG only |
| 15 | SMAP point series, 3-day, 2015-04-01 to 2026-10-31 | **confirmed** |
| 16 | SMAP multi-year window fails (HTTP 500) | **corrected**: 3 years gives 200 in 40 s. Only the original 8-year window failed (not re-probed) |
| 17 | CHIRPS SPI dates 2017 to 2026-10-16 (706 dates); ESI stale at 2026-07-09 | **confirmed**. ESI history starts 2002-01-08 (1,272 dates) |
| 18 | CDI shows 0 ("no drought") for Bolivia although its SPI input is null | **confirmed** (85196 too) |
| 19 | Licence unknown, no published terms | **unverifiable**: no terms found |
| 20 | Rate limits unknown | **confirmed**: no limit headers and no 429 in about 10 fast sequential calls |
| 21 | Viru Viru 47 km and El Trompillo 64 km from the centroid | **confirmed** |

## Evidence

### Access, TLS, rate limits
- `selectores/max-fecha-con-datos`: 200 in 1.6 s, `{"fecha":"2026-11-05"}`. `selectores/estaciones/BO`:
  200 in 0.68 s, 33 stations.
- HEAD gives `405 Method Not Allowed`, `allow: GET`, `Server: uvicorn`, `x-process-time: 0.013`. There are
  no `X-RateLimit` or `Retry-After` headers.
- In Python, `requests.get(...)` with the default certifi bundle gives `SSLError`, and curl on macOS gives 200.
  The wrapper must ship the Sectigo intermediate in a custom CA bundle. Do not use `verify=False`.
- There is no OpenAPI or docs page. The routes come from the dashboard's lazy-loaded Angular chunks (listed
  in `runtime.*.js`). The routes are undocumented and can change without notice.

### Station drought indices (SENAMHI Bolivia)
Station metadata (`selectores/estaciones/BO`), distance to the 12 farms (min-max):

| Station | km to farms | Metadata start | SPI-3 non-null / 4,740 pentads | First value | First full year | Last value | Values at +/-3 cap |
|---|---|---|---|---|---|---|---|
| Viru Viru 85244 | 12-110 | 1984-08 | 0 (`mapas-de-calor` HTTP 500 for spi and spei) | n/a | n/a | n/a | n/a |
| El Trompillo 85245 | 30-127 | 1942-11 | 4,412 | 1961-03-31 | 1962 | 2025-02-28 (SPEI-6: 2025-03-10) | 7 |
| San Javier 85195 | 66-166 | 1947-04 | 3,826 (about 19% null) | 1964-03-10 | 1968 (1964-67 have 19-27 pentads, 1966 none) | 2024-12-31 (SPEI-6: 2024-02-20) | 30 |
| **Concepcion 85196** | 96-194 | 1942-11 | 4,157 | 1961-03-31 | 1962 | 2025-02-15 (SPEI-6: 2025-03-05) | 65 |

- Bulk endpoint: `informes/indices-sequia/mapas-de-calor/BO/{omm}/{spi|spei}/{k}/1` returns the full
  1961-2026 pentad series for one station, about 465 KB, in 2.8-6.7 s. Use one call per station and index.
- `mapas/spi/3/{date}`: 200 in 1.4-3.1 s, about 160 KB. Bolivian stations with an index value: 2015-10-31
  21/33, 2023-10-31 10/33, 2024-12-31 10/33, 2025-02-28 8/33, 2025-05-31 0/33, 2026-09-30 0/33. On
  2026-09-30 other countries are current (AR 72, CL 21, BR 18, UY 11, PY 9). **SENAMHI data has not reached
  SISSA since about March 2025.** This is a baseline and backtest source only.
- Viru Viru appears in `mapas` with `valor_dato` (3-month precip, mm: 69.3 on 2023-10-31 and 187.4 on
  2015-10-31), but `valor_indice` and `percentil_dato` are null. The precip totals exist, but SISSA never
  computed the index, probably because the record starts in 1984. Do not harvest it pentad by pentad
  (160 KB per call). Drop Viru Viru from the index station list.
- SPI values are clipped at +/-3.0, so treat the tails as censored.

### 2023-24 drought ground truth
- `eventos-estacion/BO/85245/spi/3/seco/-1.0/6`: 200 in 0.88 s, 52 events, the first 1962-01-06. The last is
  **2023-10-16 to 2024-02-25, 26 pentads, valor_extremo -3.0 (clip), intensity -2.15**. The heatmap agrees:
  SPI-3 is below -1 from 2023-10-20, reaches -3.00 on 2023-12-15, and recovers to -1.30 on 2024-02-25.
- **New, better magnitude target:** El Trompillo SPI-6 event **2023-11-11 to 2024-05-10, 36 pentads, minimum
  -2.94** (not clipped). SPEI-6 at El Trompillo falls to -2.31 (2024-02-20).
- **Concepcion 85196 (north-east of the farms)** has SPI-3 = -2.23 on 2023-10-31 and a 2023-10 to 2024-03
  minimum of **-3.00 (32 pentads with values)**. San Javier 85195 (north) only reaches -1.31 and is the
  outlier. Its last SPI-3 dry event is 2024-10-06 to 2024-11-05. So 2 of the 3 long-record stations around
  the portfolio (south-west and north-east) show severe drought. This corrects the earlier verification's
  view that the drought applied "to the southern farms only".
- GRACE-DA rtzsm at (-62.6, -17.1) agrees: 2023-10-16 to 2024-02-19 it is mostly 1-20th percentile (1 on
  2023-12-25 and 2024-01-01), with recovery to 26 on 2024-02-26.

### GRACE-DA soil-moisture percentiles
- `grace/comparar/rtzsm_inst/2026-11-02/2026-05-04/-62.6/-17.1`: 200 in 3.6 s, 27 weekly points, no nulls.
  Latest 2026-11-02 = 58.7.
- `.../2003-12-29/2003-02-03/-63.3/-17.5`: 200 in 5.2 s, 48 points, starts 2003-02-03. A window that starts
  in 2002-12 is **silently truncated** to 2003-02-03, with no error.
- A 5-year window (2020-01 to 2024-12): 200 in 26 s, 261 points, 1 null.
- Upstream `https://nasagrace.unl.edu/globaldata/` is keyless: 200 in 0.25 s, weekly folders 20030203 to
  20261102 (files dated 2026-11-03). `rtzsm_perc_025deg_GL_20261102.tif` is 915 KB, 0.57 s, EPSG:4326,
  0.25 deg, nodata -999.
- Label check at (-62.6, -17.1) on 2026-11-02: SISSA `rtzsm_inst` 58.7 vs upstream rtzsm 56.5. SISSA
  `sfsm_inst` 41.4 vs upstream sfsm 46.2. **The ids match the upstream variables.** Only the `nombre`
  strings in `grace/productos` are swapped ("rtzsm_inst" is labelled "superficie").
- The series is noisy week to week (for example 45 -> 18 -> 20 -> 5 in Nov-Dec 2023). Smooth it before
  using it for alerts.

### Province MODIS NDVI
- `series-temporales/BO/545/630/ndvi` (Ignacio Warnes): 200 in 0.63 s, 69 rows, 2023-11-01 to 2026-10-16.
  Latest NDVI 0.663, climatology 0.535, anomaly +0.128 (exact match with the claim). Sara 634: 0.726 /
  0.681 / +0.045. EVI works too (`.../630/evi`, 200).
- Fill rows (|x| > 1) are on **2023-11-17, 2024-11-16 and 2025-11-17** in both provinces. 2025-11-17 is
  inside the 13-month window.
- `resumen/BO/545/634/ndvi`: 200, 26 same-period box stats from 2001-10-16 to 2026-10-16. These numbers are
  the usable "distribution across years".
- `distribuciones/BO/545/630/ndvi`: 404. The chunk route is `.../distribuciones/{pais}/{adm1}/{adm2}/{indice}/{ejeTemporal}`.
  With `/historico` or `/fecha_especifica`: 200 in 2.5-2.9 s, 265-344 KB, and the body is
  `{"grafico_distribuciones": "<base64 PNG>"}`. It is an image, not data. The earlier "refuted (404)"
  verdict was wrong about the route. The practical outcome is the same: use `resumen`.
- Latency: the 2026-10-16 composite covers 10-16 to 10-31, so it is about 1 week behind the end of the period.

### SMAP, CHIRPS, ESI, CDI
- SMAP `comparar/soil_moisture_am/2026-11-03/2025-11-04/-63.3/-17.5`: 200 in 12.3 s, 121 points, 6 nulls
  (5%). Latest 2026-10-31 = 0.200 m3/m3. `smap/fechas-disponibles/soil_moisture_am`: 1,414 dates,
  2015-04-01 to 2026-10-31.
- SMAP 3-year window (2021-11 to 2024-10, at -62.6, -17.1): **200 in 40 s**, 74 KB. Get multi-year
  history in chunks of 3 years or less.
- `chirps/fechas-disponibles/spi/3`: 706 dates, 2017-01-01 to 2026-10-16. `esi/fechas-disponibles/percentiles/{4,12}`:
  1,272 dates, 2002-01-08 to 2026-07-09 (stale for about 4 months).
- `indices-cdi/resumen/BO/85196`: `valor_actual: 0` ("Sin sequia") for 2026-10-11 to 10-21, although no SPI
  exists since 2025-02. **The false "no drought" is confirmed. Reject CDI for Bolivia.**

### Licence
I searched `www.crc-sas.org/es/`, `institucional.php`, `sissa.crc-sas.org` and all 31 dashboard JS chunks for
licencia / terminos / condiciones / politica de datos / comercial. I found **no terms of use**. The station
data belongs to SENAMHI Bolivia, and GRACE-DA, SMAP, CHIRPS and MODIS are open NASA/UCSB data. For the
hackathon demo this does not block us if we attribute "CRC-SAS / SISSA, data from SENAMHI Bolivia". It is
**not cleared for production or commercial use** to a bank until CRC-SAS or SENAMHI give permission in
writing.

### Not re-probed in this run (verified=false here)
Guarayos heatmap and end date, CHIRPS `periodo` rasters, the GRACE 10-year window (61 s), the SMAP 8-year
HTTP 500, the El Trompillo 2024-10 SPI-3 value (+0.46), and the SMN Argentina obs files.

## Recommendation changes
1. **SPI baseline:** use three stations, not two. El Trompillo 85245 (1962 to 2025-02), **Concepcion 85196
   (1962 to 2025-02, fewer gaps than San Javier)** and San Javier 85195 (1968 to 2024-12, about 19% gaps).
   Do not say "1942/1947". Get them with `mapas-de-calor/BO/{omm}/{spi|spei}/{k}/1`. Treat +/-3 as censored.
   Drop Viru Viru (no index).
2. **Backtest ground truth:** use the El Trompillo SPI-3 event dates (2023-10-16 to 2024-02-25) and the
   SPI-6 event (2023-11-11 to 2024-05-10, minimum -2.94, not clipped) as the magnitude target. Use
   Concepcion's -3.0 as confirmation that the drought reached the north-east. San Javier (-1.31) shows the
   drought did not hit the northern farms equally. Pair the station signal with per-farm GRACE-DA rtzsm,
   which is at the 1st-20th percentile over the same months.
3. **Root-zone soil moisture:** use the upstream NDMC `nasagrace.unl.edu/globaldata` GeoTIFFs (keyless, under
   1 s per week, 2003 onward) as the primary GRACE-DA path. Keep the SISSA point API as the fallback. Use
   id `rtzsm_inst` and ignore `nombre`. Remember that windows before 2003 are silently truncated.
4. **SMAP through SISSA:** 3-year chunks work (about 40 s each). Still prefer upstream SMAP (other family)
   for the baseline.
5. **NDVI province validation:** drop rows with |value| > 1 (one every mid-November). Use `resumen` for the
   across-year distribution. `distribuciones` needs the `/{ejeTemporal}` suffix and returns only a PNG, so
   do not use it in the pipeline.
6. Keep CDI rejected for Bolivia. ESI is stale (2026-07-09), so do not use it for the current state.
7. **Python wrapper:** add the Sectigo intermediate to a custom CA bundle, GET only, timeout of 60 s or more
   for multi-year calls, and cache in DuckDB.
8. **Licence:** fine for the demo with attribution. Not cleared for production or commercial use.
