# Adversarial verification: Chile agrometeorological networks (family `chile-agromet`)

Verifier probe time: 2026-11-07, 13:15–13:45 UTC (10:15–10:45 Chile summer time, UTC-3). No accounts, keys or
credentials were used. To avoid repeating the original probes, I used different stations and date ranges:

- RAN: San Fernando (58), Cauquenes (164), Vicuña FDF (11) and Linares 2 (99), plus the original Requínoa (82)
  and Quillota (32), only to check the claimed start year.
- INIA: Santa Rosa Chillán (INIA-17), Human (INIA-21) and Remehue (INIA-19).
- CEAZA: Vicuña (station 6), in 2005 and 2026.

Scratch scripts are kept outside the repo. This file is the only one written in this folder.

## Bottom line

1. **None of these sources covers Santa Cruz, Bolivia.** Our ADRs and sample portfolio are Bolivian. The
   nearest RAN station to any of the 12 sample farms is Lago Chungará, 630–720 km away. These are Chile-only
   sources. If Chile is not a target market for v1, the whole family is out of scope.
2. **RAN (agromet.cl) holds up as the best Chile station source, with three corrections.**
   - History starts on **2010-01-01**, not 2009. Every station I tested has zero valid hours in all 12 months
     of 2009. The researcher's `first_year()` returns 2009 when the 2010-01-15 check passes: an off-by-one.
   - Latency is **1.5–2.5 h**, not about 1 h.
   - `robots.txt` publishes **`Crawl-delay: 10`**. So "no rate limits documented" is wrong, and the probe
     scripts' 0.3–0.5 s sleeps break the crawl delay.
3. **INIA (agrometeorologia.cl) cannot be primary for anything today.** The weather table view (`/TA`) still
   works. But three resources the original report verified now return **HTTP 403 Forbidden** from this network:
   - the ETo page `/evapotranspiracion/` (GET);
   - the frost-event query (POST to `/heladas/`);
   - the catalogue JSON `items-resumen.json`.

   The other pages on the same site return 200. INIA also added an anti-bot check on exports in late October,
   so the site is tightening access. ETo, frost events and the daily refresh therefore need new routes.
4. **The CEAZA claims are confirmed.** The username is requested by email. The anonymous cap is 24 data rows
   per request plus a daily query limit. Attribution is mandatory. Commercial use is **not** granted
   explicitly: approval depends on the stated business and use.

## Probes and results

### RAN, agromet.cl, `ext/aux/*.php`

