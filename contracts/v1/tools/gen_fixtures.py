"""Generate contracts/v1/fixtures/*.json. Numbers follow CONTRACT.md §E exactly."""
import json, math, os
from datetime import date

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures")
os.makedirs(OUT, exist_ok=True)
AS_OF = "2026-11-07"
FETCHED = "2026-11-07T15:40:00Z"
PERILS = ["frost", "heat", "harvest_rain", "water", "chill", "fire", "flood", "declared_emergency", "abandonment", "vigour"]
CLIMATE = ["frost", "heat", "harvest_rain", "water", "chill", "vigour", "abandonment"]
DISASTER = ["fire", "flood", "declared_emergency"]
ILL = "fixture: illustrative value"


def dump(name, obj):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def prov(source, label, observed, resolution, licence, estimated=False, stale=False, note=None, tier="enhanced"):
    return {"source": source, "sourceLabel": label, "observedAt": observed, "fetchedAt": FETCHED,
            "resolution": resolution, "licenceTier": licence, "dataTier": tier, "stale": stale,
            "estimated": estimated, "note": note}


# ── countries ───────────────────────────────────────────────────────────────
C = [("AR", "Argentina", "Argentina", [-64.0, -34.0], 4), ("BO", "Bolivia", "Bolivia", [-64.7, -16.7], 5),
     ("BR", "Brazil", "Brasil", [-51.9, -14.2], 4), ("CL", "Chile", "Chile", [-71.0, -33.5], 6),
     ("CO", "Colombia", "Colombia", [-74.3, 4.6], 5), ("EC", "Ecuador", "Ecuador", [-78.2, -1.8], 6),
     ("GY", "Guyana", "Guyana", [-58.9, 4.9], 6), ("PY", "Paraguay", "Paraguay", [-58.4, -23.4], 6),
     ("PE", "Peru", "Perú", [-75.0, -9.2], 5), ("SR", "Suriname", "Surinam", [-56.0, 3.9], 7),
     ("UY", "Uruguay", "Uruguay", [-55.8, -32.5], 6), ("VE", "Venezuela", "Venezuela", [-66.6, 6.4], 5)]
countries = [{"code": c, "name": n, "nameEs": es, "dataTier": "enhanced" if c == "CL" else "standard",
              "comingLater": False, "center": ctr, "zoom": z, "defaultCurrency": "CLP" if c == "CL" else "USD"}
             for c, n, es, ctr, z in C]
countries.append({"code": "GLOBAL", "name": "Global", "nameEs": "Global", "dataTier": "standard", "comingLater": True,
                  "center": [0.0, 0.0], "zoom": 2, "defaultCurrency": "USD"})
dump("countries.json", countries)

# ── crop templates ──────────────────────────────────────────────────────────
BASE_SENS = {"fire": 1.0, "flood": 0.8, "declared_emergency": 1.0, "abandonment": 1.0}


def stage(key, label, es, start, end, sens, fc, fs, heat, rain, kc):
    s = {p: 0.0 for p in PERILS}
    s.update(BASE_SENS)
    s.update(sens)
    return ({"key": key, "label": label, "labelEs": es, "start": start, "end": end, "sensitivity": s},
            {"frostCriticalC": fc, "frostSevereC": fs, "heatC": heat, "harvestRainMm72h": rain, "kc": kc})


CREDIT_RULES = [
    {"id": "cr-risk-high-before-installment", "name": "High risk before an installment", "enabled": True,
     "when": {"metric": "risk.tier", "op": "gte", "value": "high", "withinDaysBeforeInstallment": 60, "and": None},
     "then": "watch", "message": "High climate risk within 60 days of an installment: review repayment capacity."},
    {"id": "cr-abandonment", "name": "Abandonment signal", "enabled": True,
     "when": {"metric": "imagery.abandonment", "op": "eq", "value": True, "withinDaysBeforeInstallment": None, "and": None},
     "then": "field_visit", "message": "Vigour lost in the dry season against its own history and its peers: schedule a field visit."},
    {"id": "cr-decree-low-snowmelt", "name": "Water decree and low snowmelt", "enabled": True,
     "when": {"metric": "water.decreeActive", "op": "eq", "value": True, "withinDaysBeforeInstallment": None,
              "and": [{"metric": "water.snowmeltPct", "op": "lt", "value": 70, "withinDaysBeforeInstallment": None}]},
     "then": "watch", "message": "Water-scarcity decree active and snowmelt below 70 % of normal: irrigation supply at risk."},
    {"id": "cr-burned-area", "name": "Burned area on the orchard", "enabled": True,
     "when": {"metric": "events.burnedAreaIntersects", "op": "eq", "value": True, "withinDaysBeforeInstallment": None, "and": None},
     "then": "restructure_review", "message": "A mapped burned area intersects the orchard: asset damage likely, open a restructuring review."},
]

SRC_FROST = "FAO Frost Protection Vol. 1 (2005), Tables 4.7–4.9, after Proebsting & Mills (1978): critical temperatures T10/T90"
SRC_KC = "FAO-56 (Allen et al. 1998), Table 12: crop coefficients Kc"
SRC_AGRO = "Agroseguros subsidised policy sheets distributed by INDAP (2016–2022): frost and 'lluvia mayor' definitions"
SRC_CAL = "ADR-0013 D5: approximate central-Chile stage calendar (not verified against an INIA document)"

