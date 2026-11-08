"""FAO Crop Calendar API (keyless JSON): Bolivia AEZs and per-crop sowing/harvest windows.
Writes sample_fao_cropcalendar_BO.json (compact) and prints the lowland (Santa Cruz) rows."""
import json, time, requests
B = "https://api-cropcalendar.apps.fao.org/api/v1/countries/BO"
t = time.time(); aez = requests.get(f"{B}/aez", params={"language": "en"}, timeout=60).json(); t1 = time.time() - t
t = time.time(); cal = requests.get(f"{B}/cropCalendar", params={"language": "en"}, timeout=60).json(); t2 = time.time() - t
print(f"aez n={len(aez)} {t1:.2f}s; cropCalendar n={len(cal)} {t2:.2f}s")
for a in aez:
    print("AEZ", a.get("id"), a.get("name"), "|", (a.get("administratrative_units") or "")[:80])
rows = []
for c in cal:
    for s in c["sessions"]:
        g = lambda k: f"{s[k]['day']:02d}/{s[k]['month']:02d}" if s.get(k) else None
        rows.append({"aez": c["aez"]["name"], "aez_id": c["aez"]["id"], "crop": c["crop"]["name"], "updated": c["lastUpdated"],
                     "sow": [g("early_sowing"), g("later_sowing")], "harvest": [g("early_harvest"), g("late_harvest")],
                     "growing_days": (s.get("growing_period") or {}).get("value"), "info": s.get("additional_information")})
json.dump(rows, open("sample_fao_cropcalendar_BO.json", "w"), indent=0, ensure_ascii=False)
print("crops:", sorted({r["crop"] for r in rows}))
for r in rows:
    if any(k in r["aez"].lower() for k in ["llano", "plain", "chaco", "oriente", "lowland", "amaz", "santa"]):
        print(r)
