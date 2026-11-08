"""GWIS/EFFIS near-real-time burned-area polygons (MODIS/VIIRS-derived, global, 2012-), keyless WFS. NB: WFS 1.1 + EPSG:4326 = lat,lon axis order in BBOX; output GeoJSON is lon,lat.
Filter by bbox + initialdate via OGC FILTER. Usage: python probe_gwis_ba.py 2026-01-01 2026-03-31"""
import sys, requests, time, json
from shapely.geometry import shape, Point
from farms_cl import FARMS
d0, d1 = sys.argv[1:3]
flt = ("<Filter><And>"
       f"<PropertyIsGreaterThanOrEqualTo><PropertyName>initialdate</PropertyName><Literal>{d0}</Literal></PropertyIsGreaterThanOrEqualTo>"
       f"<PropertyIsLessThanOrEqualTo><PropertyName>initialdate</PropertyName><Literal>{d1}</Literal></PropertyIsLessThanOrEqualTo>"
       "<BBOX><PropertyName>msGeometry</PropertyName><Envelope srsName='EPSG:4326'><lowerCorner>-41.0 -73.8</lowerCorner><upperCorner>-30.0 -70.3</upperCorner></Envelope></BBOX>"
       "</And></Filter>")
t = time.time()
r = requests.get("https://maps.effis.emergency.copernicus.eu/gwis", params={"service": "WFS", "version": "1.1.0", "request": "GetFeature", "typename": "ms:nrt.ba.poly", "outputformat": "geojson", "FILTER": flt, "srsName": "EPSG:4326"}, timeout=120)
print(r.status_code, f"{time.time()-t:.2f}s", len(r.content), "bytes")
fc = r.json(); fs = fc["features"]
print("polygons", len(fs), "initialdate", min(f["properties"]["initialdate"] for f in fs) if fs else None, "..", max(f["properties"]["initialdate"] for f in fs) if fs else None,
      "total ha", sum(float(f["properties"]["area"]) for f in fs))
# axis order check: first coordinate pair
if fs: print("first coord", json.dumps(fs[0]["geometry"]["coordinates"])[:60])
for name, lon, lat in FARMS:
    best = None
    for f in fs:
        g = shape(f["geometry"])
        for P in (Point(lon, lat), Point(lat, lon)):  # tolerate lat/lon axis order
            dd = g.distance(P) * 100
            if best is None or dd < best[0]: best = (dd, f["properties"]["initialdate"][:10], f["properties"]["area"])
    if best and best[0] < 30: print(f"  {name}: nearest burned polygon ~{best[0]:.1f} km (start {best[1]}, {best[2]} ha)")
