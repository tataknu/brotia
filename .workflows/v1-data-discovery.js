export const meta = {
  name: 'v1-data-discovery',
  description: 'Deep public-data discovery for the climate loan monitor: 22 parallel researchers (Chile first, Bolivia, global) probing live, adversarial verification, gap follow-ups, catalog, then a product-owner phase that records discoveries as ADRs + v1 backlog',
  phases: [
    { title: 'Research', detail: '22 source families (8 Chile) researched and probed in parallel' },
    { title: 'Verify', detail: 'independent re-probe of each family\'s top picks' },
    { title: 'Gaps', detail: 'completeness critic + targeted follow-ups' },
    { title: 'Synthesize', detail: 'catalog + variable-to-source matrix' },
    { title: 'Product owner', detail: 'record data discoveries as ADRs, prioritised v1 backlog, independent review' },
  ],
}

const ROOT = '/Users/cristian/Documents/projects/energhack'
const OUT = `${ROOT}/docs/data-discovery`
const FARMS = args.farms

const COMMON = `
You are a data-engineering researcher on a 4-person hackathon team (MIT Energy & Climate Hack 2026, today is ${args.today}).
Product: "Climate Loan Monitor" — shows a bank which farm loans in its portfolio are under climate stress and WHY, using satellite + weather data.
Sponsor: Suyana (Bolivian parametric ag insurance / early warning; Bolivia flagship, Santa Cruz lowlands soy belt). Their guidance: compare each field with ITS OWN same-time-of-year history (anomaly), not fixed thresholds.
Agreed architecture (ADR-0002, read ${ROOT}/docs/adr/0002-v1-real-data-architecture.md and ADR-0001 in the same folder):
- Python FastAPI service, no queues, per-source wrappers behind a variable registry with fallback, DuckDB storage, offline JSON snapshot.
- Display window: last 13 months, as-of = today / latest available; baseline = multi-year same-time-of-year history (weather up to 30 y, MODIS since 2000).
- NDVI: MODIS long baseline + Sentinel-2 10 m current, cross-calibrated. Weather anomalies as percentiles, NDVI as z-score.
- Variables our formulas need: precipitation (daily), Tmax/Tmin (daily), reference ET (ETo, FAO-56), soil moisture (root zone), NDVI, NDMI, flood/surface water, frost, heat, hail proxies, recent disaster events, crop masks/calendars/phenology.
Test locations (sample farms, lon/lat, Santa Cruz, Bolivia): ${JSON.stringify(FARMS)}. Santa Cruz Viru Viru airport (SLVR) is ~(-63.14, -17.64).

RULES:
- Be hands-on: actually probe endpoints with curl/python (python3 + requests is fine; a venv exists at ${ROOT}/.venv with pandas/requests). Use one or two sample farm coordinates. Record HTTP status, latency, a tiny excerpt of the response, the date of the latest available value, and history start. A claim you did not verify live must be marked verified=false.
- Do NOT create accounts, sign up, or use any credentials/API keys. If a source requires registration or a key, record that (and how hard: instant free email signup vs institutional approval) and test any public/no-auth path (WMS, open STAC, sample files).
- Respect rate limits; keep downloads small (<20 MB each). Never print or store secrets.
- Write ONLY inside your own folder: ${OUT}/families/<your-key>/ (notes.md + any small sample files <1 MB + probe scripts). Do not touch app/, service/, pipeline/ or other families' folders.
- This project is independent: do not reference or read any other company's private product or code.
- Prefer sources that are free, keyless or free-signup, have Bolivia/Santa Cruz coverage, long history (for same-time-of-year baselines), low latency, and are usable from a Python server.
- Spanish-language national sites are expected; search in Spanish too.
- In notes.md write a concise human-readable report: what you found, what you probed (with results), recommended primary + fallback per variable you cover, and open risks.
`

const SOURCE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' }, provider: { type: 'string' }, url: { type: 'string' },
    variables: { type: 'array', items: { type: 'string' } },
    kind: { type: 'string', description: 'station | gridded-reanalysis | satellite-gridded | satellite-imagery | model-product | catalog | method | statistics | other' },
    spatial_res: { type: 'string' }, temporal_res: { type: 'string' },
    history_start: { type: 'string' }, latency: { type: 'string' },
    coverage_santa_cruz: { type: 'string', description: 'good | partial | none | unknown + detail (e.g. nearest station distance)' },
    access: { type: 'string', description: 'endpoint/protocol (REST, STAC, OPeNDAP, WMS, GEE, FTP, HTML scrape, PDF) and format' },
    auth: { type: 'string', description: 'none | free-signup | key | institutional | paid' },
    rate_limits: { type: 'string' }, licence: { type: 'string' },
    verified_live: { type: 'boolean' },
    probe_result: { type: 'string', description: 'what you actually ran and saw (status, latest date, sample value); empty if not probed' },
    fit: { type: 'string', description: 'primary | fallback | baseline-only | validation-only | reject' },
    notes: { type: 'string' },
  },
  required: ['name', 'provider', 'variables', 'access', 'auth', 'verified_live', 'fit'],
}

