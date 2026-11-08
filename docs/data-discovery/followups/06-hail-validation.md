# Follow-up 06: hail validation (Santa Cruz soy belt)

- **Probed:** 2026-11-07, about 13:50–14:10 UTC. All probes were keyless. No account was created.
- **Scripts:** these ran in the session scratchpad, a venv with `h5py`, `rasterio` and `numpy`. They are not in the repo because this follow-up writes only this file.
  - `probe_glm_events.py`
  - `probe_glm_meta.py`
  - `probe_s2.py`
  - `probe_om.py`
- **Verdict (short):** I found **no dated, located hail event on lowland crops** near Cuatro Cañadas, Okinawa or Mineros. The GLM and Sentinel-2 parts of the chain work, and GLM saw the two hail storms the press reported in the Santa Cruz valleys. The NDVI rule still has **no true-positive check**.
  - **Recommendation:** for v1, mark hail as having **no observational source**.
  - Keep an "unexplained NDVI drop" flag, without a hail label (see the last section).

## Step 1: press search for dated lowland hail events

**Limit:** the WebSearch budget for this session was used up (200/200) before this task started. I searched instead with live `curl` on news-site tag pages, site searches and search RSS feeds, all HTTP 200.

These searches returned **0 hits** for hail on lowland crops:

- `granizo` or `granizada` combined with soya, Cuatro Cañadas, San Julián, Okinawa, Pailón, Mineros, Montero, Warnes, trigo or girasol
- `granizo` + `norte integrado`

Every dated hail story I found was in the Andean valleys or the highlands.

| Pub. date | Place (event) | Crop | Source (live, 200) | Usable for the soy belt? |
|---|---|---|---|---|
| 2026-09-29 (event: "la tarde de este martes" = **Tue 2026-09-29, afternoon**) | Rancho Novillero and Alto Seco, Vallegrande municipality (Santa Cruz valleys, about 180 km SW of Cuatro Cañadas). The same story reports **hail in San José de Chiquitos** (lowland Chiquitania), which put out fires there and did not damage crops | peach, plum, apple, lemon | elmundo.com.bo/intensa-granizada-causa-danos-en-cultivos-de-vallegrande/ | No. Valley orchards. It does test whether GLM sees a hail storm reported in Bolivia |
| 2026-10-25 (event: "la madrugada de este domingo" = **Sun 2026-10-25, about 00–06 local**) | Alto Citanos, Vallegrande | plum, close to harvest | elmundo.com.bo/vallegrande-fuertes-vientos-y-granizo-afectan-comunidades/ | No, same reason |
| undated on the tag page | Comarapa (strawberry); Vallegrande fruit; Mairana apple (80 % damage) | fruit | eldeber.com.bo/tag/granizo, /tag/granizada; elmundo search | No |
| 2023-11 to 2024-10 | Cochabamba valleys (Sacabamba, Palca, Cocapata), Tarija | potato, maize | opinion.com.bo/tags/granizada | No |
| 2015–2016 | La Paz, Potosí, Chuquisaca | potato, broad bean | erbol.com.bo/tags/granizada | No |

Other sources I checked:

- **ANAPO:** the homepage had no hail item, and `/nuevo/noticias-3` returned 406.
- **CAO:** a site search for "granizo" returned 200 with no relevant hits.
- **eju.tv, Los Tiempos and Red Uno:** the tag URLs returned 404.
- **Página Siete:** returned 522.
- **ANAPO and INSA (El Mundo, 2026-04-22):** they say the agricultural insurance covers "heladas y granizadas" in Santa Cruz, but name no event.

**Conclusion (verified=false):** no lowland hail event was **found in the sources I reached**. I did not show that hail does not happen there. This matches the `frost-heat-hail` family: the South American hail maximum is in Argentina, and Bolivian hail losses are mostly in the Andean valleys.

**Event coordinates are approximate (verified=false):**

- Vallegrande town: (-64.11, -18.49).
- South Vallegrande / Alto Seco: (-64.10, -18.85). I estimated this point. The village coordinates were not geocoded.

## Step 2: GOES-19 GLM L2 LCFA, events against dry controls

### Archive checks

- `noaa-goes19` S3 listing: 200 in 0.10–0.35 s.
  - **Latest file:** `..._s20263111356000...nc`, which is 2026-11-07 13:56 UTC, at a wall clock of 13:56 UTC. Latency is under 2 minutes.
  - **History start:** 2025/015 (2025-01-15).
- `noaa-goes16` LCFA covers **2018/044 to 2025/097** (2018-02-13 to 2025-04-07).

