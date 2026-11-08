"""Crop calendars and stress thresholds for Bolivian agriculture.

Santa Cruz lowlands run two campaigns: summer (verano, sown Nov-Dec, harvested Mar-Apr)
and winter (invierno, sown May-Jun, harvested Sep-Oct). Andean valleys farm in the
Nov-Apr rainy season. Weights say how much each hazard matters for that crop.
"""

CROPS = {
    "soy_summer":   {"label": "Soy (summer)",    "es": "Soya (verano)",   "sow": (11, 15), "harvest": (4, 10),
                     "heat": 35, "frost": False, "w": {"water": 3, "dry": 2, "soil": 2, "heat": 1.5, "ndvi": 3, "wet": 1}},
    "soy_winter":   {"label": "Soy (winter)",    "es": "Soya (invierno)", "sow": (5, 10), "harvest": (9, 30),
                     "heat": 35, "frost": True,  "w": {"water": 3, "dry": 2, "soil": 2, "heat": 1, "frost": 1.5, "ndvi": 3, "wet": 0.5}},
    "maize_summer": {"label": "Maize (summer)",  "es": "Maíz (verano)",   "sow": (11, 1), "harvest": (4, 15),
                     "heat": 35, "frost": False, "w": {"water": 3, "dry": 2.5, "soil": 2, "heat": 2, "ndvi": 3, "wet": 1}},
    "sorghum_winter": {"label": "Sorghum (winter)", "es": "Sorgo (invierno)", "sow": (4, 20), "harvest": (9, 15),
                     "heat": 38, "frost": True,  "w": {"water": 2.5, "dry": 1.5, "soil": 2, "heat": 1, "frost": 1.5, "ndvi": 3, "wet": 0.5}},
    "wheat_winter": {"label": "Wheat (winter)",  "es": "Trigo (invierno)", "sow": (5, 1), "harvest": (9, 10),
                     "heat": 32, "frost": True,  "w": {"water": 3, "dry": 2, "soil": 2, "heat": 1.5, "frost": 2, "ndvi": 3, "wet": 0.5}},
    "potato_andean": {"label": "Potato (Andean)", "es": "Papa (altiplano/valles)", "sow": (10, 15), "harvest": (4, 1),
                     "heat": 28, "frost": True,  "w": {"water": 3, "dry": 2, "soil": 1.5, "heat": 1, "frost": 3, "ndvi": 2.5, "wet": 1}},
    "maize_valley": {"label": "Maize (valleys)", "es": "Maíz (valles)",   "sow": (11, 1), "harvest": (5, 1),
                     "heat": 33, "frost": True,  "w": {"water": 3, "dry": 2.5, "soil": 1.5, "heat": 1, "frost": 2, "ndvi": 3, "wet": 1}},
}
