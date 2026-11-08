"""List the GEOGLAM Crop Monitor sub-national calendars zip (554 MB, Zenodo, CC-BY-4.0) via HTTP range,
and pull only small tabular members mentioning Bolivia."""
import zipfile, sys, time, io
from httpzip import HttpFile
URL = "https://zenodo.org/api/records/15850408/files/GEOGLAM_CM4EW_Calendars_V1.3.zip/content"
t = time.time(); f = HttpFile(URL); z = zipfile.ZipFile(f)
infos = z.infolist()
print(f"members={len(infos)} listed in {time.time()-t:.1f}s, fetched {f.bytes/1e3:.0f} kB of {f.size/1e6:.0f} MB")
exts = {}
for i in infos: exts.setdefault(i.filename.rsplit('.',1)[-1].lower(), []).append(i)
for e, l in exts.items(): print(f"  .{e}: {len(l)} files, {sum(i.file_size for i in l)/1e6:.1f} MB, e.g. {[i.filename for i in l[:3]]}")
for i in infos:
    if any(k in i.filename.lower() for k in ["bol", "readme", ".csv", ".xlsx", ".dbf", ".txt", ".json"]) and i.file_size < 15e6:
        print("candidate:", i.filename, i.file_size)
