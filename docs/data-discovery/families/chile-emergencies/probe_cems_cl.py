"""Intersect Copernicus EMS Chile wildfire observed-event vectors with Chile test points.
Usage: python probe_cems_cl.py <dir-with-unzipped-products>"""
import sys, json, glob
from shapely.geometry import shape, Point
from shapely.ops import unary_union
from farms_cl import FARMS
root = sys.argv[1]
for f in sorted(glob.glob(f"{root}/**/*observedEventA*.json", recursive=True)):
    gj = json.load(open(f))
    geoms = [shape(ft["geometry"]) for ft in gj["features"]]
    u = unary_union(geoms)
    props = gj["features"][0]["properties"] if gj["features"] else {}
    print(f.split("/")[-1], "features", len(geoms), "props", {k: props[k] for k in list(props)[:8]})
    for name, lon, lat in FARMS:
        p = Point(lon, lat)
        d_deg = u.distance(p)
        if d_deg < 0.5:
            print(f"   {name}: inside={u.contains(p)} dist~{d_deg*100:.1f} km")
for f in sorted(glob.glob(f"{root}/**/*builtUp*.json", recursive=True))[:1]:
    gj = json.load(open(f)); print(f.split('/')[-1], 'damage props', gj["features"][0]["properties"] if gj["features"] else None)
