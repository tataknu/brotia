# Bolivia national sources: data discovery notes

Family key: `bolivia-national`. Probed on 2026-11-06 from a Python server context (plain `curl` and `requests`, no accounts, no keys).

## TL;DR

1. **Bolivian national sources do not give a free, current daily station series near the farms.**
   - SENAMHI publishes its full station catalogue through an open OGC WFS: 2,024 stations, 147 in the Santa Cruz box, with start dates.
   - SENAMHI does not publish the observations openly. Its backend serves daily data to its own geovisor, but this is undocumented. My probe of the data endpoints was blocked by the session permission system, so I did not verify them. The official route is a data request to SENAMHI.
   - On NCEI, the free global mirror (GHCN-Daily) for Viru Viru (BLM00085244) and El Trompillo (BLM00085245) **ends on 2025-08-24**. My ISD/GSOD query for Oct 2026 returned only a header.
   - **Result:** for the 13-month display window, daily precipitation, Tmax and Tmin must come from the gridded families. National stations are for validation only.
2. **Verified and useful now:**
   - **SENAMHI active alerts JSON** (weather and hydrological): live, keyless, with MultiPolygon areas, so a point-in-polygon test against the farms is easy. This is the primary source for "recent events / warnings".
   - **INE Bolivia yield tables** (xlsx, keyless): Santa Cruz department, per crop, 1983-84 to 2024-25. Department level only, so baseline and sanity check only.
   - **ANAPO Memoria Anual 2024** (PDF, keyless). It has municipality-level 2023/24 soy yields and Oct–Mar rainfall:
     - Pailón: 0.42 t/ha and 349 mm.
     - Cuatro Cañadas: 0.55 t/ha and 403 mm.
     - Zone Este rainfall was 455 mm, against 899 mm the previous season.

     This is the ground truth for the ADR-0002 Phase-2 backtest.
   - **SENAMHI monthly climate summaries** (PDF). Station totals against the 1991–2020 normals for Viru Viru and Trompillo, published about one month late. Validation only.
3. **Not reachable from here** (DNS failure, or 403 to scripted clients): VIDECI (defensacivil.gob.bo), SENASAG, GeoBolivia (geo.gob.bo), the MDRyT Observatorio Agroambiental, SIAPRO, and ABT SIMB/geo. Each needs a manual check in a browser. I did not try to work around the blocks.

## 1. SENAMHI Bolivia (Servicio Nacional de Meteorología e Hidrología)

### 1a. Station catalogue: GeoServer WFS (VERIFIED, keyless)

- **Endpoint:** `https://senageo.senamhi.gob.bo/geoserver/senamhi/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=senamhi:estaciones&outputFormat=application/json&bbox=-64.2,-18.6,-61.6,-15.8,EPSG:4326`
- **Probe:** HTTP 200 in 2.1 s, 154 KB. 147 stations in the Santa Cruz box; 2,024 nationally (`resultType=hits`).
- **Fields:** `codigo_senamhimet`, `estacion`, `lat`/`lon`, `altura`, `activo`/`estado`, `fecha_inicio`, `clasificacion` (P pluviométrica, TP termo-pluviométrica, CP climatológica principal, S sinóptica), `propietario`, `operador`.
- **Gap:** there is no end-date field, so the record length of inactive stations is unknown.
- **WMS:** the same GeoServer also serves WMS layers (`estaciones`, `municipio`, `cuenca`, `cm_precip_anual`, `cm_temp_anuales`, `temp_est`). These are static climatology maps.
- **Script:** `probe_senamhi_stations.py`. **Sample:** `samples/senamhi_stations_santacruz.geojson`.

**Nearest SENAMHI stations to the sample farms** (from the WFS; the distance is to the nearest farm in the group):

