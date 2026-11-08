# Chile national met and gridded climate (family key: chile-national-met)

Probed 2026-11-07 (UTC morning), with no account and no key. Chile is the primary market.
Test sites are the 11 Chilean farms (Quillota to Osorno). The deep comparison site is Curicó.

## TL;DR

| Variable | Primary | Fallback | Station truth / validation |
|---|---|---|---|
| Daily precip | **CR2MET v2.5** grid, 0.05°: R1 for the baseline (1960 to P−3 months) + NRT for the current window (~10 days lag) | ERA5-Land (Open-Meteo), another family's source | DMC station annual tables (keyless scrape, 1 day lag) |
| Tmax / Tmin daily | **CR2MET v2.5 txn** (R1 + NRT, ~6 days lag) | ERA5-Land | DMC station tables; DMC frost table per station |
| ETo | **CR2MET et0** (modified Hargreaves-Samani, daily, 1959→) | FAO-56 computed from ERA5-Land | none national |
| Drought index | **CR2MET SPI/SPEI 3,6,12,24,36,48 months** (daily, v2.5_best) | Compute SPI from CR2MET pr ourselves | DMC "Monitor de Sequía" (maps only) |
| Frost / heat events | **DMC geoservicios** heat waves and cold waves for the last 90 days + daily station extremes (keyless GeoJSON) | CR2MET Tmin/Tmax percentiles | DMC `monitoreoHeladasEstacion` annual table |
| Wildfire weather | **DMC `getRiesgoIncendio`** (keyless GeoJSON, 150 stations, today + tomorrow) | — | — |

Main findings:
- **CR2MET is keyless and operational.** It has daily data from 1959 to the current month. Files are monthly NetCDF3, about 10 MB each, on `ftp.cr2.cl`. The server accepts HTTP Range requests, so a Python server can read a single pixel remotely (`netCDF4` with `#mode=bytes`) without downloading the file.
- **DMC exposes 10 GeoJSON "geoservicios" with no token.** The 7 JSON "servicios" need a free registered email and token.
- **DMC per-station annual HTML tables are a plain GET with no session.** They give daily precip, Tmax and Tmin back to the 1960s for the main stations.

## Sources probed

### 1. CR2MET v2.5 (CR2, Universidad de Chile): gridded daily pr, tmin/tmax, tmean, et0, SPI, SPEI
- Browse at `https://ftp.cr2.cl/browse/cr2met/`. Download files at `https://ftp.cr2.cl/download/cr2met/{version}/{var}/{version}_day/CR2MET_{var}_{version}_day_{YYYY}_{MM}_005deg.nc`.
  - Variable filename stems: `pr`, `tmin_tmax`, `tmean`, `et0hsm`, `spi{3,6,12,24,36,48}`, `spei{…}`.
  - Each file has a `.json` sidecar with `end_date` and `nc_file_mtime_utc`. The service can poll it cheaply for freshness.
- Grid: 0.05°, lat −56.975…−17.025 (800 cells), lon −76.975…−66.025 (220 cells). Values are int16 with scale_factor 0.01 and add_offset 300.
- Versions, from the readme `ftp.cr2.cl/download/cr2met/readme.pdf` and checked against the folder listings:

  | Version | Coverage | Notes |
  |---|---|---|
  | `v2.5` | 1960-01 → **2021-12** | Final product, with monthly anomalies adjusted to observations |
  | `v2.5_R1` | 1959-02 → **2026-07** | Not adjusted, P−3 months |
  | `v2.5_NRT` | 2022-11 → **2026-10-27** for pr, **2026-11-01** for txn | ERA5T, refreshed daily: the Oct pr file was rewritten 2026-11-07 06:02 UTC |
  | `v2.5_best` | All of the above, stitched | Also the only version with SPI/SPEI. Rebuilt monthly (files dated the 9th, the last batch on Nov 6) |

- **Probe:** remote point read at Curicó (−34.975, −71.225).
  - Opening a file takes about 1.3 s. A one-variable month takes 4–6 s, and pr+txn takes about 12 s.
  - The Oct-2026 values (mm) were 0.8, 8.7, 0.4, 0, 28.3, 36.1 and so on.
  - The global attribute `cr2met_version` shows that 2023–2024 inside `v2.5_best` is actually R1.
