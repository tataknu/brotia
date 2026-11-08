# Chile agrometeorological station networks (family: `chile-agromet`)

Probed 2026-11-07 (as-of 2026-11-06) from a laptop, no accounts, no keys. Scope: Chile is the primary
market. **This family has no Bolivia coverage**: every source here covers Chile only.

## TL;DR

1. **RAN / agromet.cl (Red Agroclimática Nacional; Minagri plus INIA, FDF, ASOEX, Vinos de Chile, CEAZA, DMC
   EMAs) is the best station source.** The site's own JS calls keyless endpoints that return
   **hourly** Tavg/Tmin/Tmax, precip, RH, pressure, solar radiation, max wind, wind direction, GDD10 and chill
   hours (base 7). Records start in **2009** for most central-valley stations. There are **442 stations**.
   Latency is about 1 hour, and a request takes about 0.4 s. All 11 Chile test sites have a station within
   4–13 km.
2. **INIA agrometeorologia.cl** (489 stations: 185 INIA plus DMC, CEAZA, FDF, ARAUCO, VDCH and others) is the
   **fallback for weather** and the **primary for derived agro products**: ETo (FAO-56, daily/monthly from
   2009), frost events (start, end, duration, minimum), chill hours, Utah units and chill portions, and
   GDD 5/10/12.5. Its CSV/Excel export sits behind an image anti-bot check, which we did not touch. The public
   HTML table view (`vista=tabla`) has no such check and parses cleanly. One keyless JSON (`items-resumen.json`,
   900 KB) holds every station's last 7 days plus coordinates.
3. Same-time-of-year demo, RAN Requínoa (cherries), window 8 Oct–6 Nov: **2026 rainfall was 56.4 mm against a
   16-year median of 6.95 mm (the record)**. INIA Rayentué, 5.6 km away, confirms it with 49.3 mm. Cherry
   harvest runs Nov–Dec, and rain at harvest is the cracking peril, so this is a live demo hook.
4. DMC (meteochile): the station list is keyless, but data needs a user and token. Most DMC EMAs are mirrored
   inside RAN and INIA anyway, so we don't need DMC registration for v1.
5. CEAZA-Met (Coquimbo/Ovalle): a clean REST CSV web service, but anonymous calls are **capped at 24 rows per
   request**. An emailed username request lifts the cap.

## Station density near the Chile test locations

Nearest stations are computed from each network's own station catalogue (great-circle distance).
`first_year` is the first year with data, found by searching RAN hourly records. "Latest" is the newest
observation seen during the probe.

| Test location | RAN ≤10 km / ≤25 km | Nearest RAN (id, km, first year, latest) | Nearest INIA-platform stations (km) |
|---|---|---|---|
| Quillota avocado | 2 / 10 | Quillota (32, 4.3 km, 2009, 2026-11-07 02:00) | Liceo Agrícola Quillota DMC 3.6; La Cruz INIA 6.7 |
| Ovalle/Limarí table grape | 1 / 8 | Ovalle (324, 4.7 km, 2015, 11-06 23:00) | Esc. Agrícola Ovalle DMC 2.6; Talhuén CEAZA 4.7 (offline in INIA list) |
| Requínoa cherry | 5 / 12 | Requinoa (82, 5.6 km, 2009, 11-07 01:00) | Rayentué INIA 5.6; Altair VDCH 11.3 |
| Santa Cruz (Colchagua) wine | 5 / 11 | Santa Cruz (76, 6.3 km, 2009) | Idahue CyT 22.6 (INIA platform is thin here; RAN is much better) |
| Curicó apple/cherry | 5 / 12 | Curicó (696, 4.6 km, 2020) | Gral. Freire DMC 2.6; Molina EAM-FDF 13.5 |
| Talca vineyard | 0 / 10 | Pencahue (95, 10.6 km, 2009, latest 11-05 14:00: lagging) | Talca ARAUCO 4.7; Panguilemo DMC 7.9 |
| Parral rice | 0 / 7 | Parral (102, 11.6 km, 2009) | Parral AGRICHILE 6.6; Copihue DMC 9.6 |
| Chillán blueberry | 1 / 5 | San Nicolás (114, 9.2 km, 2009) | Quilamapu INIA 1.1 (data only since Oct-2025); Chillán Ad. DMC 5.5 |
| Los Ángeles maize/wheat | 1 / 7 | Las Viñas (119, 5.6 km, 2012) | El Huertón DMC 6.8; Human INIA 10.2 (from 2009) |
| Temuco wheat/oats | 0 / 5 | Taplon (644, 13.1 km, 2018) | Maquehue Ad. DMC 4.1; Rucamanque 8.8 |
| Osorno potato | 2 / 3 | Osorno (137, 6.3 km, 2012) | Adolfo Matthei DMC 2.7; Remehue INIA 7.7 (from 2009) |

