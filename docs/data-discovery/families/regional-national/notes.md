# Family: neighbouring national / regional met services (`regional-national`)

Probed 2026-11-06 from a macOS laptop, no credentials. Farm reference points: Estancia Los Tajibos
(-62.52, -16.86) and the portfolio centroid (-62.9, -17.3). Reproduce with `probe.py` in this folder.

## Headline

1. **No neighbouring-country station is close enough to describe a Santa Cruz farm.** The nearest
   stations in Argentina, Paraguay and Brazil are 580–750 km from the farms (table below). National
   services of neighbouring countries can only be used to check results, or not at all.
2. **CRC-SAS / SISSA is the useful find in this family.** Its public dashboard has a JSON API with no
   key, which we found by reading the dashboard's JavaScript. It gives two things:
   - **(a) SENAMHI Bolivia gauge history as drought indices.** SPI/SPEI/decile/% of normal at 33
     Bolivian stations, including El Trompillo (1942–) and Viru Viru (1984–), plus a list of drought
     events per station. **Station values stop around 2025-03**, so they are a baseline and backtest
     source only, not a current-state source.
   - **(b) Regional copies of gridded products, queryable at a point:** GRACE-DA root-zone and
     surface soil-moisture percentiles (weekly, 2003–, current to 2026-11-02), SMAP soil moisture
     (3-day, 2015–, current to 2026-10-31), CHIRPS SPI, ESI, and MODIS NDVI per province with
     climatology and anomaly.
3. **Backtest bonus:** SISSA lists an SPI-3 dry event at El Trompillo (Santa Cruz city) from
   **2023-10-16 to 2024-02-25 with a minimum of −3.0**. This is the 2023–24 drought that ADR-0002
   D1 phase 2 uses for its backtest. We can use it as independent ground truth.

## Distance from the portfolio centroid (-62.9, -17.3) to the nearest stations

Taken from the CRC-SAS station list (378 stations) and the INTA SIGA station list (182 stations).

| Network | Station | km | Since |
|---|---|---|---|
| SENAMHI BO (via CRC-SAS) | Viru Viru 85244 | 47 | 1984 |
| SENAMHI BO (via CRC-SAS) | El Trompillo 85245 | 64 | 1942 |
| SENAMHI BO (via CRC-SAS) | San Javier 85195 | 123 | 1947 |
| SENAMHI BO (via CRC-SAS) | Ascención de Guarayos 85175 | 156 | 1946 |
| DMH PY | Mcal. Estigarribia 86068 | 578 | 1950 |
| SMN AR | Tartagal Aero 87022 | 599 | 1951 |
| INTA SIGA AR | Sta Victoria Oeste (Salta, Andes) | 591 | 2015 |
| INMET BR (conventional) | Cuiabá 83361 | 748 | 1911 |
| INMET BR (automatic, estimate, not verified) | Vila Bela da Santíssima Trindade MT | ~400 | n/a |

## What we probed

### CRC-SAS SISSA dashboard API: `https://dashboard.crc-sas.org/api-sissa/v0.1.0/`
- **How we found it:** the base URL is in `dashboard.crc-sas.org/sissa/assets/config/env.js`; the
  routes come from the Angular bundle. It is a FastAPI backend with no auth, no documentation, no
  published licence and no published rate limits. The bundle also mentions a `backend-dev` URL.
  It may change without notice.
