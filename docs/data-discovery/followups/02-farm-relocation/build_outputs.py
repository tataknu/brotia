"""fields_verified.json -> farms_fields.geojson + farms_fields_table.csv/.md"""
import json, csv, sys, os
D = os.path.dirname(os.path.abspath(__file__))
R = json.load(open(f"{D}/fields_verified.json"))
FLAGS = {
 "rice": "RICE NOT VERIFIABLE: MapBiomas 2024 has no rice class (40) here and no cropland block (MB agri >=0.95, no water/forest/sand pixels) within 10 km reaches 5% JRC ever-water (16 blocks reach 2%); provisional non-soy cropland, weak NDVI amplitude (could be cane). Do not use for a rice story.",
 "sugarcane": "CANE NOT CLASS-VERIFIABLE: no sugarcane class in MapBiomas Bolivia 2024; evidence = cropland (MB72+WC40), never soy in GLAD 2021-23, ~7.8 km NE of Montero town centre (approx. coordinate, unverified), inside the Montero-Mineros cane belt by local knowledge (unverified).",
}
feats, rows = [], []
for r in R:
    f = r["fractions"]; s, w = r["s2_janfeb"], r["s2_julaug"]
    flag = FLAGS.get(r["crop"], "") + (" " + r["provisional"] if r.get("provisional") and r["crop"] != "rice" else "")
    props = {"name": r["name"], "crop": r["crop"], "status": r["status"], "area_ha": r["area_ha"], "moved_km": r["moved_km"],
             "orig_lonlat": r["orig_lonlat"], "centre_lonlat": r["lonlat"], "flag": flag.strip() or None,
             "mb2024_agri": f["mb_agri"], "mb39_soy": f["mb39_soy"], "mb72_other_crops": f["mb72_othercrop"], "mb21_mosaic": f["mb21_mosaic"],
             "wc2021_cropland40": f["wc40_cropland"], "glad_soy_max_2021_2023": f["glad_soy_max21_23"],
             "glad_soy_by_year": [f["glad_soy_2021"], f["glad_soy_2022"], f["glad_soy_2023"]], "jrc_ever_water": f["jrc_ever_water"],
             "modis250_px_centres": r["modis_px_centres"], "modis250_px_full": r["modis_px_full"],
             "ndvi_janfeb": s.get("ndvi"), "ndvi_janfeb_date": s.get("date"), "ndvi_janfeb_item": s.get("item"),
             "ndvi_julaug": w.get("ndvi"), "ndvi_julaug_date": w.get("date"), "ndvi_julaug_item": w.get("item"),
             "ndvi_amplitude": r["ndvi_amplitude"], "s2_baseline": [s.get("baseline"), w.get("baseline")]}
    feats.append({"type": "Feature", "properties": props, "geometry": r["polygon"]})
    o = r["orig_fractions"]
    rows.append({"farm": r["name"], "crop": r["crop"], "status": r["status"], "moved_km": r["moved_km"],
                 "centre": f"{r['lonlat'][0]:.5f},{r['lonlat'][1]:.5f}", "area_ha": r["area_ha"],
                 "orig_mb_agri": o["mb_agri"], "orig_wc40": o["wc40_cropland"], "orig_glad_soy_max": o["glad_soy_max21_23"],
                 "orig_forest": o["mb3_forest"], "orig_pasture": o["mb15_pasture"], "orig_water": o["mb33_water"],
                 "mb_agri": f["mb_agri"], "mb39": f["mb39_soy"], "mb72": f["mb72_othercrop"], "wc40": f["wc40_cropland"],
                 "glad_soy_max": f["glad_soy_max21_23"], "glad_soy_21_22_23": "/".join(str(f[f"glad_soy_{y}"]) for y in (2021, 2022, 2023)),
                 "jrc_ever_water": f["jrc_ever_water"], "modis_px_centres/full": f"{r['modis_px_centres']}/{r['modis_px_full']}",
                 "ndvi_janfeb": s.get("ndvi"), "date_janfeb": s.get("date"), "ndvi_julaug": w.get("ndvi"), "date_julaug": w.get("date"),
                 "amplitude": r["ndvi_amplitude"]})
json.dump({"type": "FeatureCollection", "name": "climate_loan_monitor_sample_fields_v2",
           "properties": {"generated": "2026-11-07", "crs": "EPSG:4326", "field": "900 m x 900 m square in UTM 20S (~81 ha)"},
           "features": feats}, open(f"{D}/farms_fields.geojson", "w"), indent=1)
with open(f"{D}/farms_fields_table.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
cols = list(rows[0])
md = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)] + ["| " + " | ".join(str(r[c]) for c in cols) + " |" for r in rows]
open(f"{D}/farms_fields_table.md", "w").write("\n".join(md) + "\n")
print("\n".join(md))