- **Catch:** a partial-month NRT file can be 2-D, with no time dimension, when it holds one day. The reader must handle both shapes.
- Licence: **CC-BY-4.0** (Zenodo `metadata.license.id`). Cite Boisier (2023), Zenodo DOI 10.5281/zenodo.7529682 (the v2.5 1960–2021 zips: pr 2.5 GB, txn 6.8 GB). The ftp tree has no click-through. The www.cr2.cl download page asks for name, email and institution, but the ftp link does not.
- **Homogeneity rule (important):** do not mix final v2.5 (≤2021, observation-adjusted) years into a baseline that is compared against an NRT current month. Build the same-time-of-year baseline **from v2.5_R1 only** and the current window from NRT. Both use the same calibration and neither is adjusted. Keep v2.5 final for validation and backtest only.

### 2. DMC, Dirección Meteorológica de Chile (climatologia.meteochile.gob.cl)

**a) Keyless GeoJSON geoservicios** (`/application/geoservicios/…`). All returned HTTP 200 with no token.

| Endpoint | Content | Probe |
|---|---|---|
| `getCatastroEstacionesGeo` | 712 stations (538 conventional, 136 automatic, 35 mixed), with install date | 367 KB, slow (16 s) |
| `getEmaResumenDiarioGeo` | 139 AWS: current T, RH, wind, radiation, rain yesterday, Tmax/Tmin yesterday with timestamps | 1.1 s. El Tololo: Tmin 10.1 / Tmax 16.8 on 2026-11-06 |
| `getClimatDiarioRecienteEmas` | 150 AWS: Tmax/Tmin today and yesterday, rain | 1.1 s. Encoding is double-UTF-8 mangled ("AgrÃÂ­cola") |
| `getRiesgoIncendio` | 150 stations: T, RH, wind now; max/min for today and **forecast tomorrow** | Ovalle 2026-11-07 06:45: Tmax today 25.6, tomorrow 27.6, RH min 28.7 % |
| `getOlasDeCalorRecientes` / `getOlasDeFrioRecientes` | Heat and cold wave events in the last 90 days (start, end, days over threshold, absolute max) | 6–7 s. 35 heat-wave features |
| `getBoletinPluviometricoDiarioRegional/{region}/{Y}/{M}/{D}` | Daily rain per region, DMC+FDF+INIA+DGA stations, **any historical date** | Region 6, 2023-06-23: Rancagua 12.3 mm. **FDF/INIA precip is always blank here** (checked Maule 2023-08-21: DMC 4/4 filled, FDF 0/25, INIA 0/16) |
| `getBoletinTemperaturaDiarioRegional/{region}/{Y}/{M}/{D}` | Daily Tmean/Tmin/Tmax per region, **FDF and INIA filled** | Santa Cruz FDF 2023-06-23: 14.4 / 16.1 °C |
| `getBoletinClimatologicoDiarioGeo/{Y}/{M}/{D}` | Main stations bulletin | Recent dates only: 2026-11-06 returned features; 2023 and 1995 returned 0 |

**b) Token-gated JSON servicios** (`/application/servicios/…?usuario=<email>&token=<key>`).
- Covered: recent AWS data, daily summary, station metadata, historical temperature, daily precip for the last 30 y, and the WRF point forecast.
- Without a token they return HTTP 200 with the body `{"mensaje": "Este servicio ha sido bloqueda para el usuario que consulta"}`. Exception: `getEstacionesRedEma` (the 150-station list) is open.
- Registration is free and **instant by email**. The form fields are correo, nombres, apellidos, institución, clave, ámbito and a file selector.
- The same free registration unlocks **RE3008 "Datos SACLIM – series de datos completos"**, the full historical series download. The page shows "Producto para Usuarios Registrados… puede hacerlo de manera gratuita". We did not register.
- Portal terms: "Todos los datos… son de acceso y uso público; se solicita citar a la Dirección Meteorológica de Chile".

**c) Keyless annual HTML tables (scrape).** A plain GET works; no CSRF or session is needed:
`/application/anual/{aguaCaidaAnual|temperaturaMaximaAnual|temperaturaMinimaAnual}/{codigoNacional}/{year}`
and `/application/anualb/monitoreoHeladasEstacion/{code}/{year}` (frost days, first and last frost, hours below 0 °C).
- Parser: `probes/dmc_annual.py`. The table is 31 days × 12 months.
  - **`s/p` = sin precipitación = 0 mm.** Blank or `.` = missing.
  - Risk: a month of all `s/p` cannot be told apart from an unreported dry month.
- Latency: **1 day**. The 2026 table had values through 2026-11-06 when we read it on 2026-11-07.
- Each request takes 1.3–7 s. A 30-y baseline is about 90 requests per station, so precompute it into DuckDB and never fetch it during a user request.
- History is long for the main DMC stations. Curicó 340031 was complete in 1965, 1975, 1995, 2010, 2023 and 2026.
- Old "Sendos"/DGA pluviometric stations appear only before about 1980 (for example San Luis de Talca, Parral Sendos, Padre las Casas, Osorno Ovejería: 1975 only). Their modern data sit at DGA, not DMC.
- DMC caveat on the page itself: AWS data "no cuentan por el momento con control de calidad".

