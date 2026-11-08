# Data discovery catalog

Generated 2026-11-07 from 22 family reports (research and live verification), one critic pass and 3 follow-ups. Source notes are in `families/<key>/notes.md` and `verification.md`. Follow-ups are in `followups/`. The machine-readable version is `catalog.json`.

## Summary

Every variable the Climate Loan Monitor needs has at least one keyless, verified source in both regions, except hail. The weak points are licences, not data:

- Several primaries are fine for a hackathon demo but not for a bank product: the Open-Meteo free API, OGIMET, the FAO Crop Calendar and Meteostat.
- Several Chilean and Bolivian government sources state no licence at all.

The technical rules that apply to every family:

1. **Build each baseline and its current value from the same product stream.** Mixing streams creates false anomalies. Examples: NASA POWER switches from MERRA-2 to GEOS-IT on 2026-10-01, Open-Meteo `best_match` splices in IFS, and CHIRPS v2 has a break in the 1990s.
2. **Express anomalies as percentiles against the field's own same-time-of-year history,** not as fixed thresholds. This matches Suyana's guidance and the data. ADR-0001's `frostC = 0 °C` never fires in 35 years of lowland reanalysis, and the number of days at or above 35 °C in 2023 ranges from 29 to 97 depending on the source.
3. **Precompute every baseline into DuckDB and the offline snapshot.** Many sources throttle (CHC, OGIMET, IEM, ORNL, CIREN, Open-Meteo) or are undocumented. The Open-Meteo daily quota for the team's shared IP was used up on 2026-11-07.

What is still missing:

- **Three follow-ups were not run:**
  - 01: a licence-clean, quota-free ERA5 path, timed end to end.
  - 03: an end-to-end precipitation backtest at 3 points with the 2024/25 control season.
  - 05: Bolivian institutions INSA, the Gobernación's SAT and the SENAMHI terms of use.
- **The sample portfolio needed new field polygons.** Follow-up 02 delivered 12 verified field polygons, which replace the original points.

## Market priority

The team decision is Chile first, Bolivia second, so the Chile sections come first. Verifiers flagged one contradiction, which is listed under open questions: the ADRs, the sponsor brief and all 12 sample farms are Bolivian, and 10 of the 11 Chile test coordinates are town centres. No Chile-only source covers the Bolivian portfolio. The global satellite sources cover both countries.

## Variable to source matrix

"Commercial OK" refers to the access path we would use in production. "Demo only" means the source is allowed for evaluation or prototyping but not for a bank product. "Live" means verified live during this discovery round.

### Chile

| Variable | Primary | Fallback | Baseline (source, depth) | Resolution | Latency | Auth | Commercial OK | Live |
|---|---|---|---|---|---|---|---|---|
| Precipitation, daily (per farm) | CR2MET v2.5 R1 + NRT (ftp.cr2.cl monthly NetCDF, HTTP Range reads) | ERA5 (CDS) percentiles | CR2MET R1, 1991–2020 (not 1960–: the readme warns of pre-1980 bias) | 0.05° | NRT pr ~10 d; R1 P-3 months | none | Unresolved (CC-BY stated only for the Zenodo v2.5 1960–2021 archive) | yes |
| Precipitation, station truth | DMC annual tables `aguaCaidaAnual/{code}/{year}` (keyless HTML) | OGIMET SYNOP (validation only); GHCNh 12Z 24 h on days where present | DMC main stations, 1960s– | station | ~1 d | none | Yes, cite DMC | yes |
| Tmax / Tmin | CR2MET txn R1 + NRT, as percentiles | DMC temperature tables; RAN agromet.cl hourly | CR2MET R1, 1991–2020 | 0.05° | ~6 d | none | Unresolved | yes |
| Frost and heat hours (absolute) | RAN agromet.cl `getGraphData` hourly, nearest station 4–13 km | DMC tables + `monitoreoHeladasEstacion`; OGIMET for today | Station 2010–2025 (16 seasons), plus CR2MET percentiles | station | 1.5–2.5 h | none (undocumented; WAF; Crawl-delay 10 s) | Unresolved (no licence) | yes |
| Reference ET | In-house FAO-56 from RAN hourly (wind and radiation are hourly maxima, so expect a high bias) or CR2MET et0 | ERA5 FAO-56 (CDS or paid Open-Meteo) | CR2MET et0 1991–2020 (modified Hargreaves-Samani, not FAO-56 PM) | 0.05° / station | ~6 d | none | Unresolved | partial (INIA ETo returned 403) |
| Chill hours / portions, GDD | RAN fields 11/12, or computed in-house from hourly T | INIA `/frio_invernal/`, `/grados_dia/` (POST unverified) | Station 2010– | station | hours | none | Unresolved | partial |
| Irrigation water supply | DGA snowmelt forecast (Sep–Mar volume vs 1991–2020, deterministic ±20 %) + DGA weekly bulletin (reservoirs vs historical monthly mean; snow depth) | MODIS MOD10A2 snow-cover percentile (PC); GloFAS for large rivers only | Normals embedded in the PDFs; MODIS 2001– | basin | weekly / yearly | none | Unresolved (no licence; marked provisional) | yes |
| River discharge (observed) | DGA monthly bulletin PDF (the parser must be fixed, see corrections) | GloFAS percentile (Maule, Biobío, Ñuble, Tinguiririca only) | CR2 Explorador 1936–2020; CAMELS-CL 1913–2018 (CC-BY) | gauge | 2–6 weeks | none | Unresolved | yes |
| Water-scarcity decrees | DGA historical XLS (251 decrees, 2008–2026) + scrape of the page's "vigentes" list | Diario Oficial MOP decrees | 2008– | province / basin text | weeks | none | Unresolved (public data, no licence) | yes |
| Agricultural emergency declarations | Diario Oficial daily-index scraper + PDF "Resuelvo" parsing | Minagri / INDAP PDFs | 2016-08-17– | commune | same day | none | Yes (public legal record) | yes |
| Crop / orchard polygons | CIREN Catastro Frutícola productor layers 55–68 (geometry) | CIREN PROPIEDADES_RURALES (legal parcels); user-drawn | single vintage per region, 2022–2025 | parcel | ~3-year survey cycle | none | Unresolved (no licence) | yes |
| Orchard attributes (species, planting year, irrigation) | ODEPA Catastro Frutícola CSV (CKAN, CC-BY) | — | 1999–2025 (latest survey year per region) | commune / block | annual | none | Yes (CC-BY) | yes |
| Annual crops, vines | CIREN USO_DE_LA_TIERRA_CIREN_2 (60–68 % of annual-crop polygons in Maule and Ñuble have no species) | MapBiomas Chile (GEE only); CONAF cadastre | 2019–2026 vintages | polygon | years | none | Unresolved | yes |
| Irrigated flag | CIREN HIDRICO_PUBLICO irrigated-area polygons (500 m proximity test, never a single point) | ODEPA irrigation-method share by commune | static 2016–2022 | polygon | static | none | Unresolved | yes |
| NDVI / NDMI current | Sentinel-2 L2A, PC data API `item/statistics`, SCL mask | Earth Search c1 (3–6 h fresher; archive from 2017-11); HLS | — | 10 m | 7–11 h | none | Yes (Copernicus) | yes |
| NDVI baseline | Landsat C2 L2 (PC), calibrated to S2 per block | S2 own history 2015–; MODIS only where one pixel is ≥80 % one orchard (2–3 % of blocks) | Landsat 1984– (1,256 items at Requínoa) | 30 m | 2–10 d | none | Yes (USGS public domain) | yes |
| Wildfire burned area | GWIS/EFFIS `nrt.ba.poly` WFS (geometry union, not sum) | Copernicus EMS vectors where activated | GWIS 2012–; CONAF GEPRIF points >50 ha 2002–2024; PANGAEA 1985–2018 (CC-BY) | ~100 ha floor | ~1 d (provisional for 2–3 weeks) | none | Yes (CC BY 4.0) | yes |
| Active fire, same day | FIRMS NOAA-20/21 South America 7-day CSV | CONAF SIDCO (enrichment only, stale) | FIRMS MODIS yearly 2000–2025 | 375 m points | ~4 h | none | Yes (NASA) | yes |
| Weather warnings | DMC `datos_AAA.json` + zone GeoJSON, self-archived hourly | IFRC GO | none exists (we must archive) | forecast zone | real time | none | Unresolved (cite DMC) | yes |
| Rain at harvest | Station daily rain (DMC tables / RAN) | CR2MET NRT percentile | station history | station | 1 d | none | see above | yes |

