# Family: chile-ag-stats-credit

Chile agricultural statistics, cadastres, and the credit and insurance context.
Probed on 2026-11-07, keyless only. No accounts were created. Chile is the primary market (team decision 2026-11-06).

## TL;DR

1. **The core find: the CIREN / IDE Minagri ArcGIS server** (`https://esri.ciren.cl/server/rest/services`, ArcGIS 11.5).
   - It is public, needs no key, and is queryable over REST (point + buffer → JSON or GeoJSON, EPSG:4326 out).
   - **Orchard parcels (Catastro Frutícola):** polygons by species for every region, survey years 2022–2025.
   - **Crop-level land use:** polygons including ARROZ, MAIZ, TRIGO, AVENA and VID.
   - **Irrigated-area polygons.**
   - **Wildfire scars:** CONAF 2024-25.
   - **Insurance:** uptake and loss layers by commune (2017/2018 only).
   - **Rural property boundaries.**
   - **Census:** layers by commune for the 2007 census only; the 2021 census is not on the server.
2. **All 11 given Chile test coordinates fall on town centres** (land use = `CIUDAD` / `AREAS ARTIFICIALES`).
   I replaced them with the nearest real polygon of the target crop: `samples/chile_test_farm_polygons.geojson`
   (10 sites; Osorno is a gap, see below). **Recommendation: the team should adopt these as the Chile sample farm polygons.**
3. **ODEPA open-data CKAN** (`datos.odepa.gob.cl`):
   - The Catastro Frutícola is published block by block as CSV, 2020–2025.
   - Each block has: species, variety, planting year, **irrigation method**, number of trees and hectares, located down to the commune.
   - This gives the "what is planted where" context at commune level, and the planting year and irrigation method for each block.
4. **DGA water-scarcity decrees, 2008–2026:** one keyless XLS of 269 decrees.
   - It is the best structured "water-availability emergency" event history for irrigated Chile.
   - It shows the megadrought pattern clearly. Quillota has decrees in 9 of the 10 years 2013–2022, and Petorca has 25 decrees.
5. **Credit and insurance:**
   - **Insurance:** Agroseguros publishes the perils it covers and the subsidy rules, but **no downloadable loss statistics**. The only spatial loss data is the CIREN 2017/2018 layer.
   - **Credit:** Banco Central BDE needs a free registration. The CMF API needs a free key.
   - **INDAP:** emergency credit and automatic-extension resolutions are PDFs, and they work as an event signal. One example is a July 2026 resolution (21-07-2026) for the rain and flood event in Atacama and Coquimbo.

## Probes (all keyless, from macOS, 2026-11-07)