| Farm(s) | Station (code) | Distance | Type | Status | Record start |
|---|---|---|---|---|---|
| Okinawa Dos, Okinawa Uno | **Okinawa I** (07017) | 5.4–7.7 km | TP (rain and temperature) | Active | 1975-10-30 |
| Arrocera Mineros, Mineros Norte | **Minero (Unagro)** (07015) | 11 km | TP | Active | 1975-12-31 |
| Arrocera Mineros, Cañaveral San Antonio | **General Saavedra** (07061), the "Saavedra-CIAT" station | 6.4–10 km | conventional | **Inactive**, end date unknown | 1959-01-01 |
| Cañaveral San Antonio | Montero_Muyurina (07016) | 8.8 km | TP | Inactive | 1991-04-28 |
| Cañaveral San Antonio, Arrocera Mineros | Montero Guabirá CIMAR | 7.6 km | CP | Active | **2025-08-20** (new) |
| Los Tajibos, Brecha 8 | **San Julián** (07031) | 10–13 km | P (rain only) | Active | 1973-03-29 |
| Los Tajibos, Brecha 8 | San Julián – Com. Los Ángeles (GPRS automatic) | 10–13 km | S | Active | 2019-04-13 |
| Cuatro Cañadas Lote 7, El Cusi | Palometillas (07125) | 1.8–14 km | conventional | Inactive | 1979-09-01 |
| Cuatro Cañadas, El Cusi, Pailón Norte | **Cuatro Cañadas – CEA-2 (GPRS)** | 9.6–22 km | S | Active | 2020-09-07 |
| Cuatro Cañadas | Cuatro Cañadas – Col. Chihuahua (GPRS) | 35 km | S | Active | 2019-12-15 |
| Pailón Norte, Las Londras | Pailón (Satelital) | 10–12 km | automatic | Inactive | n/a |
| Pailón Norte, Las Londras | Puerto Pailas (07021) | 10–15 km | conventional | Inactive | 1980-12-31 |
| Las Londras | Puente Pailas (Autom) (07201) | 8.3 km | automatic | Active | n/a |
| Warnes Sur | **Viru Viru Aeropuerto (F)** | 11.7 km | synoptic/airport | Active | 1984-07-24 |
| Warnes Sur | Santa Cruz El Trompillo (WMO 85245) | ~27 km | synoptic | Active | 1958 (GHCN) |

What this means:

- Long same-time-of-year baselines (30+ years) exist only at a few conventional stations: Okinawa I, Minero/Unagro, San Julián, Viru Viru and Trompillo. Of these, only Okinawa I and Minero/Unagro also measure temperature (TP).
- The automatic GPRS stations closest to the soy belt in the east start in 2019–2020. They are too short for a baseline.
- None of these series is openly downloadable (see 1b).

### 1b. Station observations (NOT VERIFIED; access is institutional)

What I verified:

- The public geovisor `https://sena.senamhi.gob.bo/public/public-geoanalisys` (an Angular app) talks to a backend at `https://senab.senamhi.gob.bo/api`.
- Plain GETs returned HTTP 200 for:
  - `variables`: the variable catalogue. Ids include precipitation 1, Tmax 3, Tmin 4, Tmean 5, **ETo 27**, hail ("Granizo") 57, sun hours 50, RH 6–9, flags for hourly, daily and monthly data, and its colour-scale settings.
  - `layers/stations`
  - `metStations/{id}`
- Other routes returned 401 without a token.

What I did not verify:

- The bundle also references the station time-series endpoints (`stations/variables`, `stations/historyvariables`, both POST). My probe of them was **blocked by the session permission system**, so whether they work without auth, their history depth and their latency are all unknown.
- This is an undocumented internal API with no published terms. **Do not build on it** without written permission from SENAMHI.

Official route:

- Request the data from SENAMHI: Dirección de Meteorología, `dirmethi@senamhi.gob.bo`, `info@senamhi.gob.bo`, phone +591-2-2355824.
- The cost and turnaround are unknown. Peru's SENAMHI charges per station-variable; Bolivia's terms are not published.
- This route is too slow for the hackathon, but it is the correct path for a product.

### 1c. Active alerts JSON (VERIFIED, keyless): PRIMARY for "recent warnings"

**Weather alerts:**

