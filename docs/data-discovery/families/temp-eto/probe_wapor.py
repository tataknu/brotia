"""FAO WaPOR v3 (keyless gismgr API + public COGs): list mapsets, latest raster, sample at Santa Cruz farm."""
import requests,json,time,os,rasterio
os.environ.update(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR")
B="https://data.apps.fao.org/gismgr/api/v2/catalog/workspaces/WAPOR-3/mapsets"
def allpages(url):
    out=[]
    while url:
        j=requests.get(url,timeout=60).json()["response"]; out+=j["items"]; url=(j.get("links") or [{}])
        url=next((l["href"] for l in j.get("links",[]) if l.get("rel")=="next"),None)
    return out
ms=allpages(B)
print("mapsets",len(ms)); print([m["code"] for m in ms if m["code"].startswith("L1")])
pts={"Tajibos":(-62.52,-16.86),"Mineros":(-63.29,-17.2)}
for code in ["L1-RET-D","L1-AETI-D","L1-AETI-M","L1-RET-E","L1-NPP-D"]:
    if code not in [m["code"] for m in ms]: print(code,"NOT IN CATALOG"); continue
    t=time.time(); rs=allpages(f"{B}/{code}/rasters")
    codes=sorted(r["code"] for r in rs); last=[r for r in rs if r["code"]==codes[-1]][0]
    print(f"\n{code}: n={len(rs)} first={codes[0]} last={codes[-1]} listing {time.time()-t:.1f}s url={last.get('downloadUrl')}")
    try:
        with rasterio.open("/vsicurl/"+last["downloadUrl"]) as ds:
            print("  bounds",ds.bounds,"res",ds.res,"crs",ds.crs,"scale",ds.scales,"nodata",ds.nodata)
            print("  sample",{k:(float(v[0]) if v[0]!=ds.nodata else None) for k,v in zip(pts,ds.sample(list(pts.values())))})
    except Exception as e: print("  read err",str(e)[:150])
