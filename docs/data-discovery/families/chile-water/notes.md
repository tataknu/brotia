# Chile water availability: rivers, snow, reservoirs, scarcity decrees (family `chile-water`)

Probed 2026-11-07 from a Python server context. No accounts, no keys. Every claim marked **verified** was observed live
in this session; anything else is marked unverified.

## Headline

1. **Chile has no keyless, machine-readable feed of current daily river flow.** The DGA's real-time systems are
   closed to scripts:
   - SNIA portal: needs a login.
   - BNA Consultas (`snia.mop.gob.cl/BNAConsultas/reportes`): returns **HTTP 403** to scripted clients. We did not try
     to get around it.
   - `dgasat` page: timed out.

   The usable route is the **DGA's own published PDFs**. They are official, free and carry their own 1991–2020 normals.
   `pdftotext -layout` plus regex parses them reliably (`probe_dga_bulletins.py`):
   - **Weekly hydrometeorological bulletin.** Reservoirs, snow courses and rain against normal. Latency is about 1 week.
   - **Monthly bulletin.** Monthly mean flow per gauge against the 1991–2020 mean and the record minimum, plus well
     levels. Latency is about 5–6 weeks.
   - **Yearly snowmelt forecast** (*Pronóstico de caudales de deshielo*). September-to-March volume per river against
     1991–2020, with 20/50/85 % exceedance. Published in October.
2. **Water-scarcity decrees:**
   - The DGA history **XLS** (updated 2026-09-04) is the authoritative current list.
   - The DGA **ArcGIS REST** layer (keyless, point-in-polygon) gives 627 decree polygons for 2008–2023. It is useful
     for history and geometry, but **its `VIGENTE` flag is stale** (last update 2023-04-21). Never use it for "active now".
3. **Snow is the strongest live signal.** MODIS MOD10A1 and MOD10A2 on Microsoft Planetary Computer can be read
   keyless:
   - zonal statistics over a basin polygon in about 0.6 s;
   - history from 2000-02-24;
   - latency of about 6 days for the daily product.

   This gives a same-date snow-cover percentile per basin. The DGA snow courses give SWE against 1991–2020.
4. **GloFAS via the Open-Meteo Flood API works keyless, but it is wrong for narrow Andean valleys.**
   - **Aconcagua:** model monthly medians are about 0.2 m³/s from March to October. The DGA observes 13–28 m³/s.
   - **Big rivers** (Maule, Biobío, Ñuble, Tinguiririca): the climatology looks plausible.
   - **History:** values are non-null only **from 1997-01-01**.
   - **Forecast tail:** the series runs to about 2027-05 as forecast or seasonal values, not observations.
5. **2026 is a split season.**
   - **North-central (Limarí, Elqui, Aconcagua): wet.** Snow courses are +97 % to +485 % above normal and the Limarí
     reservoirs are 82–100 % full. The Limarí province is still under an active scarcity decree (No. 177, until
     2027-07-10), because decrees lag the hydrology.
   - **South-central (Maule to Biobío): snow drought.**
     - SWE: Lo Aguirre −87 %, Volcán Chillán −47 %, Alto Mallines −100 %.
     - Lago Laja: 33 % of capacity.
     - Biobío at Rucalhue, September flow: 220 m³/s against a 560 m³/s mean.
   - **Demo value:** this split is a strong story for a lender.

## What was probed (results)