| Probe | Result |
|---|---|
| `getRegiones.php` with plain `curl` (default client) | **403**, 0.55 s. Body: *"This transfer is blocked by a Web Application Firewall."* `robots.txt` was also 403 with curl. Plain http: 403. |
| Same URL with default Python `requests` and a CA bundle that includes the Sectigo DV R36 intermediate | **200**, 0.43 s, `[["1","Arica y Parinacota"],["2","Tarapacá"],...]`. There are 16 regions. |
| Python `requests` with the default certifi bundle | `SSLError CERTIFICATE_VERIFY_FAILED`. `openssl s_client` shows the server sends only the leaf (`CN=*.agromet.cl`), issued by Sectigo DV R36: "unable to verify the first certificate". The intermediate comes from the AIA URL (HTTP 200, 1,616 B) and is valid until 2036-03-21. |
| `getRegionWMS.php` for all 16 regions | 442 stations, all with unique ids: **confirmed**. Four of them fall inside a rough Bolivia bounding box, but all four are Chilean (Ollagüe, Calama Rural, Caspana, San Pedro de Atacama). |
| Nearest RAN station to Los Tajibos, Arrocera Mineros and Viru Viru | 719 km, 631 km and 638 km respectively, all to Lago Chungará (id 145). **No Bolivia coverage.** |
| `getGraphData.php`, last 3 days, stations 58, 164, 11 and 99 | 200, 0.42–0.55 s, about 9 KB. Latest valid hour was 2026-11-07 08:00 (09:00 for station 164) at 10:31 local. Future hours come back as empty rows (`fecha\|2026-11-07 23:00:00\|1\|\|2\|\|...`). |
| `<gra>` footer | Confirms the field codes: 1 Tavg °C, 2 hourly precip mm, 3 RH %, 4 pressure mbar, 5 **maximum** solar radiation W/m², 6 **maximum** wind m/s, 7 Tmin, 8 Tmax, 9 wind direction, 11 GDD base 10, 12 chill hours base 7. There is no ETo field. |
| History, stations 82, 32 and 58: each month of 2009 queried separately | **0 valid hours in every month of 2009.** Data starts at 2010-01-01 00:00. Requínoa (82) has only 335 of 672 hours in Jan-2010. |
| History, stations 58, 164 and 11 (10–12 Jul each year) | Nothing in 2007, 2008 or 2009; data present in 2010. Station 99 (Linares 2) has nothing in 2010 either. |
| Requínoa (82), window 8 Oct–6 Nov, 2010–2026, recomputed independently | 2026: 56.4 mm. History n=16, median 6.95 mm, previous maximum 46.3 mm (2015). 2026 mean daily Tmin 10.65 °C, the highest of the series (2024 was 9.17). **Confirmed exactly.** All 17 windows have 719–720 of 720 hours. |
| One full year of hourly data, Cauquenes (164), 2025 | 200, **8.4 s, 1.10 MB**, 8,760 rows, 8,756 valid (4 missing in June). Annual rainfall 408 mm. That looks low for Cauquenes but was not cross-checked, so plausibility is **unverifiable**. |
| `robots.txt` (Drupal) | `User-agent: * / Crawl-delay: 10`. `/ext/` is not disallowed. |
| Homepage search for términos, condiciones, licencia, derechos, Creative Commons, fuente | Nothing found. **No licence or terms published.** |

### INIA Red Agrometeorológica, agrometeorologia.cl

| Probe | Result |
|---|---|
| GET `/TA` | 200, 1.56 s, 338 KB. The form has `verificacion_token`, `verificacion_respuesta`, an image question and a hidden `website` honeypot. The page text says **"Solo se pide al descargar CSV o Excel"**, so the table view is not gated: **confirmed**. Variables offered: TA, HR, PP, PS, RD, TS00/TS10 and VV/DV. **No ETo variable.** Years from 2009. |
| POST `/TA` table, INIA-17, daily 01–10 Jan 2015, [TA_MIN, TA_MAX, PP_SUM] | 200, 1.44 s, 10 rows, e.g. `01-01-2015, 6,4, 25,9, 0, 100 %`. Time column labelled "UTC-4". Decimal commas. |
| The same query with the variables in the order [PP_SUM, TA_MAX, TA_MIN] | 200. The values moved (`0, 25,9, 6,4`) but the header still reads Tmin, Tmax, PP. **The column-order gotcha is confirmed.** |
| INIA-17, daily 28 Oct–7 Nov 2026 | 200, 1.4 s. 07-11-2026 is 41 % complete at about 10:35 local, so data is near real time (under 1.5 h). |
| INIA-17, `intervalo=hour`, 5 Nov 2026, TA_MAX | 200, 0.84 s, 24 hourly rows. The hourly fallback works. |
| INIA-19 Remehue, daily Oct-2009 | 200, 31 rows, 100 % complete, `01-10-2009 5,1`. **The Oct-2009 start is confirmed.** |
| GET `/evapotranspiracion/`, with and without the trailing slash, from Python and from curl | **403 Forbidden** (239 B) on 4 attempts over about 10 minutes. `/heladas/`, `/frio_invernal/` and `/grados_dia/` returned 200 at the same moment. |
| POST `/heladas/` table, INIA-21, Jun–Aug 2025, with the page's token | **403** in 0.15 s, the same 239 B body. A `/TA` POST 20 s later returned 200. |
| GET `/json/tmp_474842841/items-resumen.json` (tmp id taken from `/grados_dia/GD_5_AYER`) | **403** in 0.15 s, the same 239 B body. |
| `robots.txt` | Returns the HTML homepage, so there is no robots file. No licence or terms text on `/TA`. |

I did not repeat these blocked requests with other headers, clients or hosts. From one vantage point I cannot
tell whether the block is per IP (possibly triggered by the original researcher's heavy probing from this
network earlier today) or applies to the whole site. Either way it is a production risk.

