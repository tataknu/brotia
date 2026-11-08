"""Round 2: CPC point extraction, ESA CCI latest, GES DISC auth check, TerraClimate."""
import time, requests, re, datetime as dt
H={"User-Agent":"energhack-data-discovery/0.1"}
def get(name,url,**kw):
    t=time.time()
    try:
        r=requests.get(url,timeout=kw.pop("timeout",60),headers=H,**kw)
        print(f"== {name}: HTTP {r.status_code} {time.time()-t:.2f}s bytes={len(r.content)} url={r.url[:150]}"); return r
    except Exception as e: print(f"== {name}: ERROR {e}"); return None
# CPC: time axis + point
base="https://psl.noaa.gov/thredds/dodsC/Datasets/cpcsoil/soilw.mon.mean.nc"
r=get("CPC time", base+".ascii?time[0:1:945]")
if r is not None and r.ok:
    nums=[float(x) for x in re.findall(r"[-\d.]+", r.text.split("time[946]")[-1])]
    # units: hours since 1800-01-01 (check das)
    das=requests.get(base+".das",headers=H).text
    u=re.search(r'time \{[^}]*units "([^"]+)"',das,re.S).group(1); print("  time units:",u)
    t0=dt.datetime(1800,1,1)
    f=lambda h: (t0+dt.timedelta(hours=h)) if "hours" in u else (t0+dt.timedelta(days=h))
    print("  first:",f(nums[0]).date()," last:",f(nums[-1]).date(), " n=",len(nums))
li=int(round((89.75-(-16.86))/0.5)); lo=int(round(((360-62.52)-0.25)/0.5))
r=get("CPC point last 6 months", base+f".ascii?soilw[940:1:945][{li}:1:{li}][{lo}:1:{lo}]")
if r is not None: print("  ", re.sub(r"\s+"," ",r.text[-400:]))
r=get("CPC lat/lon check", base+f".ascii?lat[{li}:1:{li}],lon[{lo}:1:{lo}]")
if r is not None: print("  ", re.sub(r"\s+"," ",r.text[-120:]))
# ESA CCI versions + latest
r=get("CEDA CCI versions","https://data.ceda.ac.uk/neodc/esacci/soil_moisture/data/daily_files/COMBINED/",params={"json":""})
vers=[i["name"] for i in r.json()["items"]]; print("  versions:",vers)
v=sorted(vers,key=lambda s:[int(x) for x in re.findall(r"\d+",s)])[-1]
r=get("CEDA CCI years "+v,f"https://data.ceda.ac.uk/neodc/esacci/soil_moisture/data/daily_files/COMBINED/{v}/",params={"json":""})
yrs=[i["name"] for i in r.json()["items"]]; print("  years:",yrs[:2],"...",yrs[-2:])
r=get("CEDA CCI last year files",f"https://data.ceda.ac.uk/neodc/esacci/soil_moisture/data/daily_files/COMBINED/{v}/{yrs[-1]}/",params={"json":""})
it=r.json()["items"]; print("  n files:",len(it)," last:",it[-1].get("name"), "size:",it[-1].get("size"))
# ICDR (interim climate data record / NRT) other dirs?
r=get("CEDA CCI soil_moisture/data root","https://data.ceda.ac.uk/neodc/esacci/soil_moisture/data/",params={"json":""})
print("  ",[i["name"] for i in r.json()["items"]])
# GES DISC: listing latest + try one file without auth
r=get("GLDAS 2.1 years","https://hydro1.gesdisc.eosdis.nasa.gov/data/GLDAS/GLDAS_NOAH025_3H.2.1/")
yy=sorted(set(re.findall(r'href="(\d{4})/"',r.text))); print("  years:",yy[0],"..",yy[-1])
r=get("GLDAS 2.1 last year days",f"https://hydro1.gesdisc.eosdis.nasa.gov/data/GLDAS/GLDAS_NOAH025_3H.2.1/{yy[-1]}/")
dd=sorted(set(re.findall(r'href="(\d{3})/"',r.text))); print("  last doy:",dd[-1] if dd else None, f"(={dt.date(int(yy[-1]),1,1)+dt.timedelta(days=int(dd[-1])-1) if dd else ''})")
r=get("FLDAS global monthly years","https://hydro1.gesdisc.eosdis.nasa.gov/data/FLDAS/FLDAS_NOAH01_C_GL_M.001/")
yy2=sorted(set(re.findall(r'href="(\d{4})/"',r.text))); print("  years:",yy2[:1],"..",yy2[-1:])
r=get("FLDAS last year files",f"https://hydro1.gesdisc.eosdis.nasa.gov/data/FLDAS/FLDAS_NOAH01_C_GL_M.001/{yy2[-1]}/")
ff=sorted(set(re.findall(r'href="(FLDAS[^"]+\.nc)"',r.text))); print("  last file:",ff[-1] if ff else None)
if ff:
    r=get("FLDAS file no-auth",f"https://hydro1.gesdisc.eosdis.nasa.gov/data/FLDAS/FLDAS_NOAH01_C_GL_M.001/{yy2[-1]}/{ff[-1]}",allow_redirects=False)
    if r is not None: print("  location:",r.headers.get("Location","")[:120])
# TerraClimate
for u in ["http://thredds.northwestknowledge.net:8080/thredds/dodsC/agg_terraclimate_soil_1958_CurrentYear_GLOBE.nc.das",
          "https://thredds.northwestknowledge.net/thredds/dodsC/agg_terraclimate_soil_1958_CurrentYear_GLOBE.nc.dds"]:
    r=get("TerraClimate",u)
    if r is not None: print("  ",re.sub(r"\s+"," ",r.text[:300]))