### Bolivia

| Variable | Primary | Fallback | Baseline (source, depth) | Resolution | Latency | Auth | Commercial OK | Live |
|---|---|---|---|---|---|---|---|---|
| Precipitation, deficit / percentile | CHIRPS v3 (CHC COGs): final rnl → prelim sat → last days labelled "estimated" | ERA5 against its own ERA5 baseline (CDS / ARCO / NCAR for production); CPC Unified as a cross-check | CHIRPS v3 1991–2020 (not 1981: the series drops ~18 % pre-1991); built offline from pentads (~3.5 h for Oct–Apr) | 0.05° | final ~5 weeks; prelim ~6 d; pentad 2–4 d | none | Yes (public domain / CC BY 4.0) | yes |
| Dry spells, heavy rain | IMERG V07 Late via ClimateSERV dt 226, using its own percentile thresholds | CHIRPS v3 sat daily; ERA5 percentiles | IMERG 2000-06– | 0.1° | Late ~3 d, Early ~2 d | none | Yes (NASA); service has no SLA | yes |
| Tmax / Tmin | ERA5 daily (Open-Meteo `models=era5` for the demo) | NASA POWER (MERRA-2 period only, as-of 2026-09-30); CHIRTS-ERA5 for °C display | ERA5 1991–2020 (history from 1940) | 0.25° | ~6–7 d | none | Demo only on Open-Meteo; CDS / ARCO / NCAR are CC-BY | yes |
| Reference ET (FAO-56) | ERA5 `et0_fao_evapotranspiration` (a genuine PM: r 0.99 on recompute) | FAO-56 via `refet` on POWER with u2 derived from WS10M (never WS2M) | Same ERA5 stream | 0.25° | ~6–7 d (POWER ~5 d) | none | Demo only on Open-Meteo | yes |
| Root-zone soil moisture | ERA5-Land 0–100 cm percentile | FAO-56 bucket forced by CHIRPS (not ERA5 rain); GRACE-DA NDMC GeoTIFF percentile (keyless, weekly, 2003–); CPC monthly as a second opinion | ERA5-Land 1991–2020 | 0.1° | ~6 d | none | Demo only on Open-Meteo; CDS is CC-BY | yes |
| Actual ET / stress ratio | FAO WaPOR v3 L1 AETI / RET (polygon median, in-season only) | MODIS MOD16A2GF + MOD16A2 (ORNL) | WaPOR 2018– (z-score with sd floor) | 300 m | ~1 week | none | Yes (CC-BY, dataset) | yes |
| NDVI baseline | MODIS MOD13Q1/MYD13Q1 on PC (COG window reads) + ORNL backfill for PC holes (verified for 2025-07 → 2025-11) | ORNL subset API | 2000– (26 seasons; mask years before land clearing) | 250 m | PC ~1 composite behind LP DAAC | none | Yes (NASA) | yes |
| NDVI current | Sentinel-2 L2A via PC data API (one call, three expressions) | Earth Search c1 | Cross-calibrated to MODIS: Theil-Sen MODIS = 0.94·S2(B8A) + 0.05 (n = 308) | 10 m | 7–11 h | none | Yes | yes |
| NDMI | Sentinel-2 B8A/B11 | Landsat C2 L2 NIR/SWIR1 (Landsat NDMI = 1.030·S2 + 0.037, R² 0.996) | Landsat 1984– (5/7/8 harmonisation untested) | 10–30 m | days | none | Yes | yes |
| Observed flood | Copernicus GFM (EODC STAC + COG), with the exclusion mask read on every item | NOAA VIIRS flood map (near-real-time only; archive gap 2021-01 → 2023-07); GIBS imagery for display | GFM 2015– per-field flood frequency | 20 m | 2–6.5 h after the pass; one valid pass every 12 d | none | Yes (Copernicus) | yes |
| River discharge | GloFAS v4 (Open-Meteo Flood API) at the main-channel cell (Río Grande) as a same-week percentile | CEMS EWDS GloFAS (free key) | `consolidated_v4` 1997 → 2025-05-31 | 0.05° | daily; forecast horizon ~180 d | none | Demo only; EWDS for production | yes |
| Waterlogging proxy | Sentinel-1 RTC (PC) VV/VH anomaly on descending track 10 | GFM water extent | Own 2017– same-track history (thin in 2022–24) | 10 m | ~3 d | none (anonymous SAS) | Yes (CC-BY) | yes |
| Flood-prone / normally wet | JRC GSW occurrence (CC-BY-like) | GFM reference water mask | 1984–2021 static | 30 m | static | none | Yes (attribution) | yes |
| Frost | ERA5 Tmin percentile + hours ≤ 5 °C (a tunable display threshold) | NASA POWER; MODIS night LST as corroboration (clear on ~40–50 % of cold nights) | ERA5 1991–2020 | 0.25° / 1 km | ~6 d / 2–3 d | none | Demo only on Open-Meteo | yes |
| Heat | ERA5 heat-days and degree-hours as percentiles (never as observed counts: about 45 % low) | CHIRTS-ERA5 (public domain / CC BY) | ERA5 1991–2020 | 0.25° | ~6 d | none | see above | yes |
| Hail | **Out of scope for v1** (no observational source; rule untested) | Context only: GOES-19 GLM flashes and an "unexplained persistent NDVI drop" flag | — | — | GLM < 1 min | none | — | yes (GLM) |
| Wildfire / active fire | FIRMS MODIS yearly Bolivia 2000–2025 + NOAA-20/21 7-day NRT | FIRMS area API (free MAP_KEY) for Jan–Oct 2026; INPE monthly CSVs (up to 186 MB) | FIRMS 2000– same-season ring percentile | 375 m–1 km | ~4 h | none / free key | Yes (NASA) | yes |
| Burned area footprint | GWIS `nrt.ba.poly` (also covers Bolivia: 1.6 M ha in Aug–Sep 2019) | — | 2012– | ~100 ha floor | ~1 d | none | Yes (CC BY 4.0) | yes |
| Drought events | Our own SPI/SPEI and percentile signals for the last 3–6 months; GDO jspeS for older events | GDACS DR (context only) | jspeS 1991– (regional flag only) | 0.25° | jspeS lags 3–6 months | none | Yes (CC BY 4.0) | yes |
| Official warnings | SENAMHI active-alerts JSON (forecast, province scale), self-archived hourly | SENAMHI hydro alerts (basin text) | none (current only) | polygon | real time | none | Unresolved ("Derechos Reservados") | yes |
| Cropland mask | MapBiomas Bolivia 2024 mirror, classes {18, 39, 72} (+21 partial) | ESA WorldCover 2021 class 40; Esri/IO 2017–2023 | — | 10–30 m | annual | none | Yes (CC BY 4.0 upstream) | yes |
| Soy mask | GLAD/UMD soybean, max 2021–2023 (summer season only) | MapBiomas 2024 class 39 | 2001–2023 (the 2024 layer is unusable) | 30 m | ~19 months | none | Unresolved (no licence) | yes |
| Crop calendar | Curated table: FAO Crop Calendar API (AEZ 003) + ANAPO Memoria text, split by zone and crop | GEOGLAM CM4EW (maize, wheat) | climatological | AEZ / zone | static | none | FAO is non-commercial without permission | yes |
| Phenology / crop stage | Derived per field from its own NDVI history | MCD12Q2 (ORNL; build time only) | MOD13Q1 2000– | 250 m | — | none | Yes | partial |
| Yield truth / backtest | ANAPO Memoria 2024 (2023/24) + 2025 (control) | INE summer-campaign table (department) | INE 1984–2025 | municipality / department | annual | none | Unresolved | yes |
| Station drought truth | CRC-SAS SISSA station SPI/SPEI (El Trompillo, Concepción, San Javier) | — | 1962 → 2025-02 (no SENAMHI values after ~2025-03) | station | stale | none | Unresolved (demo with attribution) | yes |
| Station weather (validation) | OGIMET SYNOP Viru Viru 85244 / El Trompillo 85245 | IEM METAR (temperature only; public domain); GHCNh | OGIMET 1999– (cache still to build) | station | 1–3 h | none | No (OGIMET: "no critical mission") | yes |

