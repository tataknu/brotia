"""DGA ArcGIS 'ALERTAS' layer joins the hydrometric network with a live alert view (V_DGA_GIS_ALERTAS):
mod_fechra (timestamp), mod_valor (latest value), mod_indale/mod_alerta (alert index). Keyless. Probe freshness + key gauges."""
import requests, json, time, datetime as dt, collections
UA={"User-Agent":"climate-loan-monitor-hackathon (research probe)"}
URL="https://rest-sit.mop.gob.cl/arcgis/rest/services/DGA/ALERTAS/MapServer/0/query"
P="SITMOP_PROD.SITMOP_DESA.TG_RED_HIDROMETEO."; A="SITMOP_PROD.SDE.V_DGA_GIS_ALERTAS."
ms=lambda v: dt.datetime.fromtimestamp(v/1000,dt.UTC).isoformat(timespec="minutes") if v else None
t=time.time()
r=requests.get(URL,params={"f":"json","where":"1=1","outFields":"*","returnGeometry":"true","outSR":"4326"},headers=UA,timeout=90)
feats=r.json()["features"]; print("status",r.status_code,"latency",round(time.time()-t,2),"n",len(feats))
rows=[]
for f in feats:
    a=f["attributes"]; g=f.get("geometry",{})
    rows.append(dict(code=a[P+"CODBNA"],name=a[P+"NOMBRERED"],fluv=a[P+"FLUVIOMETRICA"],snow=a[P+"NIEVESYGLAC"],tx=a[P+"TIPOTRASMISION"],
                     t=ms(a[A+"mod_fechra"]),val=a[A+"mod_valor"],indale=a[A+"mod_indale"],alerta=a[A+"mod_alerta"],lon=g.get("x"),lat=g.get("y")))
print("timestamps:",collections.Counter(r_["t"] for r_ in rows).most_common(3))
print("nonzero values:",sum(1 for r_ in rows if r_["val"]), "alerts:",collections.Counter(r_["alerta"] for r_ in rows))
keys=["05410002","06008005","06028001","07104002","07321002","08105001","08317001","04511002","04558001"]
sel=[r_ for r_ in rows if r_["code"][:8] in keys]
for r_ in sel: print(r_)
print("sample nonzero:",[r_ for r_ in rows if r_["val"]][:5])
json.dump({"n":len(rows),"key_gauges":sel,"nonzero_sample":[r_ for r_ in rows if r_["val"]][:20]},open("sample_dga_alertas.json","w"),indent=1,ensure_ascii=False)