- **Endpoints and results:**
  - `selectores/max-fecha-con-datos` → 200, `{"fecha":"2026-11-05"}`.
  - `selectores/estaciones/BO` → 200 in 0.55 s, 33 stations with WMO id, coordinates and start date.
  - `informes/indices-sequia/mapas/spi/3/{date}` → 200 in about 6 s, GeoJSON of all stations with
    `valor_dato` (accumulated mm), `valor_indice`, `percentil_dato`. Dates run in pentads from
    1947-01-01 to 2026-10-26.
    - **Bolivian stations with a value, by date:** 2015-10: 21/33; 2018-10: 20; 2023-10: 10;
      2025-02-26: 8; **2025-04 onward: 0**. Other countries are current (on 2026-10-26: AR 75,
      BR 18, PY 10).
    - **Viru Viru 85244 has few values even in the past.** El Trompillo 85245 and San Javier 85195
      are the reliable Santa Cruz series.
    - **Sample values, El Trompillo SPI-3:** 2023-10 = −1.39 (111 mm); 2024-10 = +0.46.
  - `informes/indices-sequia/eventos-estacion/BO/85245/spi/3/seco/-1.0/6` → 200 in 0.7 s. It
    returns 52 dry events from 1962 to 2024; the last one is 2023-10-16 to 2024-02-25, minimum −3.0.
    Saved as `sample_trompillo_spi3_dry_events.json`.
  - `informes/indices-sequia/mapas-de-calor/BO/85245/spi/3/1` → 200, 470 KB, SPI history by year
    for the same calendar period (a same-time-of-year view).
  - Products: `spi`, `spei`, `decil`, `ppn`. Time scales: 1, 2, 3, 6, 9, 12, 18, 24, 36, 48 months.
  - `informes/grace/comparar/rtzsm_inst/{date}/{date0}/{lon}/{lat}` → 200 in 5.7–8.7 s for a
    1-year window. It returns a weekly percentile time series at the farm; latest 2026-11-02 =
    52.2 at Los Tajibos. **A 10-year window also works (522 points, 61 s, 100 KB).** Saved as
    `sample_grace_rtzsm_pct_tajibos.json`.
    - The product names look swapped in the `productos` list (`sfsm` is labelled root zone and
      `rtzsm` surface). Check this against the NASA GRACE-DA source before use.
  - `informes/smap/comparar/soil_moisture_am/...` → 200 in 13–18 s for 1 year (3-day steps, m³/m³,
    latest 2026-10-31 = 0.148). **An 8-year window gave HTTP 500 after 53 s.**
  - `informes/esi/fechas-disponibles/percentiles/4` → latest 2026-07-09, about 4 months stale.
  - `informes/chirps/...` → SPI-3/6/12 rasters, 2017–2026-10-16. The `periodo` endpoints return
    base64 GeoTIFF inside JSON.
  - `informes/indices-cdi/resumen/BO/85244` → 200, CDI = 0 for 2026-10-11 to 2026-10-21 (CDI
    history starts 2022-12). **Do not trust this value.** CDI reports 0 ("no drought") for Bolivia
    even though its station SPI input is null.
  - `informes/indices-vegetacion/escala-local/series-temporales/BO/545/630/ndvi` (province Ignacio
    Warnes) → 200 in 0.56 s. It gives 16-day MODIS NDVI, climatology and anomaly from 2023-11 to
    2026-10-16; latest NDVI is 0.663, anomaly +0.128.
    - One row holds a fill value (anomaly ≈ −4.9e35), so filter |x| > 1.
    - `resumen` gives same-period NDVI distributions across years (2001…2026), which works as a
      province-level same-time-of-year baseline.
- **TLS gotcha:** the server sends only the leaf certificate (`*.smn.gob.ar` / `*.crc-sas.org`)
  without the Sectigo DV R36 intermediate. python-requests with certifi fails with
  `CERTIFICATE_VERIFY_FAILED`; curl on macOS works. `probe.py` fixes this by downloading the
  intermediate from its AIA URL and adding it to the certifi bundle. A Linux server needs the same
  fix.

### CRC-SAS web services `https://api.crc-sas.org/ws-api/`
- 401 with `WWW-Authenticate: Basic realm="CRC-SAS Web Services"`. Access needs institutional
  credentials, and we found no public signup. This is probably where the raw daily station data
  sits. Not usable without a partnership.

### SMN Argentina open data `https://ssl.smn.gob.ar/dpd/descarga_opendata.php?file=`
- `observaciones/obs20261105.txt` → 200 in 0.25 s, 12 KB, Latin-1 fixed-width text. It has daily
  Tmax and Tmin for yesterday, with **no precipitation**. Example: TARTAGAL AERO 29.4 / 18.8.
- `observaciones/datohorario20261105.txt` → 200, 190 KB, hourly temperature, humidity, pressure and
  wind, with no precipitation.
- **Archive depth we saw:** the hourly file for 2020-01-01 existed (216 KB). Hourly files for 2017
  and 2015, and daily `obs` files for 2018 and 2010, returned "El archivo no existe".
- `smn.gob.ar/descarga-de-datos` returned 403 to WebFetch.
- The nearest station is 600 km from the farms, so use this only to check a regional heat signal.