### Global and platform

| Variable | Primary | Fallback | Notes |
|---|---|---|---|
| Latency oracle / newest granule | NASA CMR granule search (keyless) | PC STAC + blob listing | PC STAC lags and misses items; check against CMR |
| Station registry | WMO OSCAR REST; SENAMHI WFS; DMC EMA catalogue | GHCNh station list; IEM network GeoJSON | All keyless |
| Disaster index and join key | GLIDE JSON + IFRC GO + GDACS (join on GLIDE, then check hazard and date) | ReliefWeb RSS | GDACS FL/DR polygons must never be intersected with farms |
| Licence-clean ERA5 | ARCO-ERA5 Zarr (GCS, keyless, ERA5T to 2026-10-31) and NCAR `nsf-ncar-era5` (AWS) | CDS (free key) | Point-series timing not measured (follow-up 01 not run) |

## Chile national sources

| Source | What it gives | Access | Verdict |
|---|---|---|---|
| DMC annual tables (climatologia.meteochile.gob.cl) | Daily rain, Tmax, Tmin and frost events per station, 1960s–, 1-day latency | Keyless HTML GET `/application/anual/{aguaCaidaAnual\|temperaturaMaximaAnual\|temperaturaMinimaAnual}/{code}/{year}` | Primary station truth. "s/p" = 0 mm and "." = not yet. Fills the OGIMET gaps (2001–2012, Jun 2023, Jun 2024) |
| DMC geoservicios | Fire-weather risk (today and tomorrow), heat and cold waves (last 90 d), regional bulletins (usable from ~2015, DMC stations only) | Keyless GeoJSON | Primary for official heat and cold wave events |
| DMC warnings `datos_AAA.json` | Live avisos, alertas and alarmas with zone polygons | Keyless JSON | No archive anywhere (Wayback included). Start archiving hourly now. `desde`/`hasta` are Spanish free text |
| DMC token API | Recent EMA data and daily temperature history | Free self-service signup | Optional; the keyless tables cover v1 |
| CR2MET v2.5 (CR2, Universidad de Chile) | Daily 0.05° pr, Tmax, Tmin, et0, SPI/SPEI | ftp.cr2.cl monthly NetCDF3 with HTTP Range (R1 1959 → P-3 months; NRT pr ~10 d) | Per-farm gridded primary. Build baselines from R1 + NRT only: v2.5_best splices in obs-adjusted years up to 2021, which breaks homogeneity in 2022. Point reads take ~10 s per variable-month, so bulk-download months. Use `cl_mask`. The NRT file for 2026-10-31 was missing |
| RAN agromet.cl | Hourly T, rain, RH, radiation, wind, GDD10, chill hours for 442 stations, 2010– | Undocumented `getGraphData.php` | Station hourly primary for frost and heat. Missing Sectigo intermediate certificate (ship a CA bundle), WAF, `Crawl-delay: 10` |
| INIA agrometeorologia.cl | ETo, frost events, chill, GDD | HTML table POST; CSV export behind a captcha | Do not rely on it. ETo, frost and JSON paths returned 403 on the verification day. Contact INIA before automated use |
| CEAZA-Met | Coquimbo stations with ETo | REST; anonymous calls capped at 24 rows | Only with an emailed username |
| DGA (MOP) | Weekly bulletin (25 reservoirs, snow routes), monthly flow bulletin, snowmelt forecast, decree XLS, ALERTAS layer | PDFs + XLS + ArcGIS REST | No keyless live discharge (SNIA needs a login; BNA returns 403). PDFs need column-position parsers with tests |
| CIREN / ODEPA / IDE Minagri | Orchard polygons, land use, irrigated areas, wildfire scars 2024–25, rural parcels, 2017–18 insurance layer | Keyless ArcGIS 11.5 REST (~4 s per query, ~2 concurrent; errors come back as HTTP 200 with an `error` body) | Crop-mask primary. No licence stated |
| ODEPA CKAN | Catastro Frutícola blocks 1999–2025 | CSV, CC-BY | Attribute and history primary. Filter to the latest survey year per region |
| GWIS / EFFIS | Burned-area polygons 2012– | WFS (lat,lon only inside the OGC Filter Envelope; KVP bbox is lon,lat) | Fire primary for Chile and Bolivia |
| CONAF SIDCO via SENAPRED | Current-season fire perimeters | ArcGIS REST | Stale since 2026-09-08 and missing the large Jan-2026 fires. Enrichment only |
| SENAPRED alerts | Official alerts | AppSync, Cognito login (401) | Reject |
| Diario Oficial | Minagri emergencia agrícola, MOP escasez hídrica, catastrophe zones | Keyless daily index from 2016-08-17 + PDF | Only machine route to emergency declarations. Declarations state no end date, so the end date is our assumption |
| Agroseguros / INDAP policy sheets | Insurer peril definitions | PDF | Exact PDF URLs still to record before quoting thresholds |

