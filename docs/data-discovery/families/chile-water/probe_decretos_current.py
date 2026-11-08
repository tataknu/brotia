"""Current decree status from the DGA history spreadsheet (authoritative; updated 2026-09-04), merged with
ArcGIS polygon history (2008-2023). ArcGIS VIGENTE flag is stale -> never use it for 'active now'."""
import pandas as pd, re, json, datetime as dt, unicodedata
TODAY=dt.date(2026,11,7)
M={m:i+1 for i,m in enumerate(["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"])}
def norm(s): return unicodedata.normalize("NFKD",str(s)).encode("ascii","ignore").decode().lower()
def pdate(s):
    s=str(s).strip()
    m=re.match(r"(\d{4})-(\d{2})-(\d{2})",s)
    if m: return dt.date(*map(int,m.groups()))
    m=re.search(r"(\d{1,2})\s+de\s+([a-zA-Z]+)\s+(?:de\s+)?(\d{4})",norm(s))
    if m and m.group(2) in M: return dt.date(int(m.group(3)),M[m.group(2)],int(m.group(1)))
    return None
v=pd.read_csv("sample_decretos_escasez_historico.csv"); v=v[v.year!="Año"]
v["cad"]=v.caducidad.map(pdate)
act=v[v.cad.notna() & (v.cad>=TODAY)]
print("ACTIVE on",TODAY,":"); print(act[["region","decreto","caducidad","area"]].to_string())
# farm -> (provincia, comuna, main basin) mapping (manual, from Chilean political-administrative division)
farm_geo={"Quillota avocados":("Quillota","Quillota","Aconcagua"),"Ovalle/Limari grapes":("Limari","Ovalle","Limari"),
"Requinoa cherries":("Cachapoal","Requinoa","Rapel (Cachapoal)"),"Santa Cruz wine":("Colchagua","Santa Cruz","Rapel (Tinguiririca)"),
"Curico apples":("Curico","Curico","Mataquito (Teno/Lontue)"),"Talca vineyards":("Talca","Talca","Maule"),"Parral rice":("Linares","Parral","Maule (Perquilauquen/Longavi)"),
"Chillan blueberries":("Diguillin","Chillan","Itata (Nuble)"),"Los Angeles maize":("Biobio","Los Angeles","Biobio (Laja)"),
"Temuco wheat":("Cautin","Temuco","Imperial/Cautin"),"Osorno potatoes":("Osorno","Osorno","Bueno/Rahue")}
hist=json.load(open("sample_dga_decretos_by_farm.json"))
out={}
for f,(prov,com,basin) in farm_geo.items():
    hit=act[act.area.map(norm).str.contains(norm(prov))|act.area.map(norm).str.contains(norm(com))]
    xls_years=sorted(set(v[v.area.map(norm).str.contains(norm(prov))|v.area.map(norm).str.contains(norm(com))].year.astype(str)))
    out[f]={"provincia":prov,"comuna":com,"basin":basin,"active_now_per_dga_xls":not hit.empty,
            "active_decree":hit[["decreto","caducidad","area"]].to_dict("records"),
            "years_with_decree_xls_text_match":xls_years,
            "years_with_decree_arcgis_polygons_2008_2023":hist[f]["years_with_decree"],
            "arcgis_VIGENTE_flag_STALE":hist[f]["active_per_STALE_arcgis_flag"]}
    print(f, "ACTIVE" if not hit.empty else "-", len(set(xls_years)|set(map(str,hist[f]["years_with_decree"]))),"years w/ decree")
json.dump(out,open("sample_decretos_status_by_farm.json","w"),indent=1,ensure_ascii=False,default=str)