crops_def = {
    "cherry": dict(labels={"es": "Cerezo", "en": "Cherry"}, ciren=["CEREZO"], evergreen=False, cover="sometimes",
                   color="#A5463F", chill=500, stages=[
        stage("dormancy", "Dormancy", "Receso invernal", "05-01", "08-14", {"chill": 0.5, "frost": 0.1, "water": 0.2}, -8.0, -12.0, 35, 40, 0.30),
        stage("budbreak", "Budbreak", "Brotación", "08-15", "08-31", {"frost": 0.7, "chill": 0.3, "water": 0.3}, -2.7, -6.2, 35, 40, 0.45),
        stage("bloom", "Bloom", "Floración", "09-01", "10-05", {"frost": 1.0, "heat": 0.3, "water": 0.5, "vigour": 0.2, "harvest_rain": 0.2}, -2.4, -3.9, 30, 30, 0.55),
        stage("fruit_growth", "Fruit set and growth", "Cuaja y crecimiento de fruto", "10-06", "11-09", {"frost": 0.6, "heat": 0.6, "water": 0.8, "vigour": 0.6, "harvest_rain": 0.4}, -2.2, -3.6, 32, 20, 0.85),
        stage("harvest", "Harvest", "Cosecha", "11-10", "01-15", {"harvest_rain": 1.0, "heat": 0.7, "water": 0.8, "vigour": 0.6, "frost": 0.1}, -2.0, -3.5, 35, 20, 0.95),
        stage("postharvest", "Postharvest", "Postcosecha", "01-16", "04-30", {"water": 0.6, "heat": 0.4, "vigour": 0.8}, -3.0, -6.0, 35, 40, 0.70)],
                   extra=["Chill requirement: trade/INIA-derived ranges (Lapins 400–500 h, Santina 600–800 h)"]),
    "blueberry": dict(labels={"es": "Arándano", "en": "Blueberry"}, ciren=["ARANDANO AMERICANO"], evergreen=False, cover="sometimes",
                      color="#3A5BA5", chill=400, stages=[
        stage("dormancy", "Dormancy", "Receso invernal", "06-01", "08-14", {"chill": 0.5, "frost": 0.1, "water": 0.2}, -6.1, -9.0, 35, 40, 0.30),
        stage("bloom", "Bloom", "Floración", "08-15", "10-15", {"frost": 1.0, "water": 0.5, "heat": 0.2, "vigour": 0.2}, -1.0, -2.2, 32, 30, 0.50),
        stage("fruit_growth", "Fruit growth", "Crecimiento de fruto", "10-16", "11-14", {"frost": 0.6, "heat": 0.6, "water": 0.8, "vigour": 0.6, "harvest_rain": 0.3}, -1.3, -2.5, 32, 25, 0.85),
        stage("harvest", "Harvest", "Cosecha", "11-15", "02-28", {"harvest_rain": 0.8, "heat": 0.8, "water": 0.9, "vigour": 0.6}, -1.3, -2.5, 32, 20, 1.05),
        stage("postharvest", "Postharvest", "Postcosecha", "03-01", "05-31", {"water": 0.5, "vigour": 0.6, "heat": 0.3}, -3.0, -6.0, 35, 40, 0.50)],
                      extra=["Agroseguros: blueberry frost cover starts at fruit set (Region VIII from 1 Oct); south of Chillán, farms without frost control are uninsurable"]),
    "avocado": dict(labels={"es": "Palto", "en": "Avocado (Hass)"}, ciren=["PALTO"], evergreen=True, cover="rarely",
                    color="#5F8F3E", chill=0, stages=[
        stage("winter", "Winter (fruit on tree, harvest starts)", "Invierno (fruta en el árbol, inicio de cosecha)", "05-01", "08-31", {"frost": 1.0, "water": 0.6, "vigour": 0.3}, -1.6, -3.5, 35, 40, 0.60),
        stage("flowering", "Flowering (harvest ongoing)", "Floración (cosecha en curso)", "09-01", "10-31", {"heat": 1.0, "frost": 0.6, "water": 0.8, "vigour": 0.3}, -1.1, -2.5, 35, 40, 0.75),
        stage("fruit_set", "Fruit set", "Cuaja", "11-01", "12-31", {"heat": 0.9, "water": 0.9, "vigour": 0.5, "frost": 0.2}, -1.1, -2.5, 35, 40, 0.85),
        stage("fruit_growth", "Fruit growth (harvest ends Feb)", "Crecimiento de fruto (cosecha termina en feb.)", "01-01", "04-30", {"water": 1.0, "heat": 0.6, "vigour": 0.8}, -1.6, -3.5, 35, 40, 0.85)],
                    extra=["Freezing point of Hass fruit −1.6 °C (FAO Frost Protection, Table 4.9)"]),
    "walnut": dict(labels={"es": "Nogal", "en": "Walnut"}, ciren=["NOGAL"], evergreen=False, cover="rarely",
                   color="#8A6B4E", chill=700, stages=[
        stage("dormancy", "Dormancy", "Receso invernal", "05-01", "09-09", {"chill": 0.5, "frost": 0.1, "water": 0.1}, -10.0, -15.0, 35, 40, 0.30),
        stage("budbreak_bloom", "Budbreak and bloom", "Brotación y floración", "09-10", "10-20", {"frost": 1.0, "water": 0.5, "vigour": 0.2}, -1.1, -2.8, 35, 40, 0.50),
        stage("nut_growth", "Nut growth", "Crecimiento de nuez", "10-21", "03-14", {"heat": 0.9, "water": 1.0, "vigour": 0.7, "frost": 0.3}, -1.1, -2.8, 35, 40, 1.10),
        stage("harvest", "Harvest", "Cosecha", "03-15", "04-30", {"harvest_rain": 0.6, "water": 0.4, "vigour": 0.4}, -2.0, -4.0, 35, 30, 0.65)],
                   extra=["Sunburn above 35 °C (chile-crops-perils notes); chill requirement approximate"]),
    "hazelnut": dict(labels={"es": "Avellano europeo", "en": "European hazelnut"}, ciren=["AVELLANO", "AVELLANO EUROPEO"], evergreen=False, cover="rarely",
                     color="#B89B3E", chill=800, stages=[
        stage("winter_bloom", "Winter bloom (pollination)", "Floración invernal (polinización)", "06-01", "08-31", {"harvest_rain": 0.4, "chill": 0.5, "frost": 0.2}, -6.0, -10.0, 35, 30, 0.30),
        stage("budbreak", "Budbreak", "Brotación", "09-01", "10-31", {"frost": 1.0, "water": 0.4, "vigour": 0.2}, -2.0, -4.0, 35, 40, 0.50),
        stage("nut_growth", "Nut growth", "Crecimiento de fruto", "11-01", "11-30", {"water": 0.8, "heat": 0.6, "vigour": 0.6, "frost": 0.3}, -1.5, -3.0, 32, 40, 0.90),
        stage("kernel_fill", "Kernel fill", "Llenado de grano", "12-01", "02-14", {"water": 1.0, "heat": 1.0, "vigour": 0.8}, -1.5, -3.0, 32, 40, 1.05),
        stage("harvest", "Harvest", "Cosecha", "02-15", "03-31", {"harvest_rain": 0.5, "water": 0.5, "vigour": 0.4}, -2.0, -4.0, 35, 30, 0.65),
        stage("postharvest", "Postharvest", "Postcosecha", "04-01", "05-31", {"water": 0.3, "vigour": 0.5}, -3.0, -6.0, 35, 40, 0.50)],
                     extra=["Hazelnut is not in FAO-56 Table 12: Kc approximated from walnut", "harvest_rain in winter_bloom stands for damaging rain at pollination"]),
    "table_grape": dict(labels={"es": "Uva de mesa", "en": "Table grape"}, ciren=["VID DE MESA"], evergreen=False, cover="often",
                        color="#7A5AA6", chill=150, stages=[
        stage("dormancy", "Dormancy", "Receso invernal", "05-01", "08-31", {"chill": 0.5, "frost": 0.1, "water": 0.1}, -10.6, -19.4, 35, 40, 0.15),
        stage("budbreak", "Budbreak", "Brotación", "09-01", "09-30", {"frost": 1.0, "water": 0.4, "vigour": 0.1, "chill": 0.2}, -2.2, -5.6, 35, 40, 0.30),
        stage("bloom", "Bloom", "Floración", "10-01", "11-15", {"frost": 0.8, "heat": 0.5, "water": 0.7, "vigour": 0.4, "harvest_rain": 0.3}, -1.1, -2.2, 35, 15, 0.60),
        stage("berry_growth", "Berry growth", "Crecimiento de baya", "11-16", "12-14", {"water": 0.9, "heat": 0.7, "vigour": 0.6, "harvest_rain": 0.4, "frost": 0.2}, -1.1, -2.2, 35, 10, 0.85),
        stage("harvest", "Harvest", "Cosecha", "12-15", "04-30", {"harvest_rain": 1.0, "water": 0.8, "heat": 0.6, "vigour": 0.6}, -1.5, -3.0, 35, 8, 0.65)],
                        extra=["Agroseguros 'lluvia mayor' for table grape: white 8 mm, red 12 mm, Flame Seedless 5 mm, veraison to end of harvest"]),
}

