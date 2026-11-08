"""Polite OGIMET raw-SYNOP puller (keyless). Quarterly requests, >=16 s apart; a quarter whose
last bulletin is >3 days before the quarter end is treated as truncated and re-pulled month by month.
usage: python ogimet_pull.py STATION 2000 2026 RAW_DIR
Writes RAW_DIR/og_<st>_<yyyymm>.txt (raw CSV lines 'st,y,m,d,h,mi,AAXX ...')."""
import sys, os, time, requests, pandas as pd
st, y0, y1, raw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
os.makedirs(raw, exist_ok=True)
URL = "https://www.ogimet.com/cgi-bin/getsynop"; SLEEP = float(os.environ.get("OG_SLEEP", 16))
H = {"User-Agent": "energhack-research/0.1 (hackathon data discovery)"}
now = pd.Timestamp.utcnow().tz_localize(None)

def get(b, e):
    for attempt in range(3):
        t = time.time()
        try:
            r = requests.get(URL, params={"block": st, "begin": b.strftime("%Y%m%d%H%M"), "end": e.strftime("%Y%m%d%H%M")}, headers=H, timeout=120)
            lines = [l for l in r.text.splitlines() if l.startswith(st + ",")]
            print(f"{st} {b:%Y-%m}..{e:%Y-%m-%d} HTTP {r.status_code} {time.time()-t:.1f}s {len(lines)} synops", flush=True)
            time.sleep(SLEEP)
            if r.status_code == 200: return lines
        except Exception as ex:
            print("  err", ex, flush=True); time.sleep(SLEEP)
        time.sleep(SLEEP * (attempt + 1))
    return None

for y in range(y0, y1 + 1):
    for q in range(4):
        b = pd.Timestamp(y, 3 * q + 1, 1)
        if b > now: break
        e = min(b + pd.DateOffset(months=3), now.floor("h"))
        f = os.path.join(raw, f"og_{st}_{b:%Y%m}_q.txt")
        if os.path.exists(f): continue
        lines = get(b, e)
        if lines is None: continue
        last = pd.Timestamp(*map(int, lines[-1].split(",")[1:5])) if lines else None
        if last is not None and last >= e - pd.Timedelta(days=3):
            open(f, "w").write("\n".join(lines) + "\n"); continue
        # truncated or empty -> month by month
        allm = []
        for k in range(3):
            mb = b + pd.DateOffset(months=k); me = min(mb + pd.DateOffset(months=1), e)
            if mb >= e: break
            ml = get(mb, me)
            if ml: allm += ml
        open(f, "w").write("\n".join(allm) + "\n")
print("DONE", st)
