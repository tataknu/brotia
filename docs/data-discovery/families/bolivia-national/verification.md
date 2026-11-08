# Bolivia national sources: adversarial verification

- **Verifier:** independent re-probe of the claims in `notes.md` (family `bolivia-national`).
- **When:** first pass 2026-11-07, about 05:20–05:30 UTC; **second pass** 2026-11-07, about 07:00–07:30 UTC (see the section "Second pass" below, which overrides the first pass where they differ).
- **How:** plain `curl` and `requests`, no accounts and no keys.
- **What I varied on purpose:** test points that are not the sample farms, different date ranges, and different user agents.
- **Where the probe outputs are:** in the session scratchpad, not in this folder. Only this file was written here. The second pass quotes short excerpts inline so the evidence survives.

## Verdict summary

| # | Claim | Verdict |
|---|---|---|
| 1 | SENAMHI active-alerts JSON is keyless, has polygons, holds current alerts only, and suits a per-farm point-in-polygon test | **Confirmed, with corrections.** The alerts are *forecast warnings*, not observed events. The polygons cover provinces, not municipalities. The licence is "Derechos Reservados", not "public". The second pass found `X-RateLimit-Limit: 100` on the backend, so "no rate limits" is corrected. |
| 2 | SENAMHI hydro-alerts JSON: basin text, "mostly Andean/Amazon basins" | **Corrected.** Notices 45/2026 and 46/2026 name Santa Cruz basins (Piraí, Yapacaní, Ichilo, Surutú). |
| 3 | GHCN-D Viru Viru 1984–2025-08 and Trompillo 1958–2025-08 for a station-level baseline cross-check | **Dates confirmed; role refuted.** Only 26–42 % of days have a PRCP value. The stop on 2025-08-24 is an NCEI-wide cut-off for South America. The guess that the "ISD id may be wrong" is refuted. |
| 4 | INE yields 1984–2025, keyless, "3–10 s", "labels offset by one link" | **Values confirmed exactly.** The latency claim and the label-offset claim are refuted. The headline soy series blends two campaigns, so a cleaner summer-only table should be used. |
| 5 | ANAPO Memoria 2023/24 figures and crop calendar | **Figures confirmed verbatim** (twice). The crop calendar is corrected: winter sowing differs by zone, and Integrada summer sowing in 2023/24 ran Dec–late Jan. The first pass saw HTTP 406 for browser user agents; the second pass got 200 with a Chrome UA, so the block is intermittent. |
| 6 | SENAMHI WFS `estaciones` for station provenance | **Confirmed.** It has duplicate records with conflicting start dates. A municipality layer was also found and works. |
| 7 | VIDECI returns 403; Gaceta decrees are PDFs; DesInventar covers 1970–2015 | **Confirmed.** |
| 8 | "No free current national station series" near the farms (the reason for the precipitation and Tmax/Tmin recommendations) | **Refuted for Viru Viru and Trompillo.** The SYNOP daily summaries are public and keyless on OGIMET up to 2026-11-06 (Tmax, Tmin, precipitation), and IEM serves the METAR temperature for SLVR live. Both are third-party mirrors, not SENAMHI. Gridded data stays primary for the farms. |
| 9 | "Okinawa I and Minero/Unagro are the only active long-record TP stations" | **Confirmed narrowly, misleading.** Within 40 km they are the only active stations *classified TP* that start before 1996. The synoptic airports Viru Viru and Trompillo also measure temperature, and they are the only ones with current public data. |

## 1. SENAMHI active weather alerts

**Live probe on 2026-11-07, 05:19 UTC:**

| Endpoint | Status | Time | Size |
|---|---|---|---|
| `senamhi.gob.bo/index.php/api/alertas/active-alerts` | 200 | 1.50 s | 12.9 KB |
| `senab.senamhi.gob.bo/api/public/forecastweather/active-alerts` (direct backend) | 200 | 0.55 s | 12.6 KB |

- There are 3 alerts: 93/26, 92/26 and 91/26. Each is a `MultiPolygon` with one polygon of 94–131 vertices.
- The JSON also has fields that `notes.md` and its trimmed sample do not record:
  - `publicationDate`
  - `ForecastTypeAlert` (for example `NARANJA`)
  - `ForecastTypeEvent.eventType`
  - `ForecastArea[]`, each with an `idDepartment` and province-level text.
- The sample script asks for keys that do not exist (`fecha`, `titulo`), so the saved sample loses the area and type information.

**Point-in-polygon test with points that are not sample farms:**

