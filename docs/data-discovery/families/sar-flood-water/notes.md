# SAR, flood and surface water — data discovery notes

Family key: `sar-flood-water` · Probed 2026-11-06/07 · All probes keyless (no accounts, no keys).
Probe scripts and raw results: `probes/` (re-runnable with `/Users/cristian/Documents/projects/energhack/.venv/bin/python`).

## TL;DR

The flood signal comes in two layers. The second layer is also how we spot waterlogging at field level.

| Need | Primary | Fallback | Static baseline |
|---|---|---|---|
| **Event exposure** (lender view: "was this farm in or near an observed flood?") | **Copernicus GFM** observed flood extent (Sentinel-1, 20 m). Public EODC STAC + COGs, history since 2015, latency about 1 day. | NASA/NOAA **VIIRS flood** 1-day GeoTIFF on AWS (375 m, since 2012). Clouds block it in the wet season. | Event catalogues: **Copernicus EMS** rapid mapping (keyless API) and **GDACS** (keyless API) |
| **River flood hazard** (upstream) | **GloFAS v4 via Open-Meteo Flood API**, read at the main-channel cell (not the farm cell). Same-week percentile, 7-month forecast. | none keyless (CEMS EWDS needs a free key) | — |
| **Field waterlogging proxy** | **Sentinel-1 RTC (Planetary Computer)**: VV/VH backscatter anomaly against the field's own same-track (descending 10), same-time-of-year history (2015/2017+) | GFM `ensemble_water_extent` over the field polygon | **JRC GSW** occurrence/recurrence (1984–2021), used to label "normally wet" fields such as rice |

The ADR-0001 rain proxy (`flood72hMm`) stays as the weather-based flood trigger. These sources add *observed* water to it.

## Discoveries that matter (ADR-grade)

1. **GloFAS in Open-Meteo: history starts 1997-01-01, not 1984.** The API accepts 1984 dates but returns nulls before 1997. That still gives about 29 years, enough for a same-time-of-year baseline.
2. **The GloFAS consolidated reanalysis ends 2025-05-31** (`models=consolidated_v4`). From June 2025 onward the default series is the day-1 forecast (`forecast_v4`). Any percentile of "now" therefore compares a forecast-derived value with a reanalysis baseline. We must carry that in provenance (label the value "estimated").
3. **The farm's own GloFAS cell is meaningless.** Farms sit on cells with 0–0.6 m³/s. The signal only exists on main-channel cells:
   - **Río Grande:** lon ≈ −62.825, running N–S from −17.85 to −17.15, then NW toward (−63.02, −17.02). Mean 475–520 m³/s.
   - **Piraí:** lon ≈ −63.275 from Santa Cruz north to −17.5, then about −63.325. Mean about 29 m³/s.

   We need a static farm → nearest-main-channel-cell map. The grid scan is in `probes/scan_glofas_cells_result.json`.
4. **GloFAS missed the Dec 2025 Piraí catastrophe.** This was EMSR853: 20 dead, "worst flooding in four decades". The Piraí cells peaked at only 23–33 m³/s against a December median of about 16. Río Grande was unremarkable (max 568 on 2026-01-06). So GloFAS **cannot** be the sole flood signal for flash floods on small rivers. Observed water (GFM) plus rain (`flood72hMm`) must lead.
5. **GFM over STAC returns tile-level items (300 km Equi7 tiles).** `intersects` therefore returns many items whose swath does not cover the point: 45 items in 2 months at Cuatro Cañadas, and the latest was 100 % nodata (255). The wrapper must count valid pixels (≠255) inside the farm polygon and skip empty items. Direct COG hrefs on `data.eodc.eu` read keyless in about 1.5–2 s per window.
6. **GFM detected the EMSR853 flood, but only partly.** Over the largest EMSR853 observed-flood polygon (Santa Rosa del Sara AOI), GFM ensemble flood was 1.75 km² on 12-13, **7.63 km²** on 12-18 and 4.63 km² on 12-30. Most other December items had no valid pixels there. That is useful, but it is sparse: one usable pass about every 5–12 days.
7. **Sentinel-1 over the farms since 2022 is one track only, descending relative orbit 10 (~09:42 UTC).**
   - Scenes per year at Cuatro Cañadas: 2017–2021: 64–91 (3 tracks); 2022: 13; 2023: 23; 2024: 24; 2025: 34; 2026 (to Nov): 29.
   - Dual-pol VV+VH since 2017.
   - Cadence was 12 days in 2022–24 (S1B lost). It was intermittently 6 days in 2025, when S1A and S1C interleaved (e.g. Apr 11/17/23). From Aug to Nov 2026 we observed 12 days again (S1D only).
   - Latest scene 2026-11-03 (S1D), visible in the catalogue by 11-06.
   - The baseline must be **same track (d10)** so incidence geometry does not bias the anomaly.