### Sampling method

- I took one 20-s file per 10-minute slot over the storm hours. Each file was 0.46–0.68 MB, far under 20 MB.
- One run of 72–84 files came to 27–33 MB in total.
- I counted flashes with quality flag 0, using haversine distance.

### Control days

- A control day is a dry day in the same month with low CAPE. GFS (Open-Meteo forecast API, see below) gave 2026-09-07 at 0 mm and CAPE 0, and 2026-10-30 at 0 mm and CAPE 80.
- **The 10-30 control is not clean.** Its 22–12 UTC window (controls are listed by the 10-29 start) ends on 10-30, the 0 mm / CAPE 80 day. 10-29 itself, where the window starts, was not checked for dryness. GLM saw zero flashes in the whole window anyway.

### Results

Flashes with quality flag 0 (sampled):

| Window (UTC) | Files | South Vallegrande ≤25 km | ≤50 km | San José de Chiquitos ≤25 km | Cuatro Cañadas ≤25 km | Okinawa ≤25 km | Mineros ≤25 km |
|---|---|---|---|---|---|---|---|
| **A event** 09-29 17Z to 09-30 05Z | 72 | **26** (14 slots) | 122 | **24** (14 slots) | 11 (6) | 33 (12) | 25 (11) |
| A control 09-07 17Z to 09-08 05Z | 72 | 0 | 0 | 0 | 0 | 0 | 0 |
| **B event** 10-24 22Z to 10-25 12Z | 84 | **49** (12 slots) | 165 | 0 | 0 | 0 | 0 |
| B control 10-29 22Z to 10-30 12Z | 84 | 0 | 0 | 0 | 0 | 0 | 0 |

Vallegrande town within 25 km had 0 flashes on both event days, and 23 and 41 flashes within 50 km. The storms sat south of the town, which fits Alto Seco and Pucará.

**What the results show (verified):**

- GLM picks up both hail storms the press reported, and the lowland San José de Chiquitos hail, against zero on the controls.
- The soy-belt points also had lightning on 2026-09-29. It was a widespread convective day: GFS min lifted index was -2.9 at Cuatro Cañadas and -3.7 at Vallegrande.

**What they do not show:**

- They do not show that GLM can tell a **hail** storm from an ordinary thunderstorm. The controls had no storms at all.
- Lightning is evidence that convection happened. It is not evidence of hail.

## Step 3: Sentinel-2 L2A NDVI and the proposed rule

### Access

| Probe | Result |
|---|---|
| Planetary Computer SAS token (`/api/sas/v1/token/sentinel-2-l2a`) | 200, 0.32 s |
| PC STAC search, per point | 200, 1.1 s |
| PC history start | 2015-10-21 |
| PC latest | 2026-11-04 |
| Earth Search `sentinel-2-c1-l2a` | 200, 0.31 s; latest 2026-11-04; earliest 2018-02-07 |
| Window reads (B04, B08, SCL COG windows over a 1 km box) | 46–78 s per point for 74–143 items, with 6 threads |

- Every scene from 2025-09 onward has processing baseline 05.11–05.13, so the -1000 DN offset was applied to all of them.
- **Mask:** keep SCL classes 4 and 5. A scene counts only if at least 60 % of the box is valid.
- **Clear dates found:** Cuatro Cañadas 41, Okinawa 44, Mineros 72, between 2025-09 and 2026-11.

### Rule test

**Proposed rule:** NDVI drops by at least 0.15 between clear scenes no more than 10 days apart. Over about 14 months at the 3 farms, it fired 8 times (as overlapping scene pairs).

| Farm | Pair | NDVI | Likely cause |
|---|---|---|---|
| Okinawa | 03-19 → 03-22 / 03-29 | 0.45 → 0.29 / 0.27, stays low | **Soy harvest.** The harvest-window exclusion removes it |
| Okinawa | 06-20 → 06-27 | 0.82 → 0.62, back to 0.80 on 06-30 | One-scene artefact |
| Mineros | 04-26 → 04-29 | 0.76 → 0.52, back to 0.73 on 05-01 | One-scene artefact |
| Mineros | 05-16 → 05-26 | 0.73 → 0.55, back to 0.70 on 06-05 | Artefact |
| Mineros | 06-18 / 06-20 → 06-27 | 0.70 → 0.47, back to 0.66 on 06-28 | Artefact on the same date as Okinawa: haze or cloud that SCL missed. A June cold front cannot be excluded because the Tmin check was blocked (see below) |
| Mineros | 09-08 → 09-16 | 0.50 → 0.31, back to 0.49 on 09-25 | Artefact. Likely fire-season smoke |

