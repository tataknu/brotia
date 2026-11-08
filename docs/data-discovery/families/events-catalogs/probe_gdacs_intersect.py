"""Intersect GDACS footprints with sample farms."""
import json,glob
from shapely.geometry import shape, Point
from farms import FARMS
for f in sorted(glob.glob('geom_*.json')):
    d=json.load(open(f))
    for ft in d['features']:
        if ft['geometry']['type']=='Point': continue
        g=shape(ft['geometry'])
        hits=[x['name'] for x in FARMS if g.contains(Point(*x['lonlat']))]
        mind=min(g.distance(Point(*x['lonlat'])) for x in FARMS)
        print(f, ft['properties'].get('Class'), 'bounds',[round(b,2) for b in g.bounds],'area_deg2',round(g.area,2),'farms_in',len(hits),'min_dist_deg',round(mind,2))