| Source | Call | Result |
|---|---|---|
| DGA bulletin index `dga.mop.gob.cl/servicios-de-informacion/boletines/` | GET, scrape `*.pdf` | 200. The weekly list runs to **2026-11-02**, the monthly list to **September 2026**, and the monthly archive goes back to **2012**. |
| Weekly bulletin 2026-11-02 (PDF, 643 kB) | download + `pdftotext` | 200, 2.6 s. Parsed **25 reservoirs**, for example La Paloma 612.8/750 hm³ (82 %, historical monthly mean 441.8), Lago Laja 1843.6/5582 (33 %), Colbún 100 %, Convento Viejo 98 %, Digua 99 %, Coihueco 95 %. Parsed **10 snow courses** (depth and SWE against 1991–2020), for example Portillo SWE 990 mm (+120 %) and Lo Aguirre 94 mm (−87 %). It also lists rain against normal at about 80 stations. It has **no flow table**. |
| Monthly bulletin September 2026 (PDF, 9.9 MB) | download + parse | 200, 20 s. Per-gauge rows: Q for the current hydrological year (Oct–Sep), Q for the previous year, Q mean 1991–2020 and Q monthly minimum. September 2026: Aconcagua at Chacabuquito 25.7 against a 18.3 mean; Cachapoal 61.4 against 45.8; Tinguiririca 43.7 against 36.3; Maule at Armerillo 430 against 234; Ñuble at San Fabián 201 against 135; Biobío at Rucalhue 220 against 560. It also has groundwater sectors (cm change). |
| Snowmelt forecast 2026–27 (PDF, 3.2 MB) | download + parse | 200. 19 gauges from Copiapó to Ñuble. Sep–Mar volume against 1991–2020: Aconcagua +2 %, Cachapoal −12 %, Tinguiririca −18 %, Teno −8 %, Maule +7 %, Ñuble +36 %, Grande (Limarí) +36 %, Hurtado +120 %. |
| Decree XLS `Decretos_zonas_escasez_historico_04-09-2026.xls` | download | 200, 90 kB. 269 rows for 2008–2026 (region, decree, expiry, territory text). **Active on 2026-11-07:** the provinces of Limarí, Elqui, Choapa and Chiloé, and Lluta Bajo. → `sample_decretos_escasez_historico.csv` |
| DGA ArcGIS `rest-sit.mop.gob.cl/arcgis/rest/services/DGA/Decretos_Escasez_Hidrica/MapServer/0/query` | point-in-polygon per farm | 200, about 0.5 s per query. 627 polygons, latest decree 2023-04-21, stale `VIGENTE`. Years under decree per farm: Quillota 13, Ovalle 9, Curicó 10, Talca 8, Parral 7, Requínoa 5, Santa Cruz 4, Osorno 1, Chillán 1, Los Ángeles 0, Temuco 0. |
| DGA ArcGIS `ALERTAS` and `EMERGENCIA/MAPA_ESTACIONES_DGA` | query all | 200, 1.4 s. 1019 stations (paged at 1000), timestamp **2026-11-07 04:14 UTC (live)**. Gives water level against blue, yellow and red flood thresholds. It is a flood-alert index, not discharge (6 stations had values above 0 today, all in Copiapó–Choapa). |
| DGA ArcGIS `ESTACION_EMBALSE` | query | 200, but **stale**: 11 reservoirs, last `fecmed` **2019-11-12**. Rejected. |
| DGA ArcGIS `Red_Hidrometrica`, DOH `Embalses`, DOH `Canales_CNR` | query | 200. Station catalogue (5084 records with basin codes, lat/lon, status), reservoir catalogue and irrigation canals. Metadata only. |
| SNIA / BNA Consultas | GET | **403** to scripted access. Not pursued (bot check). |
| CR2 Explorador Climático `explorador.cr2.cl/request.php?options={json}` | `config`, `map` and `series` for `qflxDaily` | 200, 0.5–1.2 s, keyless JSON. 272 DGA flow gauges. Aconcagua at Chacabuquito has daily data from **1936-09-02 to 2020-06-06** (frozen). Baseline only. The time range must end at or before the data end, otherwise the call returns `{"errors":["map"]}`. |
| CAMELS-CL (PANGAEA, CC-BY-4.0) | download attributes (178 kB) + streamflow (13 MB zip) | 200, 1.6 s. 516 gauges, **1913-02-15 to 2018-03-09**. Includes `interv_degree` and `big_dam` (human intervention). → `sample_camelscl_target_gauges.csv` |
| Open-Meteo Flood API (GloFAS v4) | `daily=river_discharge` 1984–2026 at 8 gauges | 200, about 0.6 s. Bursting long ranges gives **429 (minutely limit)**, so space requests by about 10 s. Non-null data starts 1997-01-01. Gauge-coordinate cells are off-river for Aconcagua, Grande and Cachapoal. Picking the best of a 5×5 neighbourhood helps (`probe_glofas_cell.py`), but the Aconcagua seasonality is still wrong. October 2026 percentile against 1997–2020: Maule 100, Biobío 96, Tinguiririca 100. |
| MODIS MOD10A1 / MOD10A2 (Planetary Computer STAC + `api/data/v1/item/statistics`) | point value + zonal stats | 200, about 0.5 s. Latest MOD10A1 is 2026-11-01. MOD10A2 composite of 2026-09-30, snow fraction of clear pixels: upper Aconcagua 0.93 (percentile 60 against 2001–2025), upper Maule 0.90 (percentile 64). |
| Open-Meteo archive (ERA5-Land `snow_depth`) | GET | **429: daily limit exceeded** (shared IP with the other probes). **Unverified.** The docs say SWE exists only for CERRA (Europe), so for Chile we get snow depth only. |
| NASA GES DISC Hydrology Data Rods (GLDAS SWE) | GET | 301 to "service discontinued". Rejected. |
| Observatorio Agroclimático (`climatedatalibrary.cl`, Chile's IRI maproom for SPI and VCI) | GET | **301 to an unrelated municipal website** (the domain appears to have lapsed). Rejected. |
| datos.gob.cl CKAN `package_search` (embalses, caudales, escasez, nieve) | GET | 200, 0 relevant datasets. |

## Recommended primary and fallback per variable

| Variable | Primary | Fallback | Baseline |
|---|---|---|---|
| Seasonal irrigation water supply (Sep–Mar snowmelt volume) | DGA *Pronóstico de caudales de deshielo* PDF (yearly, October) | Snow-course SWE + MODIS snow-cover percentile | 1991–2020, inside the document |
| Snowpack (SWE) | DGA weekly bulletin snow courses (10 routes, Elqui to Biobío) | MODIS snow-cover percentile; ERA5-Land `snow_depth` via Open-Meteo (unverified) | 1991–2020 inside the bulletin |
| Snow cover | MODIS MOD10A2 8-day (Planetary Computer zonal stats) | MOD10A1 daily (cloudier) | MODIS 2000→, same composite date |
| River discharge (observed) | DGA monthly bulletin per-gauge table | GloFAS via Open-Meteo, **only for Maule, Biobío, Ñuble and Tinguiririca**, as its own percentile | CR2 explorer (1936–2020) and CAMELS-CL (1913–2018) for percentiles; the bulletin's 1991–2020 mean for ratios |
| River discharge (live / forecast tail) | GloFAS (large rivers), clearly labelled as a model | – | GloFAS 1997–2026 |
| Reservoir storage | DGA weekly bulletin table (% of capacity, ratio to historical monthly mean) | DGA monthly bulletin | In-table historical monthly mean; percentiles from the monthly PDF archive (2012→) |
| Water-scarcity decree (current) | DGA decree XLS on the *decretos-de-escasez* page | Diario Oficial PDFs | – |
| Decree history / geometry | DGA ArcGIS `Decretos_Escasez_Hidrica` (2008–2023 polygons) | XLS text matching | "Years under decree since 2008" as a chronic-exposure flag |
| Flood alerts on rivers | DGA ArcGIS `ALERTAS` (live, every 15–60 min) | GloFAS forecast | Thresholds in `MAPA_ESTACIONES_DGA` |
| Drought indices (SPI, SPEI, VCI) | Compute in-house from gridded precipitation and ETo (other families) and from MODIS NDVI | Copernicus GDO (global; not probed here) | – |
| Groundwater | DGA monthly bulletin (cm change per aquifer sector) | – | Text only; low priority |

## Lender-relevant indicator: Basin Water Availability (BWA), proposal for the phase-2 formula spec

### Farm to basin assets

| Farm | Basin | Gauge / forecast | Reservoirs | Snow course | 2026 reading |
|---|---|---|---|---|---|
| Quillota avocados | Aconcagua | Chacabuquito, +2 % | none for irrigation (Los Aromos is drinking water) | Portillo +120 % SWE | normal to wet; decree history 13 years |
| Ovalle table grapes | Limarí | Grande +36 %, Hurtado +120 % | La Paloma 82 %, Recoleta and Cogotí 100 % | Quebrada Larga +361 %, Vega Negra +240 % | wet, **but decree active until 2027-07-10** |
| Requínoa cherries | Rapel / Cachapoal | Puente Termas −12 % | – | (Laguna Negra −2 % as proxy) | mild deficit |
| Santa Cruz wine | Rapel / Tinguiririca | Bajo Briones −18 % | Convento Viejo 98 % | – | moderate deficit, buffered by storage |
| Curicó apples | Mataquito / Teno | −8 % | – | – | mild deficit |
| Talca vineyards | Maule | Armerillo +7 % | Colbún 100 %, Laguna del Maule 54 % (above its monthly mean) | Lo Aguirre −87 % | storage good, snow poor |
| Parral rice | Maule (Perquilauquén / Longaví) | – | Digua 99 %, Bullileo 100 % | Lo Aguirre −87 % | storage good |
| Chillán blueberries | Itata / Ñuble | San Fabián +36 % | Coihueco 95 % | Volcán Chillán −47 % | mixed |
| Los Ángeles maize | Biobío / Laja | Rucalhue September at 39 % of mean | Lago Laja 33 % | Alto Mallines −100 % | **stress** |
| Temuco wheat, Osorno potatoes | mostly rainfed | – | – | – | BWA not applicable (weight 0); use field rain and soil moisture |

### Components

Each component is turned into a 0–1 severity, using percentiles where history exists (ADR-0002 D5) and the ratio to
the 1991–2020 normal where only the bulletin normal exists:

- (a) snowmelt-forecast volume against normal (dominant from October to March);
- (b) reservoir volume against its historical monthly mean;
- (c) same-date SWE from snow courses, or the MODIS snow-cover percentile;
- (d) last observed monthly flow against Q mean, with Q minimum as the "extreme" anchor;
- (e) decree: an active decree sets the severity floor at "watch", and years under decree since 2008 act as a
  chronic flag.

BWA is the weighted maximum of the components available for the basin, and every value carries its own provenance
and as-of date.

### Combination with field NDVI and ET

ADR-0001 already multiplies field drought by 0.4 for irrigated zones. The proposal is to let BWA **gate** that
reduction:

| Basin water | Field signal (NDVI z-score / ET anomaly) | Tier | Driver text |
|---|---|---|---|
| Scarce | Negative | high | "water shortage reaching the crop" |
| Scarce | Normal | watch | "irrigation is coping; watch allocation and pumping cost" |
| Normal | any | field signal stands alone | – |

## Open risks

1. **No live observed discharge API.** Observed flow comes from the monthly PDF, 5–6 weeks late. PDF layouts can
   change between issues, so the regexes need tests and a fallback "parse failed → stale cache".
2. **File URLs are unpredictable.** Upload folders don't match issue dates, for example
   `uploads/sites/13/2026/01/2026-11-02_...`. Always discover them by scraping the bulletin index page.
3. **GloFAS is unreliable in Andean valleys.** Do not show m³/s from it for Aconcagua, Cachapoal or Limarí. It also
   ignores reservoirs and abstractions.
4. **Decrees are administrative and lag the hydrology.** Limarí is under decree in a wet year. Region- and
   province-level decrees need a manual farm → comuna/provincia mapping. The ArcGIS flag is stale.
5. **MODIS snow cover saturates in early spring at high elevation.** It has low sensitivity. Prefer snow-course SWE
   and the forecast, and use snow cover for timing of melt-out from November to December. Cloud code 50 must be
   handled.
6. **Open-Meteo free tier:**
   - limits: about 600 calls per minute, weighted by range, and a daily cap. The daily cap was hit today from a shared
     IP.
   - licence: non-commercial terms. A commercial deployment needs the paid API or self-hosting.
7. **CR2 explorer and CAMELS-CL are frozen** (2020-06 and 2018-03). Percentile baselines for 2019–2026 must be filled
   from the monthly PDF archive.
8. **Monitor de Sequía / Observatorio Agroclimático:** no working machine endpoint was found, because the domain
   lapsed. The web-search budget ran out before we could look for a successor (for example a DMC or CR2 drought
   monitor). Verifying that remains open.

## Files

- **Probe scripts:**
  - `probe_dga_bulletins.py`: weekly, monthly and forecast PDF parsers;
  - `probe_decretos_current.py`: current decree status per farm from the XLS;
  - `probe_dga_decretos.py` and `probe_dga_arcgis.py`: ArcGIS decree history;
  - `probe_dga_alertas.py`: live flood alerts;
  - `probe_cr2.py`: CR2 explorer JSON;
  - `probe_glofas.py` and `probe_glofas_cell.py`: GloFAS;
  - `probe_modis_snow.py` and `probe_modis_snow_baseline.py`: MODIS snow.
- **Samples:**
  - `sample_dga_bulletins_parsed.json`
  - `sample_decretos_escasez_historico.csv`
  - `sample_decretos_status_by_farm.json`
  - `sample_dga_decretos_by_farm.json` (stale flag renamed)
  - `sample_dga_alertas.json`
  - `sample_cr2_aconcagua_chacabuquito_monthly_tail.json`
  - `sample_camelscl_target_gauges.csv`
  - `sample_glofas_summary.json` (with caveat)
  - `sample_glofas_aconcagua_cell.json`
  - `sample_modis_snow_sca_baseline.json`
