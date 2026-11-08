# Chile crops, phenology and peril thresholds (family `chile-crops-perils`)

Probed 2026-11-07 (UTC). Market: Chile (primary, team decision 2026-11-06). Test sites: Quillota, Ovalle,
Requínoa, Santa Cruz (Colchagua), Curicó, Talca, Parral, Chillán, Los Ángeles, Temuco, Osorno.

## TL;DR

1. **Chilean fruit is irrigated by default.** The CIREN-ODEPA fruit cadastre is public and keyless. For
   O'Higgins cherries (2024 survey) it shows **27,408 ha on drip, 1,371 ha furrow, 1,029 ha micro-sprinkler,
   1 ha rain-fed (`secano`)**. ADR-0001's drought logic (a rain deficit on the field) is the wrong main
   signal for these zones. **Water supply** replaces it: DGA water-scarcity decrees now, and snow and
   reservoir anomalies later. Rain-fed drought stays only for southern cereals, potatoes and canola
   (Los Ángeles, Temuco, Osorno, and dryland zones generally).
2. **The perils that matter for Chile differ from Bolivia's.** They are:
   - spring frost, with critical temperatures by bud stage;
   - rain at harvest (cherry cracking, table-grape rot);
   - lack of winter chill;
   - heat and sunburn;
   - irrigation-water shortage;
   - cold sterility in rice ("vanazón");
   - hail and wildfire, both with low confidence.

   ADR-0001's `flood72hMm = 120 mm` will almost never fire in the central valley. Harvest-rain damage
   starts at **5–12 mm** (Agroseguros "lluvia mayor").
3. **Insurer definitions are now in hand** (Agroseguros-subsidised policies, product sheets for INDAP
   clients):
   - **Frost:** < 0 °C long enough to cause visible necrosis. For latent-bud damage, < −1.5 °C at an
     official Red Agroclimática Nacional station in the farm's or a neighbouring commune.
   - **Frost coverage starts** at cotton bud or bloom, and never before **5–25 Sep, depending on region**.
   - **Rain at harvest (grapes):** a "major rain" of 8 / 12 / 5 mm by variety group, from veraison to the
     end of harvest, using the average of the 3 nearest official stations.
   - **Rice vanazón:** ≥ 5 consecutive days with Tmean < 18 °C between 15 Jan and 20 Feb.
   - **Rain-fed drought (annual crops):** monthly rain < 50 % of normal and below the crop's water
     requirement.
   - **Heat and sunburn are not covered** by these standard policies.
