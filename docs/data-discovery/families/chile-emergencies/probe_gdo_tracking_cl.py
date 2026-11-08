"""Copernicus GDO Drought Tracking (jspeS, SPEI-based, 0.25 deg, dekadal, since 1991, keyless):
find drought clusters (id_cl_st) covering the Chile test points. Pattern adapted from the
events-catalogs family. Usage: python probe_gdo_tracking_cl.py 2019 2020 2021 2022 ..."""
import io, json, zipfile, sys, csv, re, time, requests, collections
from shapely.geometry import shape, Point
from farms_cl import FARMS
B = "https://drought.emergency.copernicus.eu/data/Drought_Observatories_datasets/GDO_Drought_Tracking/ver1-0-0/"
years = sys.argv[1:] or ["2021"]
ev = collections.defaultdict(lambda: dict(dekads=set(), farms=set(), max_area=0))
listing = requests.get(B, timeout=60).text
latest = sorted(set(re.findall(r'jspeS_m_gdo_\d{8}_(\d{8})_t\.zip', listing)))[-1:]
print("latest file end-date in listing", latest)
for y in years:
    names = sorted(set(re.findall(r'jspeS_m_gdo_%s\d{4}_\d{8}_t\.zip' % y, listing)))
    for n in names:
        t = time.time(); c = requests.get(B + n, timeout=120).content
        print(" ", n, len(c), "B", f"{time.time()-t:.2f}s")
        z = zipfile.ZipFile(io.BytesIO(c))
        for m in z.namelist():
            if not m.endswith('.json'): continue
            for f in json.loads(z.read(m))['features']:
                g = shape(f['geometry']).buffer(0)
                hit = [nm for nm, lon, lat in FARMS if g.contains(Point(lon, lat))]
                if hit:
                    p = f['properties']; e = ev[p['id_cl_st']]
                    e['dekads'].add(p['time']); e['farms'].update(hit); e['max_area'] = max(e['max_area'], p['area_km2'])
rows = [dict(event_id=k, start=min(v['dekads']), last_dekad=max(v['dekads']), n_dekads=len(v['dekads']), n_farms=len(v['farms']),
             farms="; ".join(sorted(v['farms'])), max_area_km2=round(v['max_area'])) for k, v in sorted(ev.items(), key=lambda kv: min(kv[1]['dekads']))]
if rows:
    with open('gdo_drought_events_chile_farms.csv', 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
for r in rows: print({k: r[k] for k in ('event_id', 'start', 'last_dekad', 'n_dekads', 'n_farms', 'max_area_km2')})