What changes for irrigated Chilean agriculture:

- **Water supply replaces field rain as the drought driver** for irrigated fruit, vines and rice. O'Higgins cherries are 27,408 ha drip-irrigated against 1 ha rain-fed.
- **Proposed "basin water availability" composite** (a design input, not a decision): snowmelt forecast against normal, reservoirs against their historical monthly mean, snow depth or snow-cover percentile, observed monthly flow against its mean, and decree status, where an active decree sets the floor at "watch". It would gate ADR-0001's irrigated ×0.4 drought down-weighting. Rain-fed southern farms (Temuco, Osorno) keep the rain-based drought logic.
- **Signature perils are frost at bloom, rain at harvest, heat and sunburn, and chill deficit.** NDVI does not see bloom frost, cracking, hail or sunburn, so these must come from weather signals.
- **The 2026 season is split.** The north-centre is wet (snow +97 % to +485 %), yet Limarí is still under a decree. The south-centre had an above-normal peak at 31 August followed by a fast melt (Lo Aguirre SWE 339 → 94 mm in a week). That shifts the risk to January–March; it is not a snow drought.
- **Station baselines inherit megadrought bias.** Curicó averaged 602 mm/yr in 1985–2009 and 354 mm/yr in 2010–2022. Fix the baseline at 1991–2020.

## Bolivia national sources

What exists and is usable:

- **SENAMHI GeoServer WFS `senamhi:estaciones`:** keyless, 2,024 stations, 147 in Santa Cruz. Use it for "nearest official station" provenance and for the `senamhi:municipio` intersect. Do not filter on `clasificacion` (112 of 147 are null), and de-duplicate the "(F)" records.
- **SENAMHI active weather alerts JSON:** keyless polygons. These are forecast warnings at province scale, not observed events. Type 28 is a cold front, not frost. There is no archive, so snapshot at most once an hour. The backend sends `X-RateLimit-Limit: 100`. The terms say "Derechos Reservados" and the terms link is a placeholder.
- **SENAMHI hydro alerts:** cover the Santa Cruz basins (Piraí, Yapacaní, Ichilo). Strip the base64 images before storing.
- **SENAMHI monthly climate-summary PDFs and the dekadal agromet bulletin:** validation only.
- **INE yields:** use the summer-campaign table (soy 2023/24 = 1,815 kg/ha). The blended agricultural-year table includes the previous winter campaign. Latency swings from 1 s to 70 s, so snapshot it.
- **ANAPO Memoria 2024 and 2025:** municipal truth for 2023/24 (Pailón 0.42 t/ha and 349 mm; Cuatro Cañadas 0.55 t/ha; Zona Este 455 mm against 899 mm the year before) and 2024/25 as the control year (Este 892 mm, 2.31 t/ha). Only three soy farms have a municipal match; score the rest against zone averages.
- **CRC-SAS SISSA (undocumented API):** SENAMHI station SPI/SPEI for El Trompillo 1962 → 2025-02, Concepción 1962 → 2025-02 and San Javier 1968 → 2024-12. Drop Viru Viru, which has no index values. The 2023/24 event at El Trompillo runs 2023-10-16 to 2024-02-25 (SPI-3, clipped at −3.0). The SPI-6 event runs 2023-11-11 to 2024-05-10 with a minimum of −2.94. Python needs the Sectigo intermediate certificate added to the CA bundle.
- **Gaceta Oficial Santa Cruz decrees:** PDFs for manual curation of emergency declarations.

