"""Fetch SENAMHI Bolivia active weather + hydrological alerts (public JSON used by senamhi.gob.bo homepage),
and test which sample farms fall inside each alert polygon. No auth. Writes a trimmed sample."""
import json, time, requests
FARMS = {"Estancia Los Tajibos":(-62.52,-16.86),"Colonia Cuatro Canadas Lote 7":(-62.47,-17.3),"Finca Okinawa Dos":(-62.85,-17.18),
         "Arrocera Mineros":(-63.29,-17.2),"Agricola Warnes Sur":(-63.08,-17.56),"Granja Las Londras":(-62.76,-17.74)}
def pip(x, y, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: inside = not inside
    return inside
def in_multipolygon(pt, mp):
    return any(pip(pt[0], pt[1], poly[0]) for poly in mp["coordinates"])
for path in ["active-alerts", "active-hydro-alerts"]:
    t = time.time(); r = requests.get(f"https://senamhi.gob.bo/index.php/api/alertas/{path}", timeout=60)
    print(path, "HTTP", r.status_code, f"{time.time()-t:.2f}s", len(r.content), "B")
    j = r.json(); data = j["data"]["data"] if isinstance(j.get("data"), dict) else j.get("data")
    out = []
    for a in data or []:
        slim = {k: a.get(k) for k in ("id","code","date","fecha","fechaf","idAlertType","idEventType","status","titulo","description")}
        if path == "active-alerts" and a.get("dropArea"):
            slim["farms_inside"] = [n for n, p in FARMS.items() if in_multipolygon(p, a["dropArea"])]
            slim["n_polygons"] = len(a["dropArea"]["coordinates"])
        out.append(slim); print("  ", json.dumps(slim, ensure_ascii=False)[:260])
    json.dump(out, open(f"samples/senamhi_{path}_{time.strftime('%Y%m%d')}.json", "w"), ensure_ascii=False, indent=1)
