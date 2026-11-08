"""NASA POWER daily point API (AG community): FAO-56 inputs + latency + history start."""
import requests, time, pandas as pd, json
LAT, LON = -16.86, -62.52
P="T2M_MAX,T2M_MIN,T2M,RH2M,T2MDEW,WS2M,ALLSKY_SFC_SW_DWN,CLRSKY_SFC_SW_DWN,PS,EVPTRNS,PRECTOTCORR"
t=time.time()
r=requests.get("https://power.larc.nasa.gov/api/temporal/daily/point",params=dict(parameters=P,community="AG",longitude=LON,latitude=LAT,start="20260901",end="20261106",format="JSON"),timeout=120)
dt=time.time()-t
j=r.json(); df=pd.DataFrame(j["properties"]["parameter"]).replace(-999.0,pd.NA)
print("status",r.status_code,"latency",round(dt,2),"bytes",len(r.content))
print("units",{k:v.get("units") for k,v in j["parameters"].items()})
print("last valid per var",{c:df[c].last_valid_index() for c in df})
print(df.tail(10).to_string())
# history start
t=time.time()
r=requests.get("https://power.larc.nasa.gov/api/temporal/daily/point",params=dict(parameters="T2M_MAX,T2M_MIN,ALLSKY_SFC_SW_DWN,RH2M,WS2M",community="AG",longitude=LON,latitude=LAT,start="19810101",end="20261106",format="CSV"),timeout=180)
print("full history CSV status",r.status_code,"latency",round(time.time()-t,2),"bytes",len(r.content))
lines=r.text.splitlines(); hdr=[i for i,l in enumerate(lines) if l.startswith("YEAR")][0]
from io import StringIO
h=pd.read_csv(StringIO("\n".join(lines[hdr:]))).replace(-999.0,pd.NA)
print(h.head(2).to_string()); print("rows",len(h)); 
for c in ["T2M_MAX","ALLSKY_SFC_SW_DWN","RH2M","WS2M"]:
    s=h[c].dropna(); print(c,"first valid row",h.loc[s.index[0],["YEAR","DOY"]].tolist(),"n missing",h[c].isna().sum())
print("\n".join(lines[:hdr])[:900])