What is not usable:

- SENAMHI observations sit behind an undocumented backend; the official route is a data request to dirmethi@senamhi.gob.bo.
- The SENAMHI drought monitor returned HTTP 500.
- These hosts fail DNS publicly (1.1.1.1 and 8.8.8.8): GeoBolivia (geo.gob.bo), MDRyT Observatorio, SIAPRO, ruralytierras, SENAMHI onsc and ABT SIMB.
- VIDECI and SENASAG return 403 to scripts.
- DesInventar ends in 2015.
- The CAO statistics are paid.

Never probed: INSA, the Gobernación de Santa Cruz SAT/COED, and the SENAMHI terms page (follow-up 05).

Nearest stations with long records:

| Station | Distance to farms | Record | Current public data |
|---|---|---|---|
| Viru Viru 85244 / SLVR | 11–109 km | 1984– (GHCN-D precipitation sparse) | OGIMET SYNOP, IEM METAR, GHCNh |
| El Trompillo 85245 / SLET | 30–127 km (urban) | 1942/1958– | OGIMET, IEM (lags 8–10 h), GHCNh |
| Okinawa I (TP) | 5–8 km | 1975–, active | Data request only |
| Minero / Unagro (TP) | ~11 km | 1975–, active | Data request only |
| San Julián (P) | ~10 km | 1973– | Data request only |
| Concepción 85196 | 96–194 km | SPI 1962 → 2025-02 | via SISSA |
| Cuatro Cañadas CEA-2 / San Julián Los Ángeles (automatic) | 10–22 km | 2019–2020 (too short) | none |

There is no WMO station in the eastern soy belt or in Okinawa.

## Station histograms and climatology

Bolivia, Viru Viru (OGIMET + GHCN-D):

- Mean annual rain is 1,314 mm. This is provisional: the 1985–1998 GHCN-D source-S values store some wet days as zero.
- The 2023/24 drought is clear:
  - every month from Jul 2023 to Mar 2024 was below the 40th percentile;
  - Nov 2023 had 19.7 mm, the 0th percentile and 18 % of normal;
  - Tmax was +1.4 to +2.3 °C above normal from Oct 2023 to Mar 2024;
  - Nov 2023 had 17 days at or above 35 °C, with 38–39 °C peaks.
- Frost: Tmin ≤ 5 °C occurs at most ~0.3 days/month (June) over 1991–2020. GSOD shows Tmin ≤ 5 °C on 4 days in 15 years.
- ERA5 against stations:
  - Tmin runs +1.1 °C (El Trompillo) to +2.0 °C (SLVR) warm on the coldest 2 % of nights, but ranks agree (r 0.95, 77 % hit rate on the coldest 5 %);
  - ERA5 undercounts days at or above 35 °C by 1.2–3.7× (2023: 50 against 77);
  - ERA5-Land is worse than ERA5 for heat.

Chile (DMC / OGIMET):

- Curicó's normal depends on the era: 602 mm/yr in 1985–2009 against 354 mm/yr in 2010–2022, so the same month can rank at the 27th or the 67th percentile depending on the baseline.
- ERA5 rain is 53–68 % wetter than the gauges, though the monthly pattern correlates at r 0.95–0.98.
- ERA5-Land runs ~2 °C cold on summer Tmax: 58 against 144 hot days at Curicó, and 30 against 58 frost nights at Chillán.
- At Requínoa, ERA5-Land gave 1 day at or above 32 °C in Dec–Feb, against 41 at the station.
- CR2MET bias depends on the site: +32 % rain at Curicó and +24 % at Temuco. Tmin bias is −2.1 °C at Curicó and +0.1 °C at Temuco, so CR2MET over-counts frost at one and under-counts at the other.

How we use stations:

- Validation and the trust panel ("nearest official station, distance, record start").
- Monthly bias correction of gridded Tmax/Tmin before any absolute-°C display or count.
- Sign and percentile checks of gridded rain.
- In Chile, per-farm hourly frost and heat where a station lies within ~12 km (8 of 11 Chile test sites).
- Stations are never the per-farm rain primary in Bolivia, where the nearest gauge is 11–110 km away and convective rain is not representative at that distance.

## Satellite imagery and NDVI pipeline

**Access (all keyless):**

- **Planetary Computer.** STAC search, anonymous SAS tokens (the container token `modiseuwest/modis-061-cogs` for MODIS; refresh at ~40 min, because the usable life is ~45 min) and the data API `item/statistics`.
- **Earth Search c1** as the Sentinel-2 failover.
- **ORNL subset REST** to backfill MODIS (budget up to ~25 s per call).
- **NASA CMR** to find the newest granule.

**Sentinel-2 current value, one call per scene:**

```
where((SCL==4)|(SCL==5)|(SCL==6), (B8A-B04)/(B8A+B04-2000), 0); ...NDMI...; clear*1.0 (+B04*0 to force the 10 m grid)
```

- The `-2000` term is the two −1000 DN offsets. Include it only when the offset applies to that item (see the rule below); otherwise use 0.
- The `+B04*0` term forces the clear count onto the 10 m grid. Without it, an SCL-only expression is evaluated at 20 m.
- NDVI = mean1 / mean2. Skip the scene if the clear fraction is below 0.5. Treat SCL 3 (shadow) as not clear.
- Never pass `nodata=-9999` or a NaN fallback; both return HTTP 500.

**DN offset rule (verified):**

- Planetary Computer: subtract 1000 only when `s2:processing_baseline ≥ 04.00`, keyed on the item, not the date. PC holds 04.00/05.00 reprocessings dated 2019 and 2021 next to the 02.xx/03.00 originals.
- Earth Search c1: always subtract 1000 (reprocessed to ≥ 05.00 back to 2018).
- Legacy Earth Search `sentinel-2-l2a`: never subtract, even though its metadata declares −0.1.

**Deduplication:**

- Same datatake: keep the highest baseline or latest generation time.
- Different datatakes on the same date and tile: keep the scene with the most valid polygon pixels, then the best clear fraction.
- MODIS on PC: deduplicate on (product, AYYYYDDD, tile) and keep the newest production timestamp. Filter by id prefix (`MOD13Q1.`), never by `platform`, which is empty on many items.

