"""MCD12Q1 IGBP land cover (LC_Type1, 500 m) at each sample farm point for 2020-2024, keyless ORNL.
Why: a smoother/baseline is only meaningful if the pixel is actually cropland (IGBP 12 croplands, 14 mosaic)."""
import requests, time, json
FARMS = [("Estancia Los Tajibos",-62.52,-16.86),("Agropecuaria Brecha 8",-62.7,-16.97),("Colonia Cuatro Canadas Lote 7",-62.47,-17.3),
 ("Hacienda El Cusi",-62.55,-17.38),("Agricola Pailon Norte",-62.68,-17.56),("Granja Las Londras",-62.76,-17.74),("Finca Okinawa Dos",-62.85,-17.18),
 ("Parcela Okinawa Uno",-62.93,-17.27),("Arrocera Mineros",-63.29,-17.2),("Canaveral San Antonio",-63.21,-17.29),("Agricola Warnes Sur",-63.08,-17.56),("Estancia Mineros Norte",-63.18,-17.03)]
IGBP = {1:"ENF",2:"EBF",3:"DNF",4:"DBF",5:"mixed forest",6:"closed shrub",7:"open shrub",8:"woody savanna",9:"savanna",10:"grassland",11:"wetland",12:"CROPLAND",13:"urban",14:"crop/natural mosaic",16:"barren",17:"water"}
out = {}
for n, lon, lat in FARMS:
    t = time.time()
    r = requests.get("https://modis.ornl.gov/rst/api/v1/MCD12Q1/subset", params=dict(latitude=lat, longitude=lon, band="LC_Type1",
        startDate="A2020001", endDate="A2024001", kmAboveBelow=1, kmLeftRight=1), headers={"Accept": "application/json"}, timeout=120)
    if r.status_code != 200: print(n, r.status_code); continue
    sub = r.json()["subset"]
    center = [s["data"][len(s["data"]) // 2] for s in sub]
    last = sub[-1]["data"]; crop_frac = sum(v in (12, 14) for v in last) / len(last)
    out[n] = {"center_2020_2024": center, "crop_frac_3km_2024": round(crop_frac, 2)}
    print(f"{n:30s} {r.status_code} {time.time()-t:4.1f}s center 2020-24={[IGBP.get(c,c) for c in center]}  crop/mosaic share in ~3x3 km (2024)={crop_frac:.2f}", flush=True)
json.dump(out, open(__file__.replace("probe_landcover_farms.py", "sample_mcd12q1_farms.json"), "w"), indent=1)
