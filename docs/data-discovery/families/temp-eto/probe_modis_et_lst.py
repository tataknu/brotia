"""ORNL DAAC MODIS web service (keyless REST): MOD16A2 / MOD16A2GF actual ET and MOD11A2 LST point values at Tajibos."""
import requests,time
for prod,band,s,e,scale in [("MOD16A2","ET_500m","A2026273","A2026289",0.1),("MOD16A2GF","ET_500m","A2025273","A2025289",0.1),("MOD11A2","LST_Day_1km","A2026281","A2026297",0.02)]:
    t=time.time()
    r=requests.get(f"https://modis.ornl.gov/rst/api/v1/{prod}/subset",params=dict(latitude=-16.86,longitude=-62.52,band=band,startDate=s,endDate=e,kmAboveBelow=0,kmLeftRight=0),headers={"Accept":"application/json"},timeout=90)
    j=r.json(); out=[(x["calendar_date"],x["data"][0], round(x["data"][0]*scale-(273.15 if "LST" in band else 0),2)) for x in j.get("subset",[])]
    print(prod,band,r.status_code,f"{time.time()-t:.1f}s",out,"(ET: kg/m2 per 8 days; LST: degC)")