| Alert | Inside | Outside |
|---|---|---|
| 92/26, sudden temperature drop | San José de Chiquitos, Puerto Suárez, San Ignacio de Velasco, Roboré, Concepción, Ascensión de Guarayos, Samaipata, Camiri, Yapacaní, San Matías, and all 12 sample farms | Trinidad (Beni) and Cochabamba, as expected |
| 91/26, wind | Camiri, Yapacaní and all 12 farms | the Chiquitanía towns, which matches the text "oeste de Chiquitos" |
| 93/26, rain | none of the test points | — (it covers Vallegrande, west Cordillera and Luis Calvo) |

The polygons agree with the province text.

**Archive:** these paths return 404:

- `public/forecastweather`
- `/alerts`
- `/all`
- `/history`
- `/{id}`

`active-alerts?date=2026-10-01` is **silently ignored**: it returns the same current list. This is positive evidence that the feed holds **current alerts only**.

**Corrections:**

- **They are forecasts, not events.**
  - The descriptions read "SE PREVÉ…" and "SE PRONOSTICA…".
  - Each alert is published 0.5–1 day before its valid period. For example, 92/26 was published 2026-11-06T19:56Z and is valid 11-07 to 11-08.
  - So the feed records what SENAMHI *warned*, not what happened. In the UI, label it "official warning", never "event occurred".
- **"Frost" is not frost.** Event type 28 is "Descenso brusco de temperaturas": a drop of 6–12 °C below normal. In the lowlands this is a cold front, not a frost observation.
- **The spatial unit is coarse.** Every `ForecastArea` has an empty `idMunicipality`, and the text names provinces. Alert 92/26 covers about 15 provinces of Santa Cruz (bbox −64.8…−57.5 lon). The alerts barely tell the farms apart, so the true unit is the **province or several provinces**, not the municipality.
- **Event types:** only 3 types (16, 18 and 28) were seen live. The claim that heat and hail types exist is **unverified**.
- **Licence:**
  - The site footer says "© Copyright 2026 | Derechos Reservados SENAMHI".
  - The links "Términos y condiciones de uso" and "Políticas de privacidad" point to `href="#"`.
  - So commercial reuse is **unverifiable**, not "Bolivian government public". Ask SENAMHI in writing before a product uses it.
  - The `AccessConstraints NONE` in the GeoServer capabilities covers only the WFS, not this API.
- **Latency:** 0.55–1.5 s today, against the 4.9 s claimed. No rate-limit headers were seen.

## 2. SENAMHI hydrological alerts

**Live probe:** HTTP 200, 1.56 s, 1.10 MB. There are 3 notices (No. 45, 46 and 47/2026; `fecha` 11-04…11-06, `fechaf` up to 11-14). The `aviso` field is 270–400 KB of HTML with embedded base64 images.

**Correction:** the notes say the notices covered "mostly Andean/Amazon basins". That is wrong:

- **No. 45/2026** names "Departamento de Santa Cruz (Cuenca Río Grande)", including the Ichilo, Yapacaní, Surutú and Piraí rivers.
- **No. 46/2026** names the headwaters of the Piraí and Yapacaní, and the lower Piraí. It lists El Torno, La Guardia, Samaipata and Hardeman.

The named towns are upstream or to the west of the farms, so coverage of the farms is still partial. The feed is still not structured, so it needs text parsing. Strip the base64 before storing each snapshot.

## 3. GHCN-Daily Viru Viru (BLM00085244) and El Trompillo (BLM00085245)

**Live probe of the NCEI data service for 2025-06-01 to 2026-11-07:** HTTP 200, 0.21 s. The last rows are dated 2025-08-24, for example Trompillo PRCP 46.0, TMAX 24.7, TMIN 11.0. This matches the claim exactly.

**Full series, 1958–2026:** 1.7 MB in 2.9 s.

| Station | Rows | First | Last |
|---|---|---|---|
| Viru Viru | 14,964 | 1984-07-06 | 2025-08-24 (PRCP last 2025-08-22) |
| Trompillo | 18,976 | 1958-05-02 | 2025-08-24 |

The start dates are confirmed.

**Data quality, which the notes miss:**

| Period | Viru Viru PRCP / TMAX / TMIN | Trompillo PRCP / TMAX / TMIN |
|---|---|---|
| 1991–2020 completeness | **42 % / 82 % / 49 %** | **28 % / 71 % / 50 %** |
| 2015–2024 completeness | 26 % / 73 % / 45 % | 26 % / 64 % / 49 % |

- Days with a PRCP value per year: 2015 = 4 and 2016 = 4 at Viru Viru; 2015 = 2 and 2016 = 8 at Trompillo.
- All PRCP values have source flag `S`, meaning they are derived from GSOD.
- The NCEI search API reports PRCP coverage of 32.9 % at Trompillo.
- Oct 2023–Mar 2024 has only 66 of 183 days present at Viru Viru, with a sum of 375 mm. This is an **undercount**; do not compare it with ANAPO's 455 mm.
- **Result:** a same-time-of-year precipitation baseline from these stations is not viable. TMAX is the only variable with useful completeness.