| # | What | Endpoint | Result |
|---|------|----------|--------|
| 1 | CIREN service directory | `GET /server/rest/services?f=json` | 200, 0.7 s. 26 folders; the `IDEMINAGRI` folder has about 90 services |
| 2 | Catastro Frutícola layers | `/IDEMINAGRI/CATASTRO_FRUTICOLA/MapServer?f=json` | 200. Layers 55–68 are *PRODUCTORES FRUTÍCOLAS* polygons, one per region. Valparaíso and RM are 2025; most others are 2024; Arica, Tarapacá and Aysén are 2022. maxRecordCount = 2000; capabilities Query, Map, Data. Valparaíso has 13,438 polygons and Maule 23,038 |
| 3 | Orchard point + 1 km and 3 km buffer queries | `/{59..67}/query?geometry=lon,lat&distance=3000` | 200, about **4.0 s flat per query**. Species within 3 km: Quillota PALTO 78; Requínoa CEREZO 53; Santa Cruz CIRUELO EUROPEO 53; Curicó CEREZO 14; Los Ángeles ARANDANO 23; Talca, Temuco and Osorno 0 |
| 4 | Fields | `especie_01..04`, `rolpredi` (property tax roll), `desccomu`, `comudere` (commune code), `regidere` | **No planting year or variety on the polygons.** Those are in the ODEPA CSV (probe 9) |
| 5 | GeoJSON polygons | `f=geojson&outSR=4326&maxAllowableOffset=0.00005` | 200. Saved in `samples/ciren_catastro_requinoa_5polys.geojson` |
| 6 | Land use (crop level) | `/IDEMINAGRI/USO_DE_LA_TIERRA_CIREN_2/MapServer/{0..9}/query` | 200, about 4 s. **`USO_DE_LA_TIERRA_CIREN` (without the `_2` suffix) refuses queries: "Requested operation is not supported"** (its identify works). Use `_2`. Classes within 4 km of Parral: CULTIVO ANUAL/ARROZ 17, MAIZ 11, ARANDANO 8; Los Ángeles: TRIGO 33, AVENA 22, MAIZ 16; Santa Cruz: VIÑAS Y PARRONALES/VID 21 |
| 7b | **Farm-polygon intersect** (the product's use case) | `POST .../query` with `geometryType=esriGeometryPolygon`, the Requínoa cherry ring, inSR 4326 | 200, 3.6–4.2 s. Catastro: 3 hits (CEREZO ×2, NECTARINO); land use `_2`: 3 hits (FRUTAL/CEREZO, FRUTAL/NECTARINO, MATORRAL PRADERA); irrigated areas: 1 hit. Note: an `outFields` value that names a field missing from the layer gives an opaque `400 Failed to execute query` |
| 7 | Nearest crop polygon per site | `probe_nearest_crop_polygon.py` | All 10 found, 0.5–4.6 km from the town coordinates (see the table below) |
| 8 | Irrigated area | `/Emergencias/HIDRICO_PUBLICO/MapServer/{2,5,6}` | 200. The Requínoa cherry, Ovalle grape and Parral rice polygons all intersect an *ÁREAS DE RIEGO* polygon, which gives a binary irrigated flag. Coverage: Atacama to Maule, plus RM (2016–2022). Ñuble and further south have only intakes and canals. Also: water rights for Limarí 2022 (layer 3), intakes (*bocatomas*) and canals |
| 9 | ODEPA CKAN | `datos.odepa.gob.cl/api/3/action/package_list` | 200, 0.4 s. 6 packages: catastro-fruticola, comercio-exterior, precios-consumidor, precios-mayoristas (×2), precios-uva-vinificacion |
| 10 | ODEPA Catastro CSV | `.../catastro_fruticola_2025.csv` (4.4 MB), `..._2024.csv` (14 MB) | 200, 1.5–2.5 s. 2025 = Valparaíso + RM (31,626 blocks); 2024 = 9 regions (103,716 blocks). Columns: Anio, Region, Provincia, Comuna, Número explotación, Número bloque, Tipo productor, Especie, Variedad, Anio plantacion, **Metodo de riego**, Numero de arboles, Superficie (ha). Last-Modified 2026-03-25. Aggregate saved as `samples/odepa_catastro_2024_2025_comuna_especie_ha.csv`. Top species by commune (ha): Quillota: palto 1,668; Ovalle: olivo 2,633, palto 1,253, vid de mesa 724; Requínoa: nogal 1,769, cerezo 1,564; Santa Cruz: ciruelo europeo 1,166, cerezo 890; Curicó: cerezo 4,387, manzano rojo 2,096; Parral: avellano 2,475; Chillán: avellano 560, cerezo 461; Los Angeles (spelled without the accent in the CSV, so match communes accent-insensitively): avellano 1,756, arándano 1,102; Osorno: cerezo 351. Drip (*goteo*) dominates irrigation everywhere except Curicó, where micro-sprinkler (*micro aspersión*) is slightly ahead of drip |
| 11 | datos.gob.cl CKAN | `package_search?q=odepa / indap / emergencia agricola / agroseguros / censo agropecuario` | 200. ODEPA mirrors only. INDAP emergencies are 2013 only. The Subsecretaría "Emergencias Agrícolas" CSV covers 2008–2013 (stale). 0 hits for agroseguros and 0 for censo agropecuario |
| 12 | DGA scarcity decrees | `dga.mop.gob.cl/.../Decretos_zonas_escasez_historico_04-09-2026.xls` | 200, 1.4 s, 90 KB. 269 rows, 2008–2026. Columns: year, region, decree, expiry, free-text area. Saved as CSV. In force on 2026-11-07 (expiry after today, computed from the CSV): 5 decrees (Elqui, Limarí and Choapa provinces in Coquimbo; Lluta Bajo in Arica; Chiloé). None covers the central-valley test sites now; Quillota, Curicó and Talca had decrees in 2021–22 |
| 13 | Wildfires 2024-25 | `/IDEMINAGRI/INCENDIOS/MapServer/0,2` | 200, about 4 s. Polygons ≥ magnitude, with start and end dates, cause and hectares. Points include an `agr_cola` field (hectares of farmland burned). 2 scars within 50 km of Quillota; 110 ignitions within 20 km of Los Ángeles |
| 14 | 2024 fire economic impact | `/Emergencias/IMPACTO_AGROECONOMICO_ENE_FEB_2024/MapServer/0` | 200. 152 polygons at 50 m: land use, species, `clp_p_ha`, `costo_mill` (Valparaíso fires, Feb 2024) |
| 15 | Insurance layers | `/IDEMINAGRI/SEGURO_AGRICOLA/MapServer` | 200. Polygons by commune: loss ratio 2017 (`sinies2017`, number of claims, cost) and policies and net premium 2018, by line (FRUTALES, VIDES, CEREALES, BERRIES, KIWI, POMÁCEAS, INCENDIOS FRUTALES…). Requínoa fruit 2017: sinies 14.09, 1 claim, cost 230.57; 2018: 5 policies, premium 540.84 (UF, presumably) |
| 16 | Census layers | `/IDEMINAGRI/CENSO_AGROPECUARIO/MapServer` | 200, but **2007 census only** (vineyard area, irrigated area, **use of credit instruments**, fruit species…) |
| 17 | Rural properties | `/IDEMINAGRI/PROPIEDADES_RURALES/MapServer` | 200, Query. Region vintages range from 2004 to 2023 |
| 18 | CONAF vegetation | `/RECURSOS_VEGETACIONALES_Y_USOS_DE_LA_TIERRA_1/13` (Los Lagos 2013) | 200. Osorno, 4 km: only generic "Terreno de Uso Agrícola" (8) and "Praderas Perennes" (14). **No potato or crop detail** |
| 19 | WMS | `.../CATASTRO_FRUTICOLA/MapServer/WMSServer?REQUEST=GetCapabilities` | 200, 5 s, 109 KB, 70 layers. GetMap PNG 200, 3.9 s. **WFS is not enabled (400).** Use REST query for vectors |
| 20 | INE Censo 2021 | `ine.gob.cl/censoagropecuario` | 200. The results pages exist (21 tables by commune, 2 microdata bases), but the download links are JS-rendered and **not reachable by a script** → verified=false for files |
| 21 | Agroseguros | `agroseguros.gob.cl/seguros-agricolas-2/`, `/subsidio-del-estado-2/`, `/documentos/` | 200. Perils covered and subsidy rules (below). Only PDFs: brochures and pre-2018 studies. **No statistics downloads.** WebFetch failed on the TLS chain; curl worked |
| 22 | Banco Central BDE | `si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx` | 302 to the error page without credentials. Needs a **free user registration** (email); limit 5 series per second |
| 23 | CMF API | `api.cmfchile.cl/api-sbifv3/recursos_api/...` | 422 without a key. Needs a **free API key** (email signup) |
| 24 | INDAP | `indap.gob.cl/sites/default/files/2026-07/Prorroga Créditos INDAP - Atacama y Coquimbo.pdf` | 200, 97 KB. Res. Ex. 0070-029430/2026 of 21-07-2026: automatic extension of credit instalments for users hit by abnormal rain and floods |
| 25 | MapBiomas Chile | `chile.mapbiomas.org/descargas/assets-en-google-earth-engine/` | 200. LULC Collection 2 (1999–2024, 30 m Landsat): `projects/mapbiomas-chile/assets/LULC/COLLECTION-02/CLASSIFICATIONS/classification-final/clasificacion-final-2`. Fire Collection 1: `projects/mapbiomas-public/assets/chile/fire/collection1/*` (annual, monthly, frequency, year of last fire). Water and glaciers also exist. The GCS bucket listing is 401 for anonymous callers. **Not verified at data level** (GEE needs an account) |

### Suggested replacement farm coordinates (from probe 7)

| Site | Town lon/lat | Suggested lon/lat | Distance | Polygon source / class |
|---|---|---|---|---|
| Quillota avocados | -71.25, -32.88 | -71.24389, -32.86932 | 1.3 km | Catastro V (2025): PALTO |
| Ovalle/Limarí table grapes | -71.20, -30.60 | -71.24193, -30.58287 | 4.4 km | Catastro IV (2024): VID DE MESA |
| Requínoa cherries | -70.80, -34.28 | -70.80316, -34.28378 | 0.5 km | Catastro VI (2024): CEREZO |
| Santa Cruz wine grapes | -71.37, -34.64 | -71.37508, -34.64225 | 0.5 km | Land use VI (CIREN 2024 layer): VID |
| Curicó apples & cherries | -71.24, -34.98 | -71.25567, -34.96584 | 2.1 km | Catastro VII (2024): CEREZO |
| Talca vineyards | -71.66, -35.43 | -71.62810, -35.46251 | 4.6 km | Land use VII (2022): VID |
| Parral rice | -71.83, -36.14 | -71.84165, -36.15148 | 1.7 km | Land use VII (2022): ARROZ |
| Chillán blueberries | -72.10, -36.60 | -72.06601, -36.57405 | 4.2 km | Catastro XVI (2024): ARÁNDANO AMERICANO |
| Los Ángeles maize & wheat | -72.35, -37.47 | -72.35282, -37.45440 | 1.8 km | Land use VIII (2023): TRIGO |
| Temuco wheat & oats | -72.60, -38.74 | -72.60547, -38.75843 | 2.1 km | Land use IX (2019): ROTACIÓN CULTIVO PRADERA (generic) |
| Osorno potatoes | -73.13, -40.57 | — | — | **Gap:** no CIREN land use for Los Lagos; CONAF 2013 has only generic farmland |

The polygons are in `samples/chile_test_farm_polygons.geojson`, simplified to about 5 m.

## Agroseguros perils and rules (from the site, 2026-11-07)

- **What it is:** multi-peril climate insurance that covers the working capital invested in the crop.
- **Annual crops:** drought (rainfed farms only, *sequía en secano*), excess or out-of-season rain, frost, wind, hail, snow.
- **Fruit, by species:**
  - Vines, basic cover: frost + hail. Vines, full cover: frost, hail, rain, wind, snow.
  - Apple and pear: rain, frost, wind, hail, snow.
  - Olive, kiwi and walnut: frost only.
  - Blueberry and raspberry: frost + hail.
  - There is also a fire product with add-ons for fruit, plus livestock, beekeeping, forestry and a fruit-fly catastrophe policy.
- **Subsidy:** 40 % of the premium + 1 UF per policy. Caps: 80 UF per policy, 80 UF per crop and commune, 160 UF per beneficiary. Extra subsidies stack on top (repeat contracting, etc.).
- **What this means for us:** frost, hail and harvest rain are the insured perils that matter for orchards. The policy does **not** cover drought for irrigated land. That fits the product: a bank needs a water-availability signal (decrees, reservoirs, snowpack), and insurance will not absorb that risk.

## Recommendations per variable

| Variable | Primary | Fallback | Baseline / notes |
|---|---|---|---|
| Crop type + field polygon (orchards) | CIREN Catastro Frutícola REST (layers 55–68) | ODEPA Catastro CSV (commune × species × ha) | Survey 2022–2025 by region; refreshed about every 3 years per region |
| Crop type + field polygon (annual crops, vines) | CIREN `USO_DE_LA_TIERRA_CIREN_2` REST | MapBiomas Chile LULC C2 (GEE, 30 m, 1999–2024) | Region vintages 2019–2026; descriptions cite 2004–2009 ortho imagery for some regions, so the data may be stale |
| Irrigated / rainfed flag | CIREN `Emergencias/HIDRICO_PUBLICO` irrigated areas | ODEPA Catastro `Metodo de riego` (commune share) | Atacama to Maule only; south of Maule use the CSV or assume rainfed for cereals |
| Water-scarcity event (irrigated risk) | DGA scarcity decree XLS (2008–2026) | Minagri agricultural-emergency resolutions (Diario Oficial PDFs) | The free-text area field needs a hand-mapped table to communes and provinces; one embedded header row needs cleaning |
| Recent disaster events (fire) | CIREN `IDEMINAGRI/INCENDIOS` (CONAF 2024-25 points and scars) | MapBiomas Fuego Chile C1 (GEE, annual + monthly burned area) | Older seasons are not on the server; CONAF history is xlsx on conaf.cl (not probed, URL 404) |
| Insurance exposure / loss history | CIREN `SEGURO_AGRICOLA` (2017 losses, 2018 policies, by commune) | Agroseguros PDFs; a transparency request (Ley 20.285) for newer years | Too old for live scoring; use only as "insurance penetration" context |
| Credit context (sector) | CMF API (free key) / CMF reports | Banco Central BDE (free registration); 2007 census "use of credit" layer | National or regional only; no farm-level credit data is public |
| Emergency credit / repactation | INDAP resolutions (PDF) | News and Minagri press | Event flag for "lender forbearance active in region X" |
| Commune crop statistics | ODEPA Catastro CSV + INE Censo 2021 tables | 2007 census layers on CIREN | INE files need a manual download (JS page) |

## Open risks

- **Latency:** a flat ~4.0 s per CIREN query, whatever the payload, so the delay is probably on the server side.
  - Cache per polygon in DuckDB; never query inside a request loop.
  - Pre-compute the sample portfolio into the offline snapshot.
- **Schemas differ by region:** `uso_actual` vs `usoactual`, `desccomu` vs `nom_com`, `descregi` vs `nom_reg`, and mojibake in O'Higgins (`VIÃ'AS`). Accents also vary (`ROTACIÓN` vs `ROTACION`). The wrapper needs a per-layer field map and accent-insensitive matching.
- **Vintage:** the orchard polygons have no survey date per polygon (only the year in the layer name). The land-use layers mix 2019–2026 vintages, built on older imagery.
- **Coverage:**
  - The Catastro Frutícola covers orchards only. Vines for wine are not in it: the Colchagua and Talca vines came from the land-use layer. SAG's Catastro Vitícola publishes only commune-level PDFs.
  - Los Lagos (Osorno potatoes) has no crop-level layer.
- **Services:** `USO_DE_LA_TIERRA_CIREN` (without `_2`) has query disabled; WFS is not enabled. Services can change without notice, since folder names like `Borrar` and `test_parvec` suggest an operational server, not a stable API.
- **Licence:** the IDE Minagri pages and service metadata state no licence (`copyrightText` is empty). Treat the data as Chilean public information, cite CIREN/Minagri, and confirm before any commercial use.
- **Privacy:** the catastro polygons carry `rolpredi` (property tax roll). Do not display it. The INDAP user databases (`PROYECTOS_EXTERNOS_INDAP/BBDD_Usuarios_*`) were deliberately **not** queried, because they likely hold personal data.
- **Insurance and credit data:**
  - No public loss statistics newer than 2017 were found.
  - Credit APIs need free registration (BCCh) or a key (CMF); this probe did not sign up.
- **INE Censo 2021:** file URLs are not reachable by a script; download them by hand.
- **MapBiomas:** GEE-only; anonymous GCS listing is denied, so it cannot be used from our server without a GEE service account.

## Files

- `probe_ciren_catastro.py`: orchard point and buffer queries for all sites → `samples/ciren_catastro_point_queries.json`
- `probe_ciren_landuse.py`: land use at the town points (all urban) → `samples/ciren_landuse_point_queries.json`
- `probe_nearest_crop_polygon.py`: nearest target-crop polygon → `samples/chile_test_farm_polygons.geojson`
- `samples/ciren_catastro_requinoa_5polys.geojson`: raw orchard GeoJSON example
- `samples/odepa_catastro_fruticola_2025_head.csv`: first 40 rows of the ODEPA block-level CSV
- `samples/odepa_catastro_2024_2025_comuna_especie_ha.csv`: commune × species hectares, with the median planting year
- `samples/dga_decretos_escasez_2008_2026.csv`: all DGA scarcity decrees
