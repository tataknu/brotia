# Family: disaster and drought event catalogs (`events-catalogs`)

Probed 2026-11-06/07 (UTC) from a laptop, no keys and no accounts. Test farms: the 12 sample farms
(cluster about -63.3..-62.5 lon, -17.75..-16.85 lat, Santa Cruz lowlands). Scripts and small samples
are in this folder.

## TL;DR

- **Drought events with footprints:** use **GDO Drought Tracking** (Copernicus GDO, `jspeS`). It
  needs no key, has history since 1991, a 0.25° grid, dekadal steps and discrete event IDs with
  polygons. It found every known Santa Cruz drought for our farms (2019, 2020-21, 2022, 2023-24,
  2024, 2025). This is the best find of this family.
- **Floods with real footprints:** use **Copernicus EMS Rapid Mapping**. It needs no key. Its
  observed flood vectors cover the Dec-2025 Piraí flood (EMSR853): AOI 08 "La Caranda" contains
  *Agricola Warnes Sur*, and the AOI 06 "Montero" extent is 0.1 km from *Canaveral San Antonio*.
- **Fires:** for history, use **NASA FIRMS yearly country CSVs** (no key, MODIS since 2000).
  For near-real time, use the FIRMS rolling 24h/48h/7d CSVs (no key, about 4 h latency).
  **There is a gap: FIRMS has no Jan-Oct 2026 data without a key.** Without a key, the gap can be
  filled from **INPE monthly South America CSVs** (`mensal/America_Sul/focos_mensal_YYYYMM.csv`).
  They exist for every month 2024-01..2026-11, but each is 25-180 MB (verified: 202601 returns
  200 and 48 MB). INPE daily CSVs are also available from 2026-05-14 (about 5 MB/day). The lighter
  path is a FIRMS MAP_KEY. That it is a free, instant email sign-up is *unverified*; the DEMO key
  returns 400.
- **Index and cross-reference:** GDACS, the GLIDE JSON, the ReliefWeb RSS and IFRC GO all carry
  **GLIDE numbers**, so GLIDE is the join key. **Do not intersect GDACS flood or drought polygons
  with farms.** They are department-sized or 2°-blocky (details below).
- **Blocked or registration-only:** the ReliefWeb API v2 (needs an approved appname), EM-DAT
  (registration; its API is for commercial users), IFRC Montandon STAC (needs a GO token), VIDECI
  (returns 403 to scripts). FEWS NET has no Bolivia coverage.

## Probe results