### CEAZA-Met, `ws/pop_ws.php`

| Probe | Result |
|---|---|
| `pop_ws_doc.php`, section "Condiciones de uso" | Users must **request a username by email**, giving name, email, company, *rubro* (business sector), intended use, download frequency and daily volume. The source and a link must be cited; the doc's example is *"Datos provistos por El laboratorio de meteorología CEAZA"*. No warranty is given, and the service may change at CEAZA's discretion. Without `user`, both the rows returned and the queries per day are limited (no numbers given). |
| `GetListaEstaciones` | 200, 2.7 s. Vicuña (6) has its first reading on 2004-01-31 and its last on 2026-11-07 09:00. |
| `GetListaSensores`, station 6 | 21 sensors (T, RH, wind ×2, direction, PAR, solar radiation, pressure, diffuse/direct radiation, precip, ...). |
| `GetSerieSensor`, s_cod 39, daily, 2005-01-01..2005-03-31 | 200, 2.4 s. Returned **24 data rows** (1–24 Jan 2005) out of 90 requested, e.g. `39,2005-01-01 00:00:00,11.887,21.795,31.8,100`. |
| `GetSerieSensor`, hourly, 2026-11-06..07 | 200, 2.25 s. **24 rows** (all of 6 Nov), so anonymous calls cannot reach "today" in a 2-day window. **Cap confirmed.** |

## Verdict on the recommendations

| Variable | Original | Verifier view |
|---|---|---|
| Precipitation (daily) | RAN primary, INIA `/TA` fallback | **Keep.** The baseline is 2010–2025 (16 seasons), not "2009+". Throttle requests to at least 10 s. |
| Tmax / Tmin | RAN 8/7, INIA fallback | **Keep.** |
| Frost | RAN field 7 primary, INIA `/heladas/` fallback | Keep RAN. **Downgrade INIA `/heladas/` to "blocked, fix access first".** Derive frost events in-house from RAN or INIA hourly `/TA` TA_MIN, which works. |
| Heat hours | RAN field 8, INIA hourly TA_MAX | **Keep.** The INIA hourly route was verified. |
| ETo (FAO-56) | INIA `/evapotranspiracion/` primary | **Change.** The INIA ETo page is unreachable (403) and `/TA` has no ETo variable. Primary should be in-house FAO-56 from RAN hourly data. RAN gives only hourly **maximum** wind and **maximum** radiation, which biases ETo upwards, so calibrate it against CEAZA ETo in Coquimbo or a gridded ETo source from another family. Re-test the INIA ETo page before using it as a fallback. |
| Chill / GDD | INIA `/frio_invernal/`, `/grados_dia/` | The pages return 200 on GET, but the form POST was not tested and the same site is blocking sibling paths. **Make RAN fields 11 and 12 (or in-house computation) primary and INIA the fallback.** |
| Daily "today" refresh | `items-resumen.json` | **Blocked (403).** Use 2-day RAN pulls for the stations nearest the portfolio. |

## Open risks found during verification

1. **Scope.** The product and the ADRs target Santa Cruz, Bolivia, and this family has zero coverage there.
2. **The RAN web application firewall.** A default curl client is blocked, while default Python `requests`
   gets through. The firewall rules are undocumented and could change at any time, on top of the TLS-chain
   problem. Keep an offline snapshot.
3. **RAN crawl delay.** At 10 s per station-year request, backfilling 16 years takes about 3 minutes per
   station. That is fine for a dozen stations near the portfolio and impractical for all 442.
4. **INIA is closing down access.** Three endpoints return 403 today, and exports have been behind an anti-bot
   check since late October. Contact INIA before any automated use. INIA should not be primary for anything.
5. **Licences.** No licence is published for RAN or INIA. CEAZA requires attribution and gives no explicit
   commercial-use permission. Clear all three before a bank-facing product.
6. **Station data quality is only partly checked.** Gaps are rare at the stations I tested (at most 4 missing
   hours a year), but the Cauquenes 2025 rainfall of 408 mm looks low and was not cross-checked.
