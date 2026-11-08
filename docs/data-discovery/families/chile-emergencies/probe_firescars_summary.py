"""Landscape Fire Scars DB (Miranda et al. 2022, PANGAEA 941127, CC-BY-4.0): CONAF fires 1985-2018
with ignition point, date and area. Count fires near each Chile test point. Usage: python probe_firescars_summary.py FireScar_CL_Summary_1985-2018.xlsx"""
import sys, pandas as pd
from farms_cl import FARMS, km
df = pd.read_excel(sys.argv[1])
print("rows", len(df), "seasons", df.FireSeason.min(), "..", df.FireSeason.max(), "with scar raster", int(df.FireScar.sum()))
for name, lon, lat in FARMS:
    d = df.apply(lambda r: km(lon, lat, r["Longitude [°]"], r["Latitude [°]"]), axis=1)
    near = df[d <= 10]
    big = near.sort_values("Area_CONAF [ha]", ascending=False).head(1)
    top = f"{big.FireName_CONAF.iloc[0]} {big['IgnitionDate_CONAF'].iloc[0]} {big['Area_CONAF [ha]'].iloc[0]:.0f} ha" if len(big) else ""
    print(f"  {name}: fires<=10km {len(near)}  largest: {top}")
