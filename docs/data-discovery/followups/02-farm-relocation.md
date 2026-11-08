# Follow-up 02: Farm relocation onto real cropland

Date: 2026-11-07. All checks below were run live, without keys or accounts, unless marked **unverified**.
Files are in `docs/data-discovery/followups/02-farm-relocation/`:

| File | What it holds |
|---|---|
| `farms_fields.geojson` | FeatureCollection, 12 polygons, EPSG:4326. Properties: name, crop, status, area_ha, moved_km, flag, class fractions, NDVI values and scene IDs |
| `farms_fields_table.csv` / `.md` | The same results as a flat table, with before (original point) and after (field) fractions |
| `fields_verified.json` | Full per-farm record, including every scene tried |
| `fetch_rasters.py` | Reads keyless regional clips of the four land-cover sources |
| `select_fields.py` | Keep-or-move rule and the candidate search |
| `verify_fields.py` | NDVI from the Planetary Computer data API, MODIS pixel count, geodesic area |
| `build_outputs.py` | Writes the GeoJSON and the tables |
| `api_log.json`, `fetch_log.json` | HTTP status and latency of every call. `fetch_log.json` comes from the run before the WorldCover transform fix; its shapes, values and timings are still valid |

## Result in one paragraph

Only **3 of 12 points can stay where they are**: Colonia Cuatro Canadas Lote 7 (soy), Hacienda El Cusi (sorghum) and Finca Okinawa Dos (maize). **7 points move 1.3–4.5 km** onto verified cropland. **2 placements are provisional.** Agricola Warnes Sur (soy) moves 14.7 km, because no field within 10 km grew soy in at least 2 of the 3 years 2021–2023. Arrocera Mineros (rice) cannot be verified as rice. Sugarcane (Canaveral San Antonio) gets a credible cropland polygon 1.8 km from its point, but no open map has a cane class, so the crop itself cannot be checked against a map. Every polygon is an 81 ha square, 900 m x 900 m in UTM 20S. Each one covers 12–16 MODIS 250 m pixel centres (5–8 pixels fully inside), so all pass the 4-pixel minimum. Each one has a clear Sentinel-2 scene in early February 2026 (NDVI 0.62–0.86) and in mid/late August 2026 (NDVI 0.33–0.57).

## Rules, so that keep/move can be reproduced

- **Field:** a 900 m square centred on a point (81.1 ha geodesic area). Class fractions use only pixels whose centre lies inside the polygon, on each raster's own grid, with no resampling.
- **MB agri** = MapBiomas Bolivia 2024 share of class 39 (soy) + 72 (other temporary crops) + 18 (agriculture), plus 0.5 x class 21 (mosaic). In the 2024 map, class 18 is absent from the whole region. Agriculture appears only as 39 and 72. Classes 40 (rice) and 20 (sugarcane) do not appear anywhere in the clip (all pixel values were counted).
- **Keep the original point** when all of these hold: MB agri ≥ 0.90, WorldCover 2021 class 40 ≥ 0.60, no water, forest ≤ 3 %, and the crop gate passes.
- **A relocated field** must pass stricter limits: MB agri ≥ 0.95 and WC40 ≥ 0.85, plus the same crop gate. The search covers candidate centres within 10 km, nearest first. A fast box-filter screen runs first, then the exact polygon check.
- **Crop gates** (GLAD = GLAD/UMD soybean map):
  - **Soy:** GLAD soy maximum over 2021–2023 ≥ 0.80, **and** soy ≥ 0.5 in at least 2 of the 3 years. I added the second condition because the first relocation of Warnes Sur landed on a field that was soy only in 2021.
  - **Maize, sorghum, wheat, sunflower:** GLAD maximum ≥ 0.50. In Santa Cruz these are mostly winter or rotation crops grown on soy fields.
  - **Sugarcane:** GLAD maximum ≤ 0.10, meaning the field was never soy (a perennial crop).
  - **Rice:** GLAD ≤ 0.20 and JRC ever-water ≥ 5 %. If that fails, a provisional placement on non-soy cropland.

## Georeferencing check (done before using any fraction)