- **Endpoint:** `https://senamhi.gob.bo/index.php/api/alertas/active-alerts`. This is a proxy of `https://senab.senamhi.gob.bo/api/public/forecastweather/active-alerts`; both return 200 without auth.
- **Probe:** HTTP 200 in 4.9 s, 13 KB, 3 active alerts on 2026-11-06:
  - 93/26: heavy rain on 11-07.
  - 92/26: cold front on 11-07 to 11-08.
  - 91/26: strong wind on 11-06 to 11-08.
- **Fields:** `idEventType`, `date[start,end]`, `description` (Spanish), and `dropArea` (a GeoJSON MultiPolygon).
- **Farm test:** alerts 92/26 and 91/26 cover all 6 farms I tested.
- **Script:** `probe_senamhi_alerts.py`.

**Hydrological alerts:**

- **Endpoint:** `https://senamhi.gob.bo/index.php/api/alertas/active-hydro-alerts`.
- **Probe:** HTTP 200 in 3.9 s, 1.1 MB, 3 active basin notices. The areas are HTML with embedded images, not polygons. The basins are named in the text.

**Limits of both feeds:**

- **They show current alerts only.** I found no public archive endpoint, so to build history we must snapshot them daily ourselves (store each poll in DuckDB).
- The event types include frost / cold front, heat, hail and storms, heavy rain and wind. This makes the feed the **"official warning" layer** behind the frost, heat and hail proxies.

### 1d. Monthly climate summary PDFs (VERIFIED, keyless): validation only

- **URL:** `https://senamhi.gob.bo/climatologia/{YYYY}/{MM} RESUMEN CLIMÁTICO {MES} {YYYY}.pdf`. The index is at `/index.php/clima/monitoreo-climatico`; 2024 to Sep 2026 are listed.
- **Probe:** the Sep 2026 issue returned HTTP 200 in 1.4 s, 4.2 MB, 39 pages.
- **Example, Sep 2026:**
  - Viru Viru: 217.8 mm against a normal of 72.9 mm (1991–2020). Maximum in 24 hours: 80.0 mm (record 110.6 mm). 9 rain days against a normal of 7.
  - Trompillo: 197.6 mm against a normal of 71.5 mm. Tmax anomaly −1.26 °C.
- **Latency:** about 1 month.
- **Use:** spot-checks of gridded anomalies at Viru Viru and Trompillo.

### 1e. Agrometeorological bulletins (VERIFIED, keyless)

- **10-day ("decenal") bulletin, Chiquitanía macro-region:**
  - **URL:** `https://senamhi.gob.bo/agromet/boletines_agrometeorologia/boletines_decenales/{YYYY}/{MES}/{N} DECENA/7 BOLETíN CHIQUITANIA {date}.pdf`. 217 PDFs are listed.
  - **Probe:** HTTP 200, 1.1 MB, 7 pages, for the 10 days from 4 to 13 Nov 2026.
  - **Content:** the monitoring section has *maps only*: an estimated precipitation anomaly against 1989–2015, and FAO-ASIS VHI. The station table is a **forecast** for Viru Viru, Cuatro Cañadas CEA-2, Col. Chihuahua, San Julián Los Ángeles, Pailón–Pozo del Tigre and Trompillo. It covers Tmin, Tmax, HR, **ETP** (72–86 mm in 10 days) and rain min/max.
  - **Use:** not an observation series. It gives qualitative context and confirms that SENAMHI itself uses FAO-ASIS VHI.
- **Monthly agroclimatic bulletin:**
  - **URL:** `.../boletines_Agroclimatico/mensual_2026/{N}. BOLETÍN_AGROCLIMÁTICO_{MES}_2026.pdf`. 22 are listed.
  - Listed but not parsed.
- **Other SENAMHI pages:**
  - The drought monitor (`/servicios/monitor-sequias`) returned **HTTP 500** (a Laravel error).
  - The water-balance service (`onsc.senamhi.gob.bo`) did not resolve in DNS.
  - Heat-focus forecasts are daily PDFs under `/focoscalor/2026/...`.

## 2. INE Bolivia (Instituto Nacional de Estadística): yields (VERIFIED, keyless)

