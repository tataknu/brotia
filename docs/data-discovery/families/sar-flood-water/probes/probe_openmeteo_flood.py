"""Probe Open-Meteo Flood API (GloFAS v4, 0.05 deg) at main-channel cells near the farms.
Reports history start, latest value, forecast horizon, and a same-time-of-year percentile."""
import requests, pandas as pd, time, json
CELLS = {"rio_grande_pailon": (-17.525, -62.825), "rio_grande_puente_banegas_area": (-17.025, -63.025),
         "pirai_candidate_mineros": (-17.225, -63.325), "farm_cuatro_canadas_local": (-17.3, -62.47)}
U = "https://flood-api.open-meteo.com/v1/flood"
res = {}
for k, (la, lo) in CELLS.items():
    t = time.time()
    r = requests.get(U, params={"latitude": la, "longitude": lo, "daily": "river_discharge",
                                "start_date": "1984-01-01", "end_date": "2026-12-31"}, timeout=120)
    dt = time.time() - t
    d = r.json()
    s = pd.Series(d["daily"]["river_discharge"], index=pd.to_datetime(d["daily"]["time"]), dtype=float)
    s_valid = s.dropna()
    # same-time-of-year percentile of last 7-day mean vs other years
    last = s_valid.index.max()
    today = pd.Timestamp("2026-11-06")
    w = s_valid[(s_valid.index > today - pd.Timedelta(days=7)) & (s_valid.index <= today)].mean()
    hist = []
    for y in range(s_valid.index.min().year, 2026):
        e = today.replace(year=y)
        hist.append(s_valid[(s_valid.index > e - pd.Timedelta(days=7)) & (s_valid.index <= e)].mean())
    hist = pd.Series(hist).dropna()
    pct = float((hist < w).mean()*100)
    peak = s_valid["2024-01-01":"2024-04-30"]
    res[k] = dict(status=r.status_code, latency_s=round(dt, 2), grid=(d["latitude"], d["longitude"]),
                  first=str(s_valid.index.min().date()), last=str(last.date()), n=len(s_valid),
                  mean_all=round(s_valid.mean(), 1), last7_mean=round(w, 2), pct_vs_same_week=round(pct, 1),
                  peak_2024_jan_apr=(str(peak.idxmax().date()), round(peak.max(), 1)) if len(peak) else None,
                  annual_max_top3=s_valid.groupby(s_valid.index.year).max().sort_values(ascending=False).head(3).round(0).to_dict())
    time.sleep(1)
print(json.dumps(res, indent=1, default=str))
json.dump(res, open(__file__.replace(".py", "_result.json"), "w"), indent=1, default=str)
