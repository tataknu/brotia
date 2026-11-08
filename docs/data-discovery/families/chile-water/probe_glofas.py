"""Probe Open-Meteo Flood API (GloFAS v4 reanalysis + forecast) for central-Chile river gauge points. Keyless.
Note: long ranges are weighted heavily by Open-Meteo's fair-use counter -> 429 if you burst; space requests."""
import requests, time, json, datetime as dt
UA={"User-Agent":"climate-loan-monitor-hackathon (research probe)"}
pts={ # DGA gauge coordinates (CAMELS-CL attributes)
 "Aconcagua@Chacabuquito 05410002":(-70.5094,-32.8503),
 "Grande@LasRamadas 04511002 (Limari)":(-70.5811,-31.0117),
 "Cachapoal@PteTermas 06008005":(-70.5667,-34.25),
 "Tinguiririca@BajoBriones 06028001":(-70.8267,-34.7186),
 "Teno@DespJuntaClaro 07104002":(-70.8206,-34.9961),
 "Maule@Armerillo 07321002":(-71.1139,-35.7061),
 "Nuble@LaPunilla 08105001":(-71.3208,-36.6583),
 "Biobio@Rucalhue 08317001":(-71.9017,-37.7106),
}
today=dt.date(2026,11,7)
out={}
for k,(lon,lat) in pts.items():
    for attempt in range(3):
        t=time.time()
        r=requests.get("https://flood-api.open-meteo.com/v1/flood",params=dict(latitude=lat,longitude=lon,daily="river_discharge",start_date="1991-01-01",end_date="2026-12-31"),headers=UA,timeout=60)
        dtt=time.time()-t
        if r.status_code!=429: break
        time.sleep(65)
    j=r.json(); d=j.get("daily",{}); q=d.get("river_discharge",[]); tt=d.get("time",[])
    pairs=[(a,b) for a,b in zip(tt,q) if b is not None]
    rec={"status":r.status_code,"latency_s":round(dtt,2),"grid":(j.get("latitude"),j.get("longitude")),"first":pairs[0] if pairs else None,"last":pairs[-1] if pairs else None}
    if pairs:
        # Nov 1-6 climatology 1991-2020 vs 2026
        import statistics
        def win(y): return [b for a,b in pairs if a.startswith(f"{y}-10") ]
        clim=[statistics.mean(win(y)) for y in range(1991,2021) if win(y)]
        cur=win(2026)
        rec["oct_mean_2026"]=round(statistics.mean(cur),1) if cur else None
        rec["oct_mean_1991_2020_median"]=round(statistics.median(clim),1)
        rec["oct_2026_percentile_vs_1991_2020"]=round(100*sum(c<rec["oct_mean_2026"] for c in clim)/len(clim)) if cur else None
        rec["today_value"]=[b for a,b in pairs if a==str(today)]
    out[k]=rec; print(k,rec, flush=True)
    time.sleep(12)
json.dump(out,open("sample_glofas_summary.json","w"),indent=1)