**Why the series stops:**

- `isd-history.csv` lists `852440 99999 VIRU VIRU INTL 19840701–20250824`, and GSOD `85244099999` returns rows up to 2025-08-24. So the station id is **correct**, and the guess in the notes that it may be wrong is refuted.
- Every station in the ISD history with a country code of BL, PE, PY, BR or AR ends on or before 2025-08-24. The latest end date in the whole file is 20250828.
- In GHCN-D, Asunción (PAM00086218) and Lima (PEM00084628) also end on 2025-08-24. A US station (USW00094728) has data up to 2026-11-01.
- **Conclusion:** this is an NCEI-side ingest stop for synoptic (SYNOP) reports from outside the US, not a Bolivian problem. It may resume. The global-stations family should be told, because it affects any GSOD/ISD source in the region.

**Minor:** Trompillo to Warnes Sur is **29.6 km** (the notes say about 27). Viru Viru to Warnes Sur is 11.1 km. The eastern farms, where the drought truth lies, are 49–109 km from Viru Viru. So a station cross-check helps only Warnes Sur.

## 4. INE Bolivia yield tables

**Downloads:**

| Share id | Time | Size | Result |
|---|---|---|---|
| `heefZ2fZlqIIMik` | 6.2 s | 324 KB | HTTP 200 |
| `6kBAE1i0Ys4tF0U` | 1.4 s | — | HTTP 200 |
| `DNFbjMZIJiqKFSL` | 1.9 s | — | HTTP 200 |
| `Fq9AIIMIFiTtyZY` (first try) | — | — | **timed out at 75 s** |
| `Fq9AIIMIFiTtyZY` (second try) | **69.5 s** | 223 KB | HTTP 200 |

So the claim of "3–10 s" is wrong: latency is erratic. **Fetch the tables once into the offline snapshot, never at request time.**

**Values:** my own parser reproduced Santa Cruz soy exactly: 2020-21 2506, 2021-22 2344, 2022-23 2003, 2023-24 1918, 2024-25p 2091. It also reproduced rice at 3497 and then 2036. The unit is kg/ha, from the sheet subtitle. The first season is 1983-1984. The `(p)` mark starts at 2021-22.

**The claim that "labels are offset by one link" is refuted.** For all four files I checked, the anchor text on the index page matches the `Content-Disposition` filename. The offset is an artefact of reading the text *before* each link.

**A data-quality problem the notes missed:** a footnote in the table reads "(1) Incluye la campaña de invierno del año anterior". This applies to soy, maize, sorghum, wheat and sunflower. The agricultural-year figure therefore blends the previous winter crop with the summer crop, which dilutes the drought signal.

**Better source:** the summer-campaign yield table `Fq9AIIMIFiTtyZY`. Watch out: its Santa Cruz sheet is named **"Santa Cuz"**. Santa Cruz summer yields, in kg/ha:

| Crop | 2022-23 | 2023-24 | 2024-25 | Blended 2023-24 (ag-year table) |
|---|---|---|---|---|
| Soy | 2060 | **1815** | 2290 | 1918 |
| Maize | 3502 | **2451** | 3031 | 2914 |
| Sorghum | 2810 | **1884** | 2700 | 2739 |
| Rice | 3500 | 2037 | 3196 | — |

The 2023-24 drop in maize and sorghum is almost invisible in the blended table.

**INE and ANAPO disagree in the drought year:**

- ANAPO's summer 2023/24 soy across Este and Integrada works out at 1.34 t/ha over the sown area (1,548,752 t over 1,156,600 ha), or 1.50 t/ha over the harvested area.
- INE gives 1815 kg/ha.
- In the normal year 2024/25 the two agree: ANAPO Este 2.31 and Integrada 1.95, against INE 2290.
- So how big the drought looks depends on the source. Use ANAPO for the shape of the losses, and treat INE as conservative.

**Licence:** no reuse statement was found on the index page. It is unverifiable, and probably fine with a citation.

## 5. ANAPO Memoria Anual

**Media API:** `wp-json/wp/v2/media?search=memoria&mime_type=application/pdf` returns HTTP 200 (0.72 s) with curl's default user agent. It returns **HTTP 406 (Mod_Security) with a browser user agent**, reproduced twice. This is fragile, so pin the user agent or keep the PDFs in the snapshot.

**PDFs listed by the API:**

| Uploaded | File | Pages | Size |
|---|---|---|---|
| 2024-11 | `2024/11/Memoria-OK.pdf` | — | — |
| 2025-03 | `2025/03/MEMORIA-OK.pdf` | 131 | 4,415,700 B (downloaded in 6.3 s) |
| 2026-03 | `2026/03/MEMORIA-2025.pdf` | 139 | 7.16 MB |

The page `memorias-anuales` links viewer pages for 2017–2025, which **confirms** history back to 2017.

