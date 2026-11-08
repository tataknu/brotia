"""Probe ORNL subset limits/latency: 10 vs 11 dates, 3 bands, km=1, Estancia Los Tajibos."""
import json, time, requests
BASE="https://modis.ornl.gov/rst/api/v1"; H={"Accept":"application/json"}
lat,lon=-16.86,-62.52
dates=[d["modis_date"] for d in json.load(open("MOD13Q1.dates.json"))["dates"]]
out={}
for n in (10,11):
    s,e=dates[-n],dates[-1]
    for b in ("250m_16_days_NDVI","250m_16_days_pixel_reliability","250m_16_days_VI_Quality"):
        t=time.time()
        r=requests.get(f"{BASE}/MOD13Q1/subset",params=dict(latitude=lat,longitude=lon,band=b,startDate=s,endDate=e,kmAboveBelow=1,kmLeftRight=1),headers=H,timeout=180)
        dt=time.time()-t
        txt=r.text
        try: j=r.json(); ns=len(j.get("subset",[])); 
        except Exception: j=None; ns=None
        print(n,b,r.status_code,f"{dt:.2f}s","n_composites=",ns,"" if r.status_code==200 else txt[:300])
        if n==10 and r.status_code==200: out[b]=j
        if n==11: break
json.dump(out,open("sample_MOD13Q1_10dates_km1.json","w"))
