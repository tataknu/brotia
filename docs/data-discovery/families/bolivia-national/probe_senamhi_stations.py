"""Probe SENAMHI Bolivia GeoServer WFS (public, no auth) for stations near the sample farms.
Writes samples/senamhi_stations_santacruz.geojson and prints nearest stations per farm."""
import json, math, time, requests
FARMS = [("Estancia Los Tajibos",-62.52,-16.86),("Agropecuaria Brecha 8",-62.7,-16.97),("Colonia Cuatro Canadas Lote 7",-62.47,-17.3),
 ("Hacienda El Cusi",-62.55,-17.38),("Agricola Pailon Norte",-62.68,-17.56),("Granja Las Londras",-62.76,-17.74),("Finca Okinawa Dos",-62.85,-17.18),
 ("Parcela Okinawa Uno",-62.93,-17.27),("Arrocera Mineros",-63.29,-17.2),("Canaveral San Antonio",-63.21,-17.29),("Agricola Warnes Sur",-63.08,-17.56),("Estancia Mineros Norte",-63.18,-17.03)]
URL = "https://senageo.senamhi.gob.bo/geoserver/senamhi/wfs"
params = dict(service="WFS", version="1.0.0", request="GetFeature", typeName="senamhi:estaciones",
              outputFormat="application/json", bbox="-64.2,-18.6,-61.6,-15.8,EPSG:4326")
t=time.time(); r = requests.get(URL, params=params, timeout=90); dt=time.time()-t
print("HTTP", r.status_code, f"{dt:.2f}s", len(r.content), "bytes")
fc = r.json(); feats = fc["features"]; print("stations in bbox:", len(feats))
keep = ["codigo_senamhimet","codigo","estacion","latitud","longitud","altura","id_tipo_estacion","activo","estado","fecha_inicio","clasificacion","orden","cod_omm","cod_oaci","propietario","operador","publico"]
slim = {"type":"FeatureCollection","features":[{"type":"Feature","geometry":f["geometry"],"properties":{k:f["properties"].get(k) for k in keep}} for f in feats]}
json.dump(slim, open("samples/senamhi_stations_santacruz.geojson","w"), ensure_ascii=False)
def km(a,b,c,d):
    R=6371; p1,p2=math.radians(b),math.radians(d); dp=p2-p1; dl=math.radians(c-a)
    return 2*R*math.asin(math.sqrt(math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2))
for name,lon,lat in FARMS:
    ds = sorted(((km(lon,lat,f["geometry"]["coordinates"][0],f["geometry"]["coordinates"][1]),f["properties"]) for f in feats), key=lambda x:x[0])[:4]
    print(f"\n{name} ({lon},{lat})")
    for d,p in ds:
        print(f"  {d:5.1f} km  {p['estacion']:<32} cod={p['codigo_senamhimet']} tipo={p['id_tipo_estacion']} {p['estado']} inicio={p['fecha_inicio']} {p.get('clasificacion')} omm={p.get('cod_omm')} oaci={p.get('cod_oaci')}")