**Figures, checked word for word against the text extracted from Memoria 2024, pp. 97–99:**

- Zona Este: 800,900 ha sown, 480,800 ha affected, 102,350 ha lost, 1.20 t/ha.
- Rain Oct 2023–Mar 2024: 455 mm, against 899 mm the previous season.
- Pailón 0.42 t/ha and 349 mm. Cuatro Cañadas 0.55 t/ha and 403 mm. San Julián 509 mm.
- Zona Integrada: 1.64 t/ha. 125,200 ha affected by drought; 20,900 ha lost "principalmente por encharcamiento en abril".
- The "1.85 kg/ha" typo for Montero/Okinawa is confirmed.
- **All confirmed.**

**Crop calendar: corrected.** Memoria 2024 gives these windows:

| Zone / crop | Sowing | Harvest | Where in the text |
|---|---|---|---|
| Zona Este, summer soy | Oct–Dec normally; late Nov–Jan in 2023/24 | Nov sowings harvested early Mar to late May | — |
| Zona Este, winter crops | Mar–May | Aug–Oct | Memoria 2025 also says "siembra se inicia en abril y la cosecha… agosto a octubre" |
| Guarayos, winter soy | Apr–May | — | — |
| **Zona Integrada, winter soy** | **June to mid-August** | rain at harvest in Oct–Nov | lines on "siembra se inicia en junio…" |
| Wheat, Zona Este | Mar to mid-May | — | — |
| Sunflower | Feb to late Apr | — | — |
| Another zone (one case) | Feb–Mar | Jun–Jul | — |

The notes give one calendar for all winter crops: "sown Mar–May, harvested Aug–Oct". That holds only in Zona Este. It **mis-phases** the Integrada farms (Okinawa, Mineros, Warnes) by about 3 months. ANAPO gives no calendar for rice or sugarcane (Arrocera Mineros, Cañaveral San Antonio).

**New, and missed by the notes: Memoria 2025 gives a control year (2024/25).**

- Zona Este: 892 mm (Oct–Mar), 880,000 ha sown, 2.31 t/ha.
- Cuatro Cañadas 1.87, Pailón 1.55, San Julián 2.06 t/ha.
- Integrada: 1.95 t/ha; Minero/Peta Grande 2.01; Montero/Okinawa 2.08.
- Feb–Mar 2025 had events above 150 mm in 24 h, which caused waterlogging.
- **Use:** a backtest should score 2024/25 as normal or mild in the east, as a check against false positives.

**How the sample farms match ANAPO municipalities:** the SENAMHI WFS layer `senamhi:municipio` (see section 6) puts each farm in a municipality:

| Farm | Crop | Municipality | ANAPO 2023/24 soy figure |
|---|---|---|---|
| Los Tajibos | soy | San Julián | rain only (509 mm), no yield |
| Brecha 8 | maize | San Julián | — (not soy) |
| Cuatro Cañadas Lote 7 | soy | Cuatro Cañadas | **0.55 t/ha ✓** |
| El Cusi | sorghum | Cuatro Cañadas | soy figure only, crop differs |
| Pailón Norte | wheat | Pailón | soy figure only, crop differs |
| Las Londras | sunflower | **Cotoca** | not in ANAPO's list |
| Okinawa Dos / Okinawa Uno | maize / soy | Okinawa Uno | Montero/Okinawa 1.85 (soy ✓ for Okinawa Uno) |
| Arrocera Mineros, Cañaveral San Antonio | rice, sugarcane | **General Saavedra** | none |
| Warnes Sur | soy | **Warnes** | zone average only |
| Mineros Norte | soy | Mineros | Minero/Peta Grande 1.75 (soy ✓) |

So the claim that "Pailón 0.42 and Cuatro Cañadas 0.55 match the eastern-zone farms" holds as a direct match of crop *and* municipality only for **Cuatro Cañadas Lote 7**. Pailón Norte grows wheat and Las Londras is not in Pailón. The direct soy matches are 3 of 5 soy farms: Cuatro Cañadas Lote 7, Okinawa Uno and Mineros Norte.

**Licence:** neither PDF contains a statement about reuse or copyright. It is an association publication, so cite it; reuse is unverifiable.

## 6. SENAMHI GeoServer WFS

**Live probes:**

- `estaciones`, bbox −63.4…−62.3 / −17.95…−16.7: HTTP 200, 0.78 s, 50 stations.
- `estaciones`, Chiquitanía bbox −61.5…−59.5: HTTP 200, 0.64 s, 13 stations.
- GetCapabilities: `Fees NONE`, `AccessConstraints NONE`.

**Data quality:**