**MODIS baseline:**

- MOD13Q1 2000– on PC, one COG window per tile (h11v10, h12v10) per composite over the portfolio bbox; ~2,500 reads as a bootstrap prefetch.
- Mask: `pixel_reliability` 0/1. Strict mode also drops VI_Quality bits 8, 10 and 15 and usefulness ≥ 12.
- Field value: median of pixels whose centre lies inside the polygon.
- Mark a composite missing if the good fraction is below 0.5, and report `n_years` per composite.
- Mask baseline years before land clearing (MCD12Q1).
- Gaps: PC has a hole from 2025-07-03 to 2025-11-16 plus scattered composites. Fill from blob URLs built from CMR ids, then from ORNL (verified for all 8 composites). There is no keyless fill for MCD43A4 or MOD11A1 in that window.

**Cross-calibration (follow-up 04, verified):**

- Fit on Sentinel-2 16-day maximum-value composites aligned to the MOD13Q1 dates.
- MODIS = 0.940·S2(B8A) + 0.048 (Theil-Sen); R² 0.899, RMSE 0.050, n = 308, 3 cropland points, 2019–2026.
- B8A beats B08 (mean bias +0.022 against +0.052).
- Fit per farm once a farm has ≥ 30 pairs. The wet-season slope is lower (0.85).
- NDMI: Landsat = 1.030·S2(B8A/B11) + 0.037.

**Chile specifics:**

- MODIS 250 m fits only 2–3 % of orchard blocks (median block 1.2–3.6 ha), so the Chile baseline is Landsat C2 L2 calibrated per block, plus Sentinel-2's own history from 2015.
- Deciduous crops: score only Oct–Apr, because winter NDVI measures the inter-row cover crop.
- Evergreen crops: score Dec–Apr with an sd floor of 0.03–0.04.
- Young orchards trend upwards, so detrend their baseline or use the last 3 seasons.
- Gate CIREN blocks with a still-an-orchard check (recent peak NDVI ≥ 0.5 and no step change).

**Clear observations (Sentinel-2, polygon ≥ 50 % clear):**

| Region / season | Usable scenes per month | Longest gap |
|---|---|---|
| Santa Cruz, rainy season Dec–Mar | 1.5–2.5 | 30–42 d (Nov–Jan) |
| Santa Cruz, dry season Jun–Sep | 5.6–7.4 | — |
| Central Chile, Dec–Mar | 5–6 | — |
| Central Chile, May–Aug | 2–2.5 | — |
| Temuco, winter | 1.2–1.4 | up to 65 d |

- Filtering on polygon-level SCL keeps 1.4–5× more scenes than the tile `eo:cloud_cover < 30 %` filter.
- MODIS wet-season composites are often lost entirely: 81/81 pixels cloudy at Mineros in 2026-03 and 2024-03, and 49 % of December composites cloudy at soy emergence.
- SCL misses thin haze (2026-09-15 passed as 99 % clear). Add a B02 brightness or temporal-spike check, or use HLS Fmask.

## Interpolation, gap-filling and fusion

Minimal stack, using numpy, scipy and pandas. `climate_indices` is optional. Note that the project `.venv` lacks scipy, h5py and rasterio.

1. **NDVI smoothing:** weighted Whittaker with λ = 500 on a daily grid at the real acquisition day, or Savitzky-Golay (5, 2). QA weights 1 / 0.5 / 0. Insert calibrated Sentinel-2 values as real observations. Flag curve values more than 32 days from a good observation as gap-filled and never alarm on them alone.
2. **As-of NDVI:** hold the last good observation with its date. This is never worse than extrapolating (1.0–1.8× better). Label it "estimated" after 16 days.
3. **NDVI anomaly:** z-score of the smoothed curve against the same day of year ±8 d over the other years, with persistence (2 composites in a row) or a 32-day mean z. Raise the sd floor to ~0.05 (proposed). On cropland the same-date sd is 0.09–0.21 because sowing dates shift; a phenology-aligned baseline is the v2 fix.
4. **Weather percentiles:** empirical, with a ±7-day window, the current year excluded, ≥ 15 years and one product per series. SPI-3/6 via a gamma fit (`climate_indices`, which clips at ±3.09).
5. **Absolute rain thresholds:** compute on CHIRPS. ERA5 quantile mapping fixes wet-day counts only; its 72 h flood tail fails out of sample.
6. **Gridded aggregation:** not yet decided (see open questions). Several farms share one ERA5 or ERA5-Land cell. Keep UTC days throughout and shift SYNOP 12Z rain by one day when comparing.

What we skip:

- STARFM, ESTARFM and FSDAF fusion (hours per tile, no benefit for polygon means).
- Station kriging and IDW (9 stations at 11–109 km).
- HANTS / harmonic fits (worst on cropland).
- Upper-envelope smoothing on cropland (−0.02 bias).
- Sentinel-1 RVI as a scored baseline (2022–24 too sparse; display only).
- `vam.whittaker` / `modape` (no Python 3.14 wheel).
- MODIS over Chilean orchards except pure pixels.

## Events catalog plan ("recent climate disasters" panel)

| Layer | Bolivia | Chile | Footprint test |
|---|---|---|---|
| Drought | Our own SPI/SPEI and soil percentiles for the last 3–6 months; GDO jspeS clusters for older events (union multi-part features per `(id_cl_st, time)`) | Same, plus DGA decrees | jspeS is a "regional drought event" label (clusters up to 12 M km² cannot rank farms) |
| Flood | GFM observed flood (flooded / observable-dry / not-observable fractions); CEMS rapid-mapping vectors to validate | SAR family; DGA ALERTAS live flag | CEMS EMSR853 observed flood lies 16–28 km from the nearest farm: "near the book, hit no farm" |
| Fire | FIRMS rings at 5 / 25 km with a same-season percentile; GWIS polygons | GWIS polygons (geometry union); FIRMS same day; SIDCO enrichment | Exclude managed cane and rice burning (Mineros); label GWIS as "burned area" |
| Weather warnings | SENAMHI alerts snapshot, labelled "official warning (forecast)" | DMC `datos_AAA` snapshot | Point in polygon |
| Official declarations | Gaceta Oficial decrees (manual curation) | Diario Oficial scraper (emergencia agrícola, escasez hídrica); DGA XLS | Commune join via the CONAF Comunas layer (CUT) / SENAMHI municipio |
| Index and narrative | GDACS + GLIDE + IFRC GO (country 33) | GLIDE + IFRC GO (country 46) + ReliefWeb RSS (C57) | Never intersect GDACS FL/DR polygons with farms (they are department-sized or national envelopes) |

