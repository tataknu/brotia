"""ESA WorldCover (2020 v1, 2021 v2) and Esri/IO 10 m annual LULC v02 (2017-2023) via Planetary Computer
(anonymous SAS signing, no key). Reports class mix in a ~1 km box around each farm."""
import json, time, collections
import planetary_computer as pc, pystac_client, rasterio, numpy as np
from rasterio.windows import from_bounds
from rasterio.warp import transform_bounds
FARMS = [("Estancia Los Tajibos","soy",-62.52,-16.86),("Agropecuaria Brecha 8","maize",-62.70,-16.97),
 ("Colonia Cuatro Canadas Lote 7","soy",-62.47,-17.30),("Hacienda El Cusi","sorghum",-62.55,-17.38),
 ("Agricola Pailon Norte","wheat",-62.68,-17.56),("Granja Las Londras","sunflower",-62.76,-17.74),
 ("Finca Okinawa Dos","maize",-62.85,-17.18),("Parcela Okinawa Uno","soy",-62.93,-17.27),
 ("Arrocera Mineros","rice",-63.29,-17.20),("Canaveral San Antonio","sugarcane",-63.21,-17.29),
 ("Agricola Warnes Sur","soy",-63.08,-17.56),("Estancia Mineros Norte","soy",-63.18,-17.03)]
WC = {10:"tree",20:"shrub",30:"grass",40:"cropland",50:"built",60:"bare",70:"snow",80:"water",90:"wetland",95:"mangrove",100:"moss"}
IO = {0:"nodata",1:"water",2:"trees",4:"flooded_veg",5:"crops",7:"built",8:"bare",9:"snow",10:"clouds",11:"rangeland"}
cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)
def mix(href, lon, lat, legend, d=0.0045):
    with rasterio.open(href) as ds:
        b = transform_bounds("EPSG:4326", ds.crs, lon-d, lat-d, lon+d, lat+d)
        a = ds.read(1, window=from_bounds(*b, ds.transform))
    c = collections.Counter(a.ravel().tolist()); n = sum(c.values())
    return {legend.get(k, k): round(v/n, 2) for k, v in c.most_common(3)}
out = {}
for name, crop, lon, lat in FARMS:
    row = {}
    for coll, legend in [("esa-worldcover", WC), ("io-lulc-annual-v02", IO)]:
        t = time.time()
        items = list(cat.search(collections=[coll], intersects={"type":"Point","coordinates":[lon,lat]}).items())
        for it in sorted(items, key=lambda i: i.datetime or i.properties.get("start_datetime")):
            yr = (it.properties.get("start_datetime") or str(it.datetime))[:4]
            key = "map" if "map" in it.assets else "data"
            row[f"{coll}:{yr}"] = mix(it.assets[key].href, lon, lat, legend)
        row[f"{coll}:ms"] = int((time.time()-t)*1000)
    out[f"{name} ({crop})"] = row
    print(name, crop, json.dumps(row), flush=True)
json.dump(out, open("probe_pc_landcover.json", "w"), indent=1)
