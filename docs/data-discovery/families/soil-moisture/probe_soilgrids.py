"""Probe ISRIC SoilGrids v2.0 REST (properties/query) for one farm; derive AWC via Saxton-Rawls 2006 PTF."""
import time, json, requests, math
LAT, LON = -16.86, -62.52
props=["clay","sand","silt","soc","bdod","wv0033","wv1500","wv0010"]
depths=["0-5cm","5-15cm","15-30cm","30-60cm","60-100cm"]
url="https://rest.isric.org/soilgrids/v2.0/properties/query"
params=[("lon",LON),("lat",LAT)]+[("property",p) for p in props]+[("depth",d) for d in depths]+[("value","mean")]
t=time.time(); r=requests.get(url, params=params, timeout=90); dt=time.time()-t
print("SoilGrids properties/query:", r.status_code, f"{dt:.2f}s", len(r.content), "bytes")
j=r.json()
json.dump(j, open("sample_soilgrids_tajibos.json","w"), indent=1)
out={}
for layer in j["properties"]["layers"]:
    name=layer["name"]; dfac=layer["unit_measure"]["d_factor"]; unit=layer["unit_measure"]["target_units"]
    for d in layer["depths"]:
        v=d["values"]["mean"]
        out.setdefault(d["label"],{})[name]=None if v is None else v/dfac
    print(f"  {name} ({unit}, d_factor={dfac}):", {d['label']: d['values']['mean'] for d in layer['depths']})
# Saxton & Rawls 2006 PTF
def saxton(S,C,OM):
    t1500=-0.024*S+0.487*C+0.006*OM+0.005*S*OM-0.013*C*OM+0.068*S*C+0.031
    th1500=t1500+(0.14*t1500-0.02)
    t33=-0.251*S+0.195*C+0.011*OM+0.006*S*OM-0.027*C*OM+0.452*S*C+0.299
    th33=t33+(1.283*t33**2-0.374*t33-0.015)
    return th33, th1500
thick={"0-5cm":50,"5-15cm":100,"15-30cm":150,"30-60cm":300,"60-100cm":400}
taw=0; taw_sg=0
for lab in depths:
    o=out[lab]
    S=o["sand"]/100; C=o["clay"]/100; OM=o["soc"]*1.724/10  # soc g/kg -> % OM
    fc,wp=saxton(S,C,OM)
    awc=fc-wp; taw+=awc*thick[lab]
    sgawc=None
    if o.get("wv0033") is not None and o.get("wv1500") is not None:
        sgawc=(o["wv0033"]-o["wv1500"])/100  # 10^-2 cm3/cm3 -> m3/m3
        taw_sg+=sgawc*thick[lab]
    print(f"  {lab}: sand={o['sand']:.1f}% clay={o['clay']:.1f}% soc={o['soc']:.1f}g/kg -> Saxton FC={fc:.3f} WP={wp:.3f} AWC={awc:.3f}; SoilGrids wv0033={o.get('wv0033')} wv1500={o.get('wv1500')}")
print(f"TAW 0-100cm Saxton-Rawls = {taw:.0f} mm; SoilGrids wv0033-wv1500 = {taw_sg:.0f} mm")