const FAMILY_SCHEMA = {
  type: 'object',
  properties: {
    family: { type: 'string' },
    summary: { type: 'string' },
    sources: { type: 'array', items: SOURCE_SCHEMA },
    methods: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, purpose: { type: 'string' }, inputs: { type: 'string' },
      python_libs: { type: 'string' }, complexity: { type: 'string' }, recommended: { type: 'boolean' }, notes: { type: 'string' } },
      required: ['name', 'purpose', 'recommended'] } },
    recommendations: { type: 'array', items: { type: 'object', properties: {
      variable: { type: 'string' }, primary: { type: 'string' }, fallback: { type: 'string' }, baseline: { type: 'string' }, why: { type: 'string' } },
      required: ['variable', 'primary', 'why'] } },
    risks: { type: 'array', items: { type: 'string' } },
    top_picks_to_verify: { type: 'array', items: { type: 'string' }, description: '2-4 source names whose claims matter most' },
  },
  required: ['family', 'summary', 'sources', 'recommendations', 'risks', 'top_picks_to_verify'],
}

const FAMILIES = [
  { key: 'bolivia-national', title: 'Bolivia national sources',
    brief: `Bolivian national/regional public data: SENAMHI Bolivia (station network, historical series, SISMET/data portal, boletines agroclimáticos, alerts), MDRyT observatorio agroambiental / SIAPRO / Sistema de Información Agroclimática, INE Bolivia agricultural statistics, VIDECI (Viceministerio de Defensa Civil) disaster/emergency declarations by municipality, ANAPO and CAO (Santa Cruz soy & agro associations: campaign reports, crop calendars, losses 2023-24), INIAF, Gobernación de Santa Cruz, SENASAG, ABT (fires/deforestation), FAN Bolivia. For each: what data, how accessible (portal/API/PDF), history depth, and whether station histograms (daily rain, Tmax/Tmin) near the sample farms can be obtained. Identify nearest stations (Santa Cruz Viru Viru, Okinawa, Cuatro Cañadas, San Julián, Pailón, Mineros, Montero, Saavedra-CIAT) and their record lengths.` },
  { key: 'regional-national', title: 'Neighbouring national met services',
    brief: `National/regional services near Bolivia with open APIs or station data that could cover or validate the Santa Cruz lowlands: Brazil INMET (API, Mato Grosso/Rondônia stations), CEMADEN, Argentina SMN and INTA SIGA (estaciones), Paraguay DMH, Peru SENAMHI open data, CRC-SAS (Centro Regional del Clima para el Sur de América del Sur: drought monitor, SPI maps, station data), CIIFEN. Focus on what is openly downloadable and how close stations are to Santa Cruz. Also regional drought monitors (CRC-SAS SISSA) with products for Bolivia.` },
  { key: 'global-stations', title: 'Global station archives and weather histograms',
    brief: `Global station archives that redistribute Bolivian SYNOP/METAR data: NOAA GHCN-Daily (AWS/NCEI), GSOD and ISD (NCEI), Meteostat (JSON API / bulk), OGIMET SYNOP summaries, Iowa Environmental Mesonet METAR archive (SLVR, SLET, other Santa Cruz aerodromes), WMO OSCAR/Surface station list. For stations within ~150 km of the farms: list station IDs, record start, completeness (% missing days), and build a quick daily-precip and Tmax/Tmin histogram/climatology for the nearest good station (save a small CSV + summary stats). Assess suitability for bias-correcting gridded products and for validating anomalies (e.g. the 2023-24 drought).` },
  { key: 'gridded-precip', title: 'Gridded and satellite precipitation',
    brief: `Gridded daily precipitation products for anomaly percentiles with 30-year baselines: CHIRPS v2/v3 daily (0.05°) and CHIRP, CHIRPS-GEFS forecasts, GPM IMERG (Early/Late/Final), PERSIANN-CDR/PDIR-Now (CHRS data portal), MSWEP/MSWX (licence), ERA5 / ERA5-Land precipitation (Open-Meteo archive), CPC Unified, TAMSAT (Africa only? confirm), GSMaP, IRI Data Library, ClimateSERV API (SERVIR, serves CHIRPS/IMERG by polygon — probe it!), Open-Meteo, NASA POWER. Evaluate access paths without keys (ClimateSERV, CHC FTP/HTTP COGs, Planetary Computer, IRI DL, Open-Meteo) and latency (CHIRPS prelim ~2 days vs final). Probe point/polygon extraction for a sample farm and compare 2023-10..2024-03 totals across 2-3 products.` },
  { key: 'temp-eto', title: 'Temperature, reference ET (ETo) and actual ET',
    brief: `Daily Tmax/Tmin and reference evapotranspiration ETo (FAO-56 Penman-Monteith) plus actual ET: ERA5-Land and Open-Meteo et0_fao_evapotranspiration, NASA POWER (ag community, ALLSKY radiation, RH, wind -> compute ETo ourselves), AgERA5 (Copernicus CDS; key?), FAO WaPOR v3 (reference ET, actual ET, NPP — open API, check Bolivia coverage: WaPOR L1 is continental Africa/Near East? verify v3 global coverage), MODIS MOD16A2 ET, GLEAM, SSEBop (USGS FEWS NET, global dekadal), TerraClimate (monthly, long baseline), CHIRTS (Tmax/Tmin daily), MODIS LST. Compare ETo from Open-Meteo vs computing FAO-56 from NASA POWER inputs for one farm over a month. Recommend ETo source and whether to compute it ourselves (pyeto/refet libs).` },
  { key: 'soil-moisture', title: 'Soil moisture and water balance',
    brief: `Root-zone and surface soil moisture: ERA5-Land layers (Open-Meteo soil_moisture_0_to_7cm ... 28_to_100cm), SMAP L3/L4 (NASA Earthdata — login; any no-auth paths like Crop-CASMA, NASA-USDA Global soil moisture on GEE, SMAP via AppEEARS?), ESA CCI Soil Moisture (combined/active/passive, 1978+), Copernicus Land Surface Soil Moisture (Sentinel-1 1 km), NASA-USDA Enhanced SMAP, GLDAS/FLDAS (NASA, FLDAS covers LatAm?), Crop-CASMA, SoilGrids (texture -> available water capacity), HWSD. Also simple bucket water-balance approach (rain - Kc*ETo with AWC from SoilGrids) as derived root-zone indicator. Probe at least Open-Meteo soil layers and SoilGrids REST for one farm.` },
  { key: 'modis-viirs-ndvi', title: 'MODIS / VIIRS / long-record vegetation indices',
    brief: `Long-record NDVI/EVI for same-date baselines: MODIS MOD13Q1/MYD13Q1 (250 m, 16-day; Terra+Aqua staggered = 8-day), MOD09Q1 8-day surface reflectance, MCD43A4 NBAR daily 500 m, VIIRS VNP13A1/VNP09 (continuity after MODIS decommissioning — check Terra/Aqua status in 2026!), ORNL DAAC MODIS/VIIRS subset REST API (limits: <=10 dates per call, km above/below for polygon window, QA bands), AppEEARS (Earthdata login), Planetary Computer modis-13Q1-061 STAC, Google Earth Engine (needs account), eMODIS, NOAA AVHRR CDR NDVI (1981+, 0.05°). Probe ORNL subset with kmAboveBelow=1 to get a pixel window covering a farm polygon + VI Quality / pixel reliability band; measure latency of latest composite. Recommend how to aggregate pixels to a polygon and how to QA-mask.` },
  { key: 'sentinel2-landsat-hls', title: 'Sentinel-2, Landsat and HLS current imagery',
    brief: `10–30 m current-state imagery for polygon NDVI/NDMI: Sentinel-2 L2A on Microsoft Planetary Computer (STAC + signed URLs, SCL), Element84 Earth Search (AWS, sentinel-2-l2a COGs, no auth), Copernicus Data Space Ecosystem (STAC/openEO/Sentinel Hub Statistical API — free signup), NASA HLS (HLSL30/HLSS30 v2.0 30 m, LP DAAC — Earthdata login? any public COG path), Landsat C2 L2 (USGS, Planetary Computer, AWS requester pays). Actually run a Python probe: search STAC for the last 60 days over one sample farm polygon, count scenes and cloud %, read the SCL + B04/B08/B11 COG window for the polygon (rasterio/stackstac/odc-stac — install into ${ROOT}/.venv if needed via uv/pip, record what you installed), compute masked mean NDVI and NDMI, report runtime per scene. Also compute how many clear observations per month in rainy season (Dec-Mar) vs dry season.` },
  { key: 'gapfill-fusion', title: 'Interpolation, gap-filling and sensor fusion methods',
    brief: `Methods (not sources) to turn noisy, cloudy, multi-sensor observations into clean daily/weekly series and comparable baselines: NDVI smoothing (Whittaker, Savitzky-Golay, HANTS/harmonic regression, double-logistic phenology fit), cloud gap-filling, MODIS<->Sentinel-2 cross-calibration (linear/OLS over overlapping clear dates, spectral band adjustment factors), spatiotemporal fusion (STARFM, ESTARFM, FSDAF) — cost vs benefit for a hackathon, Sentinel-1 SAR backscatter/RVI as a cloud-independent vegetation proxy, station interpolation (IDW, kriging, regression kriging with elevation), bias correction of gridded rain with stations (quantile mapping, CHIRPS-style blending), percentile baselines with day-of-year moving windows (±7/±15 days) and minimum-sample rules, SPI/SPEI computation (climate_indices lib) for reference. Give Python libraries (e.g. scipy, vam.whittaker, pyts, xarray, climate_indices, pykrige) and a recommended minimal stack. Quick experiment: apply a Whittaker or SG smoother to a short real MODIS NDVI series from ORNL for one farm and report noise reduction.` },
  { key: 'sar-flood-water', title: 'SAR, flood and surface water',
    brief: `Flood and waterlogging detection/proxies: Sentinel-1 GRD/RTC on Planetary Computer (sentinel-1-rtc) and Earth Search, Copernicus Global Flood Monitoring (GFM, Sentinel-1 based, API/WMS), GloFAS river discharge (Open-Meteo Flood API — probe Río Grande / Piraí near the farms), JRC Global Surface Water (occurrence, recurrence), MODIS NRT Global Flood Product (NASA LANCE), Dartmouth Flood Observatory archive, VIIRS flood maps (NOAA/JPSS), Copernicus EMS rapid mapping activations in Bolivia (e.g. 2024 floods Beni/Santa Cruz). Probe the Open-Meteo flood API and a Sentinel-1 RTC STAC search over one farm. Recommend a flood signal that works for a lender (event exposure) and a field-level waterlogging proxy.` },
  { key: 'events-catalogs', title: 'Disaster and drought event catalogs',
    brief: `Sources for the "recent climate disasters" panel (bank wants the top recent climate disasters affecting their portfolio): GDACS API (events by country, GeoJSON footprints), ReliefWeb API (disasters + reports for Bolivia; check v2 appname requirement), EM-DAT (registration), Copernicus Global Drought Observatory (GDO) / European Drought Observatory WMS/API (SPI, CDI, fAPAR anomaly for South America), FEWS NET, NASA FIRMS active fires (MODIS/VIIRS, API key free? CSV country downloads without key) — fires & smoke are a major Santa Cruz hazard in drought years, Copernicus EMS activations, DesInventar (Bolivia historical disasters by municipality), VIDECI declarations, GEOGLAM Crop Monitor, Drought.gov global? Probe GDACS and ReliefWeb for Bolivia 2023-2026 events and FIRMS for Santa Cruz. Recommend how to build an event list with footprints + date ranges + severity that we can intersect with farm polygons.` },
  { key: 'crop-masks-phenology', title: 'Crop masks, calendars and phenology',
    brief: `Data to know WHAT is planted and WHEN (to weight stress by crop stage): MapBiomas Bolivia (annual land cover 1985+, soy/agriculture classes, GEE/asset downloads), ESA WorldCereal (2021 global crop type/temporary crops, seasons), ESA WorldCover, Dynamic World (near-real-time 10 m land cover), USDA FAS crop calendars & IPAD/Crop Explorer, FAO GIEWS country crop calendars (Bolivia), GEOGLAM crop calendars, MODIS MCD12Q2 land surface phenology (green-up/peak/senescence), ANAPO campaign calendars (summer/winter soy in Santa Cruz), CIAT/INIAF. Also crop coefficient (Kc) tables from FAO-56 for soy, maize, wheat, sorghum, sunflower, rice, sugarcane, quinoa, potato, chia. Probe what is downloadable without keys and whether a farm polygon can be checked against a crop/agriculture mask.` },
  { key: 'frost-heat-hail', title: 'Frost, heat and hail signals',
    brief: `Signals for frost, heat stress and hail: MODIS LST day/night (MOD11A1/MYD11A1, 1 km — night LST as frost proxy), ERA5/ERA5-Land hourly 2 m temperature (Open-Meteo hourly) for frost hours and heat degree-hours, CHIRTS-daily, NASA POWER, VIIRS LST; hail: GOES-16/19 ABI overshooting tops & GLM lightning (NOAA AWS public buckets), ERA5 CAPE / instability indices, IMERG 30-min intensity, hail climatologies for South America (e.g. published TRMM/GPM hail-storm climatologies; Santa Cruz is a hail hotspot), ESSL? (Europe only). Also post-event NDVI-drop detection as damage evidence. Probe Open-Meteo hourly temperature and CAPE for a farm, and a GOES GLM file listing for a recent date. Recommend lightweight, defensible frost/heat/hail indicators.` },
  { key: 'platforms-access', title: 'Compute and access platforms',
    brief: `Platforms that serve many of the above without heavy local processing, and their terms for a hackathon prototype becoming a sponsor product: Microsoft Planetary Computer (STAC + Data API; status of the hub/compute in 2026, any deprecation notes), Element84 Earth Search, Google Earth Engine (noncommercial/commercial terms, service accounts), Copernicus Data Space Ecosystem (openEO free credits, Sentinel Hub Statistical API quota), NASA Earthdata (AppEEARS, CMR, Harmony, OPeNDAP — signup), Open-Meteo (non-commercial free tier licence, commercial pricing!), NASA POWER (open), SERVIR ClimateSERV, Copernicus CDS (key), AWS Open Data. For each: auth, quotas, licence for commercial use (Suyana is a company), stability, python client libs (pystac-client, planetary-computer, openeo, earthaccess, cdsapi, openmeteo-requests). Probe a couple of keyless endpoints for availability and response time. Flag licence risks clearly (e.g. Open-Meteo free API is non-commercial).` },
]

