"""Scan Diario Oficial daily indexes for Minagri 'emergencia agricola' and MOP 'escasez hidrica' acts.
No key. Polite: 1 request per day scanned + sleep. Usage: python probe_diario_oficial.py 2026-07-25 2026-08-20"""
import sys, re, time, html, datetime as dt, requests
IDX = "https://www.diariooficial.interior.gob.cl/edicionelectronica/index.php"
H = {"User-Agent": "Mozilla/5.0 (research probe)"}
d0, d1 = (dt.date.fromisoformat(a) for a in sys.argv[1:3])
pat = re.compile(r"EMERGENCIA AGR[IÍ]COLA|ESCASEZ H[IÍ]DRICA|CAT[AÁ]STROFE", re.I)
d = d0
while d <= d1:
    if d.weekday() < 6:  # DO publishes Mon-Sat
        r = requests.get(IDX, params={"date": d.strftime("%d-%m-%Y")}, headers=H, timeout=30)
        s = r.text
        if "select_edition" in r.url:  # several editions that day (e.g. extraordinaria)
            for ed in sorted(set(re.findall(r"edition=(\d+)", s))):
                s += requests.get(IDX, params={"date": d.strftime("%d-%m-%Y"), "edition": ed}, headers=H, timeout=30).text
                time.sleep(0.5)
        # each publication: <td ...>TITLE</td> ... href="...pdf"
        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', s, re.S)
        for row in rows:
            txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", row))).strip()
            m = re.search(r'href="([^"]+\.pdf)"', row)
            if pat.search(txt) and m:
                print(d, r.status_code, txt[:220], "|", m.group(1).split("publicaciones/")[-1])
        time.sleep(0.5)
    d += dt.timedelta(days=1)
