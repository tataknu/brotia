"""List NOAA GOES-East (GOES-19, GOES-16 archive) public S3 buckets: GLM L2 LCFA lightning, ABI DSI stability, ACHA cloud top."""
import requests, time, re, datetime as dt
def ls(bucket, prefix, maxkeys=1000):
    t = time.time()
    r = requests.get(f"https://{bucket}.s3.amazonaws.com/", params={"list-type": "2", "prefix": prefix, "max-keys": maxkeys, "delimiter": "/"}, timeout=60)
    keys = re.findall(r"<Key>(.*?)</Key>", r.text); sizes = re.findall(r"<Size>(\d+)</Size>", r.text)
    pref = re.findall(r"<Prefix>(.*?)</Prefix>", r.text)
    return r.status_code, round(time.time()-t, 2), keys, [int(s) for s in sizes], pref
d = dt.date(2026, 11, 5); doy = d.timetuple().tm_yday
print("date", d, "doy", doy)
for bucket in ["noaa-goes19", "noaa-goes16"]:
    s, lat, keys, sz, pref = ls(bucket, "")
    print(bucket, "root", s, lat, pref[:40])
for prod in ["GLM-L2-LCFA", "ABI-L2-DSIF", "ABI-L2-ACHAF", "ABI-L2-ACMF", "ABI-L2-LSTF", "ABI-L2-RRQPEF"]:
    s, lat, keys, sz, pref = ls("noaa-goes19", f"{prod}/2026/{doy:03d}/18/")
    print(prod, s, lat, "n_files_hour18=", len(keys), "first=", keys[:1], "size_kb=", (sz[0]//1024 if sz else None))
# latest GLM file
now = dt.datetime.utcnow(); 
for hh in range(0, 6):
    t0 = now - dt.timedelta(hours=hh)
    s, lat, keys, sz, _ = ls("noaa-goes19", f"GLM-L2-LCFA/{t0.year}/{t0.timetuple().tm_yday:03d}/{t0.hour:02d}/")
    if keys: print("latest GLM hour", t0.strftime("%Y-%j-%H"), len(keys), keys[-1]); break
# GOES-16 archive history start for GLM
s, lat, keys, sz, pref = ls("noaa-goes16", "GLM-L2-LCFA/")
print("goes16 GLM years", pref)
s, lat, keys, sz, pref = ls("noaa-goes16", "ABI-L2-DSIF/")
print("goes16 DSIF years", pref)
