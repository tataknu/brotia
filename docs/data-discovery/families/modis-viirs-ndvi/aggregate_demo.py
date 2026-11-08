"""Demo: QA-mask + aggregate a 9x9 MOD13Q1 window to a farm value per composite."""
import json, statistics as st
d=json.load(open("sample_MOD13Q1_10dates_km1.json"))
nd=d["250m_16_days_NDVI"]["subset"]; pr=d["250m_16_days_pixel_reliability"]["subset"]; vq=d["250m_16_days_VI_Quality"]["subset"]
def bad_viq(q):
    if q<0: return True
    mixed=(q>>10)&1; adj=(q>>8)&1; shadow=(q>>15)&1; vi_usef=(q>>2)&0xF
    return bool(mixed or adj or shadow or vi_usef>=12)
for a,b,c in zip(nd,pr,vq):
    vals=a["data"]; rel=b["data"]; q=c["data"]
    good=[v*1e-4 for v,r,qq in zip(vals,rel,q) if r in (0,1) and not bad_viq(qq) and v>-3000]
    rel_ok=sum(r in (0,1) for r in rel)
    med=round(st.median(good),3) if good else None
    print(a["calendar_date"],"rel0/1=",rel_ok,"/81 strict_good=",len(good),"median_ndvi=",med,"rel_hist=",{k:rel.count(k) for k in set(rel)})
