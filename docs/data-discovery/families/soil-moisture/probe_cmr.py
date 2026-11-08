"""NASA CMR (keyless metadata) to verify latest granule / history start for auth-gated NASA soil moisture products, + GIBS layers."""
import requests, time, re
CMR="https://cmr.earthdata.nasa.gov/search"
pt="-62.52,-16.86"
for short,ver in [("SPL4SMGP","008"),("SPL3SMP_E","006"),("SPL3SMP","009"),("GLDAS_NOAH025_3H","2.1"),("GLDAS_CLSM025_DA1_D","2.2"),
                  ("FLDAS_NOAH01_C_GL_M","001"),("GLDAS_NOAH025_M","2.1")]:
    res={}
    for sort in ["-start_date","start_date"]:
        t=time.time()
        r=requests.get(f"{CMR}/granules.json",params={"short_name":short,"version":ver,"point":pt,"sort_key":sort,"page_size":1},timeout=60)
        e=r.json().get("feed",{}).get("entry",[])
        res[sort]=(r.status_code, round(time.time()-t,2), e[0]["time_start"][:16] if e else None, e[0].get("title","")[:70] if e else None)
    hits=r.headers.get("CMR-Hits")
    print(f"{short} v{ver}: hits={hits} latest={res['-start_date']} first={res['start_date'][2]}")
# GIBS WMTS SMAP / soil layers (keyless imagery, not data values)
r=requests.get("https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml",timeout=120)
ids=re.findall(r"<ows:Identifier>([^<]*(?:SMAP|Soil_Moisture|soil)[^<]*)</ows:Identifier>",r.text,re.I)
print("GIBS WMTS caps:",r.status_code,len(r.content),"bytes; soil-moisture layers:",sorted(set(ids))[:15])
