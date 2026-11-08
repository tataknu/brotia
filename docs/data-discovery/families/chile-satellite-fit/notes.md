# Family: Satellite fit for Chilean farms (key `chile-satellite-fit`)

Probed live on 2026-11-06/07. No accounts, keys or credentials used. Nothing was installed:
the venv already had rasterio 1.5.2, pystac-client 0.9.1, planetary-computer, pyproj, shapely 2.2.0,
numpy 2.5.4, requests. (Scope note: the task boilerplate says "depth on Santa Cruz, Bolivia"; the
family scope overrides it with Chile as primary market, so everything here is Chile.)

## Bottom line

1. **The given Chile test coordinates are town centres, not farms.** ESA WorldCover 2021 says 10 of
   11 of the 50 ha squares are 51–98 % built-up (Quillota 92 %, Curicó 98 %, Talca 98 %, Temuco 92 %…).
   Only Requínoa sits on farmland. Any NDVI computed at those points measures a town.
   `out_relocated_sites.json` proposes the nearest non-built 50 ha window (0.25–4.8 km away), but
   **crop type there is unverified**. Use real parcel polygons (next point) for the demo.
2. **Big find: CIREN/ODEPA Catastro Frutícola is a keyless public polygon layer with species per
   orchard block.** ArcGIS REST `https://esri.ciren.cl/server/rest/services/IDEMINAGRI/CATASTRO_FRUTICOLA/MapServer`,
   layers 55–68 "PRODUCTORES FRUTÍCOLAS" (one per region, 2022–2025 vintages), fields `rolpredi`
   (property roll = farm id), `especie_01..04`, `desccomu`. HTTP 200, ~4 s for 700–1,300 polygons,
   2,000 records per page, GeoJSON-able in EPSG:4326. This is the Chile orchard crop mask and the
   source of realistic test fields. (Wine grapes and annual crops are **not** in it.)
3. **Chilean orchards are far too small for MODIS 250 m.** Median block 1.2–2.5 ha; median orchard
   area per farm (`rolpredi` union) 3.2–8.4 ha. Only **2–3 % of blocks** and **12–29 % of farms**
   contain even one MODIS pixel that is ≥80 % orchard. ADR-0002's "MODIS baseline per field" does not
   work for Chilean fruit at block level. Use Sentinel-2 for current state and Landsat (30 m, 1984+)
   for the long same-season baseline; keep MODIS for zone context and large fields.
4. **Where a pure MODIS pixel exists, cross-calibration works well.** On a 19.75 ha cherry block that
   covers one MODIS pixel completely: MOD13Q1 = 0.148 + 0.794 × S2, r = 0.969, RMSE 0.036, n = 100
   (16-day pairs). For a 43 ha avocado block that covers 73 % of its pixel the fit drops to r = 0.72
   on the pixel footprint, and to **r = 0.52 against the field polygon**.
5. **Cloud season is inverted vs Bolivia and mostly favourable.** The central valley gets 5–6 clear
   S2 views per month in Dec–Mar (nearly every pass) and 2–2.5 in May–Aug. The longest gap is
   ~40 days (Jul–Aug). Temuco (south) drops to **1.2–1.4 clear views per month in May–Aug**, with
   gaps of 50–65 days during the winter-cereal growth period. Spring (Sep–Oct, frost and bloom)
   gets only ~2.4–3.4 a month.
6. **MODIS night LST tracks valley-floor Tmin well on the nights it exists.** At Curicó (GHCN
   CI000085629), MYD11A1 Aqua (~01:30) vs station Tmin: bias −0.23 °C, RMSE 1.28 °C, r = 0.946
   (n = 39, May–Oct 2023+2024). With an LST threshold of −1.5 °C it caught 5 of 6 frost nights with
   0 false alarms. But LST is valid on only **24–27 % of nights**, and only 8 of 15 station frost
   days had any valid LST. Treat it as a spatial cold-pool map and a downscaling aid, not as the
   frost sensor.