4. **Data warnings:**
   - Coarse grids fail at foothill orchards. The NASA POWER cell for Requínoa sits at **1,766 m**, but
     the farm is at about 430 m. POWER reports a spring minimum of −8.3 °C and 1,763 chill hours there,
     which are not real site values.
   - **Open-Meteo returned zero harvest-window rain at Requínoa for every year from 1991 to 2025.** That
     is suspicious and unresolved. It must be checked against INIA station "Altair" (INIA-332, Requínoa)
     before we trust the cherry-cracking indicator.
   - The Open-Meteo free daily quota ran out after one 36-year hourly pull ("Daily API request limit
     exceeded", HTTP 429). The pull was 9 MB.

## What I probed (live)

| Source | What I ran | Result |
|---|---|---|
| **CIREN-ODEPA Catastro Frutícola** (ArcGIS Online table `servicio_tb_catastro_fruticola`, org `DmlBJVTrQbCmoXcR`) | `query` with groupBy species × survey year, by commune; groupBy irrigation method (`descmeri`) | HTTP 200, 2.3 s. O'Higgins has 67,751 block rows. Fields include species, variety, planting year, irrigation method, training system and survey year (2020–2025). Top species: Quillota: avocado ("palto") 1,668 ha (2025). Requínoa: walnut 1,769 / cherry 1,564 ha (2024). Curicó: cherry 4,387 / red apple 2,096 / kiwi 560 ha (2024). Chillán: hazelnut 560 / blueberry 514 ha. Ovalle: olive, mandarin, avocado, table grape. **No geometry** (commune-level table). Sample: `sample_ciren_catfru_requinoa.json`, script `probe_ciren.py`. |
| **CIREN "Áreas de riego"** (`esri.ciren.cl/.../Emergencias/HIDRICO_PUBLICO/MapServer`, layers 1–7 by region, 2016–2022) | point query with buffer | HTTP 200, about 4 s per query. Maule layer has 12,994 polygons. Requínoa and Santa Cruz hit at a 500 m buffer. Curicó, Parral, Quillota and Ovalle hit only at a 3 km buffer, because the test points are town centroids. This polygon layer can drive the per-farm `irrigated` flag. The same service also has intake points ("bocatomas"), canals, and Limarí water rights. |
| **CIREN service folders** | `rest/services?f=json` | Public folders include `Emergencias` (GloFAS flood areas 2024, agro-economic impact Jan–Feb 2024, affected points), `INCENDIOS_FORESTALES`, `IDEMINAGRI/AGROCLIMA_DESCARGA`, `PLAGAS_ENFERMEDADES`, `BONIFICACIONES_RIEGO` and `CENSO_AGROPECUARIO`. `Catastro_Fruticola` and `Emergencia_Déficit_Hídrico` are empty or private. |
| **DGA water-scarcity decrees, history** (`Decretos_zonas_escasez_historico_04-09-2026.xls`) | download (90 KB) and parse | HTTP 200, 1.4 s. 249 decrees from 2008 to 2026, with year, region, decree number, expiry and basin / province / commune. Decrees per year: 2019: 21, **2020: 33, 2021: 38, 2022: 35** (megadrought peak), 2023–2026: 5–7. **Limarí (Ovalle) is under decree now** (No. 177 of 09-Jul-2026, expires 2027-07-10). Petorca has 25 decrees, Quillota 14, Aconcagua 14, Maule 19. Saved as `sample_dga_decretos_escasez_2008_2026.csv`. |
| **INIA agrometeorologia.cl** | GET pages `/heladas/`, `/frio_invernal/FI_H_AYER`, `/grados_dia/GD_5_AYER` | HTTP 200, 1.8–2.4 s. The site has chill (hours, Utah units, chill portions), frost, degree-day, ETo, late-blight (tizón) and heat-stress products. The station list has 588 options, including INIA-332 Altair (Requínoa), INIA-351 Quilamapu (Chillán), INIA-21 Human (Los Ángeles), INIA-239 Collimallin (Temuco), EXT-152 Curicó DMC and EXT-1029 Quillota DMC. Downloads go through a POST form with a **maths captcha** (`verificacion_token`), so scraping is not acceptable. `/evapotranspiracion/` returned 403. |
| **INIA API v2** (`agromet.inia.cl/api/v2/`) | GET | **HTTP 403**. It needs a key (a free key on request, per the R/Python clients `iniamet`, `agrometR`). Not signed up. |
| **DMC climatologia** (`climatologia.meteochile.gob.cl`) | GET home | HTTP 200. The API (`getDatosRecientesEma`, etc.) needs `usuario` (email) + `token`, from a free signup at `/application/usuario/editaDatosUsuario`. Not signed up. |
| **CR2 explorer** (`explorador.cr2.cl/request.php`) | `options={"action":["config"]}` | HTTP 200, 0.5 s. Variables: daily precipitation, Tmax, Tmin, Tmean, streamflow ("caudal"); stations from 1940 to 2026; anomaly baseline 1980–2010. A map query returned `{"errors":["map"]}`; the parameters are undocumented. |
| **CR2MET** (Zenodo 10.5281/zenodo.7529682; readme at `ftp.cr2.cl/download/cr2met/readme.pdf`) | Zenodo API + readme | HTTP 200. Version v2.5 (CC-BY-4.0) covers 1960–2021 at 0.05°: `pr` 2.5 GB, `txn` 6.8 GB zips. The readme says **v2.5_NRT runs 2023 → present minus 9 days**, and v2.5_best adds tmean, et0, SPI and SPEI. My guessed NRT file paths all returned 404. `www.cr2.cl` returned 403 to our client. Data Cube Chile STAC returned 202 with a WAF challenge. |
| **Open-Meteo archive, ERA5-Land hourly** | 1991-01-01 → 2026-11-06, Requínoa | HTTP 200, 1.3 s, 9.0 MB, grid elevation 428 m, last valid hour 2026-11-01 20:00 (about 5 days latency). The **next site returned 429**, then "Daily API request limit exceeded" for the rest of the day. |
| **NASA POWER hourly** (CSV; JSON is refused for long ranges with HTTP 422) | 2001 → 2026-11-05, 4 sites | HTTP 200, 2.4 s, 5 MB per site, last valid hour 2026-11-04 23:00. Cell elevations: Requínoa 1,766 m (**wrong for the valley**), Ovalle 579 m, Curicó 448 m, Parral 218 m. Results in `sample_peril_indicators_power.json`. |
| **INDAP / Agroseguros policy sheets** (`indap.gob.cl/sites/default/files/2022-05/*.pdf`) | download + pdftotext | HTTP 200 for table grape, wine grape, apple, blueberry, kiwi, pear and annual crops. HTTP 404 for cherry, walnut, avocado and wheat. Details in the tables below. |
| **FAO Frost Protection Vol. 1, Spanish edition** (`fao.org/4/y7223s/y7223s05.pdf`) | download + pdftotext | HTTP 200. Tables 4.7–4.9 (critical temperatures T10/T90 by stage, from Proebsting & Mills 1978) and fruit freezing points. |
| **FAO-56 Table 12** (`fao.org/4/x0490e/x0490e0b.htm`) | WebFetch | Kc values extracted (below). |

## Peril indicators computed (each site against its own same-season history)

Script: `probe_perils.py` (`openmeteo` or `power`). It computes:
- chill hours below 7.2 °C and chill portions (Dynamic model), 1 May–31 Aug;
- spring frost hours at or below −2 °C and the spring minimum, 1 Sep–31 Oct;
- harvest-rain days (≥ 10 mm) and the maximum 3-day rain, 15 Nov–15 Jan;
- days with Tmax ≥ 32 °C and ≥ 35 °C, Dec–Feb;
- the vanazón run (longest spell of Tmean < 18 °C, 15 Jan–20 Feb).

The percentile is the share of baseline seasons with a value at or below the current one.

**Requínoa cherries, ERA5-Land via Open-Meteo, 35-season baseline 1991–2025.** Values transcribed from the
terminal run; the JSON was not written because the run stopped at the next site's 429.

| Indicator | 2026 value | Baseline median | Percentile |
|---|---|---|---|
| Chill hours < 7.2 °C (May–Aug 2026) | 862 h | 1,097 h | 14th, low chill |
| Chill portions | 63.1 CP | 68.9 CP | 20th |
| Spring minimum (Sep–Oct 2026, to 1 Nov) | −1.6 °C | −2.1 °C | 66th, milder than normal |
| Hours ≤ −2 °C | 0 | 2 | 46th |
| Harvest rain, 2025–26 | 0 mm | **0 mm (suspicious)** | — |
| Days with Tmax ≥ 32 °C, 2025–26 | 1 | 0 | — (looks too low for the valley) |

**NASA POWER (2001–2025 baseline).** Use these only where the cell elevation matches the site.
- **Curicó** (cell 448 m):
  - chill: 527 h (8th percentile), 58.9 CP (20th percentile);
  - days with Tmax ≥ 35 °C in 2025–26: 20, against a median of 11 (83rd percentile);
  - days with Tmax ≥ 32 °C: 45, against a median of 45.
- **Parral** (cell 218 m):
  - chill: 639 h (4th percentile);
  - days with Tmax ≥ 35 °C in 2025–26: 28, against a median of 24;
  - longest vanazón run in 2025–26: 0 days.
- **Requínoa:** the cell is at 1,766 m and the results are rejected.
- **Ovalle:** 49 chill hours, against a median of 120. This is probably a mixed coast/mountain cell, so
  confidence is low.

Take-away: **both sources agree that winter 2026 was low-chill in the central valley (about the 4th–20th
percentile).** That is a real, explainable driver ("winter chill 79 % of normal: risk of uneven
bloom"). For absolute frost and heat thresholds in foothill orchards, we need station data (INIA/DMC)
or CR2MET at 0.05°. Global grids are not good enough.

## Critical temperatures for spring frost

Source: FAO Frost Protection, Tables 4.7–4.9, from Proebsting & Mills 1978. T10 and T90 are the
temperatures that kill 10 % and 90 % of the organ after 30 minutes of exposure.

| Crop | Stage → T10 / T90 (°C) |
|---|---|
| Cherry (Bing) | green tip −3.7/−10.3 · buds still clustered −3.1/−7.9 · buds separating −2.7/−6.2 · white tip −2.7/−4.9 · first bloom −2.8/−4.1 · **full bloom −2.4/−3.9** · petal fall −2.2/−3.6 |
| Apple | swelling bud −11.9/−17.6 · swollen bud −7.5/−15.7 · clusters −5.6/−11.7 and −3.9/−7.9 · pink −2.8/−5.9 and −2.7/−4.6 · first bloom −2.3/−3.9 · **full bloom −2.9/−4.7** · petal fall −1.9/−3.0 |
| Pear (Bartlett) | full bloom −2.7/−4.9 · post-bloom −2.7/−4.0 |
| Peach / nectarine | first bloom −3.3/−5.9 · petal fall −2.5/−3.9 |
| Grapevine (Concord) | cotton bud −10.6/−19.4 · green tip −6.1/−12.2 · first leaf −2.8/−6.1 · 2nd to 4th leaf −2.2/(−5.6 to −2.8). Any new growth −1.1. |
| Blueberry (90 % kill) | swollen bud −6.1 · separate flowers −3.9 · corolla expanded −2.2 · open leaves −0.6 |
| Kiwi (% not given) | green tip −3.0 · leaf veins −2.0 · expanded leaf −1.5 · **flowers distinguishable −1.0** |
| Freezing point of the organ | avocado fruit: Hass/Fuerte −1.6 °C, Lula/Booth −0.9 °C · apple fruit −1.5 · blueberry −1.3 · kiwi −0.9 |

Proposed default for a farm with no stage information: use the **open-flower / fruit-set** values,
which are the most sensitive. Frost severity ramps from 0 at T10 + 1 °C to 1 at T90. Apply it only
inside the frost window, which opens on the Agroseguros earliest coverage date for the region (table
below) and lasts about 6 weeks. Add an absolute flag at **≤ −1.5 °C**, the insurer's official-station
rule, so our trigger matches what lenders hear from insurers.

## Insurer peril definitions

Source: Agroseguros-subsidised policies, as distributed by INDAP. The text dates from 2016–2022. They
apply POL 1 2014 0247 "Seguro Agrícola de Rendimiento por Helada en Frutales" (yield insurance against
frost in fruit orchards) and POL 1 2013 0905 (annual crops).

| Item | Definition / threshold |
|---|---|
| Covered perils (fruit) | frost, hail, harmful wind (> 60 km/h for structure collapse), snow, excessive or untimely rain. **Heat and sunburn are not covered.** Rain-fed drought is covered only for annual crops. |
| Frost | "temperaturas inferiores a 0 ºC por un tiempo suficiente para producir necrosis…" (temperatures below 0 °C for long enough to cause visible necrosis), damaging ≥ 1/3 of the organ. For latent buds: **< −1.5 °C at ≥ 1 official station** (Red Agroclimática Nacional: INIA, FDF, METEOVID) in the farm's commune or a neighbouring one. |
| Earliest frost-coverage date, grapes (vine, table and wine) | Region IV: 5 Sep · Region V inland: 10 Sep · Region V coast, RM, VI: 15 Sep · Region VII: 17 Sep (from cotton-bud stage) |
| Earliest frost-coverage date, apples | from flowering. Regions V, RM, VI: 15 Sep · VII, VIII: 17 Sep · IX, XIV, X: 25 Sep |
| Earliest frost-coverage date, blueberries | from fruit set. Region IV: 15 Aug · V: 1 Sep · RM, VI, VII: 15 Sep · VIII: 1 Oct · IX, XIV, X: 15 Oct. **South of Chillán, blueberry farms without frost control are uninsurable.** |
| Earliest frost-coverage date, kiwi | from cotton bud. V, RM: 15 Sep · VI, VII: 17 Sep |
| Rain at harvest, table grape ("lluvia mayor") | white varieties: 8 mm, or ≥ 2 events of 5 mm and ≥ 3 events of 4 mm. Red varieties: 12 mm, or 2 × 7 mm and 3 × 4 mm. Flame Seedless: 5 mm or 2 × 3 mm. The window runs **from veraison to the end of harvest**, and the rain is the average of the 3 nearest official stations. Only berry splitting caused by a major rain is covered (not fog or humidity). |
| Rice vanazón (cold sterility) | ≥ 5 consecutive days with Tmean < 18 °C between 15 Jan and 20 Feb, at the nearest Agroclima station. Only for October sowings. |
| Rain-fed drought (annual crops) | monthly rain < 50 % of normal **and** below the crop's water requirement |
| Wheat | rain causing pre-harvest sprouting is covered (with an extra deductible for the CRAC variety) |
| Frost-control methods recognised | wind machines, over-tree sprinklers, helicopters. If a declared method is not operational, an extra 35 % deductible applies. |
| Deductibles | 20–30 % of the sum insured (fruit), 25–30 % for Chardonnay |

Rain-at-harvest for cherries (no insurer table found): INIA Quilamapu, quoted in the trade press, says
about 10 mm does not represent a risk, while about 50 mm during harvest causes serious damage.
Proposal: count rain days ≥ 10 mm in the cracking window (straw-colour stage to harvest, roughly mid-Nov
to mid-Jan in the central zone). Severity ramps from 10 mm/day (0.3) to ≥ 30 mm in 3 days (1.0).

Heat and sunburn (literature): apple fruit-surface necrosis starts above about 52 °C and browning at
46–49 °C. That corresponds to air Tmax of roughly 30–32 °C or more with high radiation (INIA/UdeC). Keep
ADR-0001's 35 °C; add a count of days ≥ 32 °C for apples, walnuts and avocados in Dec–Feb.

Chill requirements (trade/INIA-derived sources): Lapins 400–500 chill hours, Santina 600–800 h, Brooks
and Royal Dawn 400–500 h. The Dynamic model (chill portions) is preferred over chill hours.

## FAO-56 Kc (Table 12), for ETc and water demand

| Crop | Kc ini | Kc mid | Kc end |
|---|---|---|---|
| Apple / cherry / pear, no ground cover, frost | 0.45 | 0.95 | 0.70 |
| same, with active ground cover, frost | 0.50 | 1.20 | 0.95 |
| Stone fruit, no ground cover, frost | 0.45 | 0.90 | 0.65 |
| Table grape | 0.30 | 0.85 | 0.45 |
| Wine grape | 0.30 | 0.70 | 0.45 |
| Kiwi | 0.40 | 1.05 | 1.05 |
| Walnut | 0.50 | 1.10 | 0.65 |
| Avocado, no ground cover | 0.60 | 0.85 | 0.75 |
| Berries (blueberry) | 0.30 | 1.05 | 0.50 |
| Olive | 0.65 | 0.70 | 0.70 |
| Citrus, 50 % canopy | 0.65 | 0.60 | 0.65 |
| Wheat | 0.3–0.7 | 1.15 | 0.25–0.4 |
| Maize | 0.30 | 1.20 | 0.35–0.60 |
| Rice | 1.05 | 1.20 | 0.60–0.90 |
| Potato | 0.50 | 1.15 | 0.75 |
| Canola | 0.35 | 1.0–1.15 | 0.35 |

## Typical crop calendars for central and south Chile

These are approximate months from general agronomy, the Agroseguros coverage dates and the trade press.
**I did not verify them against an INIA document this session**, because the search budget ran out.

| Crop (site) | Sensitive stages → main perils |
|---|---|
| Cherry (Requínoa, Curicó) | chill May–Aug → deficit · budbreak and bloom late Aug–early Oct → frost (T10 −2.4) · harvest mid-Nov–early Jan → rain/cracking · Dec–Jan heat |
| Table grape (Ovalle) | budbreak Aug–Sep → frost from 5 Sep · veraison Dec → rain from veraison · harvest Dec–Jan in Limarí (Jan–Apr further south) · water (Limarí decree in force) |
| Wine grape (Colchagua, Talca) | budbreak mid-Sep–Oct → frost (Sep 2013 is the reference event) · harvest Feb–Apr → rain and botrytis · fire and smoke (2017, 2023) · water |
| Apple (Curicó) | bloom late Sep–Oct → frost (from 17 Sep in Region VII) · Dec–Feb sunburn (days ≥ 32 °C) · harvest Feb–Apr · hail |
| Avocado (Quillota) | winter fruit frost Jun–Aug (−1.6 °C) · bloom Sep–Nov, where heat > 35 °C causes fruit drop · hillside irrigation; Petorca and Aconcagua decrees 2019–2022 |
| Blueberry (Chillán) | bloom Sep–Oct → frost (fruit set from 1 Oct in Region VIII) · harvest Nov–Feb → heat and rain |
| Walnut, kiwi | budbreak late Sep–Oct → late frost (kiwi flowers −1.0) · Mar–May harvest; kiwi is exposed to autumn frost |
| Rice (Parral) | sown Oct–Nov in flooded paddies · flowering 15 Jan–20 Feb → vanazón · water from Digua and Bullileo reservoirs |
| Maize (Los Ángeles) | sown Oct–Nov, irrigated · silking Jan → heat ≥ 35 °C · water |
| Wheat and oats (Los Ángeles, Temuco) | sown May–Aug, mostly rain-fed · heading Nov–Dec → drought, heat ≥ 30 °C · Jan–Feb harvest → rain (sprouting) |
| Potato (Osorno) | planted Sep–Nov · late blight in humid spells (INIA "tizón tardío" alert) · frost · summer drought |
| Canola (Biobío, Araucanía) | sown Apr–May · flowering Sep–Oct → frost · Dec–Jan harvest |

## How this changes ADR-0001 for Chile zones

| ADR-0001 item | Proposed for Chile |
|---|---|
| Crop list (soy … chia) | Add cherry, table grape, wine grape, apple, avocado, blueberry, walnut, kiwi, canola and oats. Keep wheat, maize, rice and potato. Hide soy, sugarcane, quinoa and chia for Chilean portfolios. |
| `irrigated` default false | **Default true for fruit, vines and rice.** Set it from the CIREN areas-de-riego polygons, with the cadastre irrigation method as evidence. Default false only for southern cereals, potato and canola. |
| Drought = rain deficit + dry spell + soil moisture | For irrigated zones, add a **water-supply** part. First, a DGA scarcity decree in force for the farm's province or basin (binary, from the history file, 2008 onward). Later, snowpack and reservoir anomalies (DGA/SNIA, not probed here). Keep the ×0.4 irrigated damping on rain parts, but **do not damp the water-supply part**. Rain-fed annual crops follow Agroseguros: monthly rain < 50 % of normal. |
| `frostC = 0 °C` | Stage-based T10/T90 table per crop. The frost window opens on the regional Agroseguros date. Also show an "insurer frost" flag at ≤ −1.5 °C. Winter frost on avocado fruit (−1.6 °C, Jun–Aug) is a separate window. |
| `heatC = 35 °C` | Keep 35 °C. Add count-based heat (days ≥ 32 °C in Dec–Feb) for sunburn on apple, walnut and avocado. Heat at rice and maize flowering stays at 35 °C. |
| `flood72hMm = 120 mm` | Keep it for real flood events (June 2023 atmospheric river). **Add a new "wet-harvest" peril**: grapes use the lluvia-mayor rule (5–12 mm per event); cherries use days ≥ 10 mm and a 3-day maximum ≥ 30 mm in the harvest window. |
| (new) Chill deficit | Chill portions or hours, May–Aug, against the farm's own history (percentile) and against the variety requirement. It is a driver for watch, not for high, on its own. |
| (new) Rice vanazón | ≥ 5 days Tmean < 18 °C between 15 Jan and 20 Feb, as in the Agroseguros rule. |
| Hail | Still no observation source. Keep the NDVI-drop inference, with low confidence. |
| (new) Wildfire | CIREN `INCENDIOS_FORESTALES` service exists (not queried). CONAF SIDCO needs a login. FIRMS is in another family. |
| Stress-window examples | Cherry 25 Aug–15 Jan · table grape (Limarí) 5 Sep–31 Jan · wine grape 15 Sep–30 Apr · apple 15 Sep–15 Apr · avocado year-round · rice 15 Jan–20 Feb |
| Backtest (ADR-0002 phase 2) | Chile equivalents of the Bolivian 2023–24 drought: the 2019–2022 megadrought (Petorca, Quillota and Limarí decrees), the Sep 2013 spring frost (central zone), and the June 2023 floods. |

## Recommended primary and fallback by variable

| Variable | Primary | Fallback | Baseline |
|---|---|---|---|
| Crop presence and species by commune | CIREN-ODEPA cadastre (ArcGIS, keyless) | ODEPA regional reports (reportes.odepa.gob.cl) | — |
| Irrigated flag | CIREN areas-de-riego polygons | cadastre irrigation-method share by commune | — |
| Water-supply stress | DGA scarcity-decree history file (keyless) | CR2 explorer streamflow (undocumented) | decrees 2008– |
| Frost and heat at the farm | INIA/Agromet station via API v2 (**free key needed**) | ERA5-Land (Open-Meteo), checked for elevation | ERA5-Land 1950–, CR2MET 1960– |
| Chill | computed from hourly ERA5-Land (Dynamic model) | INIA chill product (captcha web) | ERA5-Land 1991– |
| Harvest rain | INIA/DMC stations (insurer rule = 3 nearest stations) | CR2MET NRT / ERA5-Land (**precipitation unvalidated**) | CR2MET 1960– |
| Thresholds | FAO frost tables + Agroseguros policy sheets (this note) | — | — |

## Open risks

1. **ERA5-Land precipitation at Requínoa came back as zero** in every Nov–Jan window from 1991 to 2025.
   The model's own grid or the `era5_land` precipitation field may be the cause. This must be checked
   (default vs `era5_land`, and against INIA Altair) before we ship the cherry-cracking indicator.
2. **Rate limits.** Open-Meteo's free tier ran out after one 36-year hourly pull, because hourly
   requests count as many calls. The service must cache in DuckDB, fetch hourly only for the May–Oct
   chill and frost windows, and use daily data elsewhere. Our IP may also be shared with the other
   discovery agents.
3. **Resolution.** POWER (0.5°) and ERA5 (0.25°) mix the Andes into foothill orchards. Every source
   must pass an elevation sanity check (cell elevation vs DEM within about 200 m) before absolute
   thresholds are applied. Percentiles against the farm's own history are more robust to this.
4. **Station access needs keys:** INIA API v2 (free key on request) and DMC (free email signup). Both
   are fine for us, but someone must sign up. The INIA web download is captcha-gated.
5. **CR2MET near-real-time access path not found** (404, and WAF on cr2.cl and Data Cube Chile). The
   Zenodo files (1960–2021) are 2.5 GB and 6.8 GB zips, too big to fetch per request; pre-extract to
   points offline.
6. **Policy text is 2016–2022.** Current Agroseguros parametric products (CMF enabled parametric
   insurance in Aug 2025) were not checked. Treat the thresholds as indicative.
7. **Crop calendars are approximate.** They need an INIA or ODEPA source per region before demo claims.
8. **The cadastre has no field polygons publicly.** It is commune-level only, so per-farm species must
   come from the lender.