- **Duplicate records per site, with conflicting start dates.**
  - Viru Viru appears 4 times: start None; 2004-12-30 (WMO 85244); 1984-07-24 "(F)"; 1984-07-27.
  - Trompillo appears 3 times: 2004-12-29 (WMO 85245); 1942-10-27/28 "(F)".
  - San José de Chiquitos (WMO 85247) shows 2004-12-31, but the ISD history starts it in 1942.
  - So `fecha_inicio` depends on which duplicate is picked. The records with a WMO code seem to show the date the automatic system started, not the date the station's record starts.
- **`activo` and `estado` disagree.** Five stations have `activo=True` but `estado=Inactivo`. The notes' Active/Inactive column used `estado` (per `probe_senamhi_stations.py`).

**New: a municipality join.** `typeName=senamhi:municipio&CQL_FILTER=INTERSECTS(geom,POINT(lon lat))` returns HTTP 200 with the municipality name for all 12 farms (table in section 5). Use it for provenance text and for joining ANAPO, INE and decree data to a farm.

## 7. Disaster declarations

| Source | Probe | Result |
|---|---|---|
| VIDECI `www.defensacivil.gob.bo` | with curl's user agent, a Chrome user agent, and plain http | **HTTP 403** every time. Confirmed. |
| Gaceta Oficial Santa Cruz, decree DD 207 | `verpdf/decreto-departamental-207` | HTTP 200, `application/pdf`, 54.5 KB. Confirmed. |
| DesInventar Bolivia | profile page | HTTP 200; the page says "1970 - 2015". Confirmed. |

## Second pass (2026-11-07, about 07:00–07:30 UTC)

This pass re-ran the key probes independently. It used test points that are not sample farms and date ranges that differ from those in `notes.md` and in the first pass. It also tested new angles.

### SENAMHI active alerts: confirmed again, plus a rate limit

| Endpoint | Status | Time (2 runs) | Size | Headers worth noting |
|---|---|---|---|---|
| `senamhi.gob.bo/index.php/api/alertas/active-alerts` | 200 | 1.49 s, 1.42 s | 12,873 B | `Access-Control-Allow-Origin: *`, `Cache-Control: no-cache` |
| `senab.senamhi.gob.bo/api/public/forecastweather/active-alerts` | 200 | 2.18 s, 2.10 s | 12,559 B | **`X-RateLimit-Limit: 100`**, `X-RateLimit-Remaining: 99`, then `98` |

- **Rate limit: the claim "none observed" is corrected.** The direct backend announces 100 requests per window. The window length is not stated. The proxy on `senamhi.gob.bo` sends no rate headers. One poll per hour is far below the limit.
- **Same 3 alerts as yesterday.** Each has ids 646–648 and codes 91/26–93/26, with `status: "Aprobado"` and alert level `NARANJA`.
  - Excerpt from 92/26: `"SE PRONOSTICA EL INGRESO DE FRENTE FRÍO … DESCENSOS BRUSCOS DE TEMPERATURA ENTRE 6 °C Y 12 °C POR DEBAJO DE LOS VALORES NORMALES"`.
  - `publicationDate` is `2026-11-06T19:56:17Z`, and the valid period is 11-07 to 11-08. So these are **forecast warnings**, as the first pass found.
  - Every `ForecastArea.idMunicipality` is `[]`, and the text names provinces only. So the spatial unit is the **province**, as the first pass found.
- **New point-in-polygon test**, with points that neither earlier pass used:

  | Point | 93/26 rain | 92/26 cold front | 91/26 wind |
  |---|---|---|---|
  | Montero | no | yes | yes |
  | Puerto Quijarro | no | yes | no |
  | Vallegrande | **yes** | yes | no |
  | Concepción | no | yes | no |
  | San Javier | no | yes | no |
  | Charagua | no | yes | yes |
  | Trinidad (Beni) | no | no | no |

  The polygons match the province text: for example, 93/26 names Vallegrande. The cold-front polygon covers almost all of Santa Cruz, from Montero to Puerto Quijarro (about 600 km). So it adds almost no farm-to-farm contrast.
- **Archive:** the paths `event-types`, `eventtypes`, `types-event`, `alerts` and `alerts/history` all returned **404**. `active-alerts?year=2025&page=2` was silently ignored: it returned the same 12,559 B list. **"Current only" is confirmed.** The ids are sequential (646, 647, 648), which hints at an internal archive, but none is public.
- **Heat and hail event types are still not seen in the feed.** No event-type catalogue is exposed. The variable catalogue `senab.senamhi.gob.bo/api/variables` (HTTP 200, 2.10 s, 14.7 KB) lists `{"id":57,"variable":"Granizo","geoanalisis":false}`. That is a station *observation* variable, not an alert type. The claim that the feed covers heat and hail warnings stays **unverified**.
- **Licence:** confirmed again. The footer reads `© Copyright 2026 | Derechos Reservados SENAMHI`, and the link "Términos y condiciones de uso" is `href="#"`.
- **The homepage JS shows other public paths:** `api/alertas/export-pdf`, `api/pronostico/diario`, `diario-json`, `ediario` and `extendido`. They were not probed in this pass.