## What was probed (scripts in this folder, outputs `out_*.json`)

| # | Script | Source / endpoint | Result |
|---|---|---|---|
| 1 | `probe_worldcover.py` | PC STAC `esa-worldcover` + data API `/item/statistics` (categorical) | 200, 0.4–0.85 s/site; 10 of 11 sites mostly built-up |
| 2 | `probe_relocate.py` | WorldCover COG window read (anonymous SAS), 16 km box | nearest agri 50 ha windows, 15 s total |
| 3 | `probe_ciren_catastro.py` | CIREN ArcGIS REST, layers 58/59/61/62/63 | 200, 3.6–4.3 s, 34–1,335 polygons/box; test fields `field_*.geojson` |
| 4 | `probe_s2_chile.py` | PC STAC `sentinel-2-l2a` + data API statistics, 1 call/item with 4 expressions | 0 errors; 462–919 items/site 2021-11-09..2026-11-03; ~40–95 s/site with 6 threads |
| 5 | `probe_modis_mixed.py` | CIREN polygons + MODIS sinusoidal grid; ORNL `MOD13Q1/subset` (kmAboveBelow=0) | grid aligned exactly with ORNL `xllcorner`; 115 composites, latest 2026-10-16; ORNL took 90–400 s for 24 calls |
| 6 | `analyze_crosscal.py` | offline: MOD13Q1 vs S2 on identical footprint (`modispx_*.geojson`) | see bottom line 4 |
| 7 | `probe_landsat_hls.py` | PC `landsat-c2-l2`, `hls2-s30`, `hls2-l30`; server-side Landsat NDVI with `qa_pixel` bit 6 | 200, 0.5 s; Landsat NDVI 0.761 on 2026-03-23 vs S2 0.70–0.78 that week |
| 9 | `probe_lst_coldpool.py` | PC `cop-dem-glo-90` + `modis-11A1-061` point reads on a transect; S2 archive start | see Frost section; S2 first item 2015-08-08 |
| 8 | `probe_lst_frost.py` | PC `modis-11A1-061` + data API `/item/point`; NCEI Access `daily-summaries`; Open-Meteo archive | LST 738 items, 41 s, 0 errors; NCEI 200, 1 s; **Open-Meteo 429 "Daily API request limit exceeded"** |
| – | curl | `modis-10A1-061` (daily snow, Andes above Requínoa) | latest 2026-11-01 (MOD10A1.A2026305), point NDSI 40; 250 = cloud |

Gotchas found:
- The PC data API accepts several `;`-separated expressions in one call and evaluates them all on
  the 10 m grid. The masked mean is then just `sum(NDVI·clear)/sum(clear)`, so one call per scene
  is enough (~0.8 s).
- The DN offset is applied per item: −1000 per band only when `s2:processing_baseline ≥ 04.00`.
- PC Landsat asset names are lowercase (`qa_pixel`, `red`, `nir08`). `QA_PIXEL` gives HTTP 500.
- For `modis-11A1-061` items, `item.datetime` is None. Use `start_datetime`.
- ORNL subset band keys: strip the `250m_16_days_` prefix carefully.

## Results in detail

### Clear Sentinel-2 views per calendar month (clear_frac ≥ 0.5 over the polygon, mean of 2021-11..2026-10)

| Site | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec | longest gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Requínoa cherry block (tile 19HCC) | 5.6 | 5.2 | 5.8 | 4.0 | 2.0 | 2.4 | 3.4 | 2.4 | 2.8 | 2.8 | 4.4 | 6.0 | 40 d (Jul–Aug 2026) |
| Quillota avocado block (19HBD) | 3.8 | 4.8 | 5.0 | 4.4 | 2.6 | 3.0 | 3.6 | 2.2 | 3.4 | 2.8 | 3.6 | 5.4 | 50 d (Jul–Aug 2026) |
| Colchagua proxy (19HBB) | 5.4 | 5.4 | 5.4 | 4.0 | 2.0 | 2.2 | 2.6 | 2.0 | 3.2 | 3.0 | 4.0 | 6.0 | 38 d |
| Temuco cereal proxy (18HXC+18HYC overlap) | 3.6 | 4.6 | 4.4 | 2.2 | 1.4 | 1.4 | 2.2 | 1.2 | 1.8 | 2.4 | 3.2 | 4.2 | 65 d (Apr–Jun 2023) |

