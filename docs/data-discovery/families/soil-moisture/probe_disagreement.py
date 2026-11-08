"""Why do POWER (MERRA-2) and ERA5-Land disagree for Oct 2026? Compare window rainfall (ERA5 vs POWER) and CPC Oct soil-moisture percentile."""
import requests, re, pandas as pd, numpy as np, time
def win(s): w=s[((s.index.month==10)&(s.index.day>=7))|((s.index.month==11)&(s.index.day<=1))]; return w.groupby(w.index.year).sum()
def pct(by,y): base=[x for x in by.index if x not in (y,2026) and x>=1996]; return (by.loc[base]<by.loc[y]).mean()*100
r=requests.get("https://power.larc.nasa.gov/api/temporal/daily/point", params=dict(parameters="PRECTOTCORR", community="AG", latitude=-16.86, longitude=-62.52, start="19960101", end="20261106", format="JSON"), timeout=120)
p=pd.Series(r.json()["properties"]["parameter"]["PRECTOTCORR"]); p.index=pd.DatetimeIndex(pd.to_datetime(p.index).values.astype("datetime64[ns]")); p=p.replace(-999,np.nan)
time.sleep(3)
r=requests.get("https://archive-api.open-meteo.com/v1/archive", params=dict(latitude=-16.86, longitude=-62.52, start_date="1996-01-01", end_date="2026-11-01", models="era5", daily="precipitation_sum"), timeout=120)
e=pd.Series(r.json()["daily"]["precipitation_sum"], index=pd.DatetimeIndex(pd.to_datetime(r.json()["daily"]["time"]).values.astype("datetime64[ns]")))
bp, be = win(p.dropna()), win(e.dropna())
for y in [2023,2024,2025,2026]: print(y, "rain Oct7-Nov1: POWER %.0f mm (pct %.0f) | ERA5 %.0f mm (pct %.0f)"%(bp.loc[y],pct(bp,y),be.loc[y],pct(be,y)))
print("climatology mean: POWER %.0f mm, ERA5 %.0f mm"%(bp.loc[1996:2025].mean(), be.loc[1996:2025].mean()))
# CPC monthly Octobers 1996..2026 at -16.75,-62.75 (idx 213,594)
base="https://psl.noaa.gov/thredds/dodsC/Datasets/cpcsoil/soilw.mon.mean.nc"
# time index: 1948-01 is 0 -> Oct YYYY index = (YYYY-1948)*12+9
idx=[(y-1948)*12+9 for y in range(1996,2027)]
vals={}
for y,i in zip(range(1996,2027),idx):
    pass
r=requests.get(base+f".ascii?soilw[{idx[0]}:12:{idx[-1]}][213:1:213][594:1:594]",timeout=60)
nums=[float(x) for x in re.findall(r"\]\[0\], ([-\d.]+)", r.text)]
s=pd.Series(nums,index=range(1996,1996+len(nums)))
print("CPC Oct soilw (mm):", {k:round(v) for k,v in s.tail(5).items()}, " Oct-2026 pct vs 1996-2025 = %.0f, Oct-2023 pct = %.0f"%(((s.loc[1996:2025]<s.loc[2026]).mean()*100), ((s.drop([2023,2026])<s.loc[2023]).mean()*100)))
