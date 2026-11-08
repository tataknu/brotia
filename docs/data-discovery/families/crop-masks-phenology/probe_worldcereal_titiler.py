"""ESA WorldCereal 2021 (10 m) via Terrascope public STAC + public titiler (no key).
Direct GeoTIFF downloads on services.terrascope.be return 401 (need free Terrascope account),
but titiler.terrascope.be serves /point and /statistics publicly."""
import json, time, requests
FARMS = [("Estancia Los Tajibos","soy",-62.52,-16.86),("Agropecuaria Brecha 8","maize",-62.70,-16.97),
 ("Colonia Cuatro Canadas Lote 7","soy",-62.47,-17.30),("Hacienda El Cusi","sorghum",-62.55,-17.38),
 ("Agricola Pailon Norte","wheat",-62.68,-17.56),("Granja Las Londras","sunflower",-62.76,-17.74),
 ("Finca Okinawa Dos","maize",-62.85,-17.18),("Parcela Okinawa Uno","soy",-62.93,-17.27),
 ("Arrocera Mineros","rice",-63.29,-17.20),("Canaveral San Antonio","sugarcane",-63.21,-17.29),
 ("Agricola Warnes Sur","soy",-63.08,-17.56),("Estancia Mineros Norte","soy",-63.18,-17.03)]
STAC = "https://stac.terrascope.be/search"
TT = "https://titiler.terrascope.be/collections/{c}/items/{i}"
PRODUCTS = ["temporarycrops", "maize", "wintercereals", "activecropland"]
def items_at(c, lon, lat):
    r = requests.post(STAC, json={"collections": [f"esa-worldcereal-{c}-10m-2021-v1"],
        "intersects": {"type": "Point", "coordinates": [lon, lat]}, "limit": 10}, timeout=30)
    r.raise_for_status()
    return [(f["id"], f["assets"]["classification"]["href"].split("/")[-1]) for f in r.json()["features"]]
def square(lon, lat, d=0.0045):
    return {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [[
        [lon-d, lat-d], [lon+d, lat-d], [lon+d, lat+d], [lon-d, lat+d], [lon-d, lat-d]]]}}
res = {}
for name, crop, lon, lat in FARMS:
    row = {}
    for p in PRODUCTS:
        for iid, fn in items_at(p, lon, lat):
            season = iid.split("_")[1]
            t = time.time()
            # polygon statistics (1 km box) -> fraction of pixels == 100
            r = requests.post(TT.format(c=f"esa-worldcereal-{p}-10m-2021-v1", i=iid) + "/statistics",
                              params={"assets": "classification", "categorical": "true", "c": [0, 100]},
                              json=square(lon, lat), timeout=60)
            if r.ok:
                st = r.json()["properties"]["statistics"]
                st = next(iter(st.values()))
                hist = dict(zip(st["histogram"][1], st["histogram"][0])) if "histogram" in st else None
                n = sum(hist.values()) if hist else 0
                frac = round(hist.get(100, 0) / n, 3) if n else None
                row[f"{p}|{season}|{fn.split('_')[-2]}"] = {"frac100": frac, "ms": int((time.time()-t)*1000)}
            else:
                row[f"{p}|{season}"] = {"http": r.status_code, "body": r.text[:120]}
    res[f"{name} ({crop})"] = row
    print(name, crop, {k: v.get("frac100", v) for k, v in row.items()}, flush=True)
json.dump(res, open("probe_worldcereal_titiler.json", "w"), indent=1)