Rules for the panel:

- Join on GLIDE only after checking that hazard and date agree. IFRC GO's "Fires Bolivia 2025" carries the December flood's GLIDE.
- Normalise GDACS alert-level case.
- GDACS WF alert level does not track size; parse the hectares instead.
- Keyless CEMS JSON starts at 2023-03 (EMSR656+).
- The Jan–Oct 2026 FIRMS gap needs a free MAP_KEY: DAY_RANGE 1–5, about 60 calls per source.

## Licence and commercial-use risks

| Status | Sources |
|---|---|
| Commercial OK (with attribution) | CHIRPS v3; MODIS / VIIRS / NASA POWER / CMR / ORNL; Copernicus Sentinel-1/2, GFM, CEMS, GWIS, GDO (CC BY 4.0); Landsat (public domain); JRC GSW; IEM METAR (public domain); NOAA CPC / GHCN (non-US data may carry WMO Res 40 caveats); ODEPA CKAN (CC-BY); MapBiomas (CC BY 4.0 upstream, not CC-BY-SA); WaPOR dataset (CC-BY); CHIRTS-ERA5; CR2MET Zenodo v2.5 archive (CC-BY); CDS / ARCO / NCAR ERA5 (CC-BY) |
| Demo only | Open-Meteo free API (evaluation and prototyping allowed; production needs the Professional plan or self-hosting); OGIMET ("no critical mission", copyright); Meteostat (CC BY-NC); FAO Crop Calendar API (non-commercial without permission from copyright@fao.org); Global Flood Database (CC BY-NC) |
| Unresolved (no licence found) | SENAMHI alerts ("Derechos Reservados"); CRC-SAS SISSA; INE; ANAPO; GLAD soybean (ask glad@umd.edu); CR2MET R1 / NRT / best; RAN agromet.cl; INIA; CIREN / IDE Minagri; DGA products (provisional, unvalidated); DMC (cite as source); CONAF / SENAPRED; GDACS (disclaimer only); INPE |
| Service terms | Planetary Computer runs under preview terms (no SLA, "not for mission critical"); PC Pro is the paid successor. ClimateSERV has no SLA and continuity after the USAID wind-down is uncertain. Google Earth Engine counts a company as commercial (paid) |

Operational risks:

- The Open-Meteo per-IP quota is shared by every teammate and agent. A 30-year call costs 80–680 weighted units.
- Sources throttle:
  - CHC: 429 even at 6 s spacing; budget ~10 s per request, and a 429 can silently corrupt GDAL reads.
  - OGIMET: 501 errors.
  - IEM: 429 errors.
  - SoilGrids: 68 s to more than 120 s per call.
- Several sources are undocumented endpoints: SISSA, RAN, the SENAMHI backend, CIREN and the CR2 explorer.

## Refuted and corrected claims (do not repeat)

Station and weather data:

- GHCN-D, GSOD and ISD are frozen for Bolivia and Chile at 2025-08-24 (Osorno continues via SSOD).
- GHCN-D Chilean precipitation is badly undercounted (Curicó 2023: 175 mm against 674 mm; Chillán 2023: 220 mm against 984 mm), and GHCN-D labels Chilean Tmax and precipitation one day late.
- GHCNh precipitation did not stop in Mar 2026; it continues via BUFR (FM94_1). Rows exist only on wet days, so a missing row does not mean 0 mm. Quality_Code = 1 is not a pass flag, and the 911 mm (SLVR) and 135 mm/h (Temuco) values are mis-codes. In Chile, the 12Z 24 h value is present on only some days.
- OGIMET section-333 Tmax/Tmin at SLVR has been missing since 2026-11-04; fall back to section-1 temperatures plus METAR. The SLVR history starts between 1999-04 and 1999-10.
- The flat IEM-to-SYNOP offset of +1.27 °C is wrong; it is +0.2 to +0.7 °C recently, so refit it per year.
- IEM precipitation for Bolivia and Chile is always 0 or None. Treat it as missing.
- Meteostat fills precipitation with model forecasts (100 % of 2026 at SLVR and Curicó).

Gridded products:

- The IRI Data Library now requires sign-in. It is no longer a keyless CHIRPS point extractor.
- CHIRPS v2 (ClimateSERV dt 0) is not homogeneous at Santa Cruz (2023/24 only p13–p23) and ends in Dec 2026.
- CHIRPS v3 is homogeneous only from 1991.
- CHIRPS v3 COGs declare no nodata; mask values below 0.
- ClimateSERV IMERG V06 stopped silently in 2024-06.
- IMERG missing days count as unknown, not dry (all of May 2024 is missing).
- IMERG is 26–47 % wetter than CHIRPS, so never splice Early mm onto CHIRPS.
- Open-Meteo `era5_land` precipitation and ET0 are null; use `models=era5`.
- Open-Meteo `best_match` splices in IFS; never use it for baselines.
- ERA5 history starts in 1940 (not 1950); ERA5-Land starts in 1950.
- NASA POWER WS2M is broken in some cells (0.00–2.45 m/s). POWER Tmax has a +2.5 to +4.5 °C dry-season warm bias even in the MERRA-2 period. The GEOS-IT seam on 2026-10-01 causes a Tmin step.
- CPC Unified has a V1.0 → V1.0 RT break in 2006 and takes about 2 days, not 1.
- CHIRTS-ERA5 is not the best Tmax at El Trompillo. Its Tmin anomaly carries the Tmax correction, and it has missing days (2026-10-31).
- WaPOR RET does not validate ERA5 ET0 (the October ratio runs 0.76–1.17).
- GloFAS history starts in 1997, not 1984; values after 2025-05-31 are forecast-derived; the usable horizon is ~180 d; and it missed the Dec-2025 Piraí flood. Snap each farm to the maximum-mean-discharge cell per latitude row, not to a fixed longitude.
- The NCAR AWS bucket `nsf-ncar-era5` does carry keyless ERA5 CAPE (1940 to about 2 months ago). The statement that a 30-year CAPE baseline needs CDS is refuted.

