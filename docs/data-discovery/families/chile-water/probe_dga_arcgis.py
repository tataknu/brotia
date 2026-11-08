"""Probe DGA ArcGIS REST (rest-sit.mop.gob.cl, keyless): active water-scarcity decrees (polygons) by point,
DGA hydrometric network and reservoir stations. Point-in-polygon query per farm."""
import requests, time, json
UA={"User-Agent":"climate-loan-monitor-hackathon (research probe)"}
B="https://rest-sit.mop.gob.cl/arcgis/rest/services/DGA"
farms={"Quillota avocados":(-71.25,-32.88),"Ovalle/Limari grapes":(-71.20,-30.60),"Requinoa cherries":(-70.80,-34.28),
"Santa Cruz wine":(-71.37,-34.64),"Curico apples":(-71.24,-34.98),"Talca vineyards":(-71.66,-35.43),"Parral rice":(-71.83,-36.14),
"Chillan blueberries":(-72.10,-36.60),"Los Angeles maize":(-72.35,-37.47),"Temuco wheat":(-72.60,-38.74),"Osorno potatoes":(-73.13,-40.57)}
def q(svc,layer=0,**kw):
    p={"f":"json","outFields":"*","returnGeometry":"false"}; p.update(kw)
    t=time.time(); r=requests.get(f"{B}/{svc}/MapServer/{layer}/query",params=p,headers=UA,timeout=60); return r,time.time()-t
if __name__=='__main__':
    # 1) all decree polygons (layer name says 'vigentes' but it holds 2008-2023 history + stale VIGENTE flag)
    r,dt=q("Decretos_Escasez_Hidrica",where="1=1")
    j=r.json(); print("decretos vigentes:",r.status_code,round(dt,2),"n=",len(j.get("features",[])))
    fields=[f["name"] for f in j.get("fields",[])]; print(" fields:",fields)
    for f in j.get("features",[])[:12]: print("  ",{k:v for k,v in f["attributes"].items() if v not in (None,"")})
    res={"decretos_vigentes":[f["attributes"] for f in j.get("features",[])],"farms":{}}
    # 2) point-in-polygon per farm
    for name,(lon,lat) in farms.items():
        r,dt=q("Decretos_Escasez_Hidrica",geometry=f"{lon},{lat}",geometryType="esriGeometryPoint",inSR="4326",spatialRel="esriSpatialRelIntersects")
        hits=r.json().get("features",[])
        res["farms"][name]={"status":r.status_code,"latency_s":round(dt,2),"in_active_decree":bool(hits),"decree":[h["attributes"] for h in hits]}
        print(name, r.status_code, round(dt,2), "IN DECREE" if hits else "-", [h["attributes"].get(fields[1]) if len(fields)>1 else h for h in hits][:2])
    json.dump(res,open("sample_dga_arcgis_raw_by_farm.json","w"),indent=1,ensure_ascii=False,default=str)
