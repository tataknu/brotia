"""DGA ArcGIS layer 'Decretos_Escasez_Hidrica' holds ALL decrees since 2008 with VIGENTE flag.
Per farm: decree history (years under decree), latest decree, currently active? Keyless."""
import requests, time, json, datetime as dt, collections
UA={"User-Agent":"climate-loan-monitor-hackathon (research probe)"}
URL="https://rest-sit.mop.gob.cl/arcgis/rest/services/DGA/Decretos_Escasez_Hidrica/MapServer/0/query"
from probe_dga_arcgis import farms
F="ID_IDE,NOM_TERRITORIO,TERRITORIO,REGION,NUM_DECRETO,ANO_DECRETO,FT_DECRETO,FT_CADUCIDAD,FECHA_DECRETO,FECHA_CADUCIDAD,FECHA_ACTUALIZACION,VIGENTE,LINK_DOC"
r=requests.get(URL,params={"f":"json","where":"1=1","outFields":"VIGENTE,ANO_DECRETO,FECHA_ACTUALIZACION,FECHA_DECRETO","returnGeometry":"false"},headers=UA,timeout=60).json()
A=[f["attributes"] for f in r["features"]]
ms=lambda v: dt.datetime.fromtimestamp(v/1000,dt.UTC).date().isoformat() if v else None
print("VIGENTE counts:",collections.Counter(a["VIGENTE"] for a in A))
print("max FECHA_DECRETO:",ms(max(a["FECHA_DECRETO"] or 0 for a in A)),"max FECHA_ACTUALIZACION:",ms(max(a["FECHA_ACTUALIZACION"] or 0 for a in A)))
print("by year:",dict(sorted(collections.Counter(a["ANO_DECRETO"] for a in A).items())))
r=requests.get(URL,params={"f":"json","where":"VIGENTE='SI'","outFields":F,"returnGeometry":"false"},headers=UA,timeout=60).json()
print("active now:",[(a["attributes"]["NOM_TERRITORIO"],a["attributes"]["FT_DECRETO"],a["attributes"]["FT_CADUCIDAD"]) for a in r["features"]])
out={}
for name,(lon,lat) in farms.items():
    t=time.time()
    j=requests.get(URL,params={"f":"json","geometry":f"{lon},{lat}","geometryType":"esriGeometryPoint","inSR":"4326","spatialRel":"esriSpatialRelIntersects","outFields":F,"returnGeometry":"false"},headers=UA,timeout=60).json()
    hits=sorted([h["attributes"] for h in j.get("features",[])],key=lambda a:a["FECHA_DECRETO"] or 0)
    yrs=sorted({a["ANO_DECRETO"] for a in hits})
    last=hits[-1] if hits else None
    out[name]={"n_decrees":len(hits),"years_with_decree":yrs,"active_per_STALE_arcgis_flag":any(a["VIGENTE"]=="SI" for a in hits),
               "latest":{k:last[k] for k in ["NOM_TERRITORIO","TERRITORIO","NUM_DECRETO","FT_DECRETO","FT_CADUCIDAD","VIGENTE"]} if last else None,"latency_s":round(time.time()-t,2)}
    print(name,out[name])
json.dump(out,open("sample_dga_decretos_by_farm.json","w"),indent=1,ensure_ascii=False)
