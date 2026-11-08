"""Probe Red Agroclimatica Nacional (RAN, www.agromet.cl; Minagri/FDF/INIA/DMC partners).

Public, keyless endpoints used by the site's own JS (no login, no captcha):
  ext/aux/getRegiones.php                       -> [[reg_id, name], ...]
  ext/aux/getRegionWMS.php?reg_ia_id=N          -> XML <estacion id x y tooltip .../> (WGS84 lon/lat)
  ext/aux/getGraphData.php?ema_ia_id=ID&dateFrom=YYYY-MM-DD HH:MM:SS&dateTo=...&portada=false
        -> XML hourly rows 'fecha|ts|1|Tavg|2|PP|3|RH|4|P|5|Rad|6|Vmax|7|Tmin|8|Tmax|9|Dir|11|GD10|12|HF7|'
Writes agromet_ran_stations.csv and agromet_ran_nearest.csv next to this script.
"""
import csv, math, os, re, time, requests
B = "https://www.agromet.cl/ext/aux"
import certifi
CA = os.environ.get("AGROMET_CA_BUNDLE", certifi.where())  # agromet.cl omits the Sectigo DV R36 intermediate; pass bundle incl. it
H = {"User-Agent": "Mozilla/5.0 (research probe; hackathon)"}
OUT = os.path.dirname(os.path.abspath(__file__))
LOCS = {"Quillota avocado": (-71.25, -32.88), "Ovalle table grape": (-71.20, -30.60),
        "Requinoa cherry": (-70.80, -34.28), "Santa Cruz wine": (-71.37, -34.64),
        "Curico apple/cherry": (-71.24, -34.98), "Talca vineyard": (-71.66, -35.43),
        "Parral rice": (-71.83, -36.14), "Chillan blueberry": (-72.10, -36.60),
        "Los Angeles maize/wheat": (-72.35, -37.47), "Temuco wheat/oats": (-72.60, -38.74),
        "Osorno potato": (-73.13, -40.57)}

def km(lo1, la1, lo2, la2):
    p = math.pi / 180
    a = math.sin((la2 - la1) * p / 2) ** 2 + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))

def hourly(sid, d0, d1):
    r = requests.get(f"{B}/getGraphData.php", params={"ema_ia_id": sid, "dateFrom": d0, "dateTo": d1, "portada": "false"}, headers=H, verify=CA, timeout=120)
    rows = []
    for dato in re.findall(r"<dato>([^<]+)</dato>", r.text):
        f = dato.split("|"); rec = {"ts": f[1]}
        for k, v in zip(f[2::2], f[3::2]): rec[k] = float(v) if v else None
        rows.append(rec)
    return rows

def has_data(sid, day):
    rows = hourly(sid, f"{day} 00:00:00", f"{day} 23:59:59")
    return any(r.get("1") is not None for r in rows)

def first_year(sid):
    """Coarse scan of 15-Jan of each year 1990..2026 (binary search would be cheaper but data has gaps)."""
    lo, hi = 1990, 2026
    while lo < hi:  # binary search on first year with data on Jan-15 or Jul-15
        mid = (lo + hi) // 2
        ok = has_data(sid, f"{mid}-07-15") or has_data(sid, f"{mid+1}-01-15")
        time.sleep(0.5)
        if ok: hi = mid
        else: lo = mid + 1
    return lo

if __name__ == "__main__":
    regs = requests.get(f"{B}/getRegiones.php", headers=H, verify=CA, timeout=30).json()
    st = []
    for rid, rname in regs:
        x = requests.get(f"{B}/getRegionWMS.php", params={"reg_ia_id": rid}, headers=H, verify=CA, timeout=30).text
        for m in re.finditer(r'<estacion id="(\d+)" x="([-\d.]+)" y="([-\d.]+)" tooltip="([^"]*)"', x):
            st.append({"id": m[1], "lon": float(m[2]), "lat": float(m[3]), "name": m[4], "region": rname})
        time.sleep(0.3)
    with open(os.path.join(OUT, "agromet_ran_stations.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "name", "region", "lat", "lon"]); w.writeheader(); w.writerows(st)
    print("RAN stations:", len(st))
    res = []
    for name, (lo, la) in LOCS.items():
        ds = sorted((km(lo, la, s["lon"], s["lat"]), s) for s in st)
        n10 = sum(d <= 10 for d, _ in ds); n25 = sum(d <= 25 for d, _ in ds)
        d, s = ds[0]
        t = time.time(); last = hourly(s["id"], "2026-11-05 00:00:00", "2026-11-07 23:59:59"); dt = time.time() - t
        lastv = [r["ts"] for r in last if r.get("1") is not None]
        fy = first_year(s["id"])
        row = dict(location=name, n_le10km=n10, n_le25km=n25, nearest_id=s["id"], nearest_name=s["name"],
                   dist_km=round(d, 1), latest_obs=lastv[-1] if lastv else None, first_year_with_data=fy, latency_s=round(dt, 2))
        print(row); res.append(row)
    with open(os.path.join(OUT, "agromet_ran_nearest.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(res[0])); w.writeheader(); w.writerows(res)