| Source | What I ran | Result |
|---|---|---|
| **GDACS API** `gdacsapi/api/events/geteventlist/SEARCH?country=Bolivia&alertlevel=green;orange;red&eventlist=FL;DR;WF;TC;VO` | Paginated 2023-01-01..2026-11-06 (pagesize 100; 5 pages) | 200, 0.7-3.5 s/page. **419 non-EQ events** (392 green WF, 21 FL, 2 DR, 1 red WF). The latest WF ends 2026-11-06, so latency is under 1 day. Without `alertlevel` only 5 Orange/Red events come back (the default filter hides Green). `getgeometry` returns 200 in 0.3-1 s. |
| GDACS footprints | `probe_gdacs.py` intersects footprints with the farms | **DR 1016612** (Orange, 2023-08-21..11-30, "Medium impact for agricultural drought in 319,815 km²"): a 2°-block polygon containing 10 of 12 farms. **FL 1102094 / FL 1103643** (GLOFAS) polygon = `[-64.85,-20.47,-57.45,-13.48]` = **the Santa Cruz department bbox**, so "12 farms inside" is an artifact. **FL 1103664** (Dec 2025; CEMS links it to EMSR853) has its `Poly_Affected` in **Cochabamba** (-66.2,-17.4), not the Piraí basin, and its `Poly_Global` is worldwide. The nearest WF footprints to the farms are 17-47 km away (Jul-Aug 2024). WF `alertlevel` does not track size: WF 1018546 is "Red", yet its severitytext says "Green impact … 49,853 ha". |
| **GDO Drought Tracking** `drought.emergency.copernicus.eu/data/Drought_Observatories_datasets/GDO_Drought_Tracking/ver1-0-0/jspeS_m_gdo_YYYY…_t.zip` | Downloaded the yearly zips (0.4-0.55 MB each, about 0.9 s). Each zip holds GeoJSON per publication dekad, with features `{id_cl_st, time, area_km2, centroid, consolidated}` and dekadal polygons. Ran `probe_gdo_tracking.py` | 200. Drought events covering the farms: **5091** 2019-02-11..04-21 (4 farms) · **5434** 2020-05 (7) · **5669** 2020-10-01..2021-10-21, 18 dekads (12) · **5916** 2022-07-11..08-11 (12) · **6128** 2022-11-11..2023-01-21 (12) · **6337 2023-09-11..2024-03-01, 16 dekads, max 12.2 M km²** (12) · **6488 2024-05-21..11-01, 16 dekads** (12) · **6647** 2025-07-21..09-21 (12). Latest file: `20261021`, published 2026-11-06, so latency is about 2 weeks. **No cluster covers the farms as of 2026-10-21.** Only *consolidated* (ended) events are published; ongoing events are not in this product. The sister product `GDO_Meteorological_Drought_Tracking` (`jspa3`, SPI-3) gives the same 2022-23 event (22293). |
| GDO RDrI-Agri `GDO_Risk_of_Drought_Impacts_for_Agriculture/ver4-0-1/rdria_m_gdo_YYYY…_t.nc` | 2024 and 2026 files (about 280 KB, 0.7 s), read with h5py (`probe_gdo_rdria.py`) | 200. **1° grid, dekadal, 2010 to 2026-10-11**, classes 0-3. 2024: cell (-16.5,-62.5) = **3** from June to Oct 2024. The cells at -17.5 = 0, so it is too coarse to tell farms apart. 2026: all 0. The `ver4-0-0` path returns 404; everything is now in `ver4-0-1/`. |
| GDO WMS `…/api/wms` | GetCapabilities 1.3.0 → **502**; 1.1.1 → 200 | Layers `smang, fpanv, spaST, spaLT, spcST, spgTS, rdria, twsan…`, with TIME up to 2026-10-21. GetMap over Santa Cruz works (PNG). **There is no GetFeatureInfo**, so any value would have to come from decoding PNG colours. `cdiad` (CDI) is Europe-only. The fAPAR anomaly netCDF is 137-159 MB/yr, so I leave it to the NDVI family. |
| **Copernicus EMS Rapid Mapping** `rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=500` and `public-activations/?code=EMSRxxx` | Listed the activations, then read the details | 200. The list holds 268 activations (2023-03 .. 2026-10). Bolivia: **EMSR709** (WF, 2023-11, gdacs WF1018546), **EMSR765** (WF, event 2024-08-04, 14 AOIs in Chiquitanía/Guarayos; nearest AOI 59 km from Estancia Mineros Norte), **EMSR799** (FL, 2025-04), **EMSR853** (FL, event 2025-12-13, 8 AOIs in Portachuelo, Montero, Warnes, La Caranda, El Torno, Urubó…). The product zip (`DEL_PRODUCT`) sends a 302 to signed S3, so `-L` is needed. The AOI08 zip is 4.3 MB of shapefiles plus GeoJSON: `observedEventA` (riverine flood, semi-automatic), `floodDepthA`, `modelledEventA`. Some `downloadPath` values are empty. Sample: `cems_EMSR853_AOI08_observedFlood.json`. The observed flood polygon is 21 km from the Warnes Sur farm point (the AOI contains the farm). |
| **NASA FIRMS, no key** | HEAD/GET on `data/country/modis/YYYY/modis_YYYY_Bolivia.csv`, `data/country/viirs-snpp/…`, `data/active_fire/*/csv/*_South_America_{24h,7d}.csv` (`probe_firms.py`) | Yearly MODIS Bolivia: 2000 to **2025** (2024 = 17.0 MB, 213,817 rows; 2025 = 3.0 MB, last date 2025-12-30, file modified 2026-10-10). **2026 yearly returns 404.** VIIRS yearly = 71 MB (over the size limit). Rolling NRT: MODIS 7d (1.5 MB) and NOAA-20 7d (4.5 MB) end **2026-11-06 23:52 UTC** when fetched at 05:04 UTC, so latency is about 4-5 h. **The Suomi-NPP 24h file is empty and its 7d file ends 2026-11-02**, so SNPP is gone: use NOAA-20/21. MODIS detections within 25 km of a farm: 2024 = 1,901 (peak Aug 527), 2025 = 1,678 (peak Sep 567). Most are near the Mineros / San Antonio sugarcane and rice belt, which points to agricultural burning (chaqueo) and cane burning, not wildfire. The `area/csv/DEMO/...` API returns 400, so a MAP_KEY is required. |
| **INPE Queimadas** `dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/America_Sul/focos_diario_YYYYMMDD.csv` | GET 2026-11-06 | 200, 5.3 MB, 37,097 rows, 5,819 in Bolivia (642 in Santa Cruz). Last time 2026-11-06 23:52. Columns include `municipio, estado, pais, numero_dias_sem_chuva, precipitacao, risco_fogo, frp`; the satellites include GOES-19. Daily files are kept from **2026-05-14**. Annual `anual/AMS_sat_ref/focos_ams_ref_YYYY.zip` (reference satellite, 10-19 MB) runs 2003-2025. Monthly `mensal/America_Sul` files for 2026 are 32-178 MB (too big). TerraBrasilis WFS `bdqueimadas2:focos` with a bbox returns 262,809 Santa Cruz-cluster points since 1998, but my 2026 CQL/sort queries returned 0, so its recency is **unverified**. |
| **ReliefWeb API v2** `api.reliefweb.int/v2/disasters?appname=…` | Requests with and without an appname | v1 → **410** "decommissioned". v2 with no appname → 400 "Missing appname"; with an unapproved name → **403** "not using an approved appname". Since 2025-11-01, appnames must be requested from ReliefWeb with a form; the approval time is unverified. |
| ReliefWeb RSS `reliefweb.int/disasters/rss.xml?advanced-search=(C39)` | GET | 200, 93 KB, 20 Bolivia disasters with GLIDE in the URL: FL-2025-000235 (Dec 2025), WF-2025-000163 (Aug 2025), FL-2025-000038 (Mar 2025), WF-2024-000134 (Jul 2024), FL-2024-000021, **DR-2023-000191 (Sep 2023)**, …. No footprints. |
| **GLIDE** `glidenumber.net/glide/jsonglideset.jsp?level1=BOL&fromyear=2023&toyear=2026` | GET | 200, 10 GLIDEs from 2023 to 2026, with lat/lon, source and narrative. Example: FL-2025-000235-BOL lists the affected municipalities "El Torno, La Guardia, Warnes, Montero, General Saavedra, Mineros, Porongo, Colpa Bélgica". |
| **IFRC GO** `goadmin.ifrc.org/api/v2/event/?countries__in=33` | GET | 200, about 1 s, **74 Bolivia events** (Bolivia = id **33**; the `iso3=` filter is ignored). Includes 2025-12 "Floods in Santa Cruz" (FL-2025-000235-BOL), 2025-08 fires, 2024-07 fires, 2023-09 El Niño drought. The severity field is almost always Yellow and `num_affected` is null. The sample `go_bol.json` is cut down to id, name, type, date, GLIDE and severity; contacts were removed. |
| **DesInventar Sendai (Bolivia)** `desinventar.net/DesInventar/profiletab.jsp?countrycode=bol` | GET profile; checked the export size | 200. **Covers 1970-2015**, 5,498 records (flood 2,309, drought 586, hail 493, forest fire 211), indexed by municipality. The export `download/DI_export_bol.zip` is 25 MB. I measured its size only (streamed to /dev/null) and did not keep it. Useful as a long baseline, but it has nothing after 2015. |
| EM-DAT `api.emdat.be/v1` (GraphQL) | POST without a key | 500 "Missing API Key". Needs registration (free for academic/non-profit use); the API is for commercial users. Not verified beyond this. |
| IFRC Montandon STAC `montandon-eoapi-stage.ifrc.org/stac/collections` | GET | **401** "Not authenticated" (needs a GO bearer token). It would merge GDACS, EM-DAT, GLIDE, DesInventar and CEMS into one STAC. |
| FEWS NET FDW `fdw.fews.net/api/ipcphase/?country_code=BO` | GET | 200 with `[]`: **Bolivia is not covered**. |
| VIDECI `defensacivil.gob.bo` | GET | **403** to scripted clients; I did not try to get around it. Departmental and municipal emergency declarations appear as PDF decrees in the *Gaceta Oficial de Santa Cruz* (`gacetaoficial.santacruz.gob.bo`) and in news reports (e.g. 2024: 12 municipalities in emergency or disaster for drought and fires; Sep 2025: departmental emergency). There is no machine-readable feed; this would be manual curation (unverified). |
| GEOGLAM Crop Monitor, GWIS API | Web search only | The Early Warning Crop Monitor mentions Bolivia in monthly PDFs; I found no API. GWIS burned-area and fire-event APIs exist (api.store / JRC), but the endpoints I guessed returned 404. GDACS WF events already come from GWIS (`source=GWIS`). Unverified. |