The first WorldCover clip of tile S18W063 was shifted 0.42° west. The read window started outside the tile and was cropped silently, while the transform was not. I fixed the file and the script (`w.intersection(...)`). Then I compared the clips at the 12 original points with the earlier, independent 1 km point probes in `families/crop-masks-phenology`. They agree:

| Point | Earlier probe | This run |
|---|---|---|
| Los Tajibos | forest 0.84–0.86 | forest 0.864 |
| Okinawa Dos | MB soy 1.0, WC cropland 1.0 | 1.0 / 1.0 |
| Las Londras | water/sand, WC water | MB water 0.447, WC cropland 0 |
| Cuatro Canadas | WC cropland 0.88 | 0.863 |
| Canaveral | WC cropland 0.55 | 0.528 |

## Results

| Farm | Crop | Status | Moved km | Centre lon,lat | Original point (MB agri / WC40 / GLAD soy max) | Field MB agri | MB39 / MB72 | WC40 | GLAD soy max (21/22/23) | JRC ever-water | MODIS px centres/full | NDVI Feb (date) | NDVI Aug (date) | Amplitude |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Estancia Los Tajibos | soy | moved | 1.74 | -62.52396,-16.87521 | 0.11 / 0.06 / 0.05 (forest 0.86) | 0.95 | 0.32 / 0.64 | 0.95 | 0.97 (0.82/0.78/0.92) | 0 | 16/8 | 0.837 (02-05) | 0.359 (08-14) | 0.48 |
| Agropecuaria Brecha 8 | maize | moved | 1.28 | -62.68862,-16.97385 | 0.74 / 0.15 / 0.18 (pasture 0.23) | 0.99 | 0.02 / 0.97 | 0.86 | 0.95 (0.68/0.78/0.93) | 0 | 16/8 | 0.719 (02-10) | 0.334 (08-14) | 0.39 |
| Colonia Cuatro Canadas Lote 7 | soy | **kept** | 0 | -62.47,-17.30 | 0.94 / 0.86 / 0.93 | 0.94 | 0.70 / 0.24 | 0.86 | 0.93 (0.85/0.68/0.89) | 0 | 16/5 | 0.694 (02-05) | 0.326 (08-26) | 0.37 |
| Hacienda El Cusi | sorghum | **kept** | 0 | -62.55,-17.38 | 0.98 / 0.74 / 0.89 | 0.98 | 0.68 / 0.31 | 0.74 | 0.89 (0.70/0.11/0.83) | 0 | 15/7 | 0.785 (02-05) | 0.416 (08-26) | 0.37 |
| Agricola Pailon Norte | wheat | moved | 1.71 | -62.68080,-17.54464 | 0.73 / 0.61 / 0.42 (pasture 0.27) | 0.95 | 0.82 / 0.13 | 0.88 | 1.00 (0.99/0.79/0.97) | 0 | 15/7 | 0.853 (02-05) | 0.574 (08-26) | 0.28 |
| Granja Las Londras | sunflower | moved | 4.46 | -62.79722,-17.72116 | 0.00 / 0.00 / 0.08 (Rio Grande: water 0.45, JRC 0.26) | 0.98 | 0.01 / 0.97 | 0.99 | 1.00 (0.99/0.99/0.96) | 0 | 16/8 | 0.824 (02-05) | 0.572 (08-26) | 0.25 |
| Finca Okinawa Dos | maize | **kept** | 0 | -62.85,-17.18 | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 0 | 1.00 | 1.00 (1.0/0.05/1.0) | 0 | 16/8 | 0.859 (02-05) | 0.540 (08-14) | 0.32 |
| Parcela Okinawa Uno | soy | moved | 2.13 | -62.91634,-17.25601 | 0.92 / 0.62 / 0.11 (cropland, but not soy) | 0.98 | 0.70 / 0.27 | 0.92 | 0.86 (0.44/0.51/0.82) | 0.006 | 16/8 | 0.843 (02-05) | 0.451 (08-14) | 0.39 |
| Arrocera Mineros | rice | **provisional** | 1.52 | -63.28204,-17.18863 | 0.41 / 0.11 / 0 (riverbed: sand, forest, JRC 0.29) | 0.96 | 0.02 / 0.94 | 0.86 | 0 | 0 | 12/8 | 0.621 (02-05) | 0.519 (08-27) | **0.10** |
| Canaveral San Antonio | sugarcane | moved (cane unverifiable) | 1.79 | -63.19392,-17.29482 | 0.95 / 0.53 / 0 (failed only on WC40) | 0.96 | 0 / 0.95 | 0.87 | 0 | 0 | 12/8 | 0.694 (02-05) | 0.472 (08-22) | 0.22 |
| Agricola Warnes Sur | soy | **provisional (14.7 km)** | 14.72 | -62.95299,-17.50664 | 0.15 / 0.02 / 0 (pasture 0.74) | 0.98 | 0.15 / 0.82 | 0.92 | 0.87 (0.45/0.76/0.84) | 0 | 16/8 | 0.754 (02-05) | 0.509 (08-26) | 0.25 |
| Estancia Mineros Norte | soy | moved | 4.30 | -63.14999,-17.00403 | 0.92 / 0.55 / 0.08 (cropland, not soy) | 0.99 | 0.48 / 0.52 | 0.95 | 0.89 (0.73/0.66/0.74) | 0 | 16/8 | 0.682 (02-18) | 0.441 (08-27) | 0.24 |