- **Persistence fix:** add the condition "the next clear scene must also be at least 0.15 below the pre-event value". With it, the only trigger left is the Okinawa harvest, which the rule excludes. Outside harvest that leaves **0 false positives in 3 farm-years**.
- **Proposed change to ADR-0001 D4 (verified on this sample):** add this persistence condition to the NDVI-drop rule.
- **Event A in the soy belt:** before and after 2026-09-29, Cuatro Cañadas went 0.26 → 0.27, Okinawa 0.48 → 0.52 and Mineros 0.48 → 0.40. None reached -0.15. These fields were fallow or at the start of the season, and no damage was reported.
- **No true-positive test was possible.** I had no lowland event, and the valley orchards are too small and too mixed for a clean 1 km box. I did not run S2 at Vallegrande.
- **Frost exclusion not checked.** The Open-Meteo archive returned 429 today (see below), and the forecast API with `past_days=92` reaches back only to 2026-08-07.

## Open-Meteo CAPE / lifted index path (quota today)

| Endpoint | Status | Latency | Note |
|---|---|---|---|
| `historical-forecast-api.open-meteo.com/v1/forecast` (GFS CAPE/LI) | **429** | 0.43 s | "Daily API request limit exceeded. Please try again tomorrow." The limit is per IP, and earlier family probes on this machine used it up |
| `archive-api.open-meteo.com/v1/archive` | **429** | 0.44 s | Same message |
| `api.open-meteo.com/v1/forecast`, `models=gfs_seamless`, `past_days=92`, `hourly=cape,lifted_index,precipitation` | **200** | 0.17–0.36 s | 2,232 hourly values. Latest day 2026-11-07. Reaches back to 2026-08-07 only |

- Event days, per GFS (daily values computed on UTC days):
  - **Vallegrande:** max CAPE 680 J/kg, min LI -3.7, on 09-29. On 10-24: 1,280 J/kg and -3.8.
  - **San José de Chiquitos, 09-29:** 740 J/kg and -3.3.
- So the `hail_env_day` condition "LI ≤ -3" was met on both event days.
- I could not test the condition "CAPE ≥ the farm's own October–March p90", because the history call was blocked by the quota.
- The `frost-heat-hail` family found earlier that the historical-forecast history starts on 2021-03-23. I did not re-check that today (verified=false today).

## Recommendation

**Option 2: no observational source; hail is out of scope for v1.** Nothing in the chain (CAPE/LI environment → GLM lightning → NDVI drop) has been checked against a real hail loss on a lowland crop. Under the rule that anything not verified live is verified=false, we cannot ship it as a "hail" signal.

Changes to ADR-0001 D4:

- **Score weight:** remove `hail 0.4` from the v1 score.
- **NDVI-drop flag:** keep the rule (with the persistence condition) as **"unexplained sudden vegetation loss"**, without a hail label. It is real evidence of damage and works with keyless S2.
- **Storm context:** add GLM lightning only as an event-detail layer ("storm with lightning within 25 km on <date>"). Run it event-driven and offline into DuckDB, not on the request path.

**If the team keeps hail in v1 anyway:**

- **Primary:** S2 persistent NDVI drop + a GLM flash count within 25 km in the previous 10 days + GFS LI ≤ -3, labelled "possible hail (low confidence)".
- **Fallback:** an IMERG heavy-rain day (ClimateSERV) in place of GLM. MODIS NDVI in place of S2 when there is cloud.

## Open risks

- **No ground truth.** We need one dated, georeferenced soy-belt hail loss: an ANAPO/INSA claim, a farmer report, or Suyana's own archive. **Ask Suyana directly.** This is the cheapest way to unblock hail.
- **GLM discrimination.** GLM separates storm from no storm. It does not separate hail from no hail. Storm-scale hail needs radar or an overshooting-top product; I found neither keyless for Bolivia.
- **Sampling.** One 20-s file per 10 minutes catches about 3 % of the time. Flash totals are indices, not true counts. A full storm window at full rate is about 180 files and 70–110 MB per hour.
- **Open-Meteo quota.** The historical and archive endpoints are blocked for the rest of the day once the per-IP quota is used. The service must cache, and must not share an IP with bulk discovery jobs.
- **S2 artefacts.** SCL misses haze and smoke, especially in the August–October fire season. Without the persistence condition the rule would raise false alarms about every 2 months per farm.