templates = []
for crop, d in crops_def.items():
    templates.append({
        "crop": crop, "labels": d["labels"], "cirenEspecie": d["ciren"], "evergreen": d["evergreen"],
        "coveredDefault": False, "coverLikelihood": d["cover"], "color": d["color"],
        "stages": [s for s, _ in d["stages"]],
        "rules": {"stages": {s["key"]: t for s, t in d["stages"]}, "chillHoursMin": d["chill"], "baselineYears": 5},
        "weights": {"a": 0.65, "b": 0.35, "c": 0.30},
        "creditRules": CREDIT_RULES,
        "sources": [SRC_FROST, SRC_KC, SRC_AGRO, SRC_CAL] + d["extra"],
        "approximate": True,
    })
dump("crops.json", templates)
TPL = {t["crop"]: t for t in templates}


# check tiling
def doy(md):
    return date(2025, int(md[:2]), int(md[3:])).timetuple().tm_yday


for t in templates:
    cover = [0] * 366
    for s in t["stages"]:
        a, b = doy(s["start"]), doy(s["end"])
        days = list(range(a, b + 1)) if a <= b else list(range(a, 366)) + list(range(1, b + 1))
        for x in days:
            cover[x] += 1
    bad = [i for i in range(1, 366) if cover[i] != 1]
    assert not bad, (t["crop"], bad[:5])


# ── geometry helpers ────────────────────────────────────────────────────────
def area_centroid(ring):
    lat0 = sum(p[1] for p in ring) / len(ring)
    kx = 111320 * math.cos(math.radians(lat0)); ky = 110540
    pts = [(x * kx, y * ky) for x, y in ring]
    A = cx = cy = 0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        c = x1 * y2 - x2 * y1
        A += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c
    A /= 2
    cx /= (6 * A); cy /= (6 * A)
    return abs(A) / 1e4, [round(cx / kx, 6), round(cy / ky, 6)]


REQ_RING = [[-70.80403, -34.28413], [-70.80258, -34.28458], [-70.80187, -34.28327], [-70.80331, -34.2828], [-70.80403, -34.28413]]
OVA_RING = [[-71.24342, -30.58173], [-71.24252, -30.58386], [-71.24122, -30.58411], [-71.24005, -30.58401], [-71.24096, -30.58178], [-71.24342, -30.58173]]
req_ha, req_c = area_centroid(REQ_RING)
ova_ha, ova_c = area_centroid(OVA_RING)
print("areas", req_ha, req_c, ova_ha, ova_c)

# ── portfolio ───────────────────────────────────────────────────────────────
REQ, OVA = "cl-requinoa-cherry", "cl-ovalle-table-grape"
ova_inst = [{"dueDate": d, "amount": 30000.0} for d in ["2025-11-30", "2026-05-31", "2026-11-30", "2027-05-31", "2027-11-30", "2028-05-31"]]
req_inst = [{"dueDate": "2027-01-31", "amount": 60000.0}, {"dueDate": "2028-01-31", "amount": 60000.0}]
farms = [
    {"id": REQ, "name": "Requínoa cherries", "crop": "cherry",
     "polygon": {"type": "Polygon", "coordinates": [REQ_RING]}, "areaHa": round(req_ha, 2), "centroid": req_c,
     "zoneId": "auto-" + REQ, "covered": None, "irrigatedDeclared": None, "plantingYear": None,
     "ciren": {"especie": "CEREZO", "variedad": None, "sourceLayer": "CATASTRO_FRUTICOLA/61", "objectId": 22722},
     "overrides": {"rules": {"stages": {"bloom": {"frostCriticalC": -2.0}}}},
     "creditRuleOverrides": {"cr-risk-high-before-installment": {"when": {"withinDaysBeforeInstallment": 90}}},
     "loan": {"originationDate": "2026-07-01", "maturityDate": "2028-01-31", "amount": 120000.0, "currency": "USD",
              "scheduleType": "custom", "installments": req_inst}},
    {"id": OVA, "name": "Ovalle table grapes", "crop": "table_grape",
     "polygon": {"type": "Polygon", "coordinates": [OVA_RING]}, "areaHa": round(ova_ha, 2), "centroid": ova_c,
     "zoneId": "auto-" + OVA, "covered": None, "irrigatedDeclared": True, "plantingYear": None,
     "ciren": {"especie": "VID DE MESA", "variedad": None, "sourceLayer": "CATASTRO_FRUTICOLA/58", "objectId": 663},
     "overrides": {}, "creditRuleOverrides": {},
     "loan": {"originationDate": "2025-06-01", "maturityDate": "2028-05-31", "amount": 180000.0, "currency": "USD",
              "scheduleType": "semiannual", "installments": ova_inst}},
]
zones = [
    {"id": "auto-" + REQ, "name": "Requínoa cherries (own zone)", "center": req_c, "radiusM": 3338, "auto": True, "overrides": {}, "color": None},
    {"id": "auto-" + OVA, "name": "Ovalle table grapes (own zone)", "center": ova_c, "radiusM": 3338, "auto": True,
     "overrides": {"table_grape": {"rules": {"stages": {"harvest": {"harvestRainMm72h": 5}}}}}, "color": None},
]
audit = [
    {"id": "chg-0001", "at": "2026-11-07T15:10:00Z", "actor": {"kind": "user", "name": "Credit analyst"},
     "scope": {"level": "zone", "id": "auto-" + OVA}, "path": "overrides.table_grape.rules.stages.harvest.harvestRainMm72h",
     "oldValue": 8, "newValue": 5, "reason": "Flame Seedless block: Agroseguros 'lluvia mayor' is 5 mm for this variety.",
     "status": "applied", "recommendationId": None},
    {"id": "chg-0002", "at": "2026-11-07T15:12:00Z", "actor": {"kind": "user", "name": "Credit analyst"},
     "scope": {"level": "farm", "id": REQ}, "path": "overrides.rules.stages.bloom.frostCriticalC",
     "oldValue": -2.4, "newValue": -2.0, "reason": "Frost-pocket position at the foot of the slope; be more conservative.",
     "status": "applied", "recommendationId": None},
    {"id": "chg-0003", "at": "2026-11-07T15:13:00Z", "actor": {"kind": "user", "name": "Credit analyst"},
     "scope": {"level": "farm", "id": REQ}, "path": "creditRuleOverrides.cr-risk-high-before-installment.when.withinDaysBeforeInstallment",
     "oldValue": 60, "newValue": 90, "reason": "Harvest-linked repayment: watch earlier.", "status": "applied", "recommendationId": None},
]
portfolio = {"schemaVersion": 1, "id": "sample-cl", "name": "Chile fruit and nut orchards (sample)", "lender": "Banco Valle Andino",
             "country": "CL", "currency": "USD", "createdAt": "2026-11-07T15:00:00Z", "zones": zones, "farms": farms,
             "creditRules": [{"id": "pf-score-80", "name": "Very high score", "enabled": True,
                              "when": {"metric": "risk.score", "op": "gte", "value": 80, "withinDaysBeforeInstallment": None, "and": None},
                              "then": "restructure_review", "message": "Risk score 80 or more: open a restructuring review."}],
             "cropOverrides": {}, "audit": audit}