Full lists: `agromet_ran_stations.csv` (442 RAN stations with lon/lat), `agromet_ran_nearest.csv`,
`agrometeorologia_stations.csv` (488 INIA-platform stations with network, status and form id).
History depth on the INIA platform for 18 stations: `inia_history_depth.txt`. Start years vary a lot:
Remehue and Human start in 2009, Altair in Aug-2024, Quilamapu in Oct-2025. DMC stations mirrored there
start around 2018.

## Sources and probes

### 1. RAN, agromet.cl. Recommended primary for precipitation, Tmin, Tmax, frost hours and heat hours
- **Endpoints** (keyless GET, used by the site's own JS):
  - `https://www.agromet.cl/ext/aux/getRegiones.php` returns JSON `[[id,name],...]`.
  - `.../getRegionWMS.php?reg_ia_id=N` returns XML `<estacion id x=lon y=lat tooltip=name>`.
  - `.../getFilteredEMAS.php?reg_ia_id=N` returns JSON `[[id,name],...]`.
  - `.../getGraphData.php?ema_ia_id=ID&dateFrom=YYYY-MM-DD HH:MM:SS&dateTo=...&portada=false` returns
    hourly XML rows such as `fecha|2026-11-05 13:00:00|1|25.6|2|0.0|3|61.0|4|1013.3|5|956|6|4.0|7|25.3|8|26.0|9|239|11||12|`.
  - Field codes, from the `<gra>` footer: 1 Tavg (°C), 2 hourly precip (mm), 3 RH (%), 4 pressure (mbar),
    5 maximum solar radiation (W/m²), 6 maximum wind speed (m/s), 7 Tmin (°C), 8 Tmax (°C),
    9 wind direction (°), 11 GDD base 10, 12 chill hours base 7.
- **Probe results.** All calls returned HTTP 200 in about 0.4 s. A 2-day request is 6.8 KB. A full year of
  hourly data is 1.1 MB, 8,904 rows, in 10.7 s. The latest observation was 2026-11-07 02:00 local, so
  latency is about 1 hour. Quillota has data on 2010-01-15 but none in 1995, 2005 or 2008. Sample:
  `sample_ran_quillota_hourly.xml`.
- **History.** Most stations start in 2009; Curicó starts in 2020, Taplon in 2018, Osorno and Las Viñas in
  2012. That gives up to about 17 years for the same-time-of-year baseline, short of the 30-year goal.
- **Gotchas**
  - **The TLS chain is incomplete.** The server leaves out the Sectigo "Public Server Authentication CA DV R36"
    intermediate. Python `requests` therefore fails with CERTIFICATE_VERIFY_FAILED, while curl on macOS works.
    Plain http returns 403. The wrapper must ship that intermediate. It can be fetched from the AIA URL
    `http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt`; append it to the certifi bundle and
    pass it via `verify=` (see `probe_agromet_ran.py`, env `AGROMET_CA_BUNDLE`). This can break silently when
    the certificate renews.
  - Station names are HTML-entity encoded.
  - Wind is the hourly maximum only (no mean wind).
  - There is no ETo field, although ETo can be computed with FAO-56 hourly from T, RH, radiation and wind,
    with wind as a caveat.
  - No terms or licence are stated on the site. RAN is publicly funded by Minagri. Attribute "Red
    Agroclimática Nacional / agromet.cl".
  - No rate limits are documented. Send one station-year per request, serially or at most 2 at a time, and
    cache in DuckDB.
- **Demo** (`probe_ran_baseline.py`, output in `ran_baseline_requinoa.txt`). Station 82 Requinoa, window
  8 Oct–6 Nov, years 2010–2025 as history:
  - Precip 56.4 mm (median 6.95, the highest in 16 years).
  - Mean Tmin 10.65 °C (median 7.55, also the highest).
  - Mean Tmax 22.48 °C (25th percentile).
  - 0 frost hours and 0 hours at or above 30 °C.

  In short, a warm-night, wet spring just before cherry harvest. Cross-check: INIA Rayentué INIA-303 recorded
  49.3 mm over the same window.

### 2. INIA Red Agrometeorológica, agrometeorologia.cl (agromet.inia.cl now redirects here). Recommended primary for ETo, frost events and chill; fallback for weather
- **Coverage.** 489 stations in total, 417 online. The site says 183 are INIA's own and the rest come from
  CEAZA, DMC and others.
- **Station catalogue plus last 7 days (keyless).** Read `data-ts-map-tmp="tmp_NNN"` from a page such as
  `/grados_dia/GD_5_AYER`, then GET `https://agrometeorologia.cl/json/<tmp>/items-resumen.json`:
  - Returned 200 in 1.3 s, 905 KB.
  - Holds id, network, lat/lon, elevation, status and `STACK-DAY` (the last 7 days of PP, TA min/max, RH,
    wind and radiation), plus today/tomorrow forecasts and frost-event counts.
  - Avoid `items-ta.json`, which is 11 MB.
- **Historical data.** POST the form on the variable page, e.g. `/TA`, with these fields:
  - `estaciones[]=INIA-303` or `EXT-152`
  - `variables[]=TA_MIN|TA_MAX|PP_SUM|HR_*|RD_AVG|VV_*|TS*`
  - `intervalo=hour|day|month|year`
  - `desde`/`hasta` (daily), or `month_desde`, `yearMonth_desde=2009` (monthly)
  - `vista[]=tabla`, the token taken from the page, and an empty `website` honeypot

  The response is an HTML table. Results:
  - Altair Requínoa, daily: HTTP 200 in 1.5 s, latest value 2026-11-07 (14% of the day complete).
  - Monthly: 1.1–4.3 s.
- **Derived products.** All were probed with the same form pattern and all returned HTTP 200:
  - `/evapotranspiracion/`: daily or monthly ETo. Rayentué daily ETo for 20 Oct–5 Nov ranged 1.08–5.02 mm.
    Monthly ETo history: Remehue from Oct-2009 (204/214 months), Human from May-2010 (190/214), Rayentué from
    Jun-2018. DMC-hosted Gral. Freire Curicó has almost no ETo.
  - `/heladas/`: frost **events** (start, end, duration in hours, minimum, mean). For Rayentué, winter 2026 had
    15 events, e.g. 6 Jul, 8 h, minimum −3.5 °C.
  - `/frio_invernal/`: chill hours HF1, Utah units HF2 and chill portions HF3 (portions read "s/i" in October).
  - `/grados_dia/`: GD5, GD10 and GD12.5.
- **Gotchas**
  - **CSV/Excel export is gated by an image anti-bot check** (`verificacion_respuesta`), added around Oct-2026
    (the JS version string is `20261027-verif3`). We used only the ungated HTML table. Treat this as a
    **terms-of-use risk**: keep volume low, prefer `items-resumen.json` for the daily refresh, and contact
    INIA before production use.
  - Table columns come back in the **order the variables were submitted**, whatever the header says. Submit
    one variable per call, or map columns carefully.
  - The forms only offer years from 2009.
  - Decimal commas; missing values are written `s/i`.
  - No licence is stated; the footer reads "Red Agrometeorológica de INIA 2009-2023".
- **Probe script:** `probe_inia_agromet.py`.

### 3. CEAZA-Met, ceazamet.cl (Coquimbo region: Ovalle/Limarí). Regional fallback
- **Web service:** `https://www.ceazamet.cl/ws/pop_ws.php`. Documentation is at `/ws/pop_ws_doc.php`.
  - `fn=GetListaEstaciones&p_cod=ceazamet&c0=e_cod...` lists 94 stations, including first and last reading.
  - `fn=GetListaSensores&e_cod=TLH` lists sensors: TA, HR, VV, DV, radiation, PP, soil T, dew point,
    **evapotranspiration**, **chill hours base 7**, **Utah units** and **GDD base 10**.
  - `fn=GetSerieSensor&s_cod=TLHTA&fecha_inicio&fecha_fin&interv=hora|dia|mes` returns CSV
    (min, mean, max, data %).
- **Probe results.** Talhuén Ovalle (TLH, from 2013-01):
  - Daily Tmin, Tmean and Tmax up to 2026-11-07 (partial day), HTTP 200 in 2.4 s.
  - Daily ETo 3.85–6.19 mm.
  - **Anonymous requests are truncated to 24 rows.** Daily 2023–2026 returned only 1–24 Jan 2023, and monthly
    2013–2026 stopped at Dec-2014.
- **Access.** Use is free, but a username must be **requested by email** to CEAZA, stating name, company, use,
  download frequency and volume. This is not instant self-signup. Attribution is required ("Datos provistos
  por CEAZA").
- **Coverage.** Anonymous calls are fine for the catalogue (station history start) and for small recent
  windows. Several CEAZA stations are also mirrored in INIA and RAN, e.g. Talhuén as EXT-18 from 2013.

### 4. DMC Servicios Climáticos, climatologia.meteochile.gob.cl. Fallback via mirrors only
- `GET /application/servicios/getEstacionesRedEma` is **keyless**: 150 EMAs with national code, WMO id and
  lat/lon (sample: `sample_dmc_ema_stations.json`). Nearest DMC EMA to each site: 2.4–12 km, except Santa Cruz
  (33.5 km).
- The data endpoint `getDatosRecientesEma/<code>?usuario=&token=` without credentials returned
  `"Este servicio ha sido bloqueda para el usuario que consulta"`. Getting a token requires an account
  (`/application/usuario/loginUsuario`). How easy signup is was **not verified** (web search budget exhausted).
- The same DMC EMAs appear in RAN ("EMAs de la DMC") and INIA (`EXT-xxx`, DMC), so v1 does not need this.
  DMC's own long manual-station climatologies (decades) would be the way to reach a 30-year baseline. Not
  verified.

### 5. FDF Agroclima, agroclima.cl (fruit-industry network, Fundación para el Desarrollo Frutícola). Validation only
- `POST https://www.agroclima.cl/Home/ObtenerDatos` with body `"6"` (the region id) returns keyless JSON with
  the **latest reading only** per station (code, lat/lon, T, RH, rain, pressure). Verified for the O'Higgins
  region.
- History is at `bajadatos.agroclima.cl`, which is **login-only** (ASP.NET sign-in), likely restricted to
  members.
- FDF stations are also in RAN and INIA (`APECO-FDF`, `EAM-FDF`), so use those instead.

### 6. CR2 Explorador Climático, explorador.cr2.cl (DMC and DGA station compilation). Not usable yet
- `request.php?options={"action":["config"]}` returned 200 in 0.5 s. Datasets: prDaily, tasDaily,
  tasmax/tasminDaily, qflxDaily (river flow) and prAmon, with built-in anomaly and percentile options.
- Our map and series requests returned an empty map with `errors:["map"]`, and the dataset download links on
  cr2.cl were not found. **Not verified.** If it works, it is the best route to pre-2009 station baselines
  (decades), including river flow for irrigation water.

### Not probed (web search budget exhausted, so recorded as unverified)
- Fedefruta frost-alert system.
- UdeC Agrometeorología (Chillán).
- Observatorio Agroclimático (Minagri). Its bulletins are linked from agromet.cl.

These networks largely feed RAN, so RAN already covers the stations.

## Recommendations per variable (Chile)

| Variable | Primary | Fallback | Notes |
|---|---|---|---|
| Precipitation, daily | RAN `getGraphData` hourly → daily sum | INIA table `PP_SUM` (day) | 2009+ (about 17 years). Pair with gridded data (other families) for 30-year percentiles. |
| Tmax / Tmin, daily | RAN fields 8 / 7 (hourly max/min) → daily | INIA table `TA_MAX`/`TA_MIN` | Same as above. |
| Frost (hours < 0 °C, event minimum) | RAN hourly field 7 | INIA `/heladas/` event table | Spring frost Sep–Oct; the event table gives duration and minimum directly. |
| Heat / sunburn (hours ≥ 30 or 32 °C) | RAN hourly field 8 | INIA hourly `TA_MAX` | |
| Reference ET (ETo, FAO-56) | INIA `/evapotranspiracion/` daily (2009+ at INIA stations) | Compute FAO-56 in-house from RAN hourly (T, RH, radiation, wind; wind is hourly max only) | Station ETo has gaps at DMC-hosted stations. |
| Chill (hours, Utah units, portions) and GDD | INIA `/frio_invernal/`, `/grados_dia/` | RAN fields 11 and 12; CEAZA sensors in Coquimbo | Relevant to cherries and apples (winter chill deficit). |
| Rain at harvest (cherry cracking) | RAN hourly precip during Nov–Jan | INIA daily | The Requínoa 2026 case above. |
| Soil moisture, NDVI/NDMI, flood, hail, snowpack/reservoirs, decrees | Out of scope for this family | — | Station networks don't provide them. Snow, rivers and reservoirs come from DGA/CR2; see other families. |

**Wrapper design:**
- Fetch RAN per station-year and cache it in DuckDB.
- Choose the nearest station with history of at least 10 years, falling back to the next one.
- Fetch INIA derived products monthly or daily.
- Use `items-resumen.json` for the daily "today" refresh.
- Record provenance as station id, network and distance in km.

## Open risks
1. **History is short.** About 17 years at best (2009+), and only 2015–2020+ at some sites (Curicó RAN 2020,
   Temuco 2018, Ovalle 2015). That falls short of the 30-year weather baseline in ADR-0002. Mitigation: use
   gridded or reanalysis data for the 30-year percentile and stations for "what really happened at the farm",
   or bias-correct one against the other.
2. **There are no APIs, only undocumented site endpoints.** They can change without notice. INIA just added an
   anti-bot check on exports (Oct-2026), and the HTML-table path could be gated next. Keep an offline snapshot.
3. **Terms are unclear.** Neither RAN nor INIA states a licence. CEAZA requires attribution and a requested
   username. Contact INIA/RAN before a commercial (bank) product.
4. **The RAN TLS chain is broken.** A custom CA bundle is required, and it can break when the certificate
   renews.
5. **Station quality:**
   - Some stations lag or are offline (Pencahue's last data was 11-05 14:00, Talhuén is listed as offline in
     INIA).
   - Network changes cause gaps (Quilamapu has a new ID with data only since Oct-2025).
   - Station-to-farm distances reach 13 km in hilly terrain, where frost and rain are very local.
6. **The schema field `coverage_santa_cruz`** refers to Santa Cruz, **Bolivia**. It is "none" for every
   source in this family.

## Files in this folder
- `probe_agromet_ran.py`: RAN catalogue, nearest stations, history start and latency.
- `probe_ran_baseline.py`: same-time-of-year percentile demo.
- `probe_inia_agromet.py`: INIA table-view fetch and parse.
- Outputs:
  - `agromet_ran_stations.csv`
  - `agromet_ran_nearest.csv`
  - `agrometeorologia_stations.csv`
  - `inia_history_depth.txt`
  - `ran_baseline_requinoa.txt`
- Samples:
  - `sample_ran_quillota_hourly.xml`
  - `sample_ceaza_stations.csv`
  - `sample_ceaza_TLH_pp_monthly.csv` (shows the 24-row anonymous cap)
  - `sample_dmc_ema_stations.json`
