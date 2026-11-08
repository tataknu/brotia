"""Open-Meteo archive (ERA5, 0.25deg) daily precip 1981..latest for the 12 sample farms in ONE call (multi-location). No key."""
import requests, time, json, gzip
farms = [("Estancia Los Tajibos",-62.52,-16.86),("Agropecuaria Brecha 8",-62.7,-16.97),("Colonia Cuatro Canadas Lote 7",-62.47,-17.3),
 ("Hacienda El Cusi",-62.55,-17.38),("Agricola Pailon Norte",-62.68,-17.56),("Granja Las Londras",-62.76,-17.74),("Finca Okinawa Dos",-62.85,-17.18),
 ("Parcela Okinawa Uno",-62.93,-17.27),("Arrocera Mineros",-63.29,-17.2),("Canaveral San Antonio",-63.21,-17.29),("Agricola Warnes Sur",-63.08,-17.56),("Estancia Mineros Norte",-63.18,-17.03)]
t0 = time.time()
r = requests.get("https://archive-api.open-meteo.com/v1/archive", params={
    "latitude": ",".join(str(f[2]) for f in farms), "longitude": ",".join(str(f[1]) for f in farms),
    "start_date": "1981-01-01", "end_date": "2026-11-06", "daily": "precipitation_sum", "models": "era5", "timezone": "UTC"}, timeout=180)
print(r.status_code, f"{time.time()-t0:.1f}s", len(r.content), "bytes", r.headers.get("content-type"))
d = r.json()
out = {f[0]: {"lat": x["latitude"], "lon": x["longitude"], "time0": x["daily"]["time"][0], "p": x["daily"]["precipitation_sum"]} for f, x in zip(farms, d)}
t = d[0]["daily"]["time"]; p = d[0]["daily"]["precipitation_sum"]
last = max(i for i, v in enumerate(p) if v is not None)
print("grid cells:", sorted({(x["latitude"], x["longitude"]) for x in d}))
print("latest non-null:", t[last], "first:", t[0])
with gzip.open("sample_era5_om_12farms_1981_2026.json.gz", "wt") as f: json.dump({"time": t, "farms": out}, f)