There are ~6 acquisition dates per month (S2A/B/C, one relative orbit). Quillota loses ~1–2 summer
views a month, probably to coastal morning stratus at the 10:30 overpass (hypothesis). Temuco
falls in a tile overlap, which doubles the items but not the unique dates.

### NDVI seasonality per crop (S2, SCL-masked, monthly medians of views with clear ≥ 0.8)

**Cherry, Requínoa** (CIREN CEREZO block, 19.75 ha). Columns are months Jan..Dec:
```
2022 0.35 0.37 0.38 0.38 0.36 0.24 0.27 0.23 0.20 0.40 0.45 0.54
2023 0.57 0.56 0.56 0.59 0.61 0.34 0.31 0.29 0.33 0.51 0.54 0.56
2024 0.61 0.62 0.65 0.69 0.52 0.33 0.31 0.26 0.26 0.53 0.58 0.63
2025 0.62 0.64 0.65 0.78 0.68 0.35 0.32 0.34 0.37 0.55 0.65 0.69
2026 0.67 0.70 0.72 0.76 0.71 0.29 0.27 0.31 0.27 0.66
```
- The deciduous cycle is clear: dormancy floor ~0.28 (Jun–Sep), green-up in Oct, and the peak in
  Mar–Apr.
- **There is a strong upward trend.** Summer NDVI went from 0.35 to 0.70 in 4 years, which looks
  like a young block still filling its canopy (cherry area in O'Higgins grew >67 % from 2018 to
  2021).
- A plain same-month mean ± sd baseline would flag this healthy block as "above normal" every
  year. Interannual sd is 0.12–0.17 in summer, but almost all of that is trend.

**Avocado, Quillota** (CIREN PALTO block, 43 ha):
```
2022 0.53 0.52 0.51 0.50 0.54 0.61 0.70 0.63 0.69 0.57 0.53 0.54
2023 0.53 0.53 0.52 0.53 0.57 0.59 0.33 0.62 0.57 0.52 0.53 0.52
2024 0.53 0.50 0.51 0.52 0.56 0.61 0.60 0.59 0.53 0.49 0.48 0.49
2025 0.46 0.45 0.45 0.49 0.49 0.56 0.56 0.54 0.49 0.45 0.45 0.46
2026 0.45 0.46 0.45 0.46 0.47 0.46 0.47 0.47 0.47 0.58
```
- The signal is evergreen with a low amplitude. The summer interannual sd is only 0.03.
- The winter bump (+0.05–0.15) comes from inter-row and hillside herbaceous green-up after winter
  rain. It is absent in winter 2026, which fits a dry winter (unverified).
- The summer canopy NDVI slid from 0.53 to 0.45 between 2022 and 2026. That is a −2.7 sd anomaly
  against 2022–24. It could be water stress, heavy pruning or partial uprooting; **we have not
  confirmed which**, but it is exactly the kind of signal a lender would want explained.
- NDMI sits near 0 to 0.07, so it is low because of the soil background. The cherry block's NDMI
  is −0.14 in dormancy and +0.20 in summer.

**Winter cereal / pasture, Temuco proxy:**
- The peak is 0.75–0.84 in Oct–Nov, then a harvest drop to 0.45–0.50 in Feb, then regrowth from
  Apr–May.
- The winter values come from only 1–2 clear views a month.
- The crop is not verified, because there is no public polygon layer for annual crops.

