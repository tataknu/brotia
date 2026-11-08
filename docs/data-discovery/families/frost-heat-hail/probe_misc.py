"""Quick keyless checks: NASA POWER hourly/daily T2M, CHC CHIRTS listings, CMR VIIRS LST newest granule, GOES-16/19 ABI LST years."""
import requests, time, re
def t(f):
    s = time.time(); r = f(); return r, round(time.time() - s, 2)
lat, lon = -17.56, -62.68
# NASA POWER hourly (MERRA-2 based) T2M for 13 months is heavy -> 1 month; and daily T2M_MIN since 1981
r, dt = t(lambda: requests.get("https://power.larc.nasa.gov/api/temporal/hourly/point", params=dict(parameters="T2M", community="AG", longitude=lon, latitude=lat, start="20261001", end="20261106", format="JSON", **{"time-standard": "LST"}), timeout=120))
j = r.json(); v = j["properties"]["parameter"]["T2M"]; good = {k: x for k, x in v.items() if x > -900}
print("POWER hourly", r.status_code, dt, "n=", len(v), "valid=", len(good), "last valid", max(good) if good else None, "min", min(good.values()) if good else None)
r, dt = t(lambda: requests.get("https://power.larc.nasa.gov/api/temporal/daily/point", params=dict(parameters="T2M_MIN,T2M_MAX", community="AG", longitude=lon, latitude=lat, start="19810101", end="20261106", format="JSON"), timeout=120))
j = r.json(); mn = {k: x for k, x in j["properties"]["parameter"]["T2M_MIN"].items() if x > -900}
print("POWER daily", r.status_code, dt, "first", min(mn), "last", max(mn), "absmin", min(mn.values()), "on", min(mn, key=mn.get), "2021-07-01:", mn.get("20210701"), "2021-06-30:", mn.get("20210630"))
# CHC CHIRTS
for u in ["https://data.chc.ucsb.edu/products/CHIRTSdaily/", "https://data.chc.ucsb.edu/products/CHIRTSdaily/v1.0/", "https://data.chc.ucsb.edu/products/CHIRTS-ERA5/", "https://data.chc.ucsb.edu/experimental/CHIRTS-ERA5/"]:
    try:
        r, dt = t(lambda: requests.get(u, timeout=60)); links = re.findall(r'href="([^"?/][^"]*)"', r.text)
        print("CHC", u, r.status_code, dt, links[:25])
    except Exception as e: print("CHC", u, "ERR", e)
# CMR keyless: newest VIIRS LST granules (download needs Earthdata login)
for sn, ver in [("VNP21A1N", "002"), ("VJ121A1N", "002"), ("MOD11A1", "061"), ("VNP21A1N", "001")]:
    r, dt = t(lambda: requests.get("https://cmr.earthdata.nasa.gov/search/granules.json", params=dict(short_name=sn, version=ver, bounding_box="-63.3,-17.8,-62.4,-16.8", sort_key="-start_date", page_size=1), timeout=60))
    e = r.json()["feed"]["entry"]; print("CMR", sn, ver, r.status_code, dt, e[0]["time_start"] if e else None)
# GOES ABI LST years
for b in ["noaa-goes16", "noaa-goes19"]:
    r = requests.get(f"https://{b}.s3.amazonaws.com/", params={"list-type": "2", "prefix": "ABI-L2-LSTF/", "delimiter": "/"}, timeout=60)
    print(b, "LSTF years", re.findall(r"<Prefix>(.*?)</Prefix>", r.text))