All NDVI comes from the Planetary Computer `item/statistics` endpoint on `sentinel-2-l2a`. All 24 scenes used have `s2:processing_baseline` 05.12, so the -1000 DN offset was applied: NDVI = (B08-B04)/(B08+B04-2000). Pixels are masked to SCL classes 4, 5 and 6. Every scene used has a clear fraction of 0.989–1.0 inside the polygon. The scene IDs are in the GeoJSON. The February scenes are mostly `S2C_MSIL2A_20260205T141711_R010_*`. For Brecha 8 the scene is S2B 2026-02-10, and for Mineros Norte it is 2026-02-18.

### How to read the NDVI pairs

- **Summer crops** (soy, maize, rice) should be high in February, and they are: 0.68–0.86 on every soy or maize field. In August the soy fields are low to moderate (0.33–0.51), which fits post-harvest or a winter cover crop.
- **Winter crops** (wheat, sunflower, sorghum) sit on soy-rotation fields, so a high February value is expected. Pailon wheat (0.574) and Las Londras sunflower (0.572) show the highest late-August values, which fits a winter crop still standing. El Cusi sorghum is 0.42 in late August, which fits a June–July harvest followed by regrowth.
- **Amplitude** is 0.22–0.48 for every field except Arrocera Mineros (0.10).
- A first attempt used the least-cloudy January scene (2026-01-06), which gave soy NDVI 0.5–0.6. That date is early vegetative growth. The final run prefers February, nearer the peak.

## Flags

1. **Rice (Arrocera Mineros): cannot be placed credibly.**
   - The original point is a riverbed: MB sand, forest and mosaic, WC cropland 0.11, JRC ever-water 0.29.
   - MapBiomas 2024 has no rice class 40 in the region.
   - No cropland block within 10 km (MB agri ≥ 0.95, no water, forest or sand pixels) has ≥ 5 % JRC ever-water. Only 16 blocks reach ≥ 2 %. Santa Cruz rice is mostly rain-fed, so Landsat-based surface water is a weak marker anyway.
   - The provisional field is non-soy cropland (GLAD 0 in all three years). Its NDVI is flat (0.62 in February, 0.52 in August), which looks more like a perennial crop, possibly cane, than rain-fed rice harvested in March–April.
   - **Recommendation:** drop rice from the demo or relabel the farm. Otherwise keep it with an explicit "crop unverified" badge.
2. **Sugarcane (Canaveral San Antonio): the field is credible, the crop is not checkable against a map.**
   - The original point was already cropland (MB agri 0.95, GLAD 0). It failed only on WC40 (0.53), so it was moved 1.8 km to a block with WC40 0.87.
   - Evidence: never soy 2021–2023, an August NDVI drop that fits the zafra harvest season, and a position 7.8 km NE of an approximate Montero town-centre coordinate (-63.25, -17.34). The coordinate and the "cane belt" claim are **unverified** local knowledge.
   - Note that the original point would also be a reasonable choice for cane, because ratoon cane often appears as grassland in WorldCover.
