"""WaPOR v3 L1: October AETI (monthly, 300m) 2018-2026 at Tajibos, and daily RET-E last 11 days vs Open-Meteo ERA5/forecast ET0."""
import os,rasterio,pandas as pd,requests,time
os.environ.update(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR")
U="https://storage.googleapis.com/fao-gismgr-wapor-3-data/DATA/WAPOR-3/MAPSET/{m}/WAPOR-3.{m}.{c}.tif"
P=(-62.52,-16.86)
def s(m,c):
    with rasterio.open("/vsicurl/"+U.format(m=m,c=c)) as ds: v=next(ds.sample([P]))[0]; return None if v==ds.nodata else float(v)*ds.scales[0]
t=time.time(); oct_aeti={y:s("L1-AETI-M",f"{y}-10") for y in range(2018,2027)}; print("Oct AETI mm/month",{k:round(v,1) for k,v in oct_aeti.items()},f"{time.time()-t:.1f}s")
oct_ret={y:s("L1-RET-M",f"{y}-10") for y in range(2018,2027)}; print("Oct RET mm/month",{k:round(v,1) for k,v in oct_ret.items()})
days=pd.date_range("2026-10-26","2026-11-05")
ret={d.date().isoformat():round(s("L1-RET-E",d.strftime("%Y-%m-%d")),2) for d in days}
o=requests.get("https://api.open-meteo.com/v1/forecast",params=dict(latitude=P[1],longitude=P[0],past_days=12,forecast_days=1,daily="et0_fao_evapotranspiration",timezone="America/La_Paz"),timeout=60).json()["daily"]
om=dict(zip(o["time"],o["et0_fao_evapotranspiration"]))
print("date        WaPOR_RET-E  OpenMeteo_fcst_ET0"); [print(k,v,om.get(k)) for k,v in ret.items()]
