# Crop masks, calendars and phenology: data discovery

Family key: `crop-masks-phenology`. Probed 2026-11-07 (UTC). No accounts or keys were used.

**Question:** for each farm, what is planted, and when? We need this to weight stress by crop stage. We also want to check that a farm polygon actually sits on cropland.

## TL;DR

1. **Cropland / soy masks have keyless, polygon-ready paths that work from Python.** All were tested at the 12 farms:
   - **GLAD/UMD South America soybean**: 30 m, 2001–2024, HTTP range reads.
   - **MapBiomas Bolivia**: 30 m, a source.coop COG mirror for 2019–2024. The official GCS bucket returns 403.
   - **ESA WorldCover 2020/2021** and **Esri/IO annual LULC 2017–2023**: 10 m, on Planetary Computer.
   - **ESA WorldCereal 2021**: 10 m, through the public Terrascope titiler `/statistics` endpoint, which takes a GeoJSON polygon.
2. **Four of the 12 sample farms are not on cropland.** All five masks agree on this. Move them before the demo (see "Sample-farm check" below):
   - Estancia Los Tajibos is forest.
   - Granja Las Londras is in the Río Grande channel.
   - Agrícola Warnes Sur is pasture or forest.
   - Arrocera Mineros is a mosaic plus sand bars.
3. **Calendars:**
   - The **FAO Crop Calendar API** is keyless JSON. Its AEZ 003 "Oriental plains" covers summer and winter soy, sorghum (2 seasons), wheat and rice.
   - It has **no lowland maize, sunflower, sugarcane or chia**. GEOGLAM fills maize and wheat.
   - The global gridded **GGCMI** calendar only knows the summer season. It is wrong for the Santa Cruz winter campaign, where sorghum, wheat and sunflower are sown in Mar–May.
   - Draft curated table: `sample_crop_calendar_santacruz.json`, with provenance for each row.
4. **Phenology:**
   - **MCD12Q2** (500 m, 2001–2025) through the ORNL REST API is keyless, but it was down for part of the session (502).
   - At the farm pixels it shows the summer green-up (Nov–Dec) and, at Okinawa, a second (winter) cycle in 2016–2021.
   - Recommended approach: **derive the season per field from its own MODIS/S2 NDVI history**, and use MCD12Q2 as a check.
5. **Kc:** FAO-56 Table 12/11 values are in `sample_kc_fao56.json`, parsed from the FAO HTML. Quinoa and chia come from the literature only and are not verified.
6. **The main limitation:** every mask is annual and ends in 2021–2024. None of them says what is growing *this* season. Current-season "is the field active, and at what stage" has to come from the NDVI families (MODIS / Sentinel-2).

## What was probed (live)

