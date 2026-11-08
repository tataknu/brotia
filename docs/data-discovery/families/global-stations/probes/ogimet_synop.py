"""Fetch raw SYNOP (FM-12) from OGIMET and derive daily precip / Tmax / Tmin.

Usage: python ogimet_synop.py 85244 2023-11-01 2023-12-01 [out.csv]
No key needed. Be polite: OGIMET throttles; keep to <= 1 request / 10 s and <= ~1 month per request.

Daily precip rule (Bolivia, WMO RA III practice observed in the feed):
  * 12 UTC report, section 3 group 7RRRR (24h precip, tenths of mm; 9999 = trace) -> primary.
  * else 12 UTC section 1 group 6RRRt with tR=4 (24 h) -> secondary.
  * if iR (first digit of the 'iRiXhVV' group) is 3 -> precip = 0 (dry, group omitted on purpose).
  * iR 4 -> not observed -> NaN.
  * The 24h amount reported at 12 UTC of day D is assigned to D-1 (period 12Z D-1 .. 12Z D),
    which is the convention GHCN/GSOD style "climate day" ends with; document it in provenance.
Tmax: section 3 group 1snTxTxTx in the 00 UTC report (daytime max, RA III); Tmin: 2snTnTnTn at 12 UTC.
"""
import sys, time, re
import requests
import pandas as pd

URL = "https://www.ogimet.com/cgi-bin/getsynop"


def fetch(block, begin, end):
    p = {"block": block, "begin": begin.strftime("%Y%m%d%H%M"), "end": end.strftime("%Y%m%d%H%M")}
    t = time.time()
    r = requests.get(URL, params=p, timeout=60, headers={"User-Agent": "energhack-research/0.1"})
    return r, time.time() - t


def temp(g):
    if not g[1:5].isdigit() or g[1] not in "01":
        return None
    sign = -1 if g[1] == "1" else 1
    return sign * int(g[2:5]) / 10


def parse(line):
    parts = line.strip().rstrip("=").split(",")
    st, y, m, d, h, mi = parts[:6]
    msg = parts[6].split()
    # msg: AAXX YYGGi IIiii iRiXhVV Nddff ...
    out = {"station": st, "time": pd.Timestamp(int(y), int(m), int(d), int(h)), "iR": None,
           "p6": None, "tR": None, "p24": None, "tx": None, "tn": None}
    try:
        i = msg.index(st)
    except ValueError:
        return out
    body = msg[i + 1:]
    if not body:
        return out
    out["iR"] = body[0][0]
    sec3 = False
    for g in body[2:]:
        if g == "333":
            sec3 = True
            continue
        if g in ("555", "444"):
            break
        if len(g) != 5 or not g[0].isdigit():
            continue
        if not sec3:
            if g[0] == "6" and g[1:4].isdigit():
                rrr = int(g[1:4])
                out["p6"] = 0.0 if rrr == 990 else (rrr - 990) / 10 if rrr > 990 else float(rrr)
                out["tR"] = g[4]
            if g[0] == "1" and out.get("t") is None:
                out["t"] = temp(g)
        else:
            if g[0] == "1" and out["tx"] is None:
                out["tx"] = temp(g)
            elif g[0] == "2" and out["tn"] is None:
                out["tn"] = temp(g)
            elif g[0] == "7" and g[1:].isdigit():
                v = int(g[1:])
                out["p24"] = 0.05 if v == 9999 else v / 10
            elif g[0] == "6" and g[1:4].isdigit() and out["p6"] is None:
                rrr = int(g[1:4])
                out["p6"] = 0.0 if rrr == 990 else (rrr - 990) / 10 if rrr > 990 else float(rrr)
                out["tR"] = g[4]
    return out


def daily(df):
    rows = []
    for day, g in df.groupby(df.time.dt.normalize()):
        r12 = g[g.time.dt.hour == 12]
        r00 = g[g.time.dt.hour == 0]
        p = None
        if len(r12):
            x = r12.iloc[0]
            if x.p24 is not None and not pd.isna(x.p24):
                p = x.p24
            elif x.tR == "4" and x.p6 is not None and not pd.isna(x.p6):
                p = x.p6
            elif x.iR == "3":
                p = 0.0
        rows.append({"obs_day": day, "precip_day": day - pd.Timedelta(days=1), "precip_mm": p,
                     "tx_00z_prevday": r00.tx.iloc[0] if len(r00) else None,
                     "tn_12z": r12.tn.iloc[0] if len(r12) else None,
                     "n_reports": len(g)})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    st, b, e = sys.argv[1], pd.Timestamp(sys.argv[2]), pd.Timestamp(sys.argv[3])
    r, dt = fetch(st, b, e)
    print(f"HTTP {r.status_code} {dt:.2f}s {len(r.content)}B", file=sys.stderr)
    lines = [l for l in r.text.splitlines() if l.startswith(st)]
    df = pd.DataFrame([parse(l) for l in lines])
    dd = daily(df)
    if len(sys.argv) > 4:
        dd.to_csv(sys.argv[4], index=False)
    print(dd.to_string())
