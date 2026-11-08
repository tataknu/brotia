"""Keyless DMC (climatologia.meteochile.gob.cl) annual-table scraper.

GET https://climatologia.meteochile.gob.cl/application/anual/{product}/{codigoNacional}/{year}
products: aguaCaidaAnual (daily precip mm), temperaturaMaximaAnual, temperaturaMinimaAnual
Returns an HTML table: rows = day 1..31, cols = Jan..Dec. 's/p' = sin precipitacion (0 mm),
'.' or '' = missing.
"""
import re, sys, datetime as dt, time
import requests
import pandas as pd

BASE = "https://climatologia.meteochile.gob.cl/application/anual"
UA = {"User-Agent": "Mozilla/5.0 (energhack data-discovery probe)"}

def fetch_year(product: str, code: int, year: int) -> pd.Series:
    url = f"{BASE}/{product}/{code}/{year}"
    t0 = time.time()
    r = requests.get(url, headers=UA, timeout=90)
    r.raise_for_status()
    html = r.text
    s = re.sub(r"<script.*?</script>", "", html, flags=re.S)
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", s, flags=re.S)
    out = {}
    for row in rows:
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, flags=re.S)]
        if len(cells) >= 13 and cells[0].isdigit() and 1 <= int(cells[0]) <= 31:
            day = int(cells[0])
            for m in range(1, 13):
                v = cells[m]
                try:
                    d = dt.date(year, m, day)
                except ValueError:
                    continue
                if v.lower() == "s/p":
                    out[d] = 0.0
                else:
                    try:
                        out[d] = float(v.replace(",", "."))
                    except ValueError:
                        out[d] = float("nan")
            if day == 31:
                break  # first table only (daily values)
    ser = pd.Series(out, name=f"{product}_{code}").sort_index()
    ser.index = pd.to_datetime(ser.index)
    ser.attrs["latency_s"] = round(time.time() - t0, 2)
    return ser

if __name__ == "__main__":
    code, year = int(sys.argv[1]), int(sys.argv[2])
    for p in ["aguaCaidaAnual", "temperaturaMaximaAnual", "temperaturaMinimaAnual"]:
        s = fetch_year(p, code, year)
        print(p, len(s), "valid", s.notna().sum(), "last valid", s.dropna().index.max(), "sum/mean", round(s.sum(), 1) if p.startswith("agua") else round(s.mean(), 2), "t", s.attrs["latency_s"])
