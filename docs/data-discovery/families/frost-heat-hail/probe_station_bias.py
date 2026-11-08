"""Compare SLVR GHCN-D station TMIN/TMAX with Open-Meteo ERA5-Land/ERA5 at the airport: cold-night and hot-day bias."""
import requests, io, time, pandas as pd
SCR = "/private/tmp/claude-501/-Users-cristian-Documents-projects-energhack/6f879383-e961-442e-bad1-17fb20564051/scratchpad/"
OUT = "/Users/cristian/Documents/projects/energhack/docs/data-discovery/families/frost-heat-hail/samples/"
t = time.time(); r = requests.get("https://www.ncei.noaa.gov/data/global-historical-climatology-network-daily/access/BLM00085244.csv", timeout=120)
print("ghcnd", r.status_code, round(time.time()-t, 2), len(r.content))
st = pd.read_csv(io.StringIO(r.text), usecols=["DATE", "TMAX", "TMIN"], parse_dates=["DATE"])
st["TMAX"] = st.TMAX / 10; st["TMIN"] = st.TMIN / 10
st = st[st.DATE >= "1991-01-01"]
print("station TMIN n=%d abs min=%.1f on %s" % (st.TMIN.notna().sum(), st.TMIN.min(), st.loc[st.TMIN.idxmin(), "DATE"].date()))
print("station coldest 10 nights:\n", st.nsmallest(10, "TMIN")[["DATE", "TMIN"]].to_string(index=False))
print("station days TMIN<=5 per yr (years w/ data):", round((st.TMIN <= 5).sum() / st.DATE.dt.year.nunique(), 2), " TMIN<=3:", (st.TMIN <= 3).sum(), " TMIN<=0:", (st.TMIN <= 0).sum())
print("station days TMAX>=35 per yr:", round((st.TMAX >= 35).sum() / st.DATE.dt.year.nunique(), 1), "absmax", st.TMAX.max())
merged = {}
for model in ["era5_land", "era5"]:
    rr = requests.get("https://archive-api.open-meteo.com/v1/archive", params=dict(latitude=-17.64, longitude=-63.14, start_date="1991-01-01", end_date="2025-08-24",
        daily="temperature_2m_min,temperature_2m_max", models=model, timezone="America/La_Paz"), timeout=120)
    d = pd.DataFrame(rr.json()["daily"]); d["DATE"] = pd.to_datetime(d.time)
    m = st.merge(d, on="DATE").dropna()
    bias_all = (m.temperature_2m_min - m.TMIN).mean()
    cold = m[m.TMIN <= m.TMIN.quantile(0.02)]
    hot = m[m.TMAX >= m.TMAX.quantile(0.98)]
    print(f"{model}: n={len(m)} Tmin bias all={bias_all:.2f}  bias on coldest-2% station nights={(cold.temperature_2m_min - cold.TMIN).mean():.2f}  corr Tmin={m.TMIN.corr(m.temperature_2m_min):.3f}")
    print(f"   Tmax bias all={(m.temperature_2m_max - m.TMAX).mean():.2f} on hottest-2% days={(hot.temperature_2m_max - hot.TMAX).mean():.2f} corr={m.TMAX.corr(m.temperature_2m_max):.3f}")
    # percentile agreement: is reanalysis coldest-5% night also station coldest-5%?
    q_st = m.TMIN <= m.TMIN.quantile(0.05); q_re = m.temperature_2m_min <= m.temperature_2m_min.quantile(0.05)
    print(f"   coldest-5% hit rate (reanalysis flags station's cold nights): {(q_st & q_re).sum() / q_st.sum():.2f}")
    merged[model] = m
    time.sleep(65)
merged["era5_land"].nsmallest(15, "TMIN")[["DATE", "TMIN", "temperature_2m_min"]].to_csv(OUT + "slvr_coldest_nights_station_vs_era5land.csv", index=False)