- **Index page:** `https://www.ine.gob.bo/index.php/estadisticas-economicas/agropecuaria/agricultura-cuadros-estadisticos/`
- **Files:** public Nextcloud shares at `https://nube.ine.gob.bo/index.php/s/{id}/download`. The labels on the page are offset by one link, so check the filename in `Content-Disposition`.
  - `heefZ2fZlqIIMik`: yield ("Rendimiento") by agricultural year, per department, 1984–2025 (xlsx, 324 KB, 3–10 s).
  - `6kBAE1i0Ys4tF0U`: area ("Superficie"), 1984–2025.
  - `DNFbjMZIJiqKFSL`: winter-campaign production per crop, 2012–2025. Other links cover summer and winter yield and area for 2012/13–2025.
- **Santa Cruz soy yield (kg/ha):**

  | Agricultural year | Yield |
  |---|---|
  | 2020-21 | 2506 |
  | 2021-22 | 2344 |
  | 2022-23 | 2003 |
  | **2023-24** | **1918** |
  | 2024-25 (provisional) | 2091 |

- **Santa Cruz rice yield:** 3497 kg/ha in 2022-23, falling to **2036** in 2023-24. This is a clear drought signal.
- **Limits:** department level only, with no municipal breakdown. Values from 2021 on are provisional (p).
- **Fit:** baseline only, as a sanity check that our anomaly score ranks 2023-24 as bad.
- **Script:** `probe_ine_xlsx.py`, which parses the xlsx with the standard library only. **Sample:** `samples/ine_santacruz_yield.csv`.
- **Microdata:** the ANDA catalogue (`anda.ine.gob.bo`) holds the Encuesta Agropecuaria and Censo Agropecuario microdata (HTTP 200). A new 2026 agricultural census was signed with the Gobernación (CAO news, Oct 2026).

## 3. ANAPO (Asociación de Productores de Oleaginosas y Trigo): BACKTEST GROUND TRUTH (VERIFIED, keyless)

- **Finding the PDFs:** the "Memorias anuales" are shown in a flipbook viewer. The PDFs are listed by the public WordPress media API: `https://anapobolivia.org/wp-json/wp/v2/media?search=memoria&mime_type=application/pdf`
  - `.../uploads/2024/11/Memoria-OK.pdf`: Memoria 2023.
  - `.../uploads/2025/03/MEMORIA-OK.pdf`: Memoria 2024, 131 pages, 4.4 MB.
  - `.../uploads/2026/03/MEMORIA-2025.pdf`: Memoria 2025.
  - The viewer pages go back to 2017.
- **Content of Memoria 2024, chapter 5 "Informes de Campaña":** soy summer 2023/24, soy winter 2024, wheat and sunflower winter 2024, each split into Zona Este and Zona Integrada. Chapter 6 has Santa Cruz production series for soy, wheat, sunflower, maize and sorghum.
- **Extracted facts** (in `samples/anapo_2023_24_campaign_truth.csv`):
  - **Zona Este, summer 2023/24 soy:**
    - 800,900 ha sown, 480,800 ha affected, 102,350 ha lost. Yield 1.20 t/ha.
    - Rain Oct 2023–Mar 2024 averaged **455 mm, against 899 mm in 2022/23**.
    - Pailón: **0.42 t/ha** and 349 mm. Cuatro Cañadas: **0.55 t/ha** and 403 mm. San Julián: 509 mm.
    - "Between January and February some areas went more than 30 days without rain, with temperatures above 30 °C." Flower abortion and poor grain fill followed.
  - **Zona Integrada:**
    - 355,700 ha sown, yield 1.64 t/ha.
    - Montero/Okinawa: 1.85 t/ha. Minero/Peta Grande: 1.75 t/ha. Sur Integrada (Mennonite colonies): 0.27 t/ha.
    - 125,200 ha were affected by drought, and 20,900 ha were lost to **waterlogging in April 2024** at harvest.
- **Crop calendar (from the text):**
  - Summer soy is normally sown Oct–Dec; in 2023/24 sowing slipped to late Nov–Jan. Harvest runs Mar–May.
  - Winter crops (soy, wheat, sunflower, sorghum, maize) are sown Mar–May in Zona Este and harvested Aug–Oct.