### SENAMHI hydro alerts: confirmed again

- The probe returned HTTP 200 in 1.51 s, with 1,104,546 B.
- There are 3 notices: ids 1544–1546, titled `AVISO DE AMENAZA HIDROLÓGICA PARA EMISIÓN DE ALERTA N° 45/46/47/2026`, with `fecha` 11-04 to 11-06 and `fechaf` up to 11-14.
- With the HTML and the base64 images stripped, No. 45 names Santa Cruz, Piraí, Yapacaní, Ichilo, Surutú and Grande; No. 46 names Piraí and Yapacaní. This confirms the first pass's correction.
- The `documento` field is empty, so there is no PDF link to archive.

### SENAMHI ETo variable (id 27): it exists, but the data is not accessible

`api/variables` returns `{"id":27,"variable":"ETo","formula":"calculada","unidad_medida":"mm","geoanalisis":true}`. So the variable exists. Its time series sits behind the POST routes, which `notes.md` reports were blocked. I did not probe them: the API is undocumented and has no terms. **Data access stays unverified.**

### GHCN-Daily: stop date and completeness confirmed with new ranges

- **2025-07-01 to 2026-11-07:** HTTP 200 in 0.25 s. The maximum `DATE` is **2025-08-24** at both stations. The last row is `BLM00085245,2025-08-24,46.0,24.7,11.0`. There are no new rows since the first pass.
- **Completeness in other years**, as days with a value out of 365:

  | Year | Viru Viru PRCP / TMAX / TMIN | Trompillo PRCP / TMAX / TMIN |
  |---|---|---|
  | 1998 | 307 / 190 / 149 | 99 / 161 / 156 |
  | 2008 | 149 / 325 / 299 | 143 / 255 / 286 |
  | 2016 | **4** / 326 / **11** | **8** / 294 / **10** |

- **Oct 2024 – Mar 2025:** 102 of 177 days have a PRCP value at Viru Viru (757 mm), and 101 of 176 at Trompillo (884 mm). These are undercounts again.
- **The full series** (1958–2026, HTTP 200 in 5.0 s, 1.35 MB) shows that PRCP completeness depends on the era. A single percentage hides this:

  | Period | Viru Viru PRCP days | Trompillo PRCP days |
  |---|---|---|
  | 1985–1999 | **78 %** (1985–1998 nearly complete, for example 1991 = 352 days) | 42 % |
  | 2000–2012 | 37 % | 28 % |
  | 2009–2016 | almost none: 0–19 days a year | almost none: 2–13 days a year |
  | 2019–2024 | about 38 % (127–167 days a year) | about 38 % |
  | 1991–2020 | 42 % | 28 % |

- **Result:** the first pass is confirmed, with a refinement.
  - A Viru Viru precipitation climatology is usable **only for 1985–1998**, which is about 14 years and not a 30-year baseline.
  - Recent years are too gappy to sum. A missing day is not a dry day.
  - TMIN is also unusable in some years, such as 2016 (11 days).
  - Only TMAX is reliably complete.

### New: current station data does exist through public SYNOP and METAR mirrors

**OGIMET daily SYNOP summary** (`ogimet.com/cgi-bin/gsynres?ind=85244&…`) returned HTTP 200 in 0.43 s. It needs no key and no account. Excerpt:

```
Viru-Viru  WMO 85244  Periodo: 10 días desde 2026/11/06
Fecha  Tmax  Tmin  ...  Prec(mm)
06/11  33.5  21.5  ...  0.0
05/11  35.6  21.8  ...  17.0
28/10  27.0  15.8  ...  59.2
```

- Trompillo (85245) returned HTTP 200 in 0.36 s, with data to 06/11. For example, `05/11 34.2 22.1 … 83.0` mm.
- **Latency is 1 day.** This **refutes the "why"** behind the precipitation and Tmax/Tmin recommendations, which says there is no free current station series. The series exists, through the WMO GTS SYNOP that SENAMHI itself transmits.
- **Caveats:**
  - **Strong throttling.** After 3 requests in about 1 minute, OGIMET returned `Status: 403 Forbidden` inside an HTTP 200 body, for an archive query (2016 and then 2024).
  - **Licence.** OGIMET is a private site ("© G. Ballester Valor 2005-2026"). It says its pages are for information only and must not be used for critical missions. The underlying SYNOP is WMO Resolution 40 "essential" data, but scraping OGIMET is not a licensed feed.
  - **History depth was not verified** because of the throttle.

**IEM ASOS/METAR** (`mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=SLVR`) returned HTTP 200 in 0.22 s. It has hourly rows up to `2026-11-06 23:00`.

