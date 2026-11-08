"""Download one GOES-19 GLM L2 LCFA 20-s file (keyless, NOAA Open Data on AWS) and count flashes in the Santa Cruz portfolio bbox.
Picks the 20-s file nearest the hour with most flashes in bbox among a few sampled hours of a recent day."""
import requests, re, h5py, io, time, numpy as np, sys
B = "https://noaa-goes19.s3.amazonaws.com/"
BBOX = (-63.6, -18.0, -62.2, -16.6)  # lon_min, lat_min, lon_max, lat_max (portfolio + ~25 km)
def ls(prefix):
    r = requests.get(B, params={"list-type": "2", "prefix": prefix}, timeout=60)
    return re.findall(r"<Key>(.*?)</Key>", r.text), [int(x) for x in re.findall(r"<Size>(\d+)</Size>", r.text)]
def flashes(key):
    t = time.time(); r = requests.get(B + key, timeout=60); dt = round(time.time() - t, 2)
    f = h5py.File(io.BytesIO(r.content), "r")
    lat = f["flash_lat"][:].astype(float); lon = f["flash_lon"][:].astype(float)
    # apply CF scale/offset if present
    for arr_name, arr in (("flash_lat", lat), ("flash_lon", lon)):
        a = f[arr_name].attrs
        if "scale_factor" in a: arr *= float(a["scale_factor"][0]); arr += float(a["add_offset"][0])
    inb = (lon >= BBOX[0]) & (lon <= BBOX[2]) & (lat >= BBOX[1]) & (lat <= BBOX[3])
    return dict(key=key.split("/")[-1], status=r.status_code, s=dt, bytes=len(r.content), n_flash_total=len(lat), n_flash_bbox=int(inb.sum()),
                vars=sorted(k for k in f.keys())[:40], energy_attr=dict(f["flash_energy"].attrs).get("units"))
day = sys.argv[1] if len(sys.argv) > 1 else "2026/309"
best = None
for hh in ["18", "20", "22", "00"]:
    keys, sizes = ls(f"GLM-L2-LCFA/{day}/{hh}/")
    if not keys: continue
    print(day, hh, "files", len(keys), "total MB/hour", round(sum(sizes) / 1e6, 1))
    res = flashes(keys[len(keys) // 2])
    print("  ", {k: v for k, v in res.items() if k != "vars"})
    if best is None or res["n_flash_bbox"] > best["n_flash_bbox"]: best = res
print("vars:", best["vars"])
