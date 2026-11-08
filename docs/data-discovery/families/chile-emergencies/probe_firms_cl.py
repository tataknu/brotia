"""Count FIRMS detections within 5 km / 25 km of each Chile test point.
Usage: python probe_firms_cl.py <csv> [<csv> ...]"""
import sys, pandas as pd
from farms_cl import FARMS, km
for f in sys.argv[1:]:
    df = pd.read_csv(f)
    df = df[(df.latitude < -29) & (df.latitude > -42) & (df.longitude > -74.5) & (df.longitude < -69.5)]
    if "type" in df: df = df[df["type"] == 0]
    print(f.split('/')[-1], "rows central/south Chile", len(df), "dates", df.acq_date.min(), "..", df.acq_date.max())
    for name, lon, lat in FARMS:
        d = df.apply(lambda r: km(lon, lat, r.longitude, r.latitude), axis=1)
        n5, n25 = int((d <= 5).sum()), int((d <= 25).sum())
        if n25:
            peak = df[d <= 25].acq_date.str[:7].value_counts().head(2).to_dict()
            print(f"   {name}: <=5km {n5}  <=25km {n25}  peak months {peak}")
