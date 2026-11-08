# Chile test locations (lon, lat) - team decision 2026-11-06
FARMS = [
    ("Quillota avocados", -71.25, -32.88),
    ("Ovalle/Limari table grapes", -71.20, -30.60),
    ("Requinoa cherries", -70.80, -34.28),
    ("Santa Cruz (Colchagua) wine grapes", -71.37, -34.64),
    ("Curico apples & cherries", -71.24, -34.98),
    ("Talca vineyards", -71.66, -35.43),
    ("Parral rice", -71.83, -36.14),
    ("Chillan blueberries", -72.10, -36.60),
    ("Los Angeles maize & wheat", -72.35, -37.47),
    ("Temuco wheat & oats", -72.60, -38.74),
    ("Osorno potatoes", -73.13, -40.57),
]
import math
def km(lon1, lat1, lon2, lat2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(a))