const CHILE_SITES = `Chile test locations (lon/lat): Quillota avocados (-71.25,-32.88); Ovalle/Limari table grapes (-71.20,-30.60); Requinoa cherries (-70.80,-34.28); Santa Cruz (Colchagua) wine grapes (-71.37,-34.64); Curico apples & cherries (-71.24,-34.98); Talca vineyards (-71.66,-35.43); Parral rice (-71.83,-36.14); Chillan blueberries (-72.10,-36.60); Los Angeles maize & wheat (-72.35,-37.47); Temuco wheat & oats (-72.60,-38.74); Osorno potatoes (-73.13,-40.57).`
const CHILE_NOTE = `MARKET PRIORITY: for our team CHILE is MORE important than Bolivia (team decision ${args.today}). Treat Chile as the primary market. Use the Chile test locations below instead of the Bolivian farms (the Bolivian list above is only for the other families). Chilean agriculture is mostly IRRIGATED (central valley fruit, vineyards), so water availability (snowpack, rivers, reservoirs, water-scarcity decrees) can matter more than rain on the field; spring frost, heat/sunburn, rain at harvest (cherry cracking), wildfire and the 2010s-2020s megadrought are key perils. Search in Spanish. ${CHILE_SITES}`
const CHILE_FAMILIES = [
  { key: 'chile-national-met', title: 'Chile national met and gridded climate', brief: `${CHILE_NOTE}
Chilean national weather/climate data: Direccion Meteorologica de Chile (DMC: climatologia.meteochile.gob.cl, station data services/API and their registration terms, frost/heat alerts), CR2 (Centro de Ciencia del Clima y la Resiliencia: Explorador Climatico explorador.cr2.cl, CR2MET gridded daily precip/Tmax/Tmin ~0.05 deg since ~1960 and its latest version/latency, CR2 station database), Chile drought indices. Probe what is downloadable without keys. Compare one site's 2023-2024 daily rain/temperature from a national source vs ERA5-Land (Open-Meteo) to quantify reanalysis bias in complex Andean/coastal terrain. Identify the nearest long-record stations to each test location.` },
  { key: 'chile-agromet', title: 'Chile agrometeorological networks', brief: `${CHILE_NOTE}
Agro-meteorological station networks: INIA Agromet / Red Agroclimatica Nacional (agromet.inia.cl, hundreds of stations, hourly data, frost alerts, degree days, chill hours/portions, ETo), CEAZA-Met (Coquimbo region), Minagri agroclimatic services (Observatorio Agroclimatico / agroclima), fruit-industry networks (e.g. FDF, Fedefruta frost warning systems), Agrometeorologia UdeC. For each: station density near the test locations, variables (incl. ETo, frost hours), history, access (open download, API, scrape, registration), licence. Probe at least one station download.` },
  { key: 'chile-water', title: 'Chile water availability: rivers, snow, reservoirs, drought monitor', brief: `${CHILE_NOTE}
Water-availability signals for irrigated agriculture: DGA (Direccion General de Aguas) hydrometric, snow-course and reservoir data (SNIA / DGA official data portal, any API), DOH/DGA reservoir levels (embalses), water-scarcity decrees (decretos de escasez hidrica) by basin/commune, CAMELS-CL catchment dataset (CR2), snow cover (MODIS MOD10A1, Andes snow products) and snow water equivalent reanalyses for the Andes, Monitor de Sequia de Chile / Observatorio Agroclimatico (SPI, SPEI, VCI, NDVI anomaly maps), GloFAS river discharge via Open-Meteo for central-Chile rivers (Aconcagua, Cachapoal, Tinguiririca, Maule, Nuble, Biobio). Probe live where possible. Recommend a lender-relevant "water availability" indicator per farm (basin-level) and how it would combine with field NDVI/ET.` },
  { key: 'chile-ag-stats-credit', title: 'Chile agricultural statistics, cadastres and ag credit/insurance context', brief: `${CHILE_NOTE}
What is planted where and who lends/insures: ODEPA (statistics, prices, regional data), CIREN catastro fruticola (orchard cadastre by species, region, commune; geospatial layers via IDE Minagri), IDE Minagri geoportal (land use, crop maps, WMS/WFS), INE Censo Agropecuario 2021, MapBiomas Chile (if it exists) or Chile land-cover maps, INDAP (state agricultural lender: credit products, emergency credit/repactation after disasters), Agroseguros / Comite de Seguro Agricola (subsidised crop insurance: covered perils, any loss statistics), CMF / Banco Central data on agricultural lending, BancoEstado agro. Probe WMS/WFS or downloads that would let us check a farm polygon against an orchard/crop layer.` },
  { key: 'chile-emergencies', title: 'Chile disasters, agricultural emergencies and wildfires', brief: `${CHILE_NOTE}
Sources for the recent-disasters panel in Chile: SENAPRED (ex-ONEMI) alerts and historical events, Minagri "emergencia agricola" declarations by commune (drought, frost, floods, fires), CONAF wildfire statistics and fire perimeters (incl. 2023 Nuble/Biobio/Araucania and 2024 Valparaiso fires), Copernicus EMS activations in Chile (2023 floods, fires), GDACS/ReliefWeb/EM-DAT Chile, DesInventar Chile, NASA FIRMS for central/southern Chile, DMC alert archive, June/August 2023 central-Chile floods. Probe what has an API or downloadable footprints with dates; recommend how to build Chile event footprints to intersect with farm polygons.` },
  { key: 'chile-satellite-fit', title: 'Satellite fit for Chilean farms', brief: `${CHILE_NOTE}
How well the satellite stack fits Chilean farms: run a Python probe (Planetary Computer or Earth Search STAC, Sentinel-2 L2A with SCL mask) over 2 test locations (one central-valley orchard, one southern cereal site): clear observations per month (winter rainy season vs summer), masked mean NDVI/NDMI over a ~20-50 ha polygon; MODIS 250 m mixed-pixel problem for small orchards (typical orchard size), evergreen (avocado) vs deciduous (cherry, grape) NDVI seasonality and what an anomaly means for each; Landsat/HLS for longer 30 m baselines; MODIS LST night as a frost proxy in valley cold-air pools vs station Tmin. Install anything needed into ${ROOT}/.venv and record it. Recommend per-crop NDVI usage for Chile.` },
  { key: 'chile-crops-perils', title: 'Chilean crops, phenology and peril thresholds', brief: `${CHILE_NOTE}
Agronomy for the formulas: crop calendars and phenology for cherries, table grapes, wine grapes, apples, avocados, blueberries, walnuts, kiwi, wheat, maize, rice, potatoes, canola in Chile; critical thresholds lenders/insurers use: spring frost by bud stage (critical temperature tables), rain at cherry harvest (cracking), heat/sunburn (>32-35 C), chill hours/portions deficits, irrigation water shortage, hail; FAO-56 Kc for orchards and vines; how Agroseguros/insurers define these perils. Recommend which perils and thresholds our zones should carry for Chile and how this changes ADR-0001's rain-fed drought logic (crop list, perils, irrigated default). Cite sources (INIA, ODEPA, universities).` },
  { key: 'chile-global-stations', title: 'Global station archives for Chile', brief: `${CHILE_NOTE}
Global archives redistributing Chilean station data: NOAA GHCN-Daily, GSOD/ISD, Meteostat, OGIMET, Iowa Environmental Mesonet METAR (SCEL Santiago, SCIE Concepcion, SCCH Chillan, SCTC Temuco, SCJO Osorno, SCSE La Serena, SCRG Rancagua, others). For stations near the test locations: IDs, record start, completeness, and a quick daily precip and Tmax/Tmin histogram/climatology for 1-2 good stations (small CSV + stats). Compare with ERA5-Land at the same point for 2023-2024. Assess suitability for validation and bias correction.` },
]