## Recommended event-list design (for the "recent climate disasters" panel)

One normalised table in DuckDB, `events`:

```
event_id, source, hazard{drought,flood,fire,frost,hail,storm}, start, end,
footprint (geometry), footprint_kind{cluster,observed_vector,point_buffer,aoi,admin,coarse_block},
severity_raw (text/number from the source), severity_norm (0-1),
links{glide, gdacs_id, emsr_code, reliefweb_url, ifrc_go_id}, as_of, provenance
```

- **Join key: GLIDE.** GDACS, ReliefWeb, GLIDE JSON and IFRC GO all carry it, and CEMS carries
  `gdacsId`. Use the GLIDE JSON to attach narratives and affected municipalities.
- **Intersecting footprints with farm polygons** (a farm counts as hit when the footprint overlaps it):
  - *Drought:* GDO Drought Tracking clusters. Each event is the dekads where the farm polygon
    overlaps cluster `id_cl_st`; start and end = the first and last such dekad. Deduplicate on
    (`id_cl_st`, `time`), because the files are organised by publication dekad and repeat
    earlier dekads.
  - *Flood:* CEMS `observedEventA` (and `floodDepthA`) vectors.
  - *Fire:* FIRMS / INPE detections, with two rings: **≤5 km = on-farm or adjacent** and
    **≤25 km = context or smoke**. Keep only `type==0`, drop low confidence, and deduplicate each
    day across satellites.