8. **A fixed SAR water threshold (VV<−18 & VH<−24 dB) gives ~0 % water on every probed date.** That holds for both farms in Jan–Apr 2024/2025 and Aug–Nov 2026. Crop fields in this belt are rarely open water at Sentinel-1 scale. The waterlogging proxy must therefore be a **backscatter anomaly vs. own history** (Suyana guidance), not a threshold. The anomaly is ambiguous: wet soil raises VV, a dense canopy raises VH, and flooded vegetation can raise VV through double bounce. Pair it with NDMI from the Sentinel-2 family and rain/soil moisture before calling it waterlogging.
9. **Rice is normally wet.** Arrocera Mineros has **16–18 % "ever water"** in JRC GSW and a small non-zero SAR water fraction on most dates. Granja Las Londras (near the Río Grande) has **15.6 % ever water** with 538 seasonal-water pixels. The flood/waterlogging signal must be crop-aware (rice) and relative to the field's own baseline. GSW occurrence becomes a static "flood-prone" attribute, not an event.
10. **Optical flood maps go blind in the wet season.** On the Santa Cruz belt, NASA LANCE MODIS/VIIRS Combined Flood 2-day (GIBS) was **"Insufficient Data"** (legend verified) on 93 % of pixels on 2025-12-18. Only 32 (MODIS) and 108 (VIIRS) flood pixels showed. SAR (GFM) is the only reliable observed-water source during the soy season.
11. **EMSR853 as a demo event.** The ADR-0001 events panel needs an "event near the book that hit no farm" example, and EMSR853 is one. None of the 12 farms lies inside the EMSR853 observed flood. Agricola Warnes Sur lies inside the Warnes AOI but 20 km from the mapped flood. Nearest farms: Canaveral San Antonio 16 km, Agricola Warnes Sur 20 km, Arrocera Mineros 26 km.

## Sources probed

### 1. Open-Meteo Flood API (GloFAS v4) — VERIFIED, primary river-hazard source
- `GET https://flood-api.open-meteo.com/v1/flood?latitude=..&longitude=..&daily=river_discharge[,_mean,_max,_p75...]&start_date&end_date | past_days | forecast_days≤210 [&ensemble=true] [&models=seamless_v4|forecast_v4|consolidated_v4]`
- HTTP 200, 0.36–0.6 s, JSON. 0.05° grid (snapped, e.g. −17.525, −62.825). Daily values in m³/s.
- History: non-null from **1997-01-01** (1984–1996 are null). Consolidated values to 2025-05-31; forecast_v4 after that.
- Forecast: `forecast_days=210` returns data to 2027-06-04, with the last month null. `ensemble=true` returns 50 members.
- Example (Río Grande at Pailón cell, 2026-11-06): last-7-day mean is 195.7 m³/s, the **6.9th percentile** of the same week in 1997–2025 (low flow, consistent with a dry spring). Annual maxima: 2008 2359, 2014 1953, 2018 1713 m³/s. The 2024 Jan–Apr peak was 806 m³/s on 2024-03-25.
- Rate limit: after 5 quick calls of ~100 coordinates each, the next call returned "Minutely API request limit exceeded". Batch ≤100 coordinates per call and cache in DuckDB. Licence (from docs, not verified live): CC-BY 4.0, data from CEMS GloFAS. Free for non-commercial use; commercial use needs an Open-Meteo plan.

### 2. Sentinel-1 RTC — Planetary Computer `sentinel-1-rtc` — VERIFIED, primary waterlogging proxy
- STAC `POST https://planetarycomputer.microsoft.com/api/stac/v1/search`, 0.4–0.8 s. Assets `vv`, `vh` (COG, 10 m, gamma0 linear power), plus `rendered_preview`/`tilejson`.
- Access: an anonymous SAS token from `https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-1-rtc` (HTTP 200, no account; via `planetary_computer.sign_inplace`). Windowed read of 1 km² takes about 2 s per band.
- Extent: 2014-10-10 → present (earliest scene at farm 2014-10-07). Licence CC-BY-4.0 per the STAC collection. The RTC processing provenance (Catalyst) is from docs and was not verified live.
- Sample values (`probes/probe_s1_rtc_read_result.json`):
  - Cuatro Cañadas (soy) VV: −10.4 to −11.0 dB in Sep 2026; −7.6 dB in Jan–Feb 2025 (wet season and canopy); −12.0 dB in Jan 2024.
  - Arrocera Mineros (rice) VV: −7.6 to −9.1 dB; water fraction 0.1–0.3 %.