Satellite:

- The Planetary Computer MODIS catalogue has holes (13Q1, 11A1 and 43A4 for 2025-07 → 2025-11). The PC STAC "lag" is mostly indexing: newer blobs exist.
- The S2-to-MODIS calibration 0.117 + 0.815·S2 (2 pixels) is superseded by 0.940·S2(B8A) + 0.048 (n = 308).
- The +1000 DN offset is keyed on processing baseline, not date. Earth Search c1 always needs it.
- HLS S30 NDVI is ~+0.08 above S2 B08, not +0.04.
- GFM value 0 means "no flood OR excluded". GFM latency is 2–6.5 h (not 1–3 d), and its EMSR853 "validation" is only partial (recall ≤ 28 %).
- MODIS night LST has an Aqua view-time drift of 2–3 h. Its frost F1 is ~0.7 at 0 °C (0.91 was in-sample).
- The Sentinel-1 RTC SAS token lasts ~45 min, not 1 day.

Masks, events and calendars:

- The MapBiomas mirror has no class 40; rice falls in class 72 or 18.
- The GLAD 2024 soybean layer is unusable.
- The MapBiomas licence is CC BY 4.0 upstream, not CC-BY-SA.
- The FAO Crop Calendar is non-commercial, not "FAO open".
- GDO jspeS data lag 3–6 months and never show ongoing droughts. GDACS DR has no 2024 or 2025 Bolivia event. GDACS history starts by hazard: FL 2001, DR ~2018, WF 2021-07.
- GWIS latency is ~1 day (not 3 weeks), its detection floor is ~100 ha (not 30–50 ha), and there is no 5,000-feature cap with a filter.
- CONAF SIDCO is not maintained into the 2026–27 season.
- SENAMHI alerts are forecasts, and type 28 is a cold front, not frost.

Chile water and agriculture:

- DGA monthly Biobío at Rucalhue in Sep 2026 is 941.1 m³/s (168 % of mean), not 220. The regex parser picked another station; there is no south-centre snow drought.
- Weekly SWE is snow depth × 450 kg/m³. Lago Laja is 88 % of its normal, not "33 % = stress".
- The DGA decree file holds 251 decrees, not 269, and the latest is No. 185 (Choapa).
- The DGA snowmelt forecast is deterministic ±20 %, not probabilistic, and has no Biobío.
- The cherry harvest-rain rule (10 mm/day, 30 mm in 3 days) is our proposal, not an Agroseguros rule.
- CR2MET et0 is Hargreaves-Samani, not FAO-56.
- CR2MET Tmin is not uniformly cold; the bias sign depends on the site.
- RAN history starts 2010-01-01, not 2009.
- The INIA ETo, frost and JSON endpoints were blocked (403) on the verification day.
- CIREN annual-crop species labels are mostly "S/C" (unclassified) in Maule and Ñuble.

Bolivia:

- SISSA station SPI starts in 1962, not 1942.
- SISSA GRACE `nombre` labels are swapped; use the id `rtzsm_inst`.
- The GRACE-DA primary path is the upstream NDMC GeoTIFF, not SISSA.
- INE: use the summer-campaign table.
- The ANAPO calendar must be split by zone (Integrada winter soy is sown Jun to mid-Aug).

## Open questions for the team

1. **Market scope.** Record the Chile-first decision in an ADR. ADR-0001/0002, the sponsor and all 12 sample farms are Bolivian. Chile test points must be replaced with real fields (CIREN blocks or PROPIEDADES_RURALES).
2. **Sample portfolio.** Adopt the 12 verified field polygons from follow-up 02 (`followups/02-farm-relocation/farms_fields.geojson`). Decide on rice (no field with ≥ 5 % historical water; drop it or change the crop) and on Warnes Sur (14.7 km move, or keep it as a non-soy crop).
3. **Precipitation primary for the drought score.** CHIRPS v3 (p3/p0 for 2023/24 at 2 points) or ERA5 (p0 at 11 of 12 farms). Their percentiles agree at only r ≈ 0.51. The 3-point backtest with the 2024/25 control (follow-up 03) has not been run. Also decide whether soil moisture comes from ERA5-Land or from a CHIRPS-forced bucket, given that ERA5 missed the Aug-2020 event.
4. **Licence-clean ERA5 path for production.** CDS (free key), ARCO Zarr or NCAR, against paid Open-Meteo. Follow-up 01 was not run, so 30-year × 12-farm build time is unknown.
5. **ADR-0001 thresholds.** Move frost, heat and flood thresholds to percentiles, with absolute values used only for display and bias-corrected.
6. **Gridded aggregation rule.** Polygon-weighted, centroid or nearest valid cell. Several farms share one 0.25° cell. Agree on UTC days.
7. **Accounts to sign up.** All are free:
   - Earthdata, for VIIRS VI continuity after MODIS ends around 2027 (unverified) and the LP DAAC backfill;
   - FIRMS MAP_KEY, for Jan–Oct 2026 fire;
   - CDS, for ERA5 / ERA5-Land, GloFAS EWDS and AgERA5;
   - DMC and INIA, optional.
8. **Hail.** Accept "out of scope for v1" (no dated lowland hail event was found), or ask Suyana, ANAPO or INSA for one dated, located loss to validate the persistent-NDVI-drop rule.
9. **Licence clearances to request.** SENAMHI (alerts, data request), CR2 (R1/NRT), CIREN, GLAD, FAO (crop calendar), INIA/RAN, SISSA/CRC-SAS.
10. **Bolivian institutions not yet probed** (follow-up 05): INSA loss and indemnity data, the Gobernación de Santa Cruz SAT/COED bulletins, and the SENAMHI terms.
11. **Recent-drought events.** Confirm that the panel derives events for the last 3–6 months from our own percentile signals (no external catalogue covers them).
12. **Crop calendar gaps.** There is no source for lowland rice, sugarcane, sunflower or maize, and per-field green-up detection has not been validated on real polygons.