### 3. CR2 station database and Explorador Climático
- `www.cr2.cl/datos-de-precipitacion/` (and temperature and streamflow pages) offer zips: `cr2_prDaily_2018.zip` (16 MB), `cr2_tasDaily_2018.zip`, `cr2_qflxDaily_2018.zip` (19 MB). They behind a usage form and are **frozen at 2018/2019**, so they are only useful as a QC'd long baseline. Not downloaded.
- `explorador.cr2.cl` is a Google-Maps UI backed by `request.php?options=<json>`.
  - `{"action":["config"]}` works with no key (0.5 s). It lists station datasets prDaily, tasDaily, tasmaxDaily, tasminDaily and qflxDaily (streamflow), with max_year 2026.
  - Our reconstructed map/series queries returned empty bodies after 10–23 s, so the UI is not usable as an API without more reverse-engineering. verified=false for data.

### 4. Comparison at Curicó, 2023–2024 (DMC 340031 General Freire Ad. as truth, 2.4 km from the site)
- Files: `probes/compare_curico.py` and `probes/stats_curico.py`. The output table is `probes/curico_2023_2024_three_source.csv` (731 days).
- **ERA5-Land via Open-Meteo could not be run today.** `archive-api.open-meteo.com` returned **429 "Daily API request limit exceeded"**, because the shared IP had used up the quota. The forecast host only allows dates from 2026-08-06 on.
  - The script requests `models=era5_land` and leaves those columns empty if the call fails. **Rerun tomorrow** to add the ERA5-Land column.
  - NASA POWER (MERRA-2-based, keyless) took the place of the global reanalysis for now.

| metric (vs DMC station) | CR2MET (R1) | NASA POWER |
|---|---|---|
| precip total 2023 / 2024 (DMC 741 / 589 mm) | 1094 / 664 (+32 % over both years) | 256 / 311 (−57 %) |
| daily precip corr, lag 0 (lag −1 / +1) | **0.89** (0.37 / 0.34) | 0.76 |
| 3-day / monthly precip corr | 0.92 / 0.94 | 0.83 / 0.90 |
| wet-day ≥1 mm POD / FAR (obs 81 days) | 0.93 / 0.29 | 0.70 / 0.31 |
| 2023-08-21 atmospheric river (DMC 150.2 mm; 20–23 Aug 203 mm) | 121.9 mm; 191 mm | 21.1 mm; 43 mm |
| Tmax bias / MAE / corr | +0.96 / 1.41 / 0.975 | +2.42 / 2.95 / 0.91 |
| Tmin bias / MAE / corr | **−2.07** / 2.24 / 0.94 | +0.89 / 2.18 / 0.80 |
| frost days Tmin<0 (obs 22) | 35 | **2** |
| hot days Tmax≥33 (obs 42) | 40 | 108 |

Reading the table:
- The daily windows line up: best lag = 0 for both sources.
- CR2MET follows daily events and extremes well. It **over-estimates rain at this pixel (+48 % in 2023, +13 % in 2024)** and has a **cold Tmin bias of about 2 °C**, so it over-counts frost.
- The coarse global reanalysis (POWER) **misses frost almost completely** (2 of 22 days) and under-catches rain by more than half. This is the main argument for CR2MET/station data in Chilean valleys.
- Use **percentiles against the source's own history**, as Suyana advises. This cancels most of these level biases. Absolute frost thresholds should be bias-corrected against the nearest DMC station.

### 5. Nearest long-record stations
Full table: `samples/nearest_dmc_stations.csv`. It is the top 6 per site from the DMC catalogue (712 DMC stations) merged with the FDF, INIA and DGA automatic stations listed in the keyless regional bulletins (regions 4, 5, 6, 7, 16, 8, 9, 14, 10). The column `dmc_annual_2024_valid_days` is what the keyless table actually returned for 2024.

**The annual tables also serve FDF and INIA stations**, with daily precip, Tmax and Tmin, even though the regional bulletin leaves their precipitation blank. This makes the dense fruit-grower network (FDF) usable without a key.

