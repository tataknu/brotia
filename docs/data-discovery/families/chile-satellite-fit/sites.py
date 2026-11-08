"""Chile test locations and ~50 ha square polygons (approx 707 m x 707 m)."""
import math
SITES = [
    ("quillota_avocado", "avocado", -71.25, -32.88),
    ("ovalle_table_grape", "table grape", -71.20, -30.60),
    ("requinoa_cherry", "cherry", -70.80, -34.28),
    ("colchagua_wine", "wine grape", -71.37, -34.64),
    ("curico_apple_cherry", "apple/cherry", -71.24, -34.98),
    ("talca_vineyard", "wine grape", -71.66, -35.43),
    ("parral_rice", "rice", -71.83, -36.14),
    ("chillan_blueberry", "blueberry", -72.10, -36.60),
    ("losangeles_maize_wheat", "maize/wheat", -72.35, -37.47),
    ("temuco_wheat_oats", "wheat/oats", -72.60, -38.74),
    ("osorno_potato", "potato", -73.13, -40.57),
]

def poly(lon, lat, ha=50.0):
    side_m = math.sqrt(ha * 1e4)
    dlat = side_m / 2 / 111320.0
    dlon = side_m / 2 / (111320.0 * math.cos(math.radians(lat)))
    return {"type": "Polygon", "coordinates": [[[lon-dlon, lat-dlat], [lon+dlon, lat-dlat], [lon+dlon, lat+dlat], [lon-dlon, lat+dlat], [lon-dlon, lat-dlat]]]}
