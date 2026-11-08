"""Download INE Bolivia agricultural yield table (public Nextcloud share, no auth) and extract
Santa Cruz yields (kg/ha) by crop for the agricultural years 1983-84 .. 2024-25.
Writes samples/ine_santacruz_yield.csv. Parses xlsx with stdlib only (no openpyxl)."""
import csv, io, time, zipfile, xml.etree.ElementTree as ET, requests
URL = "https://nube.ine.gob.bo/index.php/s/heefZ2fZlqIIMik/download"  # Rendimiento Año Agrícola por Departamento 1984-2025
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
def sheets(blob):
    z = zipfile.ZipFile(io.BytesIO(blob)); ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            ss.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    names = [s.get("name") for s in ET.fromstring(z.read("xl/workbook.xml")).find("m:sheets", NS)]
    for i, n in enumerate(names, 1):
        rows = []
        for r in ET.fromstring(z.read(f"xl/worksheets/sheet{i}.xml")).iter("{%s}row" % NS["m"]):
            row = []
            for c in r.findall("m:c", NS):
                v = c.find("m:v", NS); val = v.text if v is not None else None
                if c.get("t") == "s" and val is not None: val = ss[int(val)]
                row.append(val)
            rows.append(row)
        yield n, rows
t = time.time(); r = requests.get(URL, timeout=120); print("HTTP", r.status_code, f"{time.time()-t:.1f}s", len(r.content), "B")
for name, rows in sheets(r.content):
    if name != "Santa Cruz": continue
    hdr = next(row for row in rows if row and row[0] == "DESCRIPCIÓN")
    want = ("Soya", "Maíz en grano", "Sorgo", "Trigo", "Girasol", "Arroz", "Caña")
    out = [["crop"] + hdr[1:]]
    for row in rows:
        if row and row[0] and row[0].strip().startswith(want): out.append([row[0].strip()] + row[1: len(hdr)])
    with open("samples/ine_santacruz_yield.csv", "w", newline="") as f: csv.writer(f).writerows(out)
    for row in out: print(row[0], "...", row[-6:])