| Site | Best station with keyless daily data (code, owner, distance) | History we checked |
|---|---|---|
| Quillota | Quillota 320096 FDF (4.3 km); La Cruz 320097 FDF (5.4 km) | 2010, 2015, 2024 OK (2005 empty) |
| Ovalle | Ovalle Escuela Agrícola 300024 DMC (2.6 km) | 2010, 2024, 2025 OK; 1975/1995 empty |
| Requínoa | **Los Choapinos 340077 FDF (5.8 km)**; Rayentué 340147 INIA (5.6 km, 2024 only) | 2005, 2010, 2015, 2024 OK |
| Santa Cruz (Colchagua) | Santa Cruz 340132 FDF (6.3 km); Nancagua 2 340128 FDF (8.2 km) | 2010, 2024, 2025 OK |
| Curicó | **General Freire Ad. 340031 DMC (2.4 km)** | complete 1965→2026 |
| Talca | none of the 4 stations within 1.4 km has modern keyless data (San Luis 350005 and the regimiento have ~1975 only). Panguilemo (DMC, in the Maule bulletin) is the modern candidate | use CR2MET |
| Parral | Retiro Copihue 360047 DMC (9.7 km) | 2016→ |
| Chillán | **Bernardo O'Higgins Ad. 360011 DMC (5.9 km)**; San Nicolás 360083 FDF (9.2 km) | complete 1975→ |
| Los Ángeles | Las Viñas 370070 FDF (5.6 km); El Huertón 370036 DMC (6.8 km); María Dolores Ad. 370033 (10 km, 2010/2025 OK) | 2024 OK |
| Temuco | **Maquehue Ad. 380013 DMC (4.1 km)** | complete 1975→ |
| Osorno | Juan Kalt Bode 400013 DMC (2.7 km, 2024: 284 days); Osorno 400054 FDF (6.3 km); **Cañal Bajo Ad. 400009 (7.9 km)** | Cañal Bajo complete 1975→ |

Install dates in the DMC catalogue (for example 1903 or 1912) are catalogue claims. They do not show that the keyless tables have data that far back: the oldest year we checked was 1965.

## Recommendations for the registry
1. `precip`, `tmax`, `tmin`, `eto` and `spi`/`spei` for Chile: add a `cr2met` wrapper.
   - One-time backfill job: for each farm pixel, read R1 1991-2020 (or 1960→) into DuckDB.
   - Remote point reads are fine for a dozen farms, but each month-file costs about 4–6 s. For hundreds of farms, download each monthly file once (pr ~10 MB, txn 20.2 MB per month, sizes from the listing) and sample every farm from it.
   - Daily refresh: read the NRT `.json` `end_date` and re-pull the current month.
   - Provenance: `cr2met_version` attribute + file mtime.
2. `station_obs` (validation, bias-correction of frost thresholds, and filling the last ~10 days that CR2MET lacks): add a `dmc_annual` scraper for the DMC and FDF stations above. Do it during backfill, never during a request.
3. `frost_heat_events`, `fire_weather`: add a `dmc_geo` wrapper, polled once a day (after 08:00 local, when DMC refreshes heat and cold waves).
4. Python deps: the project `.venv` **does not have netCDF4/xarray**. The service needs **`netCDF4`**: only the netCDF-C library honours `#mode=bytes` for remote byte-range reads. `scipy.io.netcdf` can read these NetCDF3 files only after downloading them.
5. Optional free signup (instant email) for the DMC token and RE3008 full series. Not needed for v1.

## Risks / open items
- CR2MET has a pixel-level bias in valleys and foothills (+32 % rain and −2 °C Tmin at Curicó). Anomalies and percentiles are robust to it; absolute thresholds are not.
- CR2MET latency is about 10 days for pr and about 6 days for txn. Bridging the last ~10 days needs DMC stations (1 day) or a forecast/ERA5T source.
- Everything sits on one university server (`ftp.cr2.cl`) with no SLA. It was reorganised recently (`/download/cr2met/` with no file is a 404; only `/browse/` lists). Cache aggressively and keep the offline snapshot.
- DMC HTML scraping is fragile: the layout can change, the encoding is mangled in some GeoJSON, `s/p` can't be told apart from unreported months, and the AWS data has no QC.
- FDF/INIA precipitation is blank in the keyless regional bulletin, but it **is** in the annual tables. FDF history starts around 2005–2010, which is too short for a 30-y baseline on its own. The fruit-grower portals agromet.cl and agrometeorologia.cl (both HTTP 200) were not probed in depth.
- ERA5-Land bias at Curicó is still unquantified because of the Open-Meteo 429. Rerun `compare_curico.py`.
- Water availability (snowpack, reservoirs, rivers, DGA water-scarcity decrees) is outside this family. The CR2 explorer lists DGA streamflow (`qflxDaily`), and DGA `snia.mop.gob.cl/BNAConsultas/reportes` answers HTTP 200. Both deserve a dedicated probe for irrigated central-valley farms.