- Same-season contrast: Jan–Feb 2025 vs Jan–Feb 2024 differs by 2–4 dB. That is a large interannual signal, which supports a percentile/z-score anomaly.

### 3. Sentinel-1 GRD — PC `sentinel-1-grd` and Earth Search `sentinel-1-grd` — catalogue VERIFIED, data access not verified
- PC GRD: same scenes as RTC (HTTP 200, 0.6 s). Uncalibrated DN, so we would need our own calibration and terrain correction. Not needed because RTC exists.
- Earth Search (`https://earth-search.aws.element84.com/v1/search`): HTTP 200, 0.26 s. It needs full RFC3339 datetimes (a `YYYY-MM-DD/..` interval gives 400). The hrefs are `s3://sentinel-s1-l1c/...`, a **requester-pays** bucket that needs AWS credentials. We did not read it, so verified=false. Use only as a catalogue fallback.

### 4. Copernicus Global Flood Monitoring (GFM) — VERIFIED, primary observed flood/water
- **STAC:** `https://stac.eodc.eu/api/v1` collection `GFM`, extent 2015-01-01 → present, HTTP 200, 0.5–1.5 s.
  - Assets: `ensemble_flood_extent`, `ensemble_water_extent`, `ensemble_likelihood`, `reference_water_mask`, `exclusion_mask`, `advisory_flags`, plus per-algorithm (dlr/tuw/list) layers.
  - Data are COG GeoTIFFs at `https://data.eodc.eu/collections/GFM_LAYERS/...`, 20 m, EPSG:27707 (Equi7 SA). Values: 0 = no flood, 1 = flood, 255 = nodata/outside swath.
  - Keyless windowed read takes about 1.5–2 s.
- At Cuatro Cañadas the latest catalogued tile item is 2026-11-04, but it has 0 valid pixels over the farm. The latest item **with valid pixels** is the 2026-11-03 09:42 pass (10,304 px, 0 flood), found again on 11-07. So observed latency is ≤4 days, and 1–3 days after the S1 pass is expected. We did not pin the exact publication time.
- **WMS-T:** `https://geoserver.gfm.eodc.eu/geoserver/gfm/wms` GetCapabilities HTTP 200 (2.3 MB, 5 s). Layers include `observed_flood_extent`, `observed_water_extent`, `reference_water_mask`, `exclusion_mask`, `affected_population`, `affected_landcover` and `uncertainty_values`. Time dimension 2015-01-01 → 2026-11-07, default today.
- **REST API** `https://api.gfm.eodc.eu/v2/` answers (Swagger UI). AOI/product endpoints need a free GFM portal account, which we did not create, so verified=false. STAC + COG covers our needs without it.
- Licence: free and open Copernicus data ("other" in STAC). Attribute "Copernicus Emergency Management Service – GFM".
- Gotcha: STAC item bbox is the tile, not the swath. Filter by valid pixels (see discovery 5).

### 5. JRC Global Surface Water — VERIFIED, static baseline
- PC collection `jrc-gsw` (v1.3, 1984-03 → 2020-12). Assets `occurrence`, `recurrence`, `seasonality`, `extent`, `change`, `transitions`; COG, 30 m (0.00025°). Search 1.6 s.
- Direct GCS v1.4 (to 2021): `https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/occurrence_70W_10Sv1_4_2021.tif`. Internally tiled at 256, so a /vsicurl windowed read takes 1.2 s and needs no download. Same value at Mineros (0.47 % mean occurrence).
- Results for all 12 farms (2 km box) are in `probes/probe_jrc_gsw_result.json`. 8 farms have ~0 water. Non-trivial: Mineros rice 17.7 % ever-water; Las Londras 15.6 %; Okinawa Uno, Brecha 8 and Canaveral 0.1–0.3 %.
- The monthly water history (1984–2021) is only in Earth Engine. We did not use it (needs a GEE account).