- **Fit:** validation only. It is the most important input for the Phase-2 backtest: the eastern-zone farms (Cuatro Cañadas, El Cusi, Pailón, Las Londras, San Julián) must come out as watch or high, and Okinawa/Mineros as milder.
- **Note:** `anapobolivia.org/estadisticas/` is an empty page.

## 4. CAO (Cámara Agropecuaria del Oriente)

- **Probe:** `cao.org.bo/estadisticas/` returned HTTP 200, but only as a description. The compendium "Números de Nuestra Tierra" is published annually **on CD or on request**. The WordPress media API returned an error.
- **Other services:** Agrodatos (`agrodatos.com.bo`) and SIPREM (prices) are linked from the site. I did not probe them; they are likely commercial.
- **Fit:** reject for automation. Media quotes give drought and flood losses by campaign; for example, the CAO reported 50,000 ha of soy, rice and maize affected by rain in 2018.

## 5. VIDECI (Viceministerio de Defensa Civil), Gobernación de Santa Cruz, and disaster declarations

- **VIDECI:** `www.defensacivil.gob.bo` returned **HTTP 403 to scripted clients**. Check it manually in a browser. HDX has no VIDECI dataset; the Bolivia group holds 162 datasets, none of them emergency declarations.
- **Gaceta Oficial Santa Cruz:**
  - **URL pattern:** `https://gacetaoficial.santacruz.gob.bo/verpdf/decreto-departamental-{N}` returns the PDF (HTTP 200).
  - **Probe:** DD 207 (2014, a disaster-declaration framework) returned 54 KB. DD 385, 252, 111 and 098 were found in search as emergency or drought decrees, but I did not verify their years.
  - **Limits:** unstructured PDFs, so municipalities must be extracted by hand. Usable as a "recent declared disasters" list if it is curated manually.
- **Press-confirmed events** (not machine-readable):
  - Jul 2024: 12 Santa Cruz municipalities declared emergency or disaster (drought and fire).
  - The Gobernación reported 22 municipalities in disaster (flood, drought, fire).
  - The worst-hit east-zone municipalities in 2024 were Pailón, Cuatro Cañadas, San Julián and El Puente.
- **DesInventar Bolivia:** profile page HTTP 200; the period is **1970–2015**, so it is too old for "recent" events.
- **HDX COD-AB Bolivia** (`cod-ab-bol`): admin boundaries down to municipality, useful for joining declarations to farms.

## 6. MDRyT (Observatorio Agroambiental y Productivo, SIAPRO), GeoBolivia, SENASAG, ABT, FAN, INIAF

| Source | Probe | Status |
|---|---|---|
| Observatorio Agroambiental (`observatorioagro.gob.bo`) | DNS failure | unknown; check manually |
| SIAPRO (`siapro.mdryt.gob.bo`) and `ruralytierras.gob.bo` | DNS failure | unknown |
| GeoBolivia (`geo.gob.bo`, national SDI GeoServer) | DNS failure | unknown |
| SENASAG | HTTP 403 to scripted clients | manual check |
| ABT site | HTTP 200, 3.9 s | official heat-focus bulletins as PDF (e.g. Bulletin 222, 2026-08-10, 8.2 MB, HTTP 200). `simb.abt.gob.bo`: DNS failure. `geo.abt.gob.bo`: TLS certificate mismatch. Use NASA FIRMS instead (other family). |
| FAN Bolivia SATRIFO (`incendios.fan-bo.org/Satrifo/`) | HTTP 200, 1.2 s | fire risk, heat foci and burn-scar viewer with downloads (Sentinel-2/Landsat/MODIS burn scars, monthly). Not probed further; a FIRMS-derived alternative. |
| INIAF (`iniaf.gob.bo`) | HTTP 200 | technical PDFs (zoning, potential). No crop-calendar dataset found. Calendar comes from ANAPO text and FEWS NET (unverified). |

## 7. Global mirrors of the Bolivian stations (for the global-stations family)

