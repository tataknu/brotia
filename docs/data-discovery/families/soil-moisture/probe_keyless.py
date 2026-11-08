"""Probe keyless soil-moisture sources for Estancia Los Tajibos (-16.86, -62.52). Small requests only."""
import time, requests, json, re
LAT, LON = -16.86, -62.52
H={"User-Agent":"energhack-data-discovery/0.1 (research probe)"}
def get(name, url, **kw):
    t=time.time()
    try:
        r=requests.get(url, timeout=kw.pop("timeout",60), headers=H, **kw)
        print(f"== {name}: HTTP {r.status_code} {time.time()-t:.2f}s bytes={len(r.content)} final_url={r.url[:140]}")
        return r
    except Exception as e:
        print(f"== {name}: ERROR {type(e).__name__}: {e}"); return None

# 1 NASA POWER daily (MERRA-2 based soil wetness, 0-1 fraction)
r=get("NASA POWER daily GWET*", "https://power.larc.nasa.gov/api/temporal/daily/point",
      params=dict(parameters="GWETROOT,GWETTOP,GWETPROF,PRECTOTCORR", community="AG", latitude=LAT, longitude=LON,
                  start="20261001", end="20261106", format="JSON"))
if r is not None and r.ok:
    j=r.json(); p=j["properties"]["parameter"]
    for k,v in p.items():
        good=[(d,x) for d,x in v.items() if x!=-999]
        print(f"  {k}: last_valid={good[-1] if good else None} n_valid={len(good)}/{len(v)}")
r=get("NASA POWER history start", "https://power.larc.nasa.gov/api/temporal/daily/point",
      params=dict(parameters="GWETROOT", community="AG", latitude=LAT, longitude=LON, start="19810101", end="19810105", format="JSON"))
if r is not None and r.ok: print("  ", r.json()["properties"]["parameter"])

# 2 NOAA CPC leaky-bucket soil moisture (monthly, 0.5 deg, 1948+) via PSL THREDDS/OPeNDAP
for nm,u in [("PSL CPC soilw das", "https://psl.noaa.gov/thredds/dodsC/Datasets/cpcsoil/soilw.mon.mean.nc.das"),
             ("PSL CPC soilw time dds","https://psl.noaa.gov/thredds/dodsC/Datasets/cpcsoil/soilw.mon.mean.nc.dds")]:
    r=get(nm,u)
    if r is not None and r.ok: print("  ", r.text[:400].replace("\n"," | "))

# 3 TerraClimate (monthly 4 km, 1958+) via UIdaho THREDDS
r=get("TerraClimate soil THREDDS dds","http://thredds.northwestknowledge.net:8080/thredds/dodsC/agg_terraclimate_soil_1958_CurrentYear_GLOBE.nc.dds")
if r is not None and r.ok: print("  ", r.text[:400].replace("\n"," | "))

# 4 ESA CCI SM via CEDA public HTTP
for nm,u in [("CEDA ESA CCI SM dir","https://dap.ceda.ac.uk/neodc/esacci/soil_moisture/data/daily_files/COMBINED/"),
             ("CEDA ESA CCI SM data root","https://data.ceda.ac.uk/neodc/esacci/soil_moisture/data/daily_files/COMBINED/")]:
    r=get(nm,u, params={"json":""} if "data.ceda" in u else None)
    if r is not None: print("  ", re.sub(r"\s+"," ",r.text[:600]))

# 5 Copernicus CLMS SSM / SWI manifests (VITO)
for nm,u in [("CLMS SSM 1km manifest","https://globalland.vito.be/download/manifest/ssm_1km_v1_daily_netcdf/manifest_clms_global_ssm_1km_v1_daily_netcdf_latest.txt"),
             ("CLMS SWI 12.5km manifest","https://globalland.vito.be/download/manifest/swi_12.5km_v3_daily_netcdf/manifest_clms_global_swi_12.5km_v3_daily_netcdf_latest.txt")]:
    r=get(nm,u)
    if r is not None: print("  ", r.text[:300].replace("\n"," | "))

# 6 NASA GES DISC GLDAS/FLDAS OPeNDAP and data rods (expect 401 / redirect to URS)
for nm,u in [("GES DISC GLDAS NOAH 0.25 3H dir","https://hydro1.gesdisc.eosdis.nasa.gov/data/GLDAS/GLDAS_NOAH025_3H.2.1/"),
             ("GES DISC FLDAS global monthly dir","https://hydro1.gesdisc.eosdis.nasa.gov/data/FLDAS/FLDAS_NOAH01_C_GL_M.001/"),
             ("Hydrology data rods GLDAS SoilMoi0_10","https://hydro1.gesdisc.eosdis.nasa.gov/daac-bin/access/timeseries.cgi?variable=GLDAS2:GLDAS_NOAH025_3H_v2.1:SoilMoi0_10cm_inst&startDate=2026-09-01T00&endDate=2026-09-02T00&location=GEOM:POINT(-62.52,%20-16.86)&type=asc2")]:
    r=get(nm,u, allow_redirects=True)
    if r is not None: print("  ", re.sub(r"\s+"," ",r.text[:300]))

# 7 NSIDC SMAP (expect URS redirect)
r=get("NSIDC SMAP L4 SPL4SMGP dir","https://n5eil01u.ecs.nsidc.org/SMAP/SPL4SMGP.008/")
if r is not None: print("  ", re.sub(r"\s+"," ",r.text[:200]))