const ALL_FAMILIES = [...FAMILIES, ...CHILE_FAMILIES]

const familyPrompt = (f) => `${COMMON}
YOUR FAMILY: ${f.title} (key: ${f.key}). Your folder: ${OUT}/families/${f.key}/
SCOPE:
${f.brief}
Be thorough: search the web (WebSearch/WebFetch are available via ToolSearch) and probe live. Aim for depth on the sources that matter for Santa Cruz, Bolivia, but list notable alternatives too. Finish by writing notes.md, then return the structured result.`

const verifyPrompt = (f, r) => `${COMMON}
You are an ADVERSARIAL VERIFIER for the "${f.title}" family. Another researcher claims the following top picks and recommendations. Your job is to try to REFUTE their key claims by independently re-probing live (different coordinates from the sample farms, different date ranges) and checking documentation: access really keyless?, history start, latency/latest date, Santa Cruz coverage, licence (especially commercial use), rate limits, data quality (gaps, units).
Top picks: ${JSON.stringify(r.top_picks_to_verify)}
Their recommendations: ${JSON.stringify(r.recommendations)}
Their source entries for the top picks: ${JSON.stringify(r.sources.filter(s => (r.top_picks_to_verify||[]).some(t => s.name.toLowerCase().includes(String(t).toLowerCase().slice(0,12)) || String(t).toLowerCase().includes(s.name.toLowerCase().slice(0,12)))))}
Write your findings to ${OUT}/families/${f.key}/verification.md (only that file). Return the structured verdicts.`

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: { type: 'array', items: { type: 'object', properties: {
      source: { type: 'string' }, claim: { type: 'string' }, status: { type: 'string', description: 'confirmed | corrected | refuted | unverifiable' },
      evidence: { type: 'string' }, correction: { type: 'string' } }, required: ['source', 'claim', 'status', 'evidence'] } },
    recommendation_changes: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdicts', 'recommendation_changes'],
}