dump("portfolio-sample.json", portfolio)


# ── risk maths (§E) ─────────────────────────────────────────────────────────
def ramp(v, v0, v1):
    return max(0.0, min(1.0, (v - v0) / (v1 - v0)))


def noisy_or(xs):
    p = 1.0
    for x in xs:
        p *= (1 - x)
    return 1 - p


def tier(score):
    return "high" if score >= 60 else "watch" if score >= 35 else "normal"


def r(x, n=3):
    return round(x, n)


P_CR2 = lambda obs: prov("cr2met_nrt", "CR2MET NRT (CR2, Universidad de Chile)", obs, "0.05° (~5 km)", "unresolved")
P_RAN = lambda obs: prov("ran_station", "Red Agroclimática Nacional station", obs, "station", "unresolved")
P_S2 = lambda obs, est=False, note=None: prov("s2_l2a_pc", "Sentinel-2 L2A (Planetary Computer)", obs, "10 m", "commercial_ok", estimated=est, note=note)
P_DGA = lambda obs, note=None: prov("dga_decrees", "DGA water-scarcity decrees", obs, "province", "unresolved", note=note)
P_SNOW = lambda obs: prov("dga_snowmelt_forecast", "DGA snowmelt volume forecast (Sep–Mar)", obs, "basin", "unresolved", note=ILL)
P_GWIS = lambda obs: prov("gwis_ba", "GWIS burned areas (Copernicus)", obs, "~500 m (MODIS/VIIRS)", "commercial_ok")
P_DEM = prov("cop_dem_glo30", "Copernicus DEM GLO-30", "2021-04-22", "30 m", "commercial_ok")
P_DER = lambda obs, note=None: prov("derived", "Derived (service)", obs, "n/a", "commercial_ok", note=note)


def drv(comp, peril, metric, sev, sens, c, text, value, normal, unit, pv):
    impact = (sens * sev) if comp != "geography" else (c * sev)
    return {"component": comp, "peril": peril, "metric": metric, "severity": r(sev), "sensitivity": sens if comp != "geography" else None,
            "impact": r(impact), "text": text, "value": value, "normal": normal, "unit": unit, "provenance": pv}


def assess_risk(stage_obj, w, climate, disaster, geo, fired, stage_label):
    s = stage_obj["sensitivity"]
    C = noisy_or([d["sensitivity"] * d["severity"] for d in climate])
    D = noisy_or([d["sensitivity"] * d["severity"] for d in disaster])
    G = sum(d["severity"] for d in geo) / len(geo) if geo else 0.0
    a, b, c = w["a"], w["b"], w["c"]
    base = 0.5 * (a * C + b * D) / (a + b) + 0.5 * max(C, D)
    score = round(100 * min(1.0, base * (1 + c * G)), 1)
    st = tier(score)
    floor = "normal"
    order = ["normal", "watch", "high"]
    for f in fired:
        ft = "high" if f["action"] in ("high", "restructure_review") else "watch"
        if order.index(ft) > order.index(floor):
            floor = ft
    final = max(st, floor, key=order.index)
    alld = sorted([d for d in climate + disaster + geo if d["impact"] > 0], key=lambda d: -d["impact"])[:5]
    cd = sorted([d for d in climate + disaster if d["impact"] > 0], key=lambda d: -d["impact"])
    top = cd[0] if cd else None
    headline = f"{stage_label}: {top['text']}" if top and top["impact"] >= 0.1 else f"No significant stress at {stage_label.lower()}."
    formula = (f"base = 0.5·({a:.2f}·{C:.2f} + {b:.2f}·{D:.2f})/({a:.2f}+{b:.2f}) + 0.5·max({C:.2f}, {D:.2f}) = {base:.2f}; "
               f"risk = 100·min(1, {base:.2f}·(1 + {c:.2f}·{G:.2f})) = {score:.1f}")
    comp = lambda key, val, ds: {"key": key, "value": r(val), "drivers": sorted(ds, key=lambda d: -d["impact"])}
    return {"score": score, "scoreTier": st, "tier": final, "stage": {"key": stage_obj["key"], "label": stage_obj["label"]},
            "components": {"climate": comp("climate", C, climate), "disaster": comp("disaster", D, disaster), "geography": comp("geography", G, geo)},
            "weights": w, "formula": formula, "headline": headline, "drivers": alld, "creditActions": fired}


