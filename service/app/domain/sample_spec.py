"""The Chilean sample portfolio "CLSF1 · Chile Specialty Fruit Credit I" (ADR-0013 D11, names ADR-0026 D6): lender-side data.

Orchard GEOMETRY and CIREN attributes are real (service/data/sample_portfolio_cl.geojson, fetched live from
CIREN by `python -m app.domain.build_sample`). Everything here is the lender's side and is ILLUSTRATIVE: the
bank, the farm names, the loans and the rule edits are made up, not records of real borrowers. CIREN
polygons carry no owner, variety or planting year, so those stay null (never invented).

Orchards were chosen on 2026-11-07 among CIREN polygons of the right species, 2–30 ha, compact, a few km
outside town centres (see build_sample.py for the selection report).
"""

from __future__ import annotations

PORTFOLIO_ID = "sample-cl"
PORTFOLIO_NAME = "Chile Specialty Fruit Credit I"
PORTFOLIO_CODE = "CLSF1"
LENDER = "Banco Valle Andino"  # fictional
COUNTRY = "CL"
CURRENCY = "USD"
CREATED_AT = "2026-11-07T15:00:00Z"
GEOJSON_NAME = "sample_portfolio_cl.geojson"
DESCRIPTION = ("12 real CIREN orchards from Atacama to Biobío, two per crop (cherry, blueberry, avocado, walnut, hazelnut, "
               "table grape), each with an illustrative loan.")

#: (farm id, display name, crop, CIREN layer id, CIREN objectid, loan spec, extra farm fields)
#: Loan spec: schedule type, origination, maturity, amount (USD), harvest date (at_harvest) or custom installments.
FARMS: list[dict] = [
    {
        "id": "cl-requinoa-cherry", "name": "Requínoa cherries", "crop": "cherry", "layer": 61, "objectId": 22722,
        "loan": {"type": "custom", "origination": "2026-07-01", "maturity": "2028-01-31", "amount": 120000,
                 "installments": [{"dueDate": "2027-01-31", "amount": 60000}, {"dueDate": "2028-01-31", "amount": 60000}]},
        "overrides": {"rules": {"stages": {"bloom": {"frostCriticalC": -2.0}}}},
        "creditRuleOverrides": {"cr-risk-high-before-installment": {"when": {"withinDaysBeforeInstallment": 90}}},
        "note": "Seasonal credit repaid after two harvests.",
    },
    {
        "id": "cl-curico-cherry", "name": "Curicó cherries (new planting)", "crop": "cherry", "layer": 62, "objectId": 6545,
        "loan": {"type": "custom", "origination": "2024-08-01", "maturity": "2030-01-31", "amount": 260000,
                 "installments": [{"dueDate": "2028-01-31", "amount": 86000}, {"dueDate": "2029-01-31", "amount": 87000},
                                  {"dueDate": "2030-01-31", "amount": 87000}]},
        "note": "Establishment loan: 3.5 years of grace until the orchard bears, then three annual payments after harvest.",
    },
    {
        "id": "cl-chillan-blueberry", "name": "Chillán blueberries", "crop": "blueberry", "layer": 63, "objectId": 989,
        "loan": {"type": "at_harvest", "origination": "2026-07-15", "maturity": "2027-03-31", "amount": 60000,
                 "harvestDate": "2027-02-15"},
        "note": "Working capital for the 2026-27 season, repaid at harvest.",
    },
    {
        "id": "cl-los-angeles-blueberry", "name": "Los Ángeles blueberries", "crop": "blueberry", "layer": 64, "objectId": 1280,
        "loan": {"type": "quarterly", "origination": "2026-03-01", "maturity": "2028-03-01", "amount": 260000},
        "note": "Netting and drip upgrade, quarterly instalments.",
    },
    {
        "id": "cl-quillota-avocado", "name": "Quillota hillside avocados", "crop": "avocado", "layer": 59, "objectId": 12007,
        "loan": {"type": "semiannual", "origination": "2024-09-01", "maturity": "2029-09-01", "amount": 900000},
        "note": "Five-year loan for hillside replanting and irrigation.",
    },
    {
        "id": "cl-cabildo-avocado", "name": "Cabildo avocados (Petorca)", "crop": "avocado", "layer": 59, "objectId": 2674,
        "loan": {"type": "at_harvest", "origination": "2026-06-01", "maturity": "2027-10-31", "amount": 140000,
                 "harvestDate": "2027-09-30"},
        "note": "Seasonal credit in the Petorca province, a basin with a long water-decree history.",
    },
    {
        "id": "cl-requinoa-walnut", "name": "Requínoa walnuts", "crop": "walnut", "layer": 61, "objectId": 15328,
        "loan": {"type": "at_harvest", "origination": "2026-09-01", "maturity": "2027-05-31", "amount": 220000,
                 "harvestDate": "2027-04-30"},
        "note": "Working capital, repaid after the March–April harvest.",
    },
    {
        "id": "cl-paine-walnut", "name": "Paine walnuts (replanting)", "crop": "walnut", "layer": 60, "objectId": 4268,
        "loan": {"type": "custom", "origination": "2023-10-01", "maturity": "2028-04-30", "amount": 110000,
                 "installments": [{"dueDate": "2026-04-30", "amount": 27500}, {"dueDate": "2027-04-30", "amount": 41250},
                                  {"dueDate": "2028-04-30", "amount": 41250}]},
        "note": "Replanting loan with two years of grace.",
    },
    {
        "id": "cl-parral-hazelnut", "name": "Parral hazelnuts (new planting)", "crop": "hazelnut", "layer": 62, "objectId": 3156,
        "loan": {"type": "custom", "origination": "2025-05-01", "maturity": "2032-03-31", "amount": 380000,
                 "installments": [{"dueDate": "2029-03-31", "amount": 95000}, {"dueDate": "2030-03-31", "amount": 95000},
                                  {"dueDate": "2031-03-31", "amount": 95000}, {"dueDate": "2032-03-31", "amount": 95000}]},
        "note": "Seven-year establishment loan; hazelnuts start bearing in year 4.",
    },
    {
        "id": "cl-los-angeles-hazelnut", "name": "Los Ángeles hazelnuts", "crop": "hazelnut", "layer": 64, "objectId": 1286,
        "loan": {"type": "bullet", "origination": "2026-05-15", "maturity": "2027-04-15", "amount": 75000},
        "note": "One-year bullet credit.",
    },
    {
        "id": "cl-ovalle-table-grape", "name": "Ovalle table grapes", "crop": "table_grape", "layer": 58, "objectId": 663,
        "loan": {"type": "semiannual", "origination": "2025-06-01", "maturity": "2028-05-31", "amount": 180000},
        "irrigatedDeclared": True,
        "note": "Three-year loan in the Limarí basin.",
    },
    {
        "id": "cl-copiapo-table-grape", "name": "Copiapó valley table grapes", "crop": "table_grape", "layer": 57, "objectId": 1286,
        "loan": {"type": "quarterly", "origination": "2025-10-01", "maturity": "2028-10-01", "amount": 340000},
        "note": "Overhead-cover structure and drip, quarterly instalments; early northern harvest.",
    },
]