phase('Research')
const results = await pipeline(
  ALL_FAMILIES,
  (f) => agent(familyPrompt(f), { label: `research:${f.key}`, phase: 'Research', schema: FAMILY_SCHEMA }),
  (r, f) => r ? agent(verifyPrompt(f, r), { label: `verify:${f.key}`, phase: 'Verify', schema: VERIFY_SCHEMA }).then(v => ({ key: f.key, title: f.title, research: r, verify: v })) : null,
)
const done = results.filter(Boolean)
const failed = ALL_FAMILIES.filter(f => !done.find(d => d.key === f.key)).map(f => f.key)
if (failed.length) log(`Families with no result: ${failed.join(', ')}`)
log(`Researched ${done.length}/${ALL_FAMILIES.length} families, ${done.reduce((n, d) => n + (d.research.sources||[]).length, 0)} sources`)

phase('Gaps')
const compact = done.map(d => ({
  family: d.key,
  recs: d.research.recommendations,
  sources: (d.research.sources||[]).map(s => `${s.name} [${s.fit}; auth=${s.auth}; live=${s.verified_live}]`),
  risks: d.research.risks,
  verify: (d.verify?.verdicts||[]).map(v => `${v.source}: ${v.status} — ${v.correction||''}`),
}))
const critic = await agent(`${COMMON}
You are the COMPLETENESS CRITIC for the data discovery. Below is a compact view of everything the ${done.length} family researchers found and what verifiers confirmed/refuted.${failed.length ? ` Families that returned nothing: ${failed.join(', ')}.` : ''}
${JSON.stringify(compact)}
Identify the most important GAPS: variables with no verified primary+fallback, unverified critical claims, licence risks for a commercial sponsor, national sources (Bolivia) not actually probed, missing method decisions (e.g. polygon aggregation, cross-calibration), contradictions between families. Return at most 6 concrete follow-up research tasks, each answerable by one agent in ~20 minutes with live probes. Do not write files.`, {
  label: 'critic', phase: 'Gaps',
  schema: { type: 'object', properties: {
    gaps: { type: 'array', items: { type: 'string' } },
    tasks: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, task: { type: 'string' } }, required: ['key', 'task'] } },
  }, required: ['gaps', 'tasks'] },
})
const tasks = (critic?.tasks || []).slice(0, 6)
const followups = (await parallel(tasks.map((t, i) => () => agent(`${COMMON}
FOLLOW-UP TASK ${t.key}: ${t.task}
Write your notes ONLY to ${OUT}/followups/${String(i + 1).padStart(2, '0')}-${t.key.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.md. Return a concise text answer with verified facts (mark anything unverified).`, { label: `followup:${t.key}`, phase: 'Gaps' })))).map((r, i) => ({ task: tasks[i], answer: r })).filter(x => x.answer)