3. **Warnes Sur (soy): moved 14.7 km, beyond the requested ~10 km.** The area south of Warnes, near the city and Viru Viru, is pasture and urban land. Only one candidate within 10 km passed the screen, and it was soy only in 2021. The new field is near Okinawa/Pailon. The alternative is to keep the location and declare a non-soy crop.
4. **Okinawa Uno and Mineros Norte** were cropland but not soy (GLAD ≤ 0.11 at the point), so they moved 2.1 and 4.3 km to multi-year soy fields. **Brecha 8 and Pailon Norte** had 23–27 % pasture inside the square and moved about 1.3–1.7 km. **Los Tajibos** was 86 % forest and **Las Londras** was the Rio Grande channel.
5. **WorldCover 2021 versus MapBiomas 2024.** WorldCover often calls fallow or young fields "grassland". That is why kept points use WC40 ≥ 0.60. Hacienda El Cusi is kept with WC40 0.74.

## Probes (live, keyless)

| Source / endpoint | Status | Latency | Notes |
|---|---|---|---|
| MapBiomas Bolivia 2024 COG, `data.source.coop/tristangruppwri/mapbiomas/mapbiomas-bolivia/mapbiomas_bolivia_2024/mapbiomas_bolivia_2024.tif` (/vsicurl range reads) | 200 | 3.2 s, 4156x4008 px window | Region classes: 39, 72, 21, 15, 3, 24, 33, 23, 12, ...; no 18, 20 or 40 |
| GLAD/UMD `glad.umd.edu/projects/AnnualClassMapsV1/SouthAmerica_Soybean_{2021,2022,2023}.tif` | 200 | 1.1–1.4 s each | 0.00025° grid, values 0/1 |
| ESA WorldCover 2021 v200 via PC STAC `esa-worldcover` (anonymous SAS), tiles S18W066 and S18W063 | 200 | 3.7 s / 4.2 s | Map asset, 10 m |
| JRC GSW occurrence via PC `jrc-gsw`, item 70W_10Sv1_3_2020 | 200 | 1.4 s | 0.00025° grid |
| PC STAC search `sentinel-2-l2a` (sorted by eo:cloud_cover) | 24 x 200 | 0.29 / 0.49 / 0.70 s (min / median / max) | |
| PC data API `item/statistics`, two expressions in one call (`ndvi;clear`) | 32 x 200, 2 x 500 | 0.27 / 0.40 / 0.68 s | The two 500s were T20KNF items tried for Okinawa Dos. The polygon is on T20KNG; the cause is probably no tile overlap (not confirmed). The loop moved on to the next scene. |
| MODIS grid: MYD13Q1.A2026281.h11v10 COG header (PC `modis-13Q1-061`, SAS token) | 200 | under 2 s | 231.656 m sinusoidal; pixel counts use the real grid |

The clips are kept outside the repo, in the session scratchpad, at 0.5–7 MB each and about 18 MB in total. Nothing over 20 MB was downloaded.

## Open risks

- **Single-date checks.** The NDVI check uses one scene per season. A full same-time-of-year baseline still has to confirm the seasonal cycle from MODIS since 2000 for each new polygon.
- **Square fields are not real field boundaries.** The squares sit inside homogeneous crop blocks, but they can still cross an internal road or windbreak. Drawing real boundaries would need a field-boundary dataset or digitising.
- **The crop labels are synthetic.** Only soy has map evidence (GLAD). Maize, sorghum, wheat and sunflower are plausible only because they rotate on soy-belt fields. Rice and cane are flagged above.
- **The MapBiomas legend changes across years.** The 2019–2023 maps in this mirror use class 18 (agriculture); the 2024 map uses 39 (soy) and 72 (other temporary crops). Any multi-year MapBiomas comparison must map these classes onto each other first.
- **The source.coop MapBiomas files are a third-party mirror.** The official GCS bucket returned 403 to anonymous requests in the earlier probe.