### 6. NASA LANCE MODIS / VIIRS NRT Global Flood Product — VERIFIED via GIBS (imagery only)
- GIBS WMS `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi`. Layers `MODIS_Combined_Flood_{1,2,3}-Day` (2021-01-01 → 2026-11-07) and `VIIRS_Combined_Flood_{1,2,3}-Day` (2025-06-03 → 2026-11-06). PNG, 250 m, 0.5 s per GetMap.
- Legend verified from `https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_Flood.xml`. We applied the same palette to the VIIRS layer because `VIIRS_Flood.xml` did not resolve; the colours matched. Classes: transparent = no water; (50,210,245) surface water; (255,255,0) recurring flood; (250,30,36) flood; (175,175,175) insufficient data.
- Raw GeoTIFF/HDF from `nrt3.modaps.eosdis.nasa.gov` (MCDWD_L3_NRT) needs an Earthdata Login token (free instant signup). We got an HTML page and did not log in, so verified=false for raw data.
- Wet-season cloud blindness: see discovery 10.

### 7. NOAA/GMU VIIRS Flood Map (VFM) — VERIFIED, fallback observed flood
- Public AWS bucket `https://noaa-jpss.s3.amazonaws.com/JPSS_Blended_Products/VFM_1day_GLB/{TIF,NetCDF,ShapeZIP,PNG}/YYYY/MM/DD/`, keyless, egress-free. Also a `VFM_5day_GLB` folder.
- History from 2012. Latest 2026-11-06, created 2026-11-07 03:01Z (about 1 day latency). 134 AOI tiles per day, about 20 MB each. **GLB034** (−75…−60 lon, −30…−15 lat) covers all farms. It is a striped (not tiled) GeoTIFF, yet a /vsicurl windowed read of 1°×1° took 0.37 s. Resolution 0.00337° (~375 m).
- Value legend partly verified: 101–200 = floodwater fraction 0–100 % (NASA Disasters docs). Our window held 16, 17, 30 and 99, plus a few 131–150. Our guess (unverified): 16/17 = land classes, 30 = cloud, 99 = normal open water. Cloud-limited like MODIS.

### 8. Copernicus EMS Rapid Mapping — VERIFIED, event catalogue + validation polygons
- Keyless JSON:
  - `https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/?code=EMSR853` returns AOIs, products and download paths (0.4 s).
  - `.../public-activations-info/?country=Bolivia` lists activations.
  - `https://mapping.emergency.copernicus.eu/activations/api/activations/EMSR853/` gives a summary.
- Product zips: `.../backend/EMSR853/AOIxx/DEL_PRODUCT/*.zip` returns a 302 to a presigned S3 URL (use `curl -L`). 3–8 MB each. Each contains `observedEventA` GeoJSON/shapefile.
- Bolivia activations since 2023: EMSR853 flood (Santa Cruz, event 2025-12-13, 8 AOIs, 16 products), EMSR799 flood (2025-04, Altiplano −66.7/−18.3), EMSR765 and EMSR709 wildfires.
- EMSR853 vs farms: see discovery 11 and `probes/probe_emsr853_farms_result.txt`. Union of observed flood in AOIs 02/07/08 is about 68.5 km².
- It is an event catalogue, not a monitoring feed: only 2 flood activations in about 3 years. Sample saved: `sample_emsr853_activation.json` (828 KB).

### 9. GDACS — VERIFIED, event catalogue (coarse)
- `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL&country=Bolivia&fromdate=..&todate=..&alertlevel=Green;Orange;Red`
  - Without `alertlevel` only Orange/Red events come back (just 1 since 2015). With it, **41 Bolivia floods 2015–2025**.
- `geteventdata?eventtype=FL&eventid=1103664` returns the Dec 2025 event (Green, 13–24 Dec). Its point is a **national centroid (−66.17, −17.40, Cochabamba)**, so it cannot be used for farm intersection. Some events do sit in the farm belt, e.g. 1102094 (2023-06, −62.56/−17.27) and 1103095 (2025-01, −63.60/−17.11).
- Use it for the "recent events" list with a region label only. Use polygons via `url.geometry` where they exist.