- **Context only (never decide "farm hit" from these):** GDACS FL/DR polygons (admin- or
  2°-sized), GDACS WF points that have no burned perimeter nearby, ReliefWeb / IFRC GO / GLIDE
  narratives, VIDECI or Gaceta declarations (these become intersectable only after joining with
  municipal boundaries from another family).
- **Severity, following Suyana's anomaly-first guidance:**
  - *Drought:* duration in dekads × area, and RDrI-Agri class (0-3) as a coarse second opinion.
  - *Fire:* the count of detections in the ring over a 30-day window, expressed as a
    **same-time-of-year percentile** against the MODIS 2000-2025 history for that farm. A plain
    count is misleading in this region because burning before planting is routine.
  - *Flood:* observed flooded area inside or near the farm (CEMS), plus the GDACS alert level as
    a fallback.
  - *Wildfire size:* parse hectares from GDACS `severitytext`. Do not use `alertlevel`.
- Rank by `severity_norm × share of the portfolio hit`, then by recency within the 13-month window.
  Show the GLIDE/EMSR link as provenance.

## Primary and fallback per variable

| Variable | Primary | Fallback | Baseline / validation |
|---|---|---|---|
| Drought events (footprint + dates) | GDO Drought Tracking `jspeS` (no key, 1991+, ~2 wk latency) | GDACS DR events (no key, <1 d, coarse 2° polygons) for ongoing droughts | GDO `jspa3` (SPI-based); ReliefWeb/GLIDE DR-2023-000191 |
| Agricultural drought risk (context) | GDO RDrI-Agri netCDF (1°, dekadal, 2010+) | GDO WMS PNG (`rdria`, `spaST`) for map tiles only | — |
| Flood events with footprint | CEMS Rapid Mapping observed vectors (no key) | GDACS FL (GLOFAS) as a date/alert index only | SAR flood family for farms with no CEMS AOI |
| Fire history (baseline) | FIRMS MODIS yearly country CSV (no key, 2000-2025) | INPE `AMS_sat_ref` annual zips (2003-2025) | FIRMS VIIRS yearly (71 MB, so download offline once) |
| Fire, current 13 months | FIRMS area API with **MAP_KEY** (free/instant and ≤10 days per call: *unverified*) | INPE monthly AMS CSVs (no key, 2026-01..11 present, 25-180 MB each; filter to Bolivia in the service) + INPE daily (from 2026-05-14) + FIRMS NRT 7d (no key) | GDACS WF (GWIS ≥5,000 ha) and CEMS EMSR709/765 |
| Disaster index / narrative | GDACS + GLIDE JSON (no key) | ReliefWeb RSS (no key); IFRC GO API (no key) | ReliefWeb API v2 once an appname is approved |
| Historical disaster losses by municipality | DesInventar Bolivia (1970-2015, no key) | EM-DAT (registration) | — |

