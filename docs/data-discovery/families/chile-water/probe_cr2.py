"""Probe CR2 Explorador Climatico request.php (keyless JSON) for DGA streamflow (qflxDaily)."""
import requests, json, time, calendar, datetime as dt
UA={"User-Agent":"climate-loan-monitor-hackathon research probe"}
base="https://explorador.cr2.cl/request.php"
def ts(y,m,d): return calendar.timegm(dt.date(y,m,d).timetuple())
def opts(action, sites=None, start=(2025,9,1), end=(2026,11,1), intv="month"):
    return {"action":[action],
      "variable":{"id":"qflxDaily","var":"caudal","intv":intv,"season":"Invierno","stat":"mean","minFrac":0},
      "time":{"start":ts(*start),"end":ts(*end),"months":"Año completo"},
      "anomaly":{"enabled":False,"type":"diff","rank":"no","start_year":1991,"end_year":2020,"minFrac":70},
      "map":{"stat":"mean","statOption":None,"minFrac":0,"borderColor":"7F7F7F","colorRamp":"Jet","showNaN":"false",
             "limits":{"range":[5,95],"size":[4,12],"type":"prc"}},
      "series":{"sites":sites or [],"start":None,"end":None},
      "export":{"map":"Shapefile","series":"CSV","view":{"frame":"Vista Actual","map":"roadmap","clat":-33,"clon":-71,"zoom":5,"width":900,"height":600}}}
if __name__=="__main__":
    t=time.time(); r=requests.get(base,params={"options":json.dumps(opts("map"))},headers=UA,timeout=90)
    print(r.status_code, round(time.time()-t,2), len(r.content)); open("cr2_map_caudal.json","wb").write(r.content); print(r.text[:800])