# Ovalle table grape, stage bloom (10-01..11-15)
tg = TPL["table_grape"]; bloom = next(s for s in tg["stages"] if s["key"] == "bloom"); th = tg["rules"]["stages"]["bloom"]
S = bloom["sensitivity"]; W = tg["weights"]
snow_pct = 64; water_x = max(ramp(snow_pct, 90, 40), 0.33)
ova_climate = [
    drv("climate", "water", "water_supply", water_x, S["water"], 0,
        "Snowmelt forecast 64 % of normal for the Limarí basin; canopy moisture slightly below its own normal.", snow_pct, 100, "% of normal", P_SNOW("2026-10-15")),
    drv("climate", "frost", "tmin_7d_min", ramp(4.2, th["frostCriticalC"] + 1, th["frostSevereC"]), S["frost"], 0,
        "Coldest night 4.2 °C on 3 Nov; bloom damage starts at −1.1 °C.", 4.2, th["frostCriticalC"], "°C", P_CR2("2026-11-06")),
    drv("climate", "heat", "tmax_7d_max", ramp(29.8, th["heatC"] - 2, th["heatC"] + 3), S["heat"], 0,
        "Hottest day 29.8 °C; heat stress starts at 35 °C.", 29.8, th["heatC"], "°C", P_CR2("2026-11-06")),
    drv("climate", "harvest_rain", "max_rain_72h", ramp(0.0, 0.5 * th["harvestRainMm72h"], 1.5 * th["harvestRainMm72h"]), S["harvest_rain"], 0,
        "No rain in the last 7 days.", 0.0, th["harvestRainMm72h"], "mm", P_CR2("2026-11-06")),
    drv("climate", "chill", "chill_hours_season", ramp(132, 150, 75), S["chill"], 0,
        "Winter chill 132 h vs 150 h needed (not scored at bloom).", 132, 150, "h", P_CR2("2026-08-31")),
    drv("climate", "vigour", "ndvi_z", ramp(-0.6, -1.0, -2.5), S["vigour"], 0,
        "Vigour (NDVI) 0.6 sd below its own normal for early November.", -0.6, 0, "z", P_S2("2026-11-03")),
    drv("climate", "abandonment", "abandonment_flag", 0.0, S["abandonment"], 0,
        "No abandonment signal in the last dry season.", False, False, None, P_S2("2026-04-30")),
]
ova_disaster = [
    drv("disaster", "declared_emergency", "decree_active", 0.6, S["declared_emergency"], 0,
        "Water-scarcity decree No. 177 covers the Limarí province until 10 Jul 2027.", True, False, None, P_DGA("2026-07-09")),
    drv("disaster", "fire", "burned_area", 0.0, S["fire"], 0, "No burned area mapped in the zone in the last 13 months.", False, False, None, P_GWIS("2026-10-18")),
    drv("disaster", "flood", "flood_footprint", 0.0, S["flood"], 0, "No flood mapped in the zone in the last 13 months.", False, False, None,
        prov("cems_gfm", "Copernicus EMS / GFM flood extent", "2026-11-05", "20 m", "commercial_ok")),
]
c = W["c"]
ova_geo = [
    drv("geography", "frost", "frost_pocket", ramp(4.0, 0, -30), None, c, "Orchard sits 4 m above the zone average: no frost-pocket position.", 4.0, 0, "m", P_DEM),
    drv("geography", "fire", "fire_recurrence", min(1, 1 / 5), None, c, "Burned area in the zone in 1 of the years since 2012.", 1, 5, "years", P_GWIS("2026-10-18")),
    drv("geography", "water", "basin_water_security", min(1, 11 / 10), None, c, "Water-scarcity decrees covered this area in 11 of the years since 2008.", 11, 10, "years", P_DGA("2026-07-09")),
]
ova_fired = [{"ruleId": "cr-decree-low-snowmelt", "action": "watch", "message": CREDIT_RULES[2]["message"]}]
ova_risk = assess_risk(bloom, W, ova_climate, ova_disaster, ova_geo, ova_fired, bloom["label"])
print("ovalle", ova_risk["score"], ova_risk["scoreTier"], ova_risk["tier"], ova_risk["formula"])

# Requínoa cherry, stage fruit_growth (10-06..11-09); farm override bloom frost −2.0 is not used this stage
ch = TPL["cherry"]; fg = next(s for s in ch["stages"] if s["key"] == "fruit_growth"); thc = ch["rules"]["stages"]["fruit_growth"]; Sc = fg["sensitivity"]
req_climate = [
    drv("climate", "heat", "tmax_7d_max", ramp(31.2, thc["heatC"] - 2, thc["heatC"] + 3), Sc["heat"], 0,
        "Hottest day 31.2 °C on 5 Nov; fruit heat stress starts at 32 °C.", 31.2, thc["heatC"], "°C", P_RAN("2026-11-06")),
    drv("climate", "frost", "tmin_7d_min", ramp(3.4, thc["frostCriticalC"] + 1, thc["frostSevereC"]), Sc["frost"], 0,
        "Coldest night 3.4 °C; young fruit damage starts at −2.2 °C.", 3.4, thc["frostCriticalC"], "°C", P_RAN("2026-11-06")),
    drv("climate", "harvest_rain", "max_rain_72h", ramp(2.1, 10, 30), Sc["harvest_rain"], 0,
        "2.1 mm of rain in the wettest 72 h; cracking risk starts near 20 mm.", 2.1, thc["harvestRainMm72h"], "mm", P_CR2("2026-11-06")),
    drv("climate", "water", "water_supply", 0.0, Sc["water"], 0,
        "No scarcity decree; snowmelt forecast 108 % of normal for the Cachapoal.", 108, 100, "% of normal", P_SNOW("2026-10-15")),
    drv("climate", "chill", "chill_hours_season", ramp(862, 500, 250), Sc["chill"], 0,
        "Winter chill 862 h vs 500 h needed.", 862, 500, "h", P_CR2("2026-08-31")),
    drv("climate", "vigour", "ndvi_z", ramp(-0.3, -1.0, -2.5), Sc["vigour"], 0,
        "Vigour (NDVI) close to its own normal for early November.", -0.3, 0, "z", P_S2("2026-11-03")),
    drv("climate", "abandonment", "abandonment_flag", 0.0, Sc["abandonment"], 0,
        "No abandonment signal in the last dry season.", False, False, None, P_S2("2026-04-30")),
]
req_disaster = [
    drv("disaster", "fire", "burned_area", 0.0, Sc["fire"], 0, "No burned area mapped in the zone in the last 13 months.", False, False, None, P_GWIS("2026-10-18")),
    drv("disaster", "flood", "flood_footprint", 0.0, Sc["flood"], 0, "No flood mapped in the zone in the last 13 months.", False, False, None,
        prov("cems_gfm", "Copernicus EMS / GFM flood extent", "2026-11-05", "20 m", "commercial_ok")),
    drv("disaster", "declared_emergency", "decree_active", 0.0, Sc["declared_emergency"], 0, "No active emergency or scarcity decree.", False, False, None, P_DGA("2026-11-07")),
]
req_geo = [
    drv("geography", "frost", "frost_pocket", ramp(-12.0, 0, -30), None, c, "Orchard sits 12 m below the zone average: cold air can pool here.", -12.0, 0, "m", P_DEM),
    drv("geography", "fire", "fire_recurrence", min(1, 2 / 5), None, c, "Burned area in the zone in 2 of the years since 2012.", 2, 5, "years", P_GWIS("2026-10-18")),
    drv("geography", "water", "basin_water_security", min(1, 5 / 10), None, c, "Water-scarcity decrees covered this area in 5 of the years since 2008.", 5, 10, "years", P_DGA("2026-11-07")),
]
req_risk = assess_risk(fg, ch["weights"], req_climate, req_disaster, req_geo, [], fg["label"])
print("requinoa", req_risk["score"], req_risk["scoreTier"], req_risk["tier"], req_risk["formula"])