### 10. Dartmouth Flood Observatory archive — VERIFIED but stale
- The old `floodobservatory.colorado.edu/Archives/*` and `/temp/FloodArchive_region.shp` URLs return 404.
- A live copy is an ArcGIS FeatureServer, `https://services1.arcgis.com/AXaYBvnJsB5Q7sDF/ArcGIS/rest/services/Global_Archive_of_large_flood_events/FeatureServer/0/query` (keyless, 0.5 s). It holds 31 Bolivia records from 1985-02-25 to **2021-02-22** (last). Example: 2015-01-05, −63.77/−16.46, 23 dead.
- Historical context only. Not maintained for 2022+.

### Not probed / notable alternatives
- **GloFAS via CEMS EWDS / CDS API** (cems-glofas-historical, 1979+, plus return-period thresholds). Free key needed (instant signup), so verified=false. It would fix the 1997 history start and give official 2/5/20-year return-period thresholds.
- **Global Flood Database** (Cloud to Street, MODIS 2000–2018, 913 events). GEE only, verified=false.
- **MERIT Hydro HAND / height-above-nearest-drainage.** A good static waterlogging-susceptibility layer, but downloads need a registration form; verified=false. Alternatives: Copernicus DEM on PC (`cop-dem-glo-30`, keyless) plus our own low-spot/TWI.
- **Bolivia national**: SENAMHI hydrology (Río Grande at Abapó/Puerto Pailón levels), VIDECI/SINAGER-SAT alerts. These belong to the `bolivia-national` family.

## Recommendations per variable

| Variable | Primary | Fallback | Baseline | Why |
|---|---|---|---|---|
| `flood_observed` (event exposure, farm polygon + 2/5 km buffer) | GFM `ensemble_flood_extent` (EODC STAC/COG, 20 m, 2015+, ~1 d) | NOAA VFM 1-day TIF GLB034 (375 m, 2012+, ~1 d) | GFM `reference_water_mask` + JRC GSW to remove permanent and seasonal water | Only SAR sees through wet-season cloud. Keyless, Python-friendly COGs, and validated against EMSR853. |
| `river_discharge` (upstream hazard) | Open-Meteo Flood API at mapped main-channel cell, same-week percentile vs 1997–2025 | Same API, `ensemble=true` p75/max for forecast | 1997–2025 (forecast_v4 after 2025-05) | Free and fast. Good for the Río Grande. Weak for flashy small rivers (missed the Dec 2025 Piraí flood). |
| `waterlogging_sar` (field proxy) | S1 RTC (PC) VV/VH mean over polygon, track d10, z-score vs same ±15-day window in 2017–2025 | GFM `ensemble_water_extent` fraction over polygon | Own d10 history (≥8 seasons) | Suyana-style own-history anomaly. 10 m. 6–12 day cadence. Fixed thresholds fail (discovery 8). |
| `flood_prone_static` | JRC GSW occurrence/recurrence/seasonality (PC COG or GCS v1.4) | GFM reference water mask | — | 1984–2021 Landsat. Flags rice and floodplain fields. |
| `flood_events` (portfolio panel) | Copernicus EMS rapid mapping (polygons) | GDACS (41 Bolivia floods 2015–2025, coarse points) | DFO (1985–2021) for history | Keyless JSON. EMS gives real polygons for exposure maths. |

## Open risks
1. **GloFAS product mix.** Recent values are day-1 forecasts and the baseline is reanalysis. The history start is 1997, not 1984. Label these values "estimated".
2. **GloFAS skill on the Piraí is poor** (it missed the Dec 2025 flood). Do not let a "normal discharge" reading suppress observed or rain-based flood signals.
3. **GFM revisit and swath gaps.** One usable pass every 5–12 days. Many STAC items are empty for a given point, so the wrapper must filter. A flood that drains between passes is missed.
4. **SAR anomaly ambiguity.** Wet soil, crop growth, harvest, tillage and flooded vegetation all shift backscatter. Use it only as a "possible waterlogging" flag combined with rain and NDMI, and weight it below observed GFM flood.
5. **Single-track baseline.** 2022–24 has only about 12–24 scenes per year (S1B loss). Same-window baselines may hold only 1–2 scenes per year, so widen the window to ±15–30 days and floor the sd.
6. **Rice/irrigated fields.** Standing water is normal, so the flood signal must use the field's own history and a crop flag.
7. **Licensing.** Open-Meteo's free tier is non-commercial. Fine for the hackathon; a bank product needs a paid plan or direct CEMS data.
8. **Latency of event catalogues.** EMS activations arrive 2–3 days after the event and are rare. GDACS points can be country centroids.
9. **VFM value legend** is only partly verified.
