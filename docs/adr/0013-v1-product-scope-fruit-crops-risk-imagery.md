# ADR-0013: v1 product scope: six fruit and nut crops, crop rules, risk formula, imagery and water status

- **Status:** Accepted
- **Date:** 2026-11-07
- **Builds on:** ADR-0001 to ADR-0012
- **Decided by:** the team, in conversation on 2026-11-07. The team accepted the definitions as proposed.

## Context

After the data discovery (ADR-0003 to ADR-0012), the team narrowed v1 to a product for lenders
financing **Chilean fruit and nut orchards**. The headline feature is satellite imagery of each
orchard over time, made **cloud-free by interpolation and sharpened with AI**, together with each orchard's
**irrigation and water status**. Risk is computed **per crop, per growth stage and per zone**. The rules
behind it are editable per crop and per farm. A farming agent recommends zone settings from history.

All six crops are perennial, mostly irrigated and export-oriented, and CIREN's fruit cadastre maps
them (ADR-0010). For a lender this changes the risk picture:
- **One season vs. the asset:** loans are often multi-year (establishment or replanting). A frost
  costs one season; fire, sustained water shortage or abandonment destroys the asset.
- **Water supply:** drought means water supply, not rain on the field (ADR-0006).

## Decisions

### D1. Crops

The crop list for v1 is exactly these six. CIREN `especie_01` values are used to pick sample parcels and for the cropland check.

| Key | Español | English | CIREN `especie_01` | Evergreen | Often under cover / nets |
|---|---|---|---|---|---|
| `cherry` | Cerezo | Cherry | `CEREZO` | no | sometimes (rain covers) |
| `blueberry` | Arándano | Blueberry | `ARANDANO AMERICANO` | no | sometimes (nets, tunnels) |
| `avocado` | Palto | Avocado (Hass) | `PALTO` | **yes** | no |
| `walnut` | Nogal | Walnut | `NOGAL` | no | no |
| `hazelnut` | Avellano europeo | European hazelnut | `AVELLANO` / `AVELLANO EUROPEO` (confirm live) | no | no |
| `table_grape` | Uva de mesa | Table grape | `VID DE MESA` | no | often (overhead plastic or mesh) |

The v0 field-crop list (soy, maize, etc.) and the ADR-0003 D4 Chile list (apple, wine grape, rice, wheat, oats, maize, potato) are **out of v1**.

### D2. Markets

- **Portfolio country:** a portfolio has a country, chosen from the South American countries.
- **Enhanced data tier: Chile.** Chile uses the national sources from ADR-0004 to ADR-0010: CR2MET, RAN, CIREN, DGA, CONAF/GWIS.
- **Standard data tier: every other South American country.** It uses global sources only: ERA5, CHIRPS, Sentinel-2/Landsat, GWIS, GFM.
- **Provenance:** every value shows which tier produced it.
- **Global (later):** a "global" option, using the standard tier anywhere, is planned and shown as *coming later* in v1.
- **Bolivia archived:** the Bolivian sample portfolio, the Bolivian ADR decisions (CHIRPS/MODIS/ERA5-Land
  choices for Santa Cruz) and the 2023/24 Santa Cruz backtest are **archived**. They are not deleted, and
  the patterns they established (source wrappers, provenance, standard tier) remain.

### D3. Zones are circles of 35 km²

- **Size:** a zone is a circle of **35 km²** (radius **3,338 m**), centred on a point. This is about one CR2MET
  cell. It is small enough to separate frost pockets and valleys, and a RAN station is usually within 4–13 km.
- **Default:** every farm gets its own zone, centred on its centroid. A user can instead place a **shared zone** on
  the map; farms whose centroid falls inside it use its settings. If shared zones overlap, the nearest
  centre wins.
- **Peer comparison:** inside the zone circle, the farm's NDVI and NDMI anomalies are also compared with
  **other CIREN orchards of the same crop**. "Whole zone down" is read as weather; "only this farm
  down" is read as management or water. Both appear as drivers. This comparison is *in addition to* the field-vs-its-own-history
  baseline, not a replacement for it.
- **NDVI baseline length:** the zone's `baselineYears` applies to the NDVI baseline only (ADR-0004 D1).

### D4. Rules: crop template → zone → farm, both agronomic and credit

- **Layers:** a crop template sets the defaults, a zone overrides them, and a farm overrides the zone.
  The effective value is the most specific one set. The UI marks overridden values "Custom" and offers a reset.