## Decisions ready for an ADR (for the product-owner phase)

1. **Drought events:** GDO Drought Tracking is the primary event source, and farm hits come from
   cluster polygons. GDACS DR serves only for ongoing or unconsolidated droughts and as a
   cross-reference.
2. **Never intersect GDACS FL/DR polygons with farms.** For Bolivia they are admin- or block-sized
   (a GLOFAS flood = the whole Santa Cruz department). GDACS is an index, not a footprint source.
3. **Floods:** CEMS Rapid Mapping vectors are the footprint source for past events. Farms outside
   CEMS AOIs rely on the SAR-flood family.
4. **Fires:** FIRMS MODIS yearly files are the baseline (2000+). For the 2026 part of the window,
   **the team must decide whether to register a FIRMS MAP_KEY**, which is the lighter path. Without
   one, current-year fire history comes from INPE monthly South America files (25-180 MB/month,
   streamed and filtered to `pais=Bolivia` in the service) plus INPE daily files from 2026-05-14.
   The 20 MB download limit was a rule for this probe, not a limit on the service.
5. **Fire severity is an anomaly** (same-time-of-year percentile of detections in a 5 km and a
   25 km ring), not a raw count, because agricultural burning is routine in Santa Cruz.
6. Use **NOAA-20/21 VIIRS, not Suomi-NPP** (the SNPP feed stopped about 2026-11-02; GDO also moved
   from SNPP to NOAA-21 in Jul 2026).
7. **GLIDE is the cross-source join key.** The ReliefWeb API is optional, because the RSS covers
   the panel's needs until an appname is approved.

## Open risks

- **FIRMS 2026 gap** inside the 13-month window: no FIRMS data without a key. Without a key, it
  costs large INPE monthly downloads (about 1 GB for Jan-Oct 2026), or a one-off offline job that
  pre-filters to Bolivia and saves the result into the snapshot. INPE also uses different
  satellites and algorithms from FIRMS, so the two counts are not directly comparable; build the
  percentile baseline from a single source.
- GDO Drought Tracking publishes only *ended* events, with about 2 weeks of latency, so a drought
  that is still developing appears only in GDACS DR or in rasters.
- The GDACS→CEMS link for EMSR853 points to FL1103664 (Cochabamba), so the IDs do not always refer
  to the same footprint. Trust GLIDE and the CEMS geometry instead.
- Farms are points today. All hits above use points (or buffers), so the real polygons may change
  the results.
- Fire detections near the sugarcane and rice belt (Mineros, San Antonio) are mostly managed
  burning, which risks false "disaster" flags unless the ring and anomaly rules above are applied.
- The ReliefWeb appname approval time, EM-DAT, VIDECI, GEOGLAM and the GWIS API are unverified.
  DesInventar stops at 2015.
- The GDO WMS GetCapabilities call fails on version 1.3.0 (502); use 1.1.1.

## Files

`probe_gdacs.py` (→ `gdacs_bolivia_events.csv`), `probe_gdacs_intersect.py`, `geom_*.json`,
`gdacs_bol_all.json` · `probe_gdo_tracking.py` (→ `gdo_drought_events_farms.csv`) ·
`probe_gdo_rdria.py` (needs h5py; not in the project venv) · `gdo_wms_capabilities.xml`,
`gdo_*.png` · `cems_EMSR765.json`, `cems_EMSR853.json`, `cems_EMSR853_AOI08_observedFlood.json` ·
`probe_firms.py` (→ `firms_near_farms_sample.csv`) · `rw_rss.xml`, `glide_bol.json`, `go_bol.json` ·
`farms.py`.
