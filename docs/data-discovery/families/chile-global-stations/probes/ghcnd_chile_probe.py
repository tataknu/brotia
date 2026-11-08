"""Probe GHCN-Daily per-station CSVs for Chilean stations near the test locations.
Usage: python ghcnd_chile_probe.py RAW_DIR
Downloads (small, 1-3 MB each) to RAW_DIR, prints latest date, source flags, completeness."""
import sys, time, os, requests, pandas as pd, numpy as np
RAW = sys.argv[1]; os.makedirs(RAW, exist_ok=True)
IDS = ["CI000085488","CI000085543","CIM00085577","CIM00085574","CI000085629",
       "CIM00085672","CIM00085682","CI000085743","CIM00085782","CIM00085766"]
BASE = "https://www.ncei.noaa.gov/data/global-historical-climatology-network-daily/access/"
rows = []
for sid in IDS:
    fp = os.path.join(RAW, sid + ".csv")
    if not os.path.exists(fp):
        t = time.time(); r = requests.get(BASE + sid + ".csv", timeout=60)
        print(sid, r.status_code, f"{time.time()-t:.2f}s", len(r.content), "B", r.headers.get("Last-Modified"))
        open(fp, "wb").write(r.content); time.sleep(1)
    df = pd.read_csv(fp, low_memory=False, parse_dates=["DATE"])
    rec = {"id": sid, "name": df["NAME"].iloc[0], "first": df.DATE.min().date(), "last": df.DATE.max().date()}
    for v in ["PRCP", "TMAX", "TMIN"]:
        if v not in df: continue
        s = df[["DATE", v, v + "_ATTRIBUTES"]].dropna(subset=[v])
        rec[v + "_last"] = s.DATE.max().date() if len(s) else None
        base = s[(s.DATE >= "1991-01-01") & (s.DATE <= "2020-12-31")]
        rec[v + "_pct_1991_2020"] = round(100 * len(base) / 10958, 1)
        rec[v + "_pct_2023_24"] = round(100 * ((s.DATE >= "2023-01-01") & (s.DATE <= "2024-12-31")).sum() / 731, 1)
        # source flag = 3rd comma-field of attributes
        src = s[v + "_ATTRIBUTES"].astype(str).str.split(",").str[2]
        rec[v + "_src_recent"] = dict(src[s.DATE >= "2023-01-01"].value_counts())
        rec[v + "_src_1991_2020"] = dict(src[(s.DATE >= "1991-01-01") & (s.DATE <= "2020-12-31")].value_counts().head(4))
    rows.append(rec)
out = pd.DataFrame(rows)
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 50)
print(out.to_string())
out.to_csv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ghcnd_chile_inventory.csv"), index=False)
