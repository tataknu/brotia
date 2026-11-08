"""The second sample portfolio "CLSO2 · Southern Orchards Credit II" (ADR-0026): lender-side data.

Orchard GEOMETRY and CIREN attributes are real (service/data/sample_portfolio_cl_sur.geojson, fetched live from
CIREN by `python -m app.domain.build_sample --id sample-cl-sur`). Everything here is the lender's side and is
ILLUSTRATIVE: the cooperative, the farm names, the loans and the schedules are made up, not records of real
borrowers. CIREN polygons carry no owner, variety or planting year, so those stay null (never invented).

Same selection rules as sample-cl (ADR-0016 D1): the right especie_01, 2–30 ha, compact, a few km outside town
centres; southern regions (Maule, Ñuble, Biobío; see ADR-0026 for why not La Araucanía). Farm ids start with 'sur-' so they never collide
with sample-cl ids (snapshot and imagery files are keyed by farm id).
"""

from __future__ import annotations

PORTFOLIO_ID = "sample-cl-sur"
PORTFOLIO_NAME = "Southern Orchards Credit II"
PORTFOLIO_CODE = "CLSO2"
LENDER = "Cooperativa Agrícola del Sur"  # fictional
COUNTRY = "CL"
CURRENCY = "USD"
CREATED_AT = "2026-11-07T15:30:00Z"
GEOJSON_NAME = "sample_portfolio_cl_sur.geojson"
DESCRIPTION = ("9 real CIREN orchards in Maule, Ñuble and Biobío (cherry, blueberry, hazelnut, walnut), "
               "with illustrative loans repaid once a year after harvest, in March–April.")

#: Chosen on 2026-11-08 by a fixed rule, before any assessment: among CIREN polygons of the crop that are 2–30 ha,
#: one ring, isoperimetric compactness >= 0.6, >= 3 km from the town centre and inside a CR2MET cell that already has
#: its 1991–2020 baseline, the MOST COMPACT one per (area, crop). Areas: Talca, Parral, Chillán, Los Ángeles.
#: Loan spec as in sample_spec.py. Repayments are annual, after harvest, in March–April.
FARMS: list[dict] = [
    {
        "id": "sur-talca-cherry", "name": "Maule (Talca) cherries", "crop": "cherry", "layer": 62, "objectId": 4200,
        "loan": {"type": "custom", "origination": "2025-06-01", "maturity": "2028-03-15", "amount": 240000,
                 "installments": [{"dueDate": "2026-03-15", "amount": 80000}, {"dueDate": "2027-03-15", "amount": 80000},
                                  {"dueDate": "2028-03-15", "amount": 80000}]},
        "note": "Three annual payments after the December–January harvest.",
    },
    {
        "id": "sur-retiro-walnut", "name": "Retiro walnuts", "crop": "walnut", "layer": 62, "objectId": 17554,
        "loan": {"type": "custom", "origination": "2024-05-01", "maturity": "2029-04-30", "amount": 300000,
                 "installments": [{"dueDate": f"{y}-04-30", "amount": 60000} for y in range(2025, 2030)]},
        "note": "Five-year orchard loan, one payment after each March–April harvest.",
    },
    {
        "id": "sur-parral-blueberry", "name": "Parral blueberries", "crop": "blueberry", "layer": 62, "objectId": 6606,
        "loan": {"type": "at_harvest", "origination": "2026-08-01", "maturity": "2027-03-31", "amount": 45000,
                 "harvestDate": "2027-03-10"},
        "note": "Season working capital, repaid at the end of harvest.",
    },
    {
        "id": "sur-parral-hazelnut", "name": "Parral hazelnuts", "crop": "hazelnut", "layer": 62, "objectId": 3126,
        "loan": {"type": "custom", "origination": "2025-09-01", "maturity": "2029-04-15", "amount": 150000,
                 "installments": [{"dueDate": f"{y}-04-15", "amount": 50000} for y in range(2027, 2030)]},
        "note": "Drip and frost-fan investment, one year of grace, then three payments after harvest.",
    },
    {
        "id": "sur-chillan-blueberry", "name": "Chillán blueberries", "crop": "blueberry", "layer": 63, "objectId": 985,
        "loan": {"type": "custom", "origination": "2026-05-01", "maturity": "2028-03-31", "amount": 70000,
                 "installments": [{"dueDate": "2027-03-31", "amount": 35000}, {"dueDate": "2028-03-31", "amount": 35000}]},
        "note": "Netting replacement, two annual payments.",
    },
    {
        "id": "sur-san-nicolas-hazelnut", "name": "San Nicolás hazelnuts", "crop": "hazelnut", "layer": 63, "objectId": 4478,
        "loan": {"type": "custom", "origination": "2025-05-15", "maturity": "2029-04-30", "amount": 210000,
                 "installments": [{"dueDate": f"{y}-04-30", "amount": 52500} for y in range(2026, 2030)]},
        "note": "Four annual payments after the March–April harvest.",
    },
    {
        "id": "sur-san-nicolas-walnut", "name": "San Nicolás walnuts", "crop": "walnut", "layer": 63, "objectId": 4422,
        "loan": {"type": "at_harvest", "origination": "2026-09-15", "maturity": "2027-05-15", "amount": 90000,
                 "harvestDate": "2027-04-20"},
        "note": "Season working capital, repaid after harvest.",
    },
    {
        "id": "sur-los-angeles-cherry", "name": "Los Ángeles south cherries", "crop": "cherry", "layer": 64, "objectId": 214,
        "loan": {"type": "custom", "origination": "2024-10-01", "maturity": "2029-03-31", "amount": 420000,
                 "installments": [{"dueDate": f"{y}-03-31", "amount": 105000} for y in range(2026, 2030)]},
        "note": "Rain covers and packing shed, four annual payments after harvest.",
    },
    {
        "id": "sur-los-angeles-hazelnut", "name": "Los Ángeles south hazelnuts", "crop": "hazelnut", "layer": 64, "objectId": 182,
        "loan": {"type": "bullet", "origination": "2026-06-01", "maturity": "2027-04-30", "amount": 60000},
        "note": "One-year bullet credit, due after harvest.",
    },
]

#: Shared zones only where the selected farms really fall inside one 35 km² circle (checked by build_sample).
SHARED_ZONES: list[dict] = [
    {"id": "zone-sur-san-nicolas", "name": "San Nicolás north", "farms": ["sur-san-nicolas-hazelnut", "sur-san-nicolas-walnut"],
     "color": None},
    {"id": "zone-sur-los-angeles", "name": "Los Ángeles south", "farms": ["sur-los-angeles-cherry", "sur-los-angeles-hazelnut"],
     "color": None},
]

ZONE_OVERRIDES: dict[str, dict] = {}

PORTFOLIO_CREDIT_RULES: list[dict] = []

AUDIT: list[dict] = []