# ── exposure (§E.8) ─────────────────────────────────────────────────────────
def outstanding(loan, d):
    if d < loan["originationDate"]:
        return 0.0
    plan = loan["installments"] or [{"dueDate": loan["maturityDate"], "amount": loan["amount"]}]
    return max(0.0, round(loan["amount"] - sum(i["amount"] for i in plan if i["dueDate"] <= d), 2))


def next_inst(loan, d):
    plan = loan["installments"] or [{"dueDate": loan["maturityDate"], "amount": loan["amount"]}]
    s = sorted([i for i in plan if i["dueDate"] > d], key=lambda i: i["dueDate"])
    return s[0] if s else None


ova_exp = outstanding(farms[1]["loan"], AS_OF); req_exp = outstanding(farms[0]["loan"], AS_OF)

# ── events ─────────────────────────────────────────────────────────────────
decree = {"id": "dga_decree:177-2026", "kind": "declared_emergency", "title": "Water-scarcity decree No. 177 (Limarí province)",
          "region": "Coquimbo · Limarí", "start": "2026-07-09", "end": "2027-07-10", "severity": "severe", "source": "DGA",
          "evidenceKind": "official_declaration", "geometry": None, "affectedFarmIds": [], "affectedExposure": 0,
          "provenance": P_DGA("2026-07-09", note="Decree list XLS + decree page scrape (ADR-0006)")}
gwis_ring = [[-72.0692, -36.6843], [-72.0642, -36.6792], [-72.0567, -36.6798], [-72.0605, -36.6713], [-72.0564, -36.6697], [-72.0495, -36.665],
             [-72.0573, -36.661], [-72.0602, -36.6553], [-72.067, -36.6536], [-72.0777, -36.6559], [-72.0787, -36.6644], [-72.079, -36.6737],
             [-72.0857, -36.6736], [-72.0857, -36.6828], [-72.0797, -36.6809], [-72.0692, -36.6843]]
gwis = {"id": "gwis:11749494", "kind": "fire", "title": "Wildfire near Chillán (686 ha burned)", "region": "Ñuble · Diguillín",
        "start": "2023-02-08", "end": "2023-02-08", "severity": "severe", "source": "GWIS (Copernicus)", "evidenceKind": "observed_footprint",
        "geometry": {"type": "Polygon", "coordinates": [gwis_ring]}, "affectedFarmIds": [], "affectedExposure": 0,
        "provenance": prov("gwis_ba", "GWIS burned areas (Copernicus)", "2023-02-08", "~500 m (MODIS/VIIRS)", "commercial_ok",
                           note="Perimeter simplified for the fixture")}
emsr = {"id": "cems:EMSR859", "kind": "fire", "title": "Wildfires in the Biobío and Ñuble regions", "region": "Biobío · Ñuble",
        "start": "2026-01-16", "end": None, "severity": "extreme", "source": "Copernicus EMS Rapid Mapping", "evidenceKind": "narrative",
        "geometry": None, "affectedFarmIds": [], "affectedExposure": 0,
        "provenance": prov("cems_activations", "Copernicus EMS activations", "2026-01-16", "n/a", "commercial_ok",
                           note="Activation record; footprint not ingested")}
dump("events.json", [decree, emsr, gwis])

# ── farm assessment (Ovalle) ────────────────────────────────────────────────
def pts(rows, est_idx=()):
    return [{"date": d, "value": v, "p10": a, "p50": b, "p90": cc, "estimated": (i in est_idx)} for i, (d, v, a, b, cc) in enumerate(rows)]


series = {
    "ndvi": {"variable": "ndvi", "unit": "index", "points": pts([("2026-10-24", 0.41, 0.38, 0.45, 0.52), ("2026-10-29", 0.43, 0.40, 0.47, 0.54),
                                                                ("2026-11-03", 0.44, 0.42, 0.49, 0.56)], est_idx=(1,)),
             "provenance": P_S2("2026-11-03", note="2026-10-29 is gap-filled (Whittaker); baseline 5 seasons")},
    "ndmi": {"variable": "ndmi", "unit": "index", "points": pts([("2026-10-24", 0.08, 0.07, 0.12, 0.17), ("2026-10-29", 0.08, 0.08, 0.13, 0.18),
                                                                ("2026-11-03", 0.09, 0.08, 0.13, 0.18)], est_idx=(1,)),
             "provenance": P_S2("2026-11-03")},
    "precip": {"variable": "precip", "unit": "mm", "points": pts([("2026-11-04", 0.0, 0.0, 0.0, 0.1), ("2026-11-05", 0.0, 0.0, 0.0, 0.1),
                                                                  ("2026-11-06", 0.0, 0.0, 0.0, 0.1)]), "provenance": P_CR2("2026-11-06")},
    "tmin": {"variable": "tmin", "unit": "°C", "points": pts([("2026-11-04", 6.1, 4.0, 6.9, 9.3), ("2026-11-05", 5.4, 4.0, 7.0, 9.4),
                                                              ("2026-11-06", 7.0, 4.1, 7.0, 9.4)]), "provenance": P_CR2("2026-11-06")},
    "tmax": {"variable": "tmax", "unit": "°C", "points": pts([("2026-11-04", 27.9, 21.8, 25.1, 28.4), ("2026-11-05", 29.8, 21.9, 25.2, 28.5),
                                                              ("2026-11-06", 28.6, 21.9, 25.2, 28.5)]), "provenance": P_CR2("2026-11-06")},
    "eto": {"variable": "eto", "unit": "mm", "points": pts([("2026-11-04", 4.0, 3.4, 4.0, 4.6), ("2026-11-05", 4.3, 3.4, 4.0, 4.6),
                                                            ("2026-11-06", 4.1, 3.5, 4.1, 4.7)]),
            "provenance": prov("derived", "FAO-56 Hargreaves from CR2MET Tmin/Tmax", "2026-11-06", "0.05° (~5 km)", "unresolved", estimated=True,
                               note="Hargreaves ETo (no radiation/wind inputs)")},
}
eto7 = 28.4
water = {
    "irrigated": {"value": "yes", "evidence": "Declared irrigated by the lender; CIREN irrigated-area polygon within 500 m (HIDRICO_PUBLICO).",
                  "provenance": prov("ciren_riego", "CIREN irrigated areas (HIDRICO_PUBLICO)", "2022-01-01", "polygon", "unresolved")},
    "demand": {"kc": th["kc"], "eto7dMm": eto7, "need7dMm": round(th["kc"] * eto7, 1), "need30dMm": round(th["kc"] * 117.0, 1),
               "provenance": P_DER("2026-11-06", note="ETc = Kc(bloom) × ETo")},
    "supply": {"decreeActive": True, "decreeId": "DGA decree No. 177 of 9 Jul 2026", "decreeUntil": "2027-07-10", "snowmeltPctOfNormal": snow_pct,
               "basin": "Limarí", "provenance": P_DGA("2026-07-09", note="Snowmelt % is " + ILL)},
    "stress": {"ndmiZ": -0.8, "ndmiPeerDelta": -0.2, "canopyMinusAirC": None, "level": "mild",
               "provenance": P_S2("2026-11-03", note="No clear Landsat pass in the last 16 days for canopy temperature")},
    "abandonment": {"flag": False, "confidence": "high", "evidence": "Dry-season 2025–26 NDVI stayed within 1 sd of its own history and of 7 peers.",
                    "provenance": P_S2("2026-04-30")},
}
peers = {"zoneId": "auto-" + OVA, "nPeers": 7, "farmNdviZ": -0.6, "peerMedianNdviZ": -0.5, "farmNdmiZ": -0.8, "peerMedianNdmiZ": -0.6,
         "reading": "normal", "provenance": prov("ciren_catastro", "CIREN Catastro Frutícola + Sentinel-2 L2A", "2026-11-03", "10 m", "unresolved")}
