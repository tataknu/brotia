"""Probe GHCNh (hourly, keyless) 2026 PSV files (parquet needs pyarrow) for Chilean stations near the test farms.
Prints latest obs, report-type mix, and precipitation field coverage."""
import sys, io, time, requests, pandas as pd
BASE = "https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/{y}/psv/GHCNh_{id}_{y}.psv"
IDS = sys.argv[1:] or ["CII0000SCIC", "CIN00370033", "CIN00380013", "CII0000SCRG", "CIN00330020", "CII0000SCJO", "CIM00085620"]
for sid in IDS:
    t = time.time(); r = requests.get(BASE.format(y=2026, id=sid), timeout=60)
    if r.status_code != 200:
        print(sid, r.status_code); continue
    df = pd.read_csv(io.BytesIO(r.content), sep="|", low_memory=False)
    df["ts"] = pd.to_datetime(df[["Year", "Month", "Day", "Hour", "Minute"]].rename(columns=str.lower))
    pcols = [c for c in df.columns if c.startswith("precipitation") and not any(k in c for k in ("Measurement", "Quality", "Report", "Source"))]
    print(f"\n{sid} {df['Station_name'].iloc[0]} {r.status_code} {time.time()-t:.2f}s {len(r.content)/1e3:.0f}kB rows={len(df)} first={df.ts.min()} last={df.ts.max()}")
    rt = [c for c in df.columns if c.startswith("temperature_Report_Type")]
    if rt: print("  report types:", df[rt[0]].value_counts().head(5).to_dict())
    print("  temp non-null:", df["temperature"].notna().sum(), " precip cols non-null:", {c: int(df[c].notna().sum()) for c in pcols})
    for c in pcols:
        s = df[[ "ts", c]].dropna()
        if len(s): print(f"   {c}: last={s.ts.max()} sum={s[c].sum():.1f} max={s[c].max()}")
    # monthly report count to see if SYNOP stops
    if rt: print("  FM12 rows by month:", df[df[rt[0]].astype(str).str.contains("FM-12|FM12", na=False)].groupby(df.ts.dt.month).size().to_dict())
    time.sleep(1)