- The network metadata gives SLVR `archive_begin` 1984-07-01, and SLET (Trompillo) 1942-10-01. Both are `online: true`.
- **Precipitation is unusable.** `p01i` is `0.00` for all 49 hours of Nov 5–6, although the SYNOP shows 17 mm at Viru Viru on 11-05. It is also `0.00` for all 796 hours of Jan 2016. Use IEM for **temperature only**: Tmax and Tmin from the hourly values.

**Fit:** a fallback for **station-level validation at Viru Viru and Trompillo only**. It does not replace gridded data for the eastern farms, which are 49–109 km away. This belongs to the global-stations family, and the finding should be passed on to it.

### INE: values confirmed, latency fast this time

| Share id | Status | Time | Size | `Content-Disposition` filename |
|---|---|---|---|---|
| `Fq9AIIMIFiTtyZY` | 200 | **1.25 s** | 222,731 B | `Bolivia- Rendimiento por cultivo campaña verano , por departamento 2013-2025.xlsx` |
| `heefZ2fZlqIIMik` | 200 | **1.04 s** | 324,474 B | `Bolivia - Rendimiento Año Agricola por Departamento, 1984 - 2025.xlsx` |

- **Values.** The tables were parsed with the standard library, because the venv has no `openpyxl`.
  - The blended table gives Santa Cruz soy 2506, 2344, 2003, **1918** and 2091 for 2020-21 to 2024-25, and rice 3497 then **2036**. These match `notes.md` exactly.
  - The summer table (sheet `'Santa Cuz'`) gives soy 2060, **1815** and 2290; maize 3502, **2451** and 3031; sorghum 2810, **1884** and 2700. These match the first pass exactly.
  - The footnote `(1) Incluye la campaña de invierno del año anterior` is confirmed.
- **Latency:** today 1–1.3 s, against 69.5 s or a timeout in the first pass. So it is **erratic**, and the "3–10 s" claim describes neither case. Snapshot the files offline.
- **Blended-table quirk:** sorghum swings from 1180 to 1809, 2739 and 1623 in 2021-22 to 2024-25, while the summer table shows 2276, 2810, 1884 and 2700. So the blended sorghum series does not follow the summer crop at all. This strengthens the recommendation to use the summer table.

### ANAPO: figures confirmed again, and the user-agent block is not reproduced

- **Media API:** HTTP 200 in 0.80 s with curl's user agent, and **HTTP 200 in 0.61 s with a Chrome user agent**. The first pass saw HTTP 406 with a browser user agent, so the Mod_Security block is intermittent. Pinning the user agent is still prudent.
- **PDFs listed:**
  - `2026/03/MEMORIA-2025.pdf` (2026-03-31)
  - `2025/03/MEMORIA-OK.pdf` (2025-03-27)
  - `2024/11/Memoria-OK.pdf` (2024-11-05)
- **Memoria 2024:** HTTP 200 in 4.39 s, 4,415,700 B, 131 pages, `last-modified 2025-03-27`. Verbatim excerpts from `pdftotext`:
  - "se sembraron 800.900 hectáreas, las afectadas fueron 480.800 hectáreas y las perdidas 102.350 … rendimiento promedio del área sembrada fue de 1.20 t/ha"
  - "Pailón el rendimiento promedio fue de 0.42 t/ha, Cuatro Cañadas 0.55 t/ha y San José de Chiquitos 0.71 t/ha"
  - "fueron 455 milímetros (anterior verano 2022/23 fue 899 milímetros) … San Julián 509 mm, El Puente 507 mm … Cuatro Cañadas 403 mm … Pailón con 349 mm"
  - Zona Integrada: "1.64 t/ha … 125.200 hectáreas [sequía] y 20.900 hectáreas principalmente por encharcamiento en abril"; "1.85 kg/ha en Montero/Okinawa, 1.75 t/ha Montero/Peta Grande"
  - **All confirmed.** Note that the source names the sub-zone both "Montero/Peta Grande" and "Minero/Peta Grande".
- **Calendar additions:**
  - Zona Integrada summer 2023/24: "La siembra inició en diciembre y se prolongó hasta finales de enero". That is later than the Oct–Dec in the notes.
  - Winter: "En la zona Este la siembra se inicia en marzo y se prolonga hasta mayo … en la zona Integrada la siembra se inicia en junio y se prolonga hasta mediados [de agosto]".
  - Sunflower: "se inicia en febrero y se prolonga hasta finales de abril".
  - This confirms the first pass's correction by zone.
- **Licence:** the text has no copyright or reuse statement. It is **unverifiable**: cite it, and ask ANAPO before commercial use.

### SENAMHI WFS: confirmed

