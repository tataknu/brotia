"""Scan a 0.05 deg grid around the sample farms with the Open-Meteo Flood API (GloFAS v4)
to locate main-channel cells of Rio Grande and Rio Pirai (highest mean discharge)."""
import requests, numpy as np, json, time
lats = np.round(np.arange(-17.85, -16.75, 0.05), 3)
lons = np.round(np.arange(-63.45, -62.35, 0.05), 3)
pts = [(la, lo) for la in lats for lo in lons]
out = []
for i in range(0, len(pts), 100):
    chunk = pts[i:i+100]
    r = requests.get("https://flood-api.open-meteo.com/v1/flood", params={
        "latitude": ",".join(str(p[0]) for p in chunk),
        "longitude": ",".join(str(p[1]) for p in chunk),
        "daily": "river_discharge", "start_date": "2024-01-01", "end_date": "2024-03-31"}, timeout=60)
    r.raise_for_status()
    for (la, lo), d in zip(chunk, r.json()):
        q = [v for v in d["daily"]["river_discharge"] if v is not None]
        out.append((round(float(np.mean(q)),2) if q else None, la, lo, d["latitude"], d["longitude"]))
    time.sleep(1)
out = [o for o in out if o[0] is not None]
out.sort(reverse=True)
for o in out[:40]: print(o)
json.dump(out, open(__file__.replace(".py", "_result.json"), "w"))
