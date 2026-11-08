"""Check NASA POWER WS2M/WS10M homogeneity over 1981-2026 (affects ETo baselines)."""
import requests,pandas as pd,numpy as np,io
for com in ["AG","RE"]:
    r=requests.get("https://power.larc.nasa.gov/api/temporal/daily/point",params=dict(parameters="WS2M,WS10M,T2M_MAX,ALLSKY_SFC_SW_DWN",community=com,longitude=-62.52,latitude=-16.86,start="19810101",end="20261106",format="CSV"),timeout=180)
    L=r.text.splitlines(); h=[i for i,l in enumerate(L) if l.startswith("YEAR")][0]
    d=pd.read_csv(io.StringIO("\n".join(L[h:]))).replace(-999.0,np.nan)
    a=d.groupby("YEAR")[["WS2M","WS10M","T2M_MAX","ALLSKY_SFC_SW_DWN"]].mean().round(2)
    print(com, r.status_code); print(a.T.to_string())
    d["date"]=pd.to_datetime(d.YEAR.astype(str)+d.DOY.astype(str).str.zfill(3),format="%Y%j")
    m=d.set_index("date").loc["2024-06":"2026-11","WS2M"].resample("MS").mean().round(2); print(m.to_string())
    break
