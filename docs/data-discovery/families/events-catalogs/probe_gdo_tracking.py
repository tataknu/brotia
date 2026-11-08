"""GDO Drought Tracking (jspeS, SPEI-based, 0.25 deg, dekadal, since 1991) keyless probe.
Downloads yearly zips (~0.5 MB each) to a temp dir, finds spatio-temporal drought
clusters (id_cl_st) covering sample farms, writes gdo_drought_events_farms.csv."""
import io, json, zipfile, sys, csv, tempfile, requests, collections
from shapely.geometry import shape, Point
from farms import FARMS
B="https://drought.emergency.copernicus.eu/data/Drought_Observatories_datasets/GDO_Drought_Tracking/ver1-0-0/"
years=sys.argv[1:] or ["2022","2023","2024","2025","2026"]
ev=collections.defaultdict(lambda: dict(dekads=set(),farms=set(),max_area=0))
listing=requests.get(B,timeout=60).text
for y in years:
    names=sorted(set(n for n in __import__('re').findall(r'jspeS_m_gdo_%s\d{4}_\d{8}_t\.zip'%y, listing)))
    for n in names:
        z=zipfile.ZipFile(io.BytesIO(requests.get(B+n,timeout=120).content))
        for m in z.namelist():
            if not m.endswith('.json'): continue
            for f in json.loads(z.read(m))['features']:
                g=shape(f['geometry']).buffer(0)
                hit=[x['name'] for x in FARMS if g.contains(Point(*x['lonlat']))]
                if hit:
                    p=f['properties']; e=ev[p['id_cl_st']]
                    e['dekads'].add(p['time']); e['farms'].update(hit); e['max_area']=max(e['max_area'],p['area_km2'])
rows=[dict(event_id=k,start=min(v['dekads']),last_dekad=max(v['dekads']),n_dekads=len(v['dekads']),n_farms=len(v['farms']),max_area_km2=round(v['max_area'])) for k,v in sorted(ev.items(),key=lambda kv:min(kv[1]['dekads']))]
with open('gdo_drought_events_farms.csv','w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
for r in rows: print(r)