| Source | Path tested | Result |
|---|---|---|
| GLAD/UMD SA Soybean (Song et al. 2021) | `https://glad.umd.edu/projects/AnnualClassMapsV1/SouthAmerica_Soybean_{YYYY}.tif` via GDAL `/vsicurl` | HTTP 200, 315 MB/yr, tiled 256x256 GTiff, EPSG:4326, 0.00025° (~27 m), values 0/1. Years 2001–2024; 2025 returns 404. 12 farm windows in ~0.7 s per year. File Last-Modified 2025-11-07. |
| GLAD regional sanity check | Soy fraction of the box (-63.35..-62.40, -17.80..-16.80), 2015–2024 | 0.17, 0.19, 0.15, 0.22, 0.21, 0.20, 0.27, 0.27, **0.34 (2023)**, **0.075 (2024)**. The 2024 layer looks incomplete for Bolivia (see Risks). |
| MapBiomas Bolivia official | `storage.googleapis.com/mapbiomas-public/initiatives/bolivia/lulc/collection_04/coverage/coverage-bolivia_classification_2025.tif` (linked from bolivia.mapbiomas.org/downloads) | **403 AccessDenied** to anonymous callers. Same for Col 3 paths, and even for Brazil/Peru files. The bucket is not anonymous today. Collection 4 (1985–2025) exists (legend PDF fetched). GEE asset needs a free Google/GEE account (not tried). |
| MapBiomas Bolivia mirror | `https://data.source.coop/tristangruppwri/mapbiomas/mapbiomas-bolivia/` STAC + COG per year | HTTP 200. 6 COGs (2019–2023 = Col 2, 2024 = Col 3), ~150 MB each, 30 m. 12 farm windows in 2.5–5.7 s per year. CC-BY-SA-4.0. |
| ESA WorldCover 2020 v1 / 2021 v2 | Planetary Computer STAC `esa-worldcover`, anonymous SAS | HTTP 200. 10 m, class 40 = cropland. ~0.6–3 s per farm (both years). |
| Esri/IO 10 m annual LULC v02 | PC `io-lulc-annual-v02` (2017–2023) | HTTP 200. Class 5 = crops. ~1.1–4.6 s per farm (7 years). |
| ESA WorldCereal 2021 | `stac.terrascope.be` search: public, 0.37 s. GeoTIFF on `services.terrascope.be/download/...`: **401** (free Terrascope account). **`titiler.terrascope.be/.../point` and `/statistics` (POST GeoJSON): public, 200, ~0.5 s.** | AEZ 20087 covers our farms. Products: temporarycrops (annual), maize main/second, wintercereals, activecropland. Values 0/100. |
| MCD12Q2 + MCD12Q1 | `modis.ornl.gov/rst/api/v1/MCD12Q2/subset` | First attempt: **502 Proxy Error after 60 s**. Later: 200, ~1–3 s per band call. Bands: Greenup, MidGreenup, Maturity, MidGreendown, Senescence, Dormancy (×2 cycles), NumCycles, EVI_Amplitude/Area/Minimum, QA. **There is no "Peak" band (400)**. Use Maturity / MidGreenup. Years 2001–2025. MCD12Q1 LC_Type1 = 12 (croplands) at Cuatro Cañadas and Okinawa every year 2015–2024; Tajibos = 4/8 (forest/savanna). |
| FAO Crop Calendar API | `https://api-cropcalendar.apps.fao.org/api/v1/countries/BO/{aez,crops,cropCalendar}?language=en` | HTTP 200, 0.5–1.3 s, keyless JSON. 5 AEZs, 32 crop×AEZ entries, lastUpdated 19/03/2025. Saved: `sample_fao_cropcalendar_BO.json`. |
| GEOGLAM CM4EW sub-national calendars v1.3 | Zenodo 15850408 (554 MB zip). Only the `.dbf` (2 MB) was pulled through HTTP range (`httpzip.py`). | HTTP 200. Bolivia: only **Maize 1** (planting-stage start DOY 274, veg→repro DOY 1, ripening/harvest DOY 75, end DOY 121, out-of-season DOY 152) and **Winter Wheat** (DOY 91/152/244/274/305). These are the same values for every department. **No soybean in the crop list.** Saved: `sample_geoglam_calendars_bolivia.json`. |
| GEOGLAM BACS crop-type masks | Zenodo 7230863 (7 MB zip, CC-BY-4.0) | Listed only (HTTP 200), not opened. Coarse (~0.05°) % area per crop. |
| GGCMI Phase 3 crop calendar | Zenodo 5062513, ~100 kB NetCDF per crop | HTTP 200, 0.6–0.9 s each. At the farm cells: soy plant 16-Nov / maturity 10-Apr (145 d); maize 22-Oct or 16-Nov / 29-Apr; **sorghum, sunflower, spring and winter wheat all 01-Dec / 30-Apr–08-May (wrong for Santa Cruz's winter crops)**; rice 31-Oct / 28-Feb; sugarcane all year. |
| FAO-56 Kc | `https://www.fao.org/4/x0490e/x0490e0b.htm` Tables 11/12 | HTTP 200, parsed. See `sample_kc_fao56.json`. |
| USDA FAS IPAD / Crop Explorer | `ipad.fas.usda.gov/...` | **503 "IPAD retired"** page that redirects to `www.fas.usda.gov/data/production/...`. That page returns **403** to curl and WebFetch (Akamai). Not usable by a script. |
| Dynamic World | Only in GEE (`GOOGLE/DYNAMICWORLD/V1`) | No keyless path found. Not probed (needs a GEE account). |
| ANAPO / CAO / INIAF | anapobolivia.org, cao.org.bo/estadisticas, iniaf.gob.bo | ANAPO **406** to curl. CAO stats page has no file links (JS-rendered). INIAF has a "datos-e-informacion-estadistica" page (not explored). These are manual intel sources only. |

### Sample-farm check: class mix in a ~1 km box around each coordinate

| Farm (crop) | GLAD soy 2023 | MapBiomas 2024 | WorldCover 2021 | Esri LULC 2023 | WorldCereal 2021 temp. crops | Verdict |
|---|---|---|---|---|---|---|
| Estancia Los Tajibos (soy) | 0.00 | forest 0.84 | tree 0.89 | trees 0.87 | 0.00 | **not cropland, move it** |
| Agropecuaria Brecha 8 (maize) | 0.15 | other crops 0.71 | grass 0.64, crop 0.16 | crops 0.69 | 0.03 | cropland (mixed) |
| Colonia Cuatro Cañadas L7 (soy) | 0.90 | soy 0.71 | crop 0.88 | crops 1.00 | 0.81 | cropland, soy |
| Hacienda El Cusi (sorghum) | 0.81 | soy 0.68 | crop 0.76 | crops 1.00 | 0.60 | cropland |
| Agrícola Pailón Norte (wheat) | 0.41 | other crops 0.64 | crop 0.59 | crops 0.92 | 0.00 | cropland (WorldCereal misses it) |
| Granja Las Londras (sunflower) | 0.07 | river 0.44, sand 0.23 | water 0.50 | rangeland/water/bare | 0.00 | **river channel, move it** |
| Finca Okinawa Dos (maize) | 1.00 | soy 1.00 | crop 1.00 | crops 0.92 | 0.99 | cropland, soy-dominated |
| Parcela Okinawa Uno (soy) | 0.06 | other crops 0.84 | crop 0.61 | crops 0.97 | 0.39 | cropland |
| Arrocera Mineros (rice) | 0.00 | other crops 0.33, mosaic, sand | bare 0.34, tree 0.34 | trees 0.48 | 0.02 | **marginal, move it** |
| Cañaveral San Antonio (sugarcane) | 0.00 | other crops 0.92 | crop 0.55 | crops 0.99 | 0.10 | cropland, not soy (fits cane) |
| Agrícola Warnes Sur (soy) | 0.00 | pasture 0.73 | tree 0.48, grass 0.43 | trees 0.58 | 0.00 | **not cropland, move it** |
| Estancia Mineros Norte (soy) | 0.00 | other crops 0.77 | crop 0.56 | crops 0.93 | 0.25 | cropland |

Full outputs: `probe_glad_soy.out`, `probe_mapbiomas_sourcecoop.json`, `probe_pc_landcover.json`, `probe_worldcereal_titiler.json`.

WorldCereal crop-type layers under-detect here. Maize is 0.00 at both "maize" farms, and wintercereals is ≤0.08 everywhere. Use WorldCereal only for `temporarycrops` and per-season `activecropland`. Note that `activecropland` is masked outside temporary crops, so the fractions in the JSON are shares of valid pixels.

### Season windows that WorldCereal embeds for AEZ 20087 (from asset names)

| Product | Window |
|---|---|
| tc-annual | 2020-10-27 → 2021-10-27 |
| tc-maize-second | 2020-10-17 → 2021-04-16 (the summer campaign) |
| tc-maize-main | 2020-12-12 → 2021-08-11 |
| tc-wintercereals | 2021-03-09 → 2021-10-27 (the winter campaign) |

These windows are a usable cross-check for the two-campaign calendar.

### MCD12Q2 at the farm pixel (ORNL, `sample_mcd12q2_3farms.json`)

**Colonia Cuatro Cañadas** (IGBP 12 croplands, every year):

- One cycle in most years.
- Green-up 15-Nov…13-Dec; mid-green-up/maturity in January; senescence Feb–Mar.
  - 2019: 15-Nov / 09-Feb.
  - 2022: 02-Dec / 14-Jan / 10-Feb.
  - 2025: 11-Nov / 08-Jan / 13-Feb.
- In 2020 it found a second winter cycle (green-up 02-May, senescence 16-Jul).
- 2023 and 2024 are fill (32767). The product is gappy exactly in the drought years.

**Finca Okinawa Dos:**

- **Two cycles each year 2016–2021**: summer (green-up Oct–Dec, senescence Feb) and winter (green-up May, senescence Jul).
- **One cycle in 2023–2025.** The winter crop was dropped or failed, which matches the 2023–24 drought.

This is exactly the kind of signal we want. But at 500 m it mixes fields, and the yearly product lags by about a year. For the live season, derive the dates from 250 m MOD13Q1 or S2.

## Recommended primary and fallback per variable

| Variable | Primary | Fallback | Baseline / validation |
|---|---|---|---|
| **Cropland mask** (is the polygon farmland?) | MapBiomas Bolivia 30 m (mirror COG, latest 2024). Collapse {18, 39, 40, 72} → agriculture, and add 21 (mosaic) as "partial". | ESA WorldCover 2021 (class 40) on PC. Esri/IO 2017–2023 for "ever cropped in last N years". | WorldCereal 2021 temporarycrops through titiler `/statistics`, as a polygon check. |
| **Soy mask / crop type** | GLAD SA soybean 30 m. Use **max over 2021–2023** (not 2024 alone). MapBiomas 2024 class 39 (beta) as the second opinion. | MapBiomas class 39 alone. | WorldCereal maize/wintercereals for validation only. The bank's own declared crop overrides all of these. |
| **Crop calendar (sow/harvest by crop & campaign)** | Curated `crop_calendar_santacruz` table: FAO Crop Calendar API (AEZ 003) for soy ×2, sorghum ×2, wheat, rice. GEOGLAM for maize. Existing `pipeline/crops.py` rows. Provenance column on each row. | GEOGLAM CM4EW (maize, wheat). GGCMI p3 for summer crops only. | MCD12Q2 green-up/senescence, and WorldCereal AEZ windows. |
| **Phenology / current stage** | Per-field, derived from that field's MOD13Q1 250 m history (since 2000) + S2 current: green-up = NDVI crossing ~20–50 % of the seasonal amplitude. This follows Suyana's "compare with its own history" rule. | MCD12Q2 via ORNL (keyless, 500 m, yearly, ~1 yr lag, flaky). | Curated calendar (above) as the prior when NDVI is cloudy. |
| **Kc (for ETc = Kc·ETo)** | FAO-56 Table 12 + Table 11, with stages rescaled to the FAO calendar's growing_days (`sample_kc_fao56.json`). | — | Quinoa: García et al. 2003 (0.5/1.0/0.7). Chia: Majes lysimeter (0.68–1.20). Both unverified. |

### Notes for implementation

**Polygon checks work as real polygons, not only boxes:**

- GLAD / MapBiomas / PC COGs: `rasterio.open('/vsicurl/...')` → `rasterio.mask.mask(ds, [geojson], crop=True)`. This is a range read: about 0.1–0.5 s per polygon per year after the header.
- WorldCereal: `POST https://titiler.terrascope.be/collections/{coll}/items/{item}/statistics?assets=classification&categorical=true&c=0&c=100` with a GeoJSON Feature. Returns the histogram.

**Caching:**

- Masks are annual and static. Compute once per farm polygon, store in DuckDB as `crop_mask(farm_id, source, year, frac_crop, frac_soy, top_class)`, and ship it in the offline snapshot.
- None of these needs to be in the live request path.

**Calendar logic:**

- Santa Cruz double-crops. A farm has a summer crop (soy/maize/rice, sown Oct–Dec) and often a winter crop (sorghum/wheat/sunflower/chia/maize, sown Feb–Jun).
- The calendar must be keyed by (crop, campaign), not by crop alone.
- The sample farm list gives one crop per farm. The "wheat", "sunflower" and "sorghum" farms are winter-campaign farms that almost surely grow summer soy too (MapBiomas 2024 marks El Cusi as soy).

## ADR-ready discoveries (for the product-owner phase)

1. **D-crop-1:** use MapBiomas Bolivia (30 m) + GLAD soybean (30 m) as cropland/soy masks, read as COGs by range request and cached per polygon. The official MapBiomas GCS is not anonymous, so we depend on a third-party mirror (CC-BY-SA, share-alike) or a GEE export.
2. **D-crop-2:** onboarding a farm validates the polygon against the masks. A farm with less than ~30 % cropland in its polygon is flagged "not on cropland: check location". Four of our 12 demo farms fail today.
3. **D-crop-3:** the crop calendar is a curated, versioned table keyed by (crop, campaign, zone), with a source for each row. FAO API first; global gridded calendars (GGCMI) only for summer crops.
4. **D-crop-4:** crop stage for the current season comes from the field's own NDVI curve. Annual phenology products (MCD12Q2) and calendars are priors and fallbacks, not the truth.
5. **D-crop-5:** Kc from FAO-56, with stages scaled to local season length. Quinoa and chia values are flagged as literature-only.

## Open risks

- **The GLAD 2024 soybean layer looks incomplete for Bolivia.** Regional soy fraction was 0.34 in 2023 and 0.075 in 2024. Cuatro Cañadas went from 0.90 to 0.00 while Okinawa Dos stayed at 0.98. Treat 2024 as provisional and use max(2021–2023).
- **MapBiomas official bucket returns 403 to anonymous callers.** The mirror covers 2019–2024 only and mixes Collection 2 (class 18 generic agriculture) with Collection 3 (39 soy / 40 rice / 72 other crops). Harmonise before comparing years. Collection 4 (1985–2025) is only reachable through GEE (free signup) or a browser download.
- **ORNL MODIS REST went down (502 after 60 s) for part of the session.** The wrapper needs a retry with backoff plus a cache. MCD12Q2 has fill values in 2023–2024 at Cuatro Cañadas, which are the drought years.
- **Calendar gaps:** no authoritative machine-readable lowland calendar exists for maize, sunflower, sugarcane or chia. Those rows are local practice (verified = false) until ANAPO, CAO or Suyana confirms them.
- **GGCMI places winter crops in December.** Using it without the campaign split would misweight the winter-crop stress window by about 4 months.
- **WorldCereal is 2021 only, its crop-type layers under-detect in Santa Cruz, and its GeoTIFFs need a (free) Terrascope login.** The public titiler could be rate-limited or withdrawn.
- **Annual masks are stale for the current season.** A field that was soy in 2023 may be fallow now. The current state must come from NDVI.
- **USDA IPAD is retired, and the new FAS pages block scripts.** USDA crop calendars are not usable by an automated pipeline.
- **Licences:** MapBiomas is CC-BY-SA-4.0 (share-alike applies to derived maps). WorldCereal, WorldCover, GEOGLAM and GGCMI are CC-BY-4.0. Esri/IO is CC-BY-4.0. The GLAD licence is not stated on the page (ask glad@umd.edu; research use is customary).

## Files

- `probe_glad_soy.py`, `probe_glad_soy_region.py` (+ `.out`): GLAD soybean, per farm and regional trend.
- `probe_mapbiomas_sourcecoop.py` (+ `.out`, `.json`): MapBiomas mirror class mix per farm.
- `probe_pc_landcover.py` (+ `.out`, `.json`): WorldCover and Esri/IO LULC per farm.
- `probe_worldcereal_titiler.py` (+ `.out`, `.json`): WorldCereal polygon statistics through public titiler.
- `probe_mcd12q2.py` (+ `.out`), `sample_mcd12q2_3farms.json`: MCD12Q2 / MCD12Q1 through ORNL.
- `probe_fao_cropcalendar.py` (+ `.out`), `sample_fao_cropcalendar_BO.json`: FAO Crop Calendar API.
- `httpzip.py`, `probe_geoglam_calendars.py`, `probe_geoglam_bolivia.py` (+ `.out`), `sample_geoglam_calendars_bolivia.json`: GEOGLAM.
- `probe_ggcmi_calendar.py` (+ `.out`): GGCMI phase-3 gridded calendar.
- `sample_kc_fao56.json`: FAO-56 Kc and stage lengths.
- `sample_crop_calendar_santacruz.json`: draft curated calendar with provenance.
