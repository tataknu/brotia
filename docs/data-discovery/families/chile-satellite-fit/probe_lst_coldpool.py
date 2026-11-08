"""Probe: does MODIS night LST show valley cold-air pooling / thermal belts around Curicó on frost nights?
For each night with station (CI000085629) Tmin <= 0 C and a valid Aqua or Terra LST at the station (from out_lst_frost.json),
read LST_Night_1km at a west-east transect from the valley floor to the Andes foothills, plus the elevation of each point
from Copernicus DEM GLO-90 (PC, keyless). Also: Sentinel-2 archive start at the Requinoa cherry block.
Output: out_lst_coldpool.json"""
import json, time, requests
from pystac_client import Client
cat = Client.open("https://planetarycomputer.microsoft.com/api/stac/v1")
API = "https://planetarycomputer.microsoft.com/api/data/v1/item/point"
LAT = -34.967
PTS = [("valley_w", -71.40), ("station", -71.233), ("valley_e", -71.12), ("foothill_1", -71.00), ("foothill_2", -70.90), ("foothill_3", -70.80)]
out = {"points": {}}
for name, lon in PTS:
    it = next(cat.search(collections=["cop-dem-glo-90"], intersects={"type": "Point", "coordinates": [lon, LAT]}, max_items=1).items())
    r = requests.get(f"{API}/{lon},{LAT}", params={"collection": "cop-dem-glo-90", "item": it.id, "assets": "data"}, timeout=60)
    out["points"][name] = {"lon": lon, "lat": LAT, "elev_m": round(r.json()["values"][0]) if r.status_code == 200 else None}
print(out["points"])
rows = json.load(open("out_lst_frost.json"))["rows"]
nights = [x for x in rows if x["lst_c"] is not None and x["tmin"] is not None and x["tmin"] <= 0]
res = []
for x in nights:
    sat = {"MOD": "MOD11A1", "MYD": "MYD11A1"}[x["sat"]]
    its = [i for i in cat.search(collections=["modis-11A1-061"], intersects={"type": "Point", "coordinates": [-71.233, LAT]},
                                  datetime=f"{x['date']}/{x['date']}").items() if i.id.startswith(sat)]
    if not its: continue
    rec = {"date": x["date"], "sat": x["sat"], "station_tmin": x["tmin"]}
    for name, lon in PTS:
        r = requests.get(f"{API}/{lon},{LAT}", params={"collection": "modis-11A1-061", "item": its[0].id, "assets": "LST_Night_1km"}, timeout=60)
        v = r.json()["values"][0] if r.status_code == 200 else 0
        rec[name] = round(v * 0.02 - 273.15, 1) if v > 0 else None
    res.append(rec); print(rec)
out["frost_nights"] = res
# S2 archive start at the Requinoa block
f = json.load(open("field_requinoa_cherry.geojson"))
t = time.time()
first = next(cat.search(collections=["sentinel-2-l2a"], intersects=f["geometry"], sortby=[{"field": "datetime", "direction": "asc"}], max_items=1).items())
out["s2_archive_first_item_requinoa"] = {"id": first.id, "date": first.datetime.date().isoformat(), "s": round(time.time() - t, 2)}
print(out["s2_archive_first_item_requinoa"])
json.dump(out, open("out_lst_coldpool.json", "w"), indent=1)
