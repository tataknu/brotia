"""Offline analysis (no network): match S2 (clear_frac>=0.8) observations to MOD13Q1 16-day composites
(pixel_reliability 0/1) on the identical 231.66 m footprint, fit MODIS ~ a + b*S2, and compare with S2 over the
whole field polygon. Also seasonal amplitude and interannual sd per calendar month (for the z-score sd floor).
Output: out_crosscal.json"""
import json, datetime as dt, collections
import numpy as np
res = {}
for key in ["requinoa_cherry", "quillota_avocado"]:
    mod = json.load(open("out_modis_mixed.json"))[f"ornl_{key}"]["series"]
    px = json.load(open(f"out_s2_modispx_{key}.json"))["per_date"]
    fld = json.load(open(f"out_s2_field_{key}.json"))["per_date"]
    pairs = []
    for d, v in mod.items():
        if v["rel"] not in (0, 1): continue
        d0 = dt.date.fromisoformat(d); d1 = d0 + dt.timedelta(days=15)
        s_px = [x["ndvi"] for k, x in px.items() if d0 <= dt.date.fromisoformat(k) <= d1 and x["clear_frac"] >= 0.8]
        s_fl = [x["ndvi"] for k, x in fld.items() if d0 <= dt.date.fromisoformat(k) <= d1 and x["clear_frac"] >= 0.8]
        if s_px: pairs.append((d, v["ndvi"], float(np.max(s_px)), float(np.max(s_fl)) if s_fl else None))  # max ~ MVC compositing
    m = np.array([p[1] for p in pairs]); s = np.array([p[2] for p in pairs])
    b, a = np.polyfit(s, m, 1); pred = a + b * s
    r = {"n_pairs": len(pairs), "modis_minus_s2px_bias": round(float(np.mean(m - s)), 3), "fit_modis_eq_a_plus_b_s2": [round(float(a), 3), round(float(b), 3)],
         "r": round(float(np.corrcoef(m, s)[0, 1]), 3), "rmse_after_fit": round(float(np.sqrt(np.mean((m - pred) ** 2))), 3)}
    fl = [(p[1], p[3]) for p in pairs if p[3] is not None]
    r["r_modis_vs_s2_field"] = round(float(np.corrcoef([x for x, _ in fl], [y for _, y in fl])[0, 1]), 3)
    # S2 field seasonality and interannual sd per calendar month (monthly medians of clear>=0.8 obs)
    mon = collections.defaultdict(list)
    for k, x in fld.items():
        if x["clear_frac"] >= 0.8: mon[k[:7]].append(x["ndvi"])
    cal = collections.defaultdict(list)
    for ym, v in mon.items(): cal[int(ym[5:])].append(float(np.median(v)))
    r["s2_field_month_mean_sd"] = {mth: [round(float(np.mean(v)), 3), round(float(np.std(v, ddof=1)), 3) if len(v) > 1 else None, len(v)] for mth, v in sorted(cal.items())}
    res[key] = r
    print(key, json.dumps(r))
json.dump(res, open("out_crosscal.json", "w"), indent=1)