- `estaciones` (Santa Cruz box): HTTP 200 in 2.21 s, 154 KB, 147 stations.
- GetCapabilities: `Fees NONE`, `AccessConstraints NONE`.
- `municipio` INTERSECTS at Concepción (−62.03, −16.25): HTTP 200 in 0.64 s, `{"municipio":"Concepción","id_departamento":7}`. The valid property is `municipio`, not `nombre`.
- **Classification gaps:** 112 of the 147 stations have `clasificacion = null`, including the Viru Viru and Trompillo airport records. So a filter on "TP" silently drops the synoptic airports.
- **Active stations within 40 km of any farm that start before 1996:**
  - Okinawa I (TP, 1975)
  - Minero/Unagro (TP, 1975)
  - San Julián (P, 1973), with an "(F)" duplicate
  - Viru Viru (null class, 1984), with an "(F)" duplicate
  - Trompillo (null class, 1942), with an "(F)" duplicate

### Disaster declarations

| Source | Second-pass probe | Result |
|---|---|---|
| VIDECI `www.defensacivil.gob.bo` | GET | **HTTP 403** in 3.3 s. Confirmed. |
| Gaceta Oficial Santa Cruz, decree DD 207 | GET | HTTP 200, `application/pdf`, 54,495 B. Confirmed. |
| DesInventar Bolivia `profiletab.jsp?countrycode=bol` | GET | HTTP 200 in 0.95 s; the page text says "1970 - 2015". Confirmed. |

## Recommendation changes

1. **GHCN-D:** demote Viru Viru and Trompillo to a **TMAX-only** spot check. PRCP completeness depends on the era: Viru Viru is about 85 % complete in 1985–1998, near zero in 2009–2016, and about 38 % in 2019–2024. So PRCP must not be used for a 30-year baseline or for the 2023/24 rainfall check. At most, Viru Viru 1985–1998 can serve as a short climatology cross-check. Tell the global-stations family about the NCEI cut-off for South America on 2025-08-24; it may resume.
2. **Yield backtest:** use the **INE summer-campaign table** (`Fq9AIIMIFiTtyZY`, sheet "Santa Cuz", 2012/13–2024/25) instead of the blended agricultural-year table. Keep the 1984–2025 table for long-run context only.
3. **Fetching:** INE and ANAPO go into the offline snapshot once, with a pinned user agent for ANAPO. They are never fetched at request time, because INE latency swings from 1 s to over 70 s, and ANAPO's Mod_Security returned 406 to a browser user agent in one of two passes.
4. **Crop calendar:** split it by zone and by crop. Zona Este winter crops are sown Mar–May; Zona Integrada winter soy is sown Jun to mid-Aug; sunflower Feb–Apr. Rice and sugarcane need another source.
5. **Control year:** add ANAPO Memoria 2025 (2024/25: Este 892 mm, 2.31 t/ha) to the backtest, so we can show the score does *not* flag a normal year.
6. **Backtest matching:** the per-farm municipal yield match covers only Cuatro Cañadas Lote 7, Okinawa Uno and Mineros Norte (soy). Score the other farms against zone averages, and say so on screen.
7. **SENAMHI alerts:** present them as an "official warning (forecast)" layer at province scale, not as a "recent event". Keep the `ForecastArea`, `ForecastTypeEvent` and `publicationDate` fields when snapshotting.
8. **Hydro alerts:** keep them as the flood-warning fallback. They do cover Santa Cruz basins (Piraí, Yapacaní, Ichilo). Strip the base64 images before storing.
9. **Station metadata:** de-duplicate WFS stations by site, and prefer the record start date of the "(F)" conventional record. Add the `senamhi:municipio` lookup.
10. **Licences:** treat commercial reuse as **unresolved** for SENAMHI alerts ("Derechos Reservados", and the terms link is a placeholder), INE and ANAPO. Only the WFS states no access constraints. Ask SENAMHI before any commercial launch. OGIMET is a private mirror for information only, so it must not be a production dependency.
11. **Precipitation and Tmax/Tmin fallback:** change the "why" from "no free current national station series" to "no free current station series *at the farms*". For the validation layer, add **OGIMET SYNOP daily summaries** for 85244 and 85245 (1-day latency, Tmax/Tmin/precipitation; heavy throttling, so cache it and make at most a few calls a day) and **IEM METAR for SLVR/SLET** (temperature only, because the precipitation is zero-filled). Gridded data stays primary for every farm. Pass this on to the global-stations family.
12. **Station fallback text:** the Tmax/Tmin fallback should name Viru Viru and Trompillo (synoptic, current through SYNOP), not only Okinawa I and Minero/Unagro (TP, by request only). Do not filter the WFS on `clasificacion`, because 112 of 147 records have it null.
13. **SENAMHI alerts polling:** poll the `senamhi.gob.bo` proxy, which sends no rate headers, or the `senab` backend (100-request window) at most once an hour. Store each poll with its `publicationDate`, because the feed has no archive.
