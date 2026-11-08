"""Probe INIA Red Agrometeorologica (agrometeorologia.cl) public 'tabla' view.

No login, no key. The CSV/Excel export is behind an image anti-bot check;
we do NOT bypass it. We only request the HTML table view (vista=tabla),
which the public form serves without the check, for small date ranges.
Usage: python probe_inia_agromet.py INIA-332 day 2026-10-25 2026-11-06 TA_MIN TA_MAX PP_SUM
"""
import re, sys, time, html, requests

BASE = "https://agrometeorologia.cl/TA"
UA = {"User-Agent": "Mozilla/5.0 (research probe; hackathon)"}

def fetch(station, interval, desde, hasta, variables):
    s = requests.Session(); s.headers.update(UA)
    r0 = s.get(BASE, timeout=30)
    tok = re.search(r'name="verificacion_token" value="([^"]+)"', r0.text)
    data = [("estaciones[]", station), ("intervalo", interval), ("desde", desde),
            ("hasta", hasta), ("vista[]", "tabla"), ("website", "")]
    data += [("variables[]", v) for v in variables]
    if tok: data.append(("verificacion_token", tok.group(1)))
    t = time.time(); r = s.post(BASE, data=data, timeout=90); dt = time.time() - t
    return r, dt

def parse(h):
    i = h.find("<table"); j = h.find("</table>", i)
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", h[i:j], re.S)
    out = []
    for row in rows:
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
        if cells and re.match(r"\d{2}-\d{2}-\d{4}", cells[0]): out.append(cells)
    title = re.search(r"Datos de ([^<]+)<", h)
    return (title.group(1).strip() if title else None), out

if __name__ == "__main__":
    st, iv, d0, d1, *vs = sys.argv[1:]
    r, dt = fetch(st, iv, d0, d1, vs)
    title, rows = parse(r.text)
    print(f"HTTP {r.status_code} {dt:.2f}s {len(r.content)}B station={title} rows={len(rows)}")
    for c in rows[:3] + (["..."] if len(rows) > 6 else []) + rows[-3:]: print(c)
