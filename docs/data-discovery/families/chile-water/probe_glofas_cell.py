"""GloFAS cells near small Andean gauges are often off-river. Search a 5x5 (0.05 deg) neighbourhood and pick the
cell with the highest mean discharge over a short window (multi-location request). Keyless Open-Meteo Flood API."""
import requests, json, sys, statistics
UA={"User-Agent":"climate-loan-monitor-hackathon (research probe)"}
def best_cell(lon,lat,start="2015-11-01",end="2016-01-31",step=0.05,n=2):
    lats=[];lons=[]
    for i in range(-n,n+1):
        for j in range(-n,n+1):
            lats.append(round(lat+i*step,3)); lons.append(round(lon+j*step,3))
    r=requests.get("https://flood-api.open-meteo.com/v1/flood",params=dict(latitude=",".join(map(str,lats)),longitude=",".join(map(str,lons)),daily="river_discharge",start_date=start,end_date=end),headers=UA,timeout=60)
    r.raise_for_status(); res=r.json()
    best=max(res,key=lambda x: statistics.mean([v or 0 for v in x["daily"]["river_discharge"]]))
    return best["latitude"],best["longitude"],round(statistics.mean([v or 0 for v in best["daily"]["river_discharge"]]),1)
if __name__=="__main__":
    lon,lat=float(sys.argv[1]),float(sys.argv[2]); print(best_cell(lon,lat))