- **NCEI search API** (keyless) returned 2 GHCN-Daily stations in the farm box:
  - BLM00085245, El Trompillo: 1958-05-02 to **2025-08-24**.
  - BLM00085244, Viru Viru: 1984-07-06 to **2025-08-24**.
  - Both carry PRCP, TMAX and TMIN. The last rows are 2025-08-19 to 2025-08-24.
- **ISD/GSOD** for `85244099999` in Oct–Nov 2026 returned a header only, so the station id may be wrong. Left for the global-stations family to resolve.

## Recommendations per variable (from this family's point of view)

| Variable | Primary | Fallback | Role of the national sources |
|---|---|---|---|
| Daily precipitation | gridded family (e.g. CHIRPS or ERA5) | none national | SENAMHI monthly PDFs and GHCN-D Viru Viru/Trompillo up to Aug 2025 for **validation**; ANAPO municipal Oct–Mar totals for the 2023/24 check |
| Tmax / Tmin | gridded / reanalysis family | none national | same as above; Okinawa I and Minero/Unagro are the only active TP stations, by request only |
| ETo | compute FAO-56 from gridded data | SENAMHI ETo variable (id 27), unverified | 10-day bulletin ETP forecast (72–86 mm per 10 days) as a plausibility range |
| Frost, heat, hail, storm warnings | **SENAMHI active-alerts JSON** (verified, polygons) | the hydro-alerts JSON for floods | snapshot daily to build our own history |
| Recent disaster events | SENAMHI alerts (now) plus a curated list from Gaceta Oficial decrees and press | VIDECI (manual) | DesInventar is historical only (up to 2015) |
| Crop calendar / phenology | ANAPO Memoria text: summer sowing Oct–Dec (late Nov–Jan in a drought year), harvest Mar–May; winter sowing Mar–May, harvest Aug–Oct | INIAF / FEWS NET (unverified) | n/a |
| Yield baseline | INE department yields, 1984–2025 | ANAPO chapter-6 series | sanity check of the anomaly ranking |
| Backtest ground truth (2023/24) | ANAPO Memoria 2024, municipal | INE 2023-24 department yields; press | the Phase-2 acceptance test |
| Station metadata / nearest station | SENAMHI WFS `estaciones` (verified) | n/a | provenance text in the UI ("nearest official station: Okinawa I, 5 km, since 1975") |

## Risks and open questions

1. **No current free station data.** GHCN-D for the Bolivian stations stopped on 2025-08-24, and SENAMHI observations require a request. The weather side of the product depends entirely on gridded sources; say so on screen.
2. **The SENAMHI internal API is off-limits** until SENAMHI permits its use: it is undocumented, its terms are unknown, and my probe was blocked by the permission system. If the team wants station series, send the official request now (it may not arrive before the demo).
3. **Alerts are current-only.** History must be collected from now on. For the 2023/24 backtest there is no archived alert feed.
4. **Some sources need manual checks:** VIDECI, the MDRyT observatory, GeoBolivia and SENASAG were unreachable (DNS failure or 403). They may work from a Bolivian network or a normal browser.
5. **The ANAPO figures are extracted from PDF text by hand.** One typo appears in the source ("1.85 kg/ha" for Montero/Okinawa). The numbers are zone or municipal averages, not per field.
6. **INE values are provisional (p) from 2021-22 on**, and department level only.
7. **Station record lengths are uncertain.** The WFS has no end dates; inactive stations such as General Saavedra (1959) may have long but discontinued records.
8. **The SENAMHI drought monitor returned HTTP 500**, and the water-balance service (onsc) did not resolve. Their outputs could have been a national drought reference.

## Files in this folder

- `probe_senamhi_stations.py`: WFS station catalogue and nearest stations per farm.
- `probe_senamhi_alerts.py`: active weather and hydro alerts, with a farm point-in-polygon test.
- `probe_ine_xlsx.py`: INE yield xlsx, Santa Cruz subset.
- `samples/senamhi_stations_santacruz.geojson` (70 KB)
- `samples/senamhi_active-alerts_20261106.json` and `samples/senamhi_active-hydro-alerts_20261106.json`
- `samples/ine_santacruz_yield.csv`
- `samples/anapo_2023_24_campaign_truth.csv`
