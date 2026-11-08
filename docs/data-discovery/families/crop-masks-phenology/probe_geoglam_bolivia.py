"""Extract ReadMe + attribute table (.dbf) of GEOGLAM CM4EW calendars via HTTP range; filter Bolivia rows."""
import zipfile, struct, json, io
from httpzip import HttpFile
URL = "https://zenodo.org/api/records/15850408/files/GEOGLAM_CM4EW_Calendars_V1.3.zip/content"
f = HttpFile(URL); z = zipfile.ZipFile(f)
pre = "GEOGLAM_CM4EW_Calendars_V1.3/"
readme = z.read(pre + "ReadMe_GEOGLAM_CM4EW_Calendars.txt").decode("utf-8", "replace")
print(readme[:4300])
dbf = z.read(pre + "GEOGLAM_CM4EW_Calendars_V1.3.dbf"); print(f"\nfetched {f.bytes/1e6:.2f} MB total")
n, hl, rl = struct.unpack("<xxxxIHH", dbf[:12])
fields = []
for i in range(32, hl - 1, 32):
    name = dbf[i:i+11].split(b"\0")[0].decode(); fields.append((name, dbf[i+11:i+12].decode(), dbf[i+16]))
rows = []
for r in range(n):
    rec = dbf[hl + r*rl: hl + (r+1)*rl]; p = 1; d = {}
    for name, typ, ln in fields:
        d[name] = rec[p:p+ln].decode("latin-1").strip(); p += ln
    rows.append(d)
print("fields:", [x[0] for x in fields], "rows:", n)
bo = [d for d in rows if "bolivia" in json.dumps(d).lower()]
print("Bolivia rows:", len(bo))
for d in bo: print(d)
json.dump(bo, open("sample_geoglam_calendars_bolivia.json", "w"), indent=0, ensure_ascii=False)
