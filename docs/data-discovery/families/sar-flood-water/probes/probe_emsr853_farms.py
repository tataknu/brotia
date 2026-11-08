"""Intersect Copernicus EMS EMSR853 (Dec 2025 Pirai flood, Santa Cruz) observed flood extent with the sample farms.
Inputs: DEL_PRODUCT zips downloaded (keyless) from rapidmapping.emergency.copernicus.eu/backend/EMSR853/AOIxx/DEL_PRODUCT/...
Usage: python probe_emsr853_farms.py <dir_with_zips>"""
import sys, zipfile, json, glob
from shapely.geometry import shape, Point
from shapely.ops import unary_union
from pyproj import Geod
FARMS = {"Estancia Los Tajibos": (-62.52, -16.86), "Agropecuaria Brecha 8": (-62.7, -16.97),
 "Colonia Cuatro Canadas Lote 7": (-62.47, -17.3), "Hacienda El Cusi": (-62.55, -17.38),
 "Agricola Pailon Norte": (-62.68, -17.56), "Granja Las Londras": (-62.76, -17.74),
 "Finca Okinawa Dos": (-62.85, -17.18), "Parcela Okinawa Uno": (-62.93, -17.27),
 "Arrocera Mineros": (-63.29, -17.2), "Canaveral San Antonio": (-63.21, -17.29),
 "Agricola Warnes Sur": (-63.08, -17.56), "Estancia Mineros Norte": (-63.18, -17.03)}
g = Geod(ellps="WGS84")
obs, aois = [], []
for z in sorted(glob.glob(sys.argv[1] + "/EMSR853_*DEL*.zip")):
    zf = zipfile.ZipFile(z)
    for n in zf.namelist():
        if n.endswith(".json") and ("observedEvent" in n or "areaOfInterest" in n):
            gj = json.loads(zf.read(n))
            geoms = [shape(f["geometry"]) for f in gj["features"] if f.get("geometry")]
            (obs if "observedEvent" in n else aois).extend(geoms)
            if "observedEvent" in n:
                print(n, len(geoms), "features; props sample:", {k: v for k, v in gj["features"][0]["properties"].items()} if gj["features"] else None)
O = unary_union(obs); A = unary_union(aois)
area_km2 = abs(g.geometry_area_perimeter(O)[0]) / 1e6
print("observed flood area km2 (union of AOI 02/07/08):", round(area_km2, 1))
for name, (lon, lat) in FARMS.items():
    p = Point(lon, lat)
    near = O.boundary.interpolate(O.boundary.project(p)) if not O.contains(p) else p
    d_km = g.inv(lon, lat, near.x, near.y)[2] / 1000
    print(f"{name:32s} in_AOI={A.contains(p)!s:5s} in_flood={O.contains(p)!s:5s} dist_to_flood_km={d_km:6.1f}")
