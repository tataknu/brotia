"""Download + parse DGA bulletins (keyless PDFs on dga.mop.gob.cl, need `pdftotext` from poppler):
 - weekly 'Boletin hidrometeorologico' -> reservoir table (capacity, historical monthly mean, current volume, % cap) and
   snow-route tables (depth + SWE vs 1991-2020);
 - monthly 'Boletin' -> per-gauge monthly mean flow table (Q current hydrological year, Q previous, Q.Promedio 1991-2020, Q.Min);
 - yearly 'Pronostico de caudales de deshielo' -> Sep-Mar volume forecast vs 1991-2020.
URLs change every issue: discover them by scraping https://dga.mop.gob.cl/servicios-de-informacion/boletines/ for *.pdf."""
import re, subprocess, sys, json, requests, os, tempfile
UA={"User-Agent":"climate-loan-monitor-hackathon (research probe)"}
WEEKLY="https://dga.mop.gob.cl/uploads/sites/13/2026/01/2026-11-02_Boletin-hidrometeorologico-1.pdf"
MONTHLY="https://dga.mop.gob.cl/uploads/sites/13/2026/02/Boletin_septiembre_2026_v8_compr.pdf"
FORECAST="https://dga.mop.gob.cl/uploads/sites/13/2026/10/Pronostico-DGA-Deshielos-2026-2027.pdf"
def text(url):
    p=os.path.join(tempfile.gettempdir(),os.path.basename(url))
    if not os.path.exists(p): open(p,"wb").write(requests.get(url,headers=UA,timeout=120).content)
    return subprocess.run(["pdftotext","-layout",p,"-"],capture_output=True,text=True).stdout
num=r"([\d.]+,\d+|\d+)"
def f(x): return float(x.replace(".","").replace(",",".")) if "," in x else float(x)
def reservoirs(t):
    rows=[]
    for m in re.finditer(r"^(\S[\w ()+#@&*´'.ÁÉÍÓÚÑáéíóúñ-]*?)\s{2,}(\S[\w ´'ÁÉÍÓÚÑáéíóúñ]*?)\s{2,}(\S[\w ÁÉÍÓÚÑáéíóúñ]*?)\s{2,}"+num+r"\s+"+num+r"\s+"+num+r"\s+(\d+)%\s+"+num+r"\s+"+num+r"\s+(\S.*)$",t,re.M):
        g=m.groups(); rows.append(dict(embalse=g[0].strip(),region=g[1].strip(),cuenca=g[2].strip(),capacidad_hm3=f(g[3]),prom_hist_mensual_hm3=f(g[4]),volumen_actual_hm3=f(g[5]),pct_capacidad=int(g[6]),vol_mes_anterior=f(g[7]),vol_ano_anterior=f(g[8]),uso=g[9].strip()))
    return rows
def snow(t):
    rows=[]
    for m in re.finditer(r"^\s*(?:[A-Za-zÁÉÍÓÚÑáéíóúñ]+\s{2,})?([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)\s{2,}([A-Z][\w .]+?)\d?\s{2,}(\d{4})\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s*$",t,re.M):
        rows.append(dict(cuenca=m.group(1),ruta=m.group(2).strip(),elev_m=int(m.group(3)),val_2026=int(m.group(4)),prom_1991_2020=int(m.group(5)),anom_pct=int(m.group(6)),val_2025=m.group(7)))
    return rows
def forecast(t):
    rows=[]
    for m in re.finditer(r"^(\S[\w .'´ÁÉÍÓÚÑáéíóúñ]+?)\s{2,}(Atacama|Coquimbo|Valparaíso|Metropolitana|O'Higgins|Maule|Ñuble)\s+((?:[\d,]+\s+){7})(\d+)\s+(\d+)\s+(-?\d+)\s*$",t,re.M):
        q=[f(x) for x in m.group(3).split()]
        rows.append(dict(estacion=m.group(1).strip(),region=m.group(2),q_sep_mar_m3s=q,vol_pron_hm3=int(m.group(4)),vol_prom_1991_2020_hm3=int(m.group(5)),anom_pct=int(m.group(6))))
    return rows
def gauge_monthly(t,name):
    i=t.find(name); seg=t[i:i+4000]
    out={}
    for lab in ["Q.2025-2026","Q.2024-2025","Q.Promedio*","Q.Mín.Mes*"]:
        m=re.search(re.escape(lab)+r"((?:\s+[\d.]+){12})",seg)
        if m: out[lab]=[float(x) for x in m.group(1).split()]
    return out
if __name__=="__main__":
    w=text(WEEKLY); r=reservoirs(w); s=snow(w)
    print("reservoirs parsed:",len(r)); [print(" ",x) for x in r if x["cuenca"] in ("Limarí","Aconcagua","Rapel","Maule","Itata","Biobío")]
    print("snow rows parsed:",len(s)); [print(" ",x) for x in s]
    fc=forecast(text(FORECAST)); print("forecast rows:",len(fc)); [print(" ",x["estacion"],x["anom_pct"]) for x in fc]
    mo=text(MONTHLY); g={n:gauge_monthly(mo,n) for n in ["Río Aconcagua en Chacabuquito","Río Grande en Las Ramadas","Río Cachapoal en Puente Termas","Río Tinguiririca bajo Los Briones","Río Maule en Armerillo","Río Ñuble en San Fabián","Río Biobío en Rucalhue"]}
    for k,v in g.items(): print(" ",k,{a:b[-1] if b else None for a,b in v.items()},"(Sep, hydro-year Oct..Sep)")
    json.dump({"weekly_url":WEEKLY,"reservoirs":r,"snow_routes":s,"forecast_url":FORECAST,"snowmelt_forecast":fc,"monthly_url":MONTHLY,"monthly_gauge_q_oct_to_sep":g},open("sample_dga_bulletins_parsed.json","w"),indent=1,ensure_ascii=False)