stage_bands = [
    {"stage": "berry_growth", "label": "Berry growth", "start": "2025-11-16", "end": "2025-12-14"},
    {"stage": "harvest", "label": "Harvest", "start": "2025-12-15", "end": "2026-04-30"},
    {"stage": "dormancy", "label": "Dormancy", "start": "2026-05-01", "end": "2026-08-31"},
    {"stage": "budbreak", "label": "Budbreak", "start": "2026-09-01", "end": "2026-09-30"},
    {"stage": "bloom", "label": "Bloom", "start": "2026-10-01", "end": "2026-11-07"},
]
# window 2025-10-07..2026-11-07: first band is bloom of previous season, clipped
stage_bands.insert(0, {"stage": "bloom", "label": "Bloom", "start": "2025-10-07", "end": "2025-11-15"})
fa = {"farmId": OVA, "asOf": AS_OF, "zoneId": "auto-" + OVA, "dataTier": "enhanced", "risk": ova_risk, "water": water, "peers": peers,
      "series": series, "nextInstallment": next_inst(farms[1]["loan"], AS_OF), "exposure": ova_exp, "stageBands": stage_bands,
      "dataAsOf": {"ndvi": "2026-11-03", "ndmi": "2026-11-03", "precip": "2026-11-06", "tmin": "2026-11-06", "tmax": "2026-11-06",
                   "eto": "2026-11-06", "imagery": "2026-11-03", "events": "2026-11-07", "water_supply": "2026-10-15"},
      "warnings": ["Fixture: series are truncated to 3 points; real responses cover the 13 months ending asOf."]}
dump(f"assessment-farm-{OVA}.json", fa)

# ── portfolio assessment ────────────────────────────────────────────────────
ranked_src = [(farms[1], ova_risk, ova_exp), (farms[0], req_risk, req_exp)]
ranked_src.sort(key=lambda t: (-t[1]["score"], -t[2]))
ranked = [{"farmId": f["id"], "name": f["name"], "crop": f["crop"], "zoneId": f["zoneId"], "score": rk["score"], "tier": rk["tier"],
           "exposure": e, "headline": rk["headline"], "stage": rk["stage"], "nextInstallment": next_inst(f["loan"], AS_OF)} for f, rk, e in ranked_src]
by_tier = {t: 0.0 for t in ["normal", "watch", "high"]}; n_tier = {t: 0 for t in by_tier}
for x in ranked:
    by_tier[x["tier"]] += x["exposure"]; n_tier[x["tier"]] += 1
stressed = lambda x: x["exposure"] if x["tier"] in ("watch", "high") else 0.0
dec_p = dict(decree); dec_p["affectedFarmIds"] = [OVA]; dec_p["affectedExposure"] = ova_exp
pa = {"portfolioId": "sample-cl", "asOf": AS_OF, "currency": "USD", "totalExposure": ova_exp + req_exp, "exposureByTier": by_tier, "farmsByTier": n_tier,
      "ranked": ranked,
      "byCrop": [{"crop": x["crop"], "farms": 1, "exposure": x["exposure"], "stressedExposure": stressed(x)} for x in sorted(ranked, key=lambda x: x["crop"])],
      "byZone": [{"zoneId": x["zoneId"], "farms": 1, "exposure": x["exposure"], "stressedExposure": stressed(x)} for x in sorted(ranked, key=lambda x: x["zoneId"])],
      "events": [dec_p], "creditActions": [dict(farmId=OVA, **a) for a in ova_fired], "warnings": []}
dump("assessment-portfolio.json", pa)

# ── imagery ────────────────────────────────────────────────────────────────
pad_lat = 20 / 110540; pad_lng = 20 / (111320 * math.cos(math.radians(-30.583)))
xs = [p[0] for p in OVA_RING]; ys = [p[1] for p in OVA_RING]
bbox = [round(min(xs) - pad_lng, 6), round(min(ys) - pad_lat, 6), round(max(xs) + pad_lng, 6), round(max(ys) + pad_lat, 6)]
u = lambda d, layer: f"/files/imagery/{OVA}/{d}_{layer}.png"
imagery = {"farmId": OVA, "bbox": bbox, "crs": "EPSG:4326", "nativeResolutionM": 10, "srResolutionM": 2.5,
           "frames": [
               {"date": "2026-10-24", "kind": "observed", "daysToClear": 0, "clearFraction": 0.97, "ndviMean": 0.41, "ndviP10": 0.33, "ndviP90": 0.49,
                "urls": {"ndvi": u("2026-10-24", "ndvi"), "rgb": u("2026-10-24", "rgb"), "ndviSr": u("2026-10-24", "ndvi_sr"), "rgbSr": u("2026-10-24", "rgb_sr")},
                "srKind": "ai", "srModel": "example-s2-sr-x4"},
               {"date": "2026-10-29", "kind": "interpolated", "daysToClear": 5, "clearFraction": None, "ndviMean": 0.43, "ndviP10": 0.35, "ndviP90": 0.51,
                "urls": {"ndvi": u("2026-10-29", "ndvi"), "rgb": None, "ndviSr": u("2026-10-29", "ndvi_sr"), "rgbSr": None},
                "srKind": "ai", "srModel": "example-s2-sr-x4"},
               {"date": "2026-11-03", "kind": "observed", "daysToClear": 0, "clearFraction": 0.92, "ndviMean": 0.44, "ndviP10": 0.36, "ndviP90": 0.52,
                "urls": {"ndvi": u("2026-11-03", "ndvi"), "rgb": u("2026-11-03", "rgb"), "ndviSr": None, "rgbSr": None},
                "srKind": None, "srModel": None},
           ],
           "legend": {"min": 0, "max": 1, "colormap": "rdylgn",
                      "stops": [[0.0, "#a50026"], [0.2, "#f46d43"], [0.4, "#fee08b"], [0.6, "#a6d96a"], [0.8, "#1a9850"], [1.0, "#006837"]]},
           "coveredWarning": "Table grape orchards are often under overhead plastic or mesh. If this one is covered, NDVI reads the cover, not the vines.",
           "trustNote": "All numbers come from native 10 m Sentinel-2 pixels. AI-enhanced images are for display only.",
           "provenance": P_S2("2026-11-03", note="Fixture truncated to 3 frames; real timelines cover 13 months on a 5-day grid plus every observed date")}