phase('Synthesize')
const synth = await agent(`${COMMON}
You are the SYNTHESIZER. Produce the discovery deliverables from the family research, verifications, critic and follow-ups below. Also read the notes.md / verification.md files under ${OUT}/families/ and ${OUT}/followups/ as needed.
FAMILY RESULTS: ${JSON.stringify(done.map(d => ({ key: d.key, research: d.research, verify: d.verify })))}
CRITIC: ${JSON.stringify(critic)}
FOLLOW-UPS: ${JSON.stringify(followups)}

Write these files (you own them; overwrite if present):
1. ${OUT}/CATALOG.md — the human report for the team, sentence case, concise:
   - one-paragraph summary;
   - MARKET PRIORITY: Chile is the primary market, Bolivia second (team decision). Chile sections come first;
   - VARIABLE → SOURCE MATRIX table: region (Chile / Bolivia / global) | variable | primary | fallback | baseline source & depth | resolution | latency | auth | licence (commercial OK?) | verified live?;
   - Chile national sources section (DMC, CR2/CR2MET, INIA Agromet, DGA water, CIREN/ODEPA/IDE Minagri, SENAPRED/CONAF/emergencia agricola) and what changes for irrigated Chilean agriculture;
   - Bolivia national sources section (what exists, what is actually usable, nearest stations with record length);
   - station-based weather histograms/climatology findings (and how we use stations: validation / bias-correction);
   - satellite imagery & NDVI pipeline (MODIS baseline + Sentinel-2 current: access path, polygon aggregation, QA masks, cross-calibration, clear-observation counts by season);
   - interpolation / gap-filling / fusion: recommended minimal method stack and what we explicitly skip;
   - events catalog plan for the "recent climate disasters" panel;
   - licence & commercial-use risks;
   - refuted/corrected claims (from verifiers) so nobody repeats them;
   - open questions for the team.
2. ${OUT}/catalog.json — machine-readable: { generated, sources: [...all deduped source entries with verification status...], matrix: [...rows...], methods: [...] }. This will seed the service's source registry.
Do NOT write ADRs (the product owner does that next). Do not edit any other files. Return a short text summary: top findings per variable, biggest risks, and the list of files written.`, { label: 'synthesize', phase: 'Synthesize' })

