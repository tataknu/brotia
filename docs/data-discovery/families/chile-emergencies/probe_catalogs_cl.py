"""GDACS / IFRC GO / GLIDE / ReliefWeb RSS / DesInventar for Chile. No keys."""
import requests, time, json, collections
H = {"User-Agent": "Mozilla/5.0 (research probe)"}
def get(u, **kw):
    t = time.time(); r = requests.get(u, headers=H, timeout=60, **kw); return r, time.time() - t
# GDACS
evs = []
import sys
SKIP_GDACS = '--skip-gdacs' in sys.argv
for page in (range(1, 8) if not SKIP_GDACS else []):
    r, dt_ = get("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH",
                 params={"country": "Chile", "fromDate": "2016-01-01", "toDate": "2026-11-07",
                         "alertlevel": "green;orange;red", "eventlist": "FL;DR;WF;TC;VO", "pagesize": 100, "pagenumber": page})
    if r.status_code != 200 or not r.text.strip(): print("gdacs page", page, r.status_code); break
    f = r.json().get("features", []); evs += f
    print("gdacs page", page, r.status_code, f"{dt_:.2f}s", len(f))
    if len(f) < 100: break
    time.sleep(1)
c = collections.Counter((e["properties"]["eventtype"], e["properties"]["alertlevel"]) for e in evs)
print("GDACS Chile events", len(evs), dict(c))
big = [e["properties"] for e in evs if e["properties"]["alertlevel"] in ("Orange", "Red")]
for p in sorted(big, key=lambda p: p["fromdate"])[-12:]:
    print("  ", p["eventtype"], p["eventid"], p["alertlevel"], p["fromdate"][:10], p["todate"][:10], p.get("name", "")[:60])
last = max((e["properties"]["todate"] for e in evs), default=None)
print("  latest todate", last)
if evs: json.dump([{k: e["properties"].get(k) for k in ("eventtype", "eventid", "episodeid", "alertlevel", "fromdate", "todate", "name", "glide")} for e in evs],
          open("gdacs_chile_events.json", "w"))
# IFRC GO (country id lookup)
r, dt_ = get("https://goadmin.ifrc.org/api/v2/country/", params={"search": "Chile"})  # iso3= filter is ignored
cid = [c for c in r.json()["results"] if c.get("iso3") == "CHL"][0]["id"]  # = 46
r, dt_ = get("https://goadmin.ifrc.org/api/v2/event/", params={"countries__in": cid, "limit": 200, "ordering": "-disaster_start_date"})
go = r.json()["results"]
print("IFRC GO Chile id", cid, r.status_code, f"{dt_:.2f}s", "events", r.json()["count"])
for e in go[:10]: print("  ", e["disaster_start_date"][:10], e["dtype"]["name"] if e.get("dtype") else "", e["name"][:70], e.get("glide"))
# GLIDE
r, dt_ = get("https://www.glidenumber.net/glide/jsonglideset.jsp", params={"level1": "CHL", "fromyear": 2016, "toyear": 2026})
gl = r.json().get("glideset", []) if r.status_code == 200 else []
print("GLIDE CHL", r.status_code, f"{dt_:.2f}s", len(gl))
for g in gl[:12]: print("  ", g.get("year"), g.get("month"), g.get("event"), g.get("number"), g.get("location", "")[:60])
# ReliefWeb RSS (C50 = Chile)
r, dt_ = get("https://reliefweb.int/disasters/rss.xml", params={"advanced-search": "(C50)"})
import re
titles = re.findall(r"<title>(.*?)</title>", r.text)[1:]
print("ReliefWeb RSS Chile", r.status_code, f"{dt_:.2f}s", len(titles), titles[:8])
# DesInventar
r, dt_ = get("https://www.desinventar.net/DesInventar/profiletab.jsp", params={"countrycode": "chl"})
print("DesInventar CHL profile", r.status_code, f"{dt_:.2f}s", len(r.content))
yrs = re.findall(r"(19[6-9]\d|20[0-2]\d)", r.text)
print("  year tokens range", min(yrs) if yrs else None, max(yrs) if yrs else None)
r = requests.head("https://www.desinventar.net/DesInventar/download/DI_export_chl.zip", headers=H, timeout=60, allow_redirects=True)
print("  export zip", r.status_code, r.headers.get("content-length"), r.headers.get("last-modified"))