### INTA SIGA (Argentina)
- `siga.inta.gob.ar/TDNi3sjp0n5yrXGM.php?param_type=estacion&param_value=` → 200, 182 stations as
  JSON, with the latest daily data on 2026-11-05.
- The bulk series file `document/series/{id}.xls` → **403**.
- The nearest station is 591 km away, in the Andean puna, so it does not represent the lowlands.
  Rejected.

### INMET Brazil (`apitempo.inmet.gov.br`, `portal.inmet.gov.br`)
- Both hosts **reset the connection after the TLS handshake** from this network, probably a
  bot or geo block. We did not try to get around it.
- Web sources say a token from INMET is required for the station data API (not verified).
- Bulk historical ZIPs exist on the portal (not verified).
- The nearest stations are about 400 km (automatic, estimated) or 748 km (Cuiabá). Rejected for
  farm use.

### CEMADEN Brazil
- The map service endpoint we guessed returned 404, and we found no documented open API. The rain
  gauges are in Brazilian municipalities more than 400 km away. Rejected without further probing.

### Paraguay DMH
- The website returns 200. Decree 8701/2012 sets a fee for historical data: about USD 7.70 per
  parameter, per month, per station (web source, not verified).
- We found no API. The nearest station is 578 km away (Chaco). Rejected.

### CIIFEN / CRC-OSA (WMO RCC for western South America, which includes Bolivia)
- The regional drought monitor uses SPI from CHIRPS at 0.25°. It is published only as **JPEG maps**
  (`MON-SEQ_03.jpeg`, last modified 2026-11-05).
- The GeoServer WMS endpoint returned 404, and LACA&D (`lacad.ciifen.org`) has no DNS record.
- We can use the maps to check results visually, but there is no data feed.

### SENAMHI Peru
- `senamhi.gob.pe` returns 302. Peru's lowland stations (Puerto Maldonado, for example) are more
  than 800 km from the farms, so we did not go further. Rejected.

### Not pursued
NOAA GSOD for 85244/85245 (2026 file returned 404) belongs to the global-station family.

## Recommendations for the variables this family touches

| Variable | Use from this family | Role |
|---|---|---|
| Precipitation anomaly (SPI and others) | SISSA station SPI/SPEI/decile for El Trompillo and San Javier, 1942–2025-02 | **Baseline and backtest only.** Not usable for the current state; the current state comes from CHIRPS or ERA5, covered by other families. |
| Drought ground truth for the backtest | SISSA `eventos-estacion` El Trompillo, SPI-3 event 2023-10-16 to 2024-02-25 | **Validation**. Use it in the ADR-0002 phase-2 backtest. |
| Root-zone soil moisture | SISSA GRACE-DA point percentile (weekly, 2003–, latency about 1 week, already a percentile) | **Fallback** behind the primary from the soil-moisture family. Cache it, because each query takes 6–60 s. |
| Surface soil moisture | SISSA SMAP point (3-day, 2015–) | Fallback or validation. Only 1-year windows work. |
| NDVI | SISSA province NDVI anomaly | **Validation only** (province scale). |
| Tmax/Tmin, heat, frost | SMN AR daily (600 km away) | Regional validation only. Not a farm input. |
| Flood, hail, ETo, NDMI, crop calendars | No source in this family | Out of scope here. |

## Open risks
1. The SISSA API is unofficial and undocumented, and could disappear before or during the demo.
   Snapshot everything we use into DuckDB and the offline JSON.
2. SENAMHI Bolivia station data stopped reaching CRC-SAS around 2025-03. Ask the sponsor (Suyana)
   whether they get SENAMHI data directly.
3. The CDI value for Bolivia reads 0 with no input data, so it would show a false "no drought".
4. Point queries are slow (5–60 s), and the SMAP endpoint fails on multi-year windows. These are
   not live-request friendly.
5. The missing intermediate certificate breaks default Python TLS. Ship the CA-bundle fix with the
   wrapper.
6. Licence and terms of use for the SISSA API are unknown, so attribute "CRC-SAS / SISSA".
   GRACE-DA, SMAP and CHIRPS are open upstream; prefer the upstream source in production.
7. The GRACE product labels look swapped. Confirm the variable mapping before relying on it.