dump(f"imagery-{OVA}.json", imagery)

# ── agent ──────────────────────────────────────────────────────────────────
zid = "auto-" + REQ
agent = {"id": "rec-0001", "zoneId": zid, "farmId": None, "question": "Suggest frost and harvest-rain settings for this zone.",
         "answer": ("**Bloom frost:** keep the trigger at **−2.0 °C** (your farm setting). In the 2013–2025 backtest it caught "
                    "**3 of 3** damaging bloom frosts (incl. September 2013) with **1** false alarm; the template value −2.4 °C caught **2 of 3**.\n\n"
                    "**Harvest rain:** lower the 72 h trigger from **20 mm** to **15 mm**. It adds **2** hits (Nov 2019, Jan 2023 rain on ripe fruit) "
                    "for **1** extra false alarm across 13 harvests.\n\n"
                    "_Every number above comes from the backtest tool. These are recommendations: nothing changes until you apply them._"),
         "proposals": [
             {"id": "chg-p-0001", "at": "2026-11-07T15:30:00Z", "actor": {"kind": "agent", "name": "Farming agent"}, "scope": {"level": "zone", "id": zid},
              "path": "overrides.cherry.rules.stages.bloom.frostCriticalC", "oldValue": -2.4, "newValue": -2.0,
              "reason": "Backtest 2013–2025: 3/3 hits, 1 false alarm at −2.0 °C vs 2/3 hits at −2.4 °C.", "status": "proposed", "recommendationId": "rec-0001"},
             {"id": "chg-p-0002", "at": "2026-11-07T15:30:00Z", "actor": {"kind": "agent", "name": "Farming agent"}, "scope": {"level": "zone", "id": zid},
              "path": "overrides.cherry.rules.stages.harvest.harvestRainMm72h", "oldValue": 20, "newValue": 15,
              "reason": "Backtest 2013–2025: +2 hits, +1 false alarm.", "status": "proposed", "recommendationId": "rec-0001"}],
         "evidence": [
             {"kind": "backtest", "summary": "Bloom frost trigger −2.0 °C vs −2.4 °C, seasons 2013–2025",
              "data": {"param": "rules.stages.bloom.frostCriticalC", "seasons": 13,
                       "candidates": [{"value": -2.4, "hits": 2, "falseAlarms": 0, "missed": 1}, {"value": -2.0, "hits": 3, "falseAlarms": 1, "missed": 0}]}},
             {"kind": "event", "summary": "September 2013 frost (central valley)", "data": {"start": "2013-09-17", "end": "2013-09-20"}}],
         "toolCalls": [
             {"name": "get_crop_template", "input": {"crop": "cherry"}, "outputSummary": "6 stages; bloom frostCriticalC −2.4 °C; harvest rain 20 mm/72 h"},
             {"name": "get_zone_history", "input": {"zoneId": zid, "variables": ["tmin", "precip"], "from": "2013-01-01"}, "outputSummary": "4,693 daily rows, CR2MET"},
             {"name": "list_events", "input": {"zoneId": zid, "since": "2013-01-01"}, "outputSummary": "3 frost events, 4 harvest-rain events"},
             {"name": "backtest", "input": {"zoneId": zid, "crop": "cherry", "params": {"rules.stages.bloom.frostCriticalC": [-2.4, -2.0]}},
              "outputSummary": "−2.0 °C: 3 hits, 1 false alarm; −2.4 °C: 2 hits, 0 false alarms"}],
         "model": "fixture-model", "createdAt": "2026-11-07T15:30:00Z"}
dump("agent-recommendation.json", agent)

# ── health, ciren, manifest, errors ────────────────────────────────────────
dump("health.json", {"status": "ok", "contractVersion": 1, "serviceVersion": "0.1.0", "time": "2026-11-07T16:07:00Z", "agentAvailable": True,
                     "srMode": "ai", "srModel": "example-s2-sr-x4",
                     "sources": [{"source": "cr2met_nrt", "ok": True, "lastFetchedAt": "2026-11-07T15:40:00Z", "stale": False},
                                 {"source": "open_meteo", "ok": False, "lastFetchedAt": "2026-11-06T22:10:00Z", "stale": True}]})
dump("ciren-orchards.json", {"type": "FeatureCollection", "truncated": False, "features": [
    {"type": "Feature", "id": 663, "geometry": {"type": "Polygon", "coordinates": [OVA_RING]},
     "properties": {"objectId": 663, "especie": "VID DE MESA", "crop": "table_grape", "areaHa": round(ova_ha, 2), "comuna": "OVALLE", "sourceLayer": "CATASTRO_FRUTICOLA/58"}}],
    "provenance": prov("ciren_catastro", "CIREN Catastro Frutícola (IDE Minagri)", None, "polygon", "unresolved")})
files = ["manifest.json", "portfolio.json", "crops.json", "countries.json", "assessment-portfolio.json", f"assessment-farm-{REQ}.json",
         f"assessment-farm-{OVA}.json", f"imagery-{REQ}.json", f"imagery-{OVA}.json", "events.json",
         f"imagery/{OVA}/2026-10-24_ndvi.png", f"imagery/{OVA}/2026-10-24_rgb.png", f"imagery/{OVA}/2026-10-24_ndvi_sr.png",
         f"imagery/{OVA}/2026-10-24_rgb_sr.png", f"imagery/{OVA}/2026-10-29_ndvi.png", f"imagery/{OVA}/2026-10-29_ndvi_sr.png",
         f"imagery/{OVA}/2026-11-03_ndvi.png", f"imagery/{OVA}/2026-11-03_rgb.png"]
dump("manifest.json", {"contractVersion": 1, "generatedAt": "2026-11-08T05:30:00Z", "asOf": AS_OF, "portfolioId": "sample-cl",
                       "portfolioName": portfolio["name"], "farmIds": [REQ, OVA], "files": files, "imageryFrames": 3,
                       "warnings": ["Fixture: the Requínoa imagery PNGs are omitted from this list for brevity."]})
dump("errors.json", [
    {"error": "invalid_request", "detail": "body.portfolio.farms[0].polygon: exterior ring is not closed"},
    {"error": "bbox_too_large", "detail": "bbox spans 0.80° × 0.50°; maximum is 0.25° per side"},
    {"error": "not_found", "detail": "farmId 'cl-nope' is not in portfolio 'sample-cl'"},
    {"error": "no_api_key", "detail": "ANTHROPIC_API_KEY is not set; the farming agent is unavailable"}])
print("done")