### MODIS mixed pixels (CIREN polygons on the exact MOD13Q1 grid, ~10 km boxes)

| Area | blocks | farms (`rolpredi`) | median orchard ha / farm (p90) | blocks with a ≥50 % pixel | blocks with a ≥80 % pixel | farms with a ≥80 % orchard pixel |
|---|---|---|---|---|---|---|
| Requínoa (O'Higgins) | 1,335 | 399 | 8.4 (23.5) | 18 % | 3 % | 29 % |
| Quillota (Valparaíso) | 740 | 261 | 3.2 (16.5) | 11 % | 2 % | 12 % |
| Curicó (Maule) | 719 | 193 | 7.3 (21.3) | 14 % | 2 % | 26 % |

Block size by species (median, p90 ha):
- Requínoa cherry: 2.4 / 4.9.
- Quillota avocado: 1.2 / 4.9.
- Curicó cherry: 2.0 / 5.3.
- Chillán blueberry: 1.1 / 1.8.
- Requínoa walnut: 5.0 / 16.4.

Even a "farm-level" MODIS pixel usually mixes species (cherry, nectarine, walnut) with different
phenologies.

### Long 30 m baseline (Requínoa block, PC STAC)

- **`landsat-c2-l2`:** 1,256 items from 1984-12-24 to 2026-11-02. Landsat 5: 327, Landsat 7: 510,
  Landsat 8: 306, Landsat 9: 108.
  - Scenes with <30 % cloud per calendar month (2000–2025 mean): 2.7 in Jan, 1.0–1.2 in May–Jul,
    1.8 in Sep–Oct.
  - So the 2000–2012 Landsat 5/7 era gives roughly 1–3 clear views per month. That is enough for a
    seasonal (Dec–Mar) baseline, but too thin for a 16-day one.
  - Landsat 7 SLC-off stripes (2003+) will hit 2 ha blocks.
- **Sentinel-2 L2A on PC** at the Requínoa block starts **2015-08-08** (first item
  `S2A_MSIL2A_20150808T144816_R096_T19HCC`, reprocessed 2021). So S2 gives up to 11 seasons of
  10 m baseline for blocks younger than that, with Landsat for older blocks.
- **Note:** the Landsat clear counts here are **scene-level** `eo:cloud_cover < 30`. Polygon-level
  QA counts for 2000–2012 were not computed.
- **`hls2-s30`** starts 2020-01-04 and **`hls2-l30`** starts 2017-08-29 on PC; the latest item is
  2026-10-31 / 11-02.
- Temuco has 1,154 Landsat items, but only 0.7–0.9 low-cloud scenes per month in Apr–Sep.

## Recommended per-crop NDVI usage for Chile

| Crop group (examples) | Polygon source | Current state | Baseline | Use the anomaly in… | What an anomaly means / caveats |
|---|---|---|---|---|---|
| Evergreen tree (avocado, citrus, olive) | CIREN catastro | S2 10 m NDVI + NDMI, monthly max composite | Landsat 30 m 2000+ for the same months, cross-calibrated to S2; MODIS only if a ≥80 % pure pixel exists | Dec–Apr (canopy only; winter inter-row green-up contaminates May–Sep) | A persistent drop means canopy loss: water restriction or drought, frost burn (Jul), fire, uprooting. The amplitude is small, so use an **sd floor of ~0.03–0.04**. A z-score is fine; prefer a 3-composite running mean before flagging. |
| Deciduous tree (cherry, plum, peach, apple, walnut, kiwi) | CIREN catastro | S2 | Landsat 2000+ (or S2 since 2017 if the block is younger than the Landsat record) | **Only Oct–Apr**; never compute in Jun–Sep dormancy (it measures the cover crop) | Oct–Nov: green-up timing (late leaf-out after frost, poor chill). Dec–Mar: vigour and water. NDVI does **not** see fruit loss (bloom frost, rain-cracking at harvest, hail): those perils must come from weather signals. Young blocks trend upward, so use a detrended or last-3-season baseline, or compare with neighbouring blocks of the same species (peer anomaly). |
| Grapes (table, wine) | Table grape: CIREN; wine: **not in the catastro** (SAG Catastro Vitícola is tabular, unverified) | S2 | Landsat | Nov–Mar | Trellis rows plus soil give a low ceiling (0.4–0.6). Small blocks. Same deciduous caveats. |
| Blueberry, berries | CIREN (blocks ~1 ha) | S2 only (≈100 px per block) | S2 since 2017; HLS | Nov–Mar | Many blocks are under netting or tunnels. Edge pixels dominate. Low confidence: label it "estimated". |
| Winter cereals, oats, pasture (Biobío, Araucanía, Los Lagos) | No public polygons: borrower/bank-supplied or drawn | S2 + HLS + SAR (sar-flood-water family) for May–Sep gaps | MODIS is OK for fields ≥20 ha; Landsat otherwise | Aug–Dec (tillering → grain fill) | Peak NDVI in Oct–Nov is the yield proxy. With 50–65 day winter gaps, carry the last clear observation forward with its age. |
| Rice (Parral), maize | Bank-supplied | S2 | Landsat/MODIS (fields are larger) | Rice Nov–Mar, maize Dec–Mar | For rice, flooding in Oct–Nov shows as low NDVI and high water: use NDWI. Not probed. |

## Frost (MODIS LST night) vs station Tmin

- **Source:** PC `modis-11A1-061`, daily, 1 km, Terra 22:30 and Aqua 01:30. Latest
  2026-11-04, ~2 days latency. Point reads go through the data API, ~0.75 s each, keyless.
- **Station:** NCEI GHCN-D `CI000085629` Curicó (1957-09-08..2025-08-24). It is keyless but has
  gaps: Tmin exists on only 197 of 366 season days, and the series ends 2025-08-24.
- **Agreement:**
  - Aqua: bias −0.23 °C, RMSE 1.28, r 0.946 (n 39).
  - Terra: bias +0.82, RMSE 1.76, r 0.933 (n 47).
- **Frost detection** (station Tmin ≤ 0 °C): Aqua F1 0.91 at an LST threshold of −1.5 °C; Terra
  F1 0.75 at 0 °C. The sample is tiny (6–7 frost nights).
- **Caveats:**
  - LST is the skin (canopy or soil) temperature hours before dawn. It is not the 2 m Tmin.
  - LST is cloud-masked. Radiative frost happens on clear nights, so the coverage bias partly
    helps, but advective cold under cloud is missed.
  - A 1 km pixel blurs cold-air pools in narrow valleys.
- **Cold-air pool check** (`probe_lst_coldpool.py` → `out_lst_coldpool.json`):
  - **Setup:** on the 7 station frost nights with valid LST, we read LST along a west–east transect at
    −34.967°, with elevations from Copernicus DEM GLO-90 on PC.
  - **Valley floor coldest:** on 5 of 6 Aqua nights the station pixel (214 m) was the coldest point
    on the transect.
  - **Thermal belt:** foothill points at 470–750 m were +0.5 to +3.6 °C warmer, median about +2 °C
    at 748 m.
  - **Inversion:** at 1,707 m the pixel was +5 to +8 °C warmer on 4 nights.
  - **Exception:** the low western point (147 m, toward the coast range) was 2–5 °C warmer, so
    "lower" does not always mean "colder". Basin shape matters.
  - **Conclusion:** LST does resolve the valley-floor cold pool vs the slope thermal belt at 1 km,
    which is useful because Chilean orchards on slopes and on valley floors carry different frost
    risk.
- **Use:** LST as a spatial cold-pool downscaler on top of a station or ERA5-Land Tmin. The ERA5
  comparison was blocked by an Open-Meteo 429 and is still to do.

## Sources

| Source | Access | Auth | Verified | Fit |
|---|---|---|---|---|
| Sentinel-2 L2A, Planetary Computer (STAC + data API) | REST, COG | none (anonymous SAS) | yes | primary NDVI/NDMI |
| Earth Search `sentinel-2-c1-l2a` | STAC + public S3 COG | none | not here (verified by the sentinel2-landsat-hls family) | fallback |
| CIREN Catastro Frutícola (IDE Minagri ArcGIS REST) | REST query → JSON polygons | none | yes | primary orchard mask + species. A single current vintage per region (2022–2025), with no time series; the survey cycle is about 3 years |
| Landsat C2 L2 (PC) | STAC + data API | none | yes | primary long 30 m baseline |
| HLS v2 S30/L30 (PC copy) | STAC | none | yes (counts) | gap-filler |
| MODIS MOD13Q1 (ORNL subset REST / PC) | REST JSON | none | yes | baseline only for ≥80 % pure pixels / zone context |
| MODIS MOD11A1/MYD11A1 daily LST (PC) | STAC + point API | none | yes | frost spatial proxy (secondary) |
| MODIS MOD10A1 snow (PC) | STAC + point API | none | yes (latest item, 1 value) | Andes snow, irrigation-water context |
| ESA WorldCover 2021 (PC) | STAC + data API | none | yes | site sanity check only; can't separate orchard types |
| NCEI GHCN-D daily (Curicó) | REST JSON | none | yes | validation (gappy, ends 2025-08) |
| Open-Meteo archive (ERA5/ERA5-Land) | REST | none | 429 today | Tmin baseline (other family) |
| CIREN `Catastro_Fruticola`, `OBSERVATORIO` folders | ArcGIS REST | token (499) | yes (blocked) | reject without agreement |
| IDE Minagri geoserver `ide.minagri.gob.cl/geoserver` | WMS | – | 404 | reject |
| `climatedatalibrary.cl` (old Observatorio Agroclimático data library) | – | – | domain now a casino spam page | reject |
| INIA Agromet (`agrometeorologia.cl`) | HTML portal | landing page 200 only; no data API tested | no | station Tmin candidate (frost family) |
| DMC climatología (`climatologia.meteochile.gob.cl`) | HTML/REST | landing page 200 only; API probably needs a free registration (unverified) | no | station candidate |

## Open risks

1. **Test sites are towns.** The team must swap in real polygons: CIREN blocks for fruit, and
   drawn or bank-supplied polygons for cereals and rice. The current Chile list will produce
   nonsense NDVI.
2. **Orchard turnover and young blocks** break long same-date baselines: cherry expansion,
   avocado uprooting during the megadrought, replanting. We need a trend or peer-block baseline
   and a land-use-change check, for example "was this pixel orchard in 2005?".
3. **ADR-0002 D4 (MODIS baseline per field) fails for 97 % of Chilean orchard blocks.** We propose
   an ADR amendment: Landsat 30 m 2000+ as the long baseline in Chile, with MODIS only where a pure
   pixel exists.
4. **NDVI misses the main Chilean fruit perils** (bloom frost, harvest rain cracking, hail, sunburn
   on fruit). Those need weather signals. NDVI covers water stress, canopy damage, fire and
   uprooting.
5. **Southern winter cloud** (Temuco/Osorno: 1–1.5 clear views a month, gaps up to 65 days) needs
   SAR or HLS fusion. Osorno itself was not probed.
6. **Shared-IP rate limits.** Open-Meteo returned a daily-limit 429 during this run, and ORNL was
   slow (400 s for 24 calls once). Cache aggressively and use the PC copies of MODIS.
7. **CIREN service stability and licence:** it is public but undocumented. The polygons are
   blocks, not legal parcels; vintages range from 2022 to 2025; the licence terms were not found
   (the web search budget ran out).
8. The avocado decline and the dry-winter-2026 readings are **hypotheses**, not verified.