phase('Product owner')
const PO_SCHEMA = {
  type: 'object',
  properties: {
    adrs: { type: 'array', items: { type: 'object', properties: {
      number: { type: 'string' }, file: { type: 'string' }, title: { type: 'string' },
      status: { type: 'string', description: 'Accepted | Proposed' }, decision_summary: { type: 'string' },
      needs_team_input: { type: 'string' } }, required: ['number', 'file', 'title', 'status', 'decision_summary'] } },
    backlog_file: { type: 'string' },
    v1_scope_summary: { type: 'string' },
    open_questions_for_team: { type: 'array', items: { type: 'string' } },
  },
  required: ['adrs', 'backlog_file', 'v1_scope_summary', 'open_questions_for_team'],
}
const po = await agent(`${COMMON}
You are the PRODUCT OWNER for v1. The data investigation is finished. Your job: turn the data discoveries into recorded decisions (ADRs) and a prioritised v1 backlog, always from the lender's point of view (Suyana's bank clients: "which loans are under climate stress, and why", plus "top recent climate disasters affecting my portfolio") and the hackathon reality (demo Sunday 9:30 AM, judged by Suyana; a credible, traceable, working demo beats breadth).

Read first: ${ROOT}/docs/adr/0001-v0-product-and-risk-definitions.md, ${ROOT}/docs/adr/0002-v1-real-data-architecture.md, ${OUT}/CATALOG.md, ${OUT}/catalog.json, and skim ${OUT}/families/*/notes.md, verification.md and ${OUT}/followups/*.md for evidence.
Synthesizer summary: ${typeof synth === 'string' ? synth : JSON.stringify(synth)}

MARKET PRIORITY (team decision ${args.today}): CHILE is MORE important than Bolivia. Chile is the primary market and Bolivia the second region; the chile-* families are first-class evidence. Every ADR must state the per-region choice where sources differ. The backlog must include a Chile sample portfolio, Chilean crops (fruit orchards, vineyards, cereals) and perils (spring frost, water availability/megadrought, harvest rain, heat, wildfire), and must flag where ADR-0001/0002 assumptions (crop list, rain-fed drought logic, Santa Cruz defaults and map centre) are superseded for Chile.
An unnumbered accepted ADR already exists at ${ROOT}/docs/adr/source-access-patterns.md (cached fetch path, provenance, concurrency limits, parallel event merge, rejected header spoofing). Assign it the next free number after your ADRs (rename the file to 00NN-source-access-patterns.md, set the number in its title, keep its content) and include it in the index.
RECORD DATA DISCOVERIES AS ADRs in ${ROOT}/docs/adr/, numbered from 0003 upward, one ADR per coherent data decision (expect roughly 5–8), e.g.:
- precipitation & weather station data (gridded primary/fallback, baseline depth, role of Bolivian/global stations: validation and/or bias correction, weather histograms);
- temperature & ETo (source, computed vs served, frost/heat indicators);
- soil moisture & water balance;
- vegetation: MODIS baseline + Sentinel-2 current pipeline (access path, polygon aggregation, QA/cloud masks, smoothing/gap-filling, cross-calibration, clear-observation reality by season);
- flood & surface water;
- disaster/event catalogs for the recent-disasters panel;
- crop masks, calendars & phenology;
- access platforms & licensing (commercial-use risk for the sponsor), and the source-wrapper registry order for the FastAPI service.
Each ADR follows the style of ADR-0001/0002 exactly (title "# ADR-000N: ...", Status, Date ${args.today}, Builds on, Context, Decisions as D1..Dn with tables where useful, Consequences). Every decision must cite its evidence (verified live? probe result, verifier status) — never state an unverified claim as fact; refuted claims go in a "Rejected / refuted" note. Status: "Accepted" when the evidence is verified and the choice is clearly in v1's interest; "Proposed" when it needs the team's call (say exactly what call). Sentence case, concise, plain language a banker could follow in the Context sections.
Also update ${ROOT}/docs/adr/README.md (create it): an index table of all ADRs (number, title, status, one-line summary).

WRITE THE v1 BACKLOG at ${ROOT}/docs/backlog/v1.md: prioritised (MoSCoW) user stories with acceptance criteria, grouped into: data wrappers (in implementation order), formulas (one story per signal: rain percentile, dry spell, soil moisture, ETo/water balance, NDVI z, NDMI, heat, frost, flood, hail proxy, events), service/API, frontend integration (provenance display, data-as-of, loading/error/offline snapshot), validation (2023–24 drought backtest, golden-value tests), and demo/pitch. Mark what is explicitly OUT of v1. Each story references the ADR that justifies it.

Only write inside ${ROOT}/docs/adr/ and ${ROOT}/docs/backlog/. Do not modify ADR-0001 or ADR-0002 (if a discovery contradicts them, record that in the new ADR as a superseding decision and note it in the README index). Return the structured summary.`, { label: 'product-owner', phase: 'Product owner', schema: PO_SCHEMA })