- **Agronomic rules (per crop, per stage):** stage calendar; risk sensitivity per stage; critical
  temperatures (frost by stage, heat/sunburn); harvest-rain trigger; chill requirement; crop
  coefficient Kc per stage; covered/netted flag; risk weights a, b, c (D6).
- **Credit rules (per crop, editable per farm):** each rule is a *condition → action*. For example:
  - risk ≥ high within N days before an installment → **watch**;
  - abandonment signal → **field visit**;
  - active DGA decree and snowmelt < 70 % of normal → **watch**;
  - burned area intersects the farm → **restructure review**.
- **Audit trail:** every change is versioned with *who* (user or agent), *when*, *what* (path, old, new) and *why*. Agent
  proposals are recorded as such until a person applies them.

### D5. Growth stages (approximate central-Chile calendars)

Each template lists its stages, with month-day windows and per-stage sensitivity (0–1) to each
peril. The windows below are **approximate** and labelled as such in the UI. A zone can shift them,
and the agent (D9) can recommend shifts from history.

| Crop | Stages and indicative windows | Most sensitive peril by stage |
|---|---|---|
| Cherry | dormancy May–Aug · budbreak Aug 15–Sep 10 · bloom Sep 1–Oct 5 · fruit set & growth Oct–Nov · harvest Nov 10–Jan 15 · postharvest Jan–Apr | bloom frost; harvest rain (cracking); low chill in winter; heat at fruit set |
| Blueberry | dormancy Jun–Jul · bloom Aug 15–Oct 15 · fruit growth Oct–Nov · harvest Nov 15–Feb 28 · postharvest Mar–May | bloom frost; heat/sunburn and rain at harvest |
| Avocado | flowering Sep–Nov · fruit set Nov–Dec · fruit growth Dec–Jul (fruit hangs) · harvest Aug–Feb · winter May–Aug | **winter frost on the tree** (asset); water all year; heat at flowering |
| Walnut | dormancy May–Aug · budbreak & bloom Sep 10–Oct 20 · nut growth Nov–Feb · harvest Mar 15–Apr 30 | budbreak frost; summer sunburn (> 35 °C); water |
| Hazelnut | winter bloom Jun–Aug · budbreak Sep–Oct · nut growth Nov–Jan · kernel fill Dec–Feb · harvest Feb 15–Mar 31 | rain/wind at winter pollination; budbreak frost; **drought and heat in kernel fill (often rain-fed in the south)** |
| Table grape | dormancy May–Aug · budbreak Sep · bloom Oct–Nov · berry growth Nov–Dec · harvest Dec–Apr (earlier in the north) | budbreak frost; harvest rain (botrytis); water (north) |

Critical temperatures and harvest-rain amounts come from the sources found in discovery
(`families/chile-crops-perils`, Agroseguros policy sheets). Where unverified, they are labelled approximate.

### D6. Risk formula

Risk is computed **per farm, at its current stage, inside its zone**:

```
C = climate component      (0..1)  current external climate stress, weighted by stage sensitivity:
                                     frost, heat/sunburn, harvest rain, water supply/stress, chill
D = disaster component     (0..1)  natural disasters touching the farm or zone: burned area, flood,
                                     official emergency/scarcity declarations
G = geography component    (0..1)  static vulnerability: frost-pocket position (relative elevation
                                     in the zone, Copernicus DEM), fire recurrence in the zone
                                     (2012–), basin water security (decree history since 2008)

base = 0.5 · (a·C + b·D) / (a + b) + 0.5 · max(C, D)     # one severe peril alone can reach "high"
Risk = 100 · min(1, base · (1 + c·G))                    # geography amplifies, never acts alone
defaults: a = 0.65, b = 0.35, c = 0.30   (per crop; editable per stage, zone and farm)
tiers:    normal < 35 ≤ watch < 60 ≤ high            (ADR-0001 D5)
```

- **Why the max term:** a plain weighted sum would let calm components dilute a catastrophe.
- **Why geography multiplies:** geography is a slowly changing vulnerability; added on its own, it would be a constant offset that never moves.
- **Calibration:** a, b, c and the sensitivities are expert defaults. Calibrating against losses
  (Agroseguros by commune, emergency declarations, the September 2013 frost) is out of v1.
- **Drivers:** every component lists its drivers in plain language, each with value, normal and source. The
  breakdown (C, D, G, a, b, c) is shown on the farm page.
- **Credit context:** risk is shown next to the outstanding balance and the next installment date (ADR-0001 D7).

### D7. Water status ladder (the "irrigation stage")

Each farm gets five water signals, shown in order:

| Rung | Question | Signal |
|---|---|---|
| 1 | Is it irrigated? | CIREN irrigated-area polygon within 500 m (ADR-0010), plus dry-season vigour: an orchard that stays green while rain-fed land in the zone browns |
| 2 | How much water does it need now? | Kc(stage) × ETo, 7-day and 30-day sums |
| 3 | Can the basin supply it? | Active DGA scarcity decree; snowmelt forecast vs 1991–2020 (ADR-0006) |
| 4 | Is it getting enough? | NDMI anomaly vs own history and vs zone peers. Landsat surface temperature minus air temperature as a canopy-heat (thirst) proxy, when a clear Landsat pass exists |
| 5 | Has irrigation stopped? | **Abandonment:** sustained loss of vigour in the dry season vs own history and peers, the strongest asset-risk signal for a lender |

Each rung feeds C (climate/water) or a credit rule, and each shows its provenance.

### D8. Imagery: temporal interpolation + AI super-resolution

1. **Interpolation.**
   - Sentinel-2 L2A, SCL-masked, is stacked per 10 m pixel over the farm's bounding box for the 13-month window.
   - Each pixel series is smoothed and gap-filled (Whittaker, ADR-0007) to produce **an NDVI image for any date** (every 5 days).
   - Every frame records its kind (`observed` or `interpolated`) and **days to the nearest clear observation**, shown as confidence.
2. **AI super-resolution.** An open pretrained Sentinel-2 super-resolution model upscales frames from 10 m to about 2.5 m for **display**.
   - The model is chosen in the build by a time-boxed evaluation of quality, speed on an Apple-silicon laptop, and licence.
   - **Fallback:** if no model is feasible, plain resampling is used, labelled "resampled, not AI".
3. **Trust rule.**
   - Every metric (NDVI scores, anomalies, risk, water status) is computed from the **native 10 m data**, never from AI pixels.
   - Frames are labelled *observed*, *interpolated* or *AI-enhanced*.
   - Covered or netted orchards carry a warning that NDVI reads the cover.
4. **Viewer.** A per-farm time-lapse with a slider, NDVI or true-colour toggle, a per-pixel vigour map clipped to the polygon, and stage bands under the slider.

### D9. Farming agent: chat panel in the app

- **What it is:** a side panel, e.g. "Suggest settings for this zone", backed by a Claude tool-use loop in the service.
- **Tools:** zone or farm history, events, crop templates, and a **backtest(params)** that reports hits and false alarms on known events (September 2013 frost, February 2023 fires, decree periods) across past years.
- **Output:** recommended stage-window shifts, critical temperatures, harvest-rain triggers and baseline length, each with evidence.
- **Two rules:** it **never invents values** (every number comes from a tool), and it **only recommends**. "Apply" writes the change through the audit trail as *proposed by agent, applied by user*.
- **Model and key:** the default model is the latest Claude model, and it is configurable. The API key comes from the environment, never from files in the repo. Without a key, the panel says so instead of failing.

### D10. Time window and as-of date

These are unchanged from ADR-0002 D3: a 13-month display window, as-of today or the latest available date, and a per-signal "data as of".

### D11. v1 demo scope (Sunday 9:30)

| Priority | Scope |
|---|---|
| **Must** | Chilean sample portfolio of real CIREN orchards covering all six crops, with loans · crop templates with stages and rules · risk formula D6 with breakdown and drivers · interpolated + AI-enhanced NDVI time-lapse with labels · water status ladder · agent panel recommending frost and harvest-rain settings for one zone with a backtest · provenance on every value · offline snapshot |
| **Should** | Zone peer comparison · editable credit rules with audit trail · South American country selector with standard tier outside Chile · recent-disasters panel for Chile (fires, decrees) |
| **On slides only** | Calibrating a, b, c against losses · global view · production licences · Bolivia (archived) |

## Consequences

- **Superseded:** ADR-0003 D2, D4, D5 and the Bolivian parts of 0004–0010 are superseded or archived. The backlog
  `docs/backlog/v1.md` is superseded by the v1 build scope in D11, wherever they differ.
- **Domain model changes:** a crop template with stages; a zone as a circle (centre + radius); layered agronomic and credit rules with
  an audit trail; risk with C/D/G components; water status; imagery frames.
- **New dependencies:** an AI super-resolution model in the service, and an Anthropic API key at runtime for the agent.
- **Lender story:** "see every orchard cloud-free and sharp; know if it is irrigated, stressed or abandoned;
  know its risk at this growth stage and why; and let the agent tune the rules from history".