#: Shared zones: centred on the midpoint of the clustered farms' centroids (computed at assembly).
SHARED_ZONES: list[dict] = [
    {"id": "zone-requinoa", "name": "Requínoa valley", "farms": ["cl-requinoa-cherry", "cl-requinoa-walnut"], "color": None},
    {"id": "zone-los-angeles", "name": "Los Ángeles east", "farms": ["cl-los-angeles-blueberry", "cl-los-angeles-hazelnut"], "color": None},
]

#: Zone overrides by zone id (auto zones included).
ZONE_OVERRIDES: dict[str, dict] = {
    "auto-cl-ovalle-table-grape": {"table_grape": {"rules": {"stages": {"harvest": {"harvestRainMm72h": 5}}}}},
}

PORTFOLIO_CREDIT_RULES: list[dict] = [
    {
        "id": "pf-score-80", "name": "Very high score", "enabled": True,
        "when": {"metric": "risk.score", "op": "gte", "value": 80, "withinDaysBeforeInstallment": None, "and": None},
        "then": "restructure_review", "message": "Risk score 80 or more: open a restructuring review.",
    }
]

AUDIT: list[dict] = [
    {
        "id": "chg-0001", "at": "2026-11-07T15:10:00Z", "actor": {"kind": "user", "name": "Credit analyst"},
        "scope": {"level": "zone", "id": "auto-cl-ovalle-table-grape"},
        "path": "overrides.table_grape.rules.stages.harvest.harvestRainMm72h", "oldValue": 8, "newValue": 5,
        "reason": "Flame Seedless block: Agroseguros 'lluvia mayor' is 5 mm for this variety.",
        "status": "applied", "recommendationId": None,
    },
    {
        "id": "chg-0002", "at": "2026-11-07T15:12:00Z", "actor": {"kind": "user", "name": "Credit analyst"},
        "scope": {"level": "farm", "id": "cl-requinoa-cherry"},
        "path": "overrides.rules.stages.bloom.frostCriticalC", "oldValue": -2.4, "newValue": -2.0,
        "reason": "Frost-pocket position at the foot of the slope; be more conservative.",
        "status": "applied", "recommendationId": None,
    },
    {
        "id": "chg-0003", "at": "2026-11-07T15:13:00Z", "actor": {"kind": "user", "name": "Credit analyst"},
        "scope": {"level": "farm", "id": "cl-requinoa-cherry"},
        "path": "creditRuleOverrides.cr-risk-high-before-installment.when.withinDaysBeforeInstallment",
        "oldValue": 60, "newValue": 90, "reason": "Harvest-linked repayment: watch earlier.",
        "status": "applied", "recommendationId": None,
    },
]