const poReview = await agent(`${COMMON}
You are an independent REVIEWER of the product owner's ADRs and backlog. Files: ${ROOT}/docs/adr/README.md, ${ROOT}/docs/adr/0003-*.md and higher, ${ROOT}/docs/backlog/v1.md. Evidence: ${OUT}/CATALOG.md, ${OUT}/catalog.json, ${OUT}/families/*/{notes,verification}.md, ${OUT}/followups/*.md.
Check every ADR decision against the evidence: unverified claims stated as fact, refuted claims reused, wrong numbers (resolution, history start, latency, auth, licence), contradictions between ADRs or with ADR-0001/0002, missing fallback for a Must variable, backlog stories without acceptance criteria or ADR reference, scope unrealistic for a Sunday-morning demo. Fix problems directly in the ADR/backlog files (minimal edits, keep the style), and do not touch ADR-0001/0002 or anything outside docs/adr and docs/backlog. Return a short list of what you changed and anything you could not resolve.`, { label: 'po-review', phase: 'Product owner' })

return {
  product_owner: po,
  po_review: poReview,
  families_done: done.map(d => d.key), families_failed: failed,
  source_count: done.reduce((n, d) => n + (d.research.sources||[]).length, 0),
  verify_summary: done.map(d => ({ key: d.key, statuses: (d.verify?.verdicts||[]).map(v => v.status) })),
  critic_gaps: critic?.gaps, followup_keys: tasks.map(t => t.key),
  synthesis: synth,
}
