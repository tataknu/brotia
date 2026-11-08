"""Compute Chile fruit/crop peril indicators against each site's OWN same-season history.

Source: Open-Meteo Historical Weather API (ERA5-Land, keyless, hourly since 1950).
Indicators (thresholds documented in notes.md):
  chill_hours   hours T < 7.2 C, 1 May - 31 Aug          (winter rest / chill deficit)
  chill_portions Dynamic model (Fishman/Erez), 1 May - 31 Aug
  frost_hours_m2 hours T <= -2.0 C, 1 Sep - 31 Oct       (bloom/fruit-set frost)
  min_spring_T  min hourly T, 1 Sep - 31 Oct
  harvest_rain_days days >= 10 mm, 15 Nov - 15 Jan (cherry cracking window)
  harvest_rain_max3d max 3-day rain, same window
  heat_days_32 / heat_days_35 days Tmax >= 32 / 35 C, 1 Dec - 28 Feb
  vanazon_run   longest run of days Tmean < 18 C, 15 Jan - 20 Feb (rice, Agroseguros rule: >=5)
Percentile = share of baseline seasons (1991..last complete) with a value <= current.
Run: .venv/bin/python probe_perils.py [openmeteo|power]   (one request per site, 4-9 MB each)
Fallback source "power" = NASA POWER hourly (MERRA-2, 0.5x0.625 deg, since 2001, keyless).
"""
import json, math, sys, time
import requests
import pandas as pd

UA = {"User-Agent": "ClimateLoanMonitor-hackathon-research (MIT Energy Hack 2026)"}
URL = "https://archive-api.open-meteo.com/v1/archive"
SITES = {
    "requinoa_cherry": (-70.80, -34.28),
    "ovalle_tablegrape": (-71.20, -30.60),
    "curico_apple": (-71.24, -34.98),
    "parral_rice": (-71.83, -36.14),
}
START, END = "1991-01-01", "2026-11-06"


def fetch(lon, lat):
    t = time.time()
    r = requests.get(URL, headers=UA, timeout=120, params={
        "latitude": lat, "longitude": lon, "start_date": START, "end_date": END,
        "hourly": "temperature_2m,precipitation", "models": "era5_land", "timezone": "America/Santiago"})
    dt = time.time() - t
    r.raise_for_status()
    j = r.json()
    df = pd.DataFrame(j["hourly"]).assign(time=lambda d: pd.to_datetime(d["time"])).set_index("time")
    return df, dt, len(r.content), j.get("elevation")


def fetch_power(lon, lat):
    t = time.time()
    r = requests.get("https://power.larc.nasa.gov/api/temporal/hourly/point", headers=UA, timeout=240, params={
        "parameters": "T2M,PRECTOTCORR", "community": "AG", "longitude": lon, "latitude": lat,
        "start": "20010101", "end": END.replace("-", ""), "format": "CSV", "time-standard": "LST"})
    dt = time.time() - t
    r.raise_for_status()
    lines = r.text.splitlines()
    elev = next((l.split("=")[-1].strip() for l in lines if l.startswith("Elevation")), None)
    body = lines[lines.index("-END HEADER-") + 1:]
    import io
    df = pd.read_csv(io.StringIO("\n".join(body)))
    df["time"] = pd.to_datetime(dict(year=df.YEAR, month=df.MO, day=df.DY, hour=df.HR))
    df = df.set_index("time").rename(columns={"T2M": "temperature_2m", "PRECTOTCORR": "precipitation"})
    df = df[["temperature_2m", "precipitation"]].where(lambda d: d > -998)
    return df, dt, len(r.content), elev


def dynamic_portions(temps_c):
    """Dynamic chill model (Fishman et al. 1987), hourly, as in chillR::Dynamic_Model."""
    e0, e1, a0, a1, slp, tetmlt = 4153.5, 12888.8, 139500.0, 2.567e18, 1.6, 277.0
    aa, ee = a0 / a1, e1 - e0
    inter_e, portions, prev_xi = 0.0, 0.0, 0.0
    for i, tc in enumerate(temps_c):
        if tc is None or (isinstance(tc, float) and math.isnan(tc)):
            continue
        tk = tc + 273.0
        ftmprt = slp * tetmlt * (tk - tetmlt) / tk
        sr = math.exp(ftmprt)
        xi = sr / (1 + sr)
        xs = aa * math.exp(ee / tk)
        ak1 = a1 * math.exp(-e1 / tk)
        inter_s = inter_e if (i == 0 or inter_e < 1) else inter_e - inter_e * prev_xi
        inter_e = xs - (xs - inter_s) * math.exp(-ak1)
        if inter_e >= 1:
            portions += inter_e * xi
        prev_xi = xi
    return portions


def window(df, y, m1, d1, m2, d2, cross=False):
    a = pd.Timestamp(y, m1, d1)
    b = pd.Timestamp(y + 1 if cross else y, m2, d2, 23)
    return df.loc[a:b]


def longest_run(mask):
    best = cur = 0
    for v in mask:
        cur = cur + 1 if v else 0
        best = max(best, cur)
    return best


def indicators(df, y):
    out = {}
    w = window(df, y, 5, 1, 8, 31)
    if len(w) > 24 * 100:
        out["chill_hours"] = int((w.temperature_2m < 7.2).sum())
        out["chill_portions"] = round(dynamic_portions(w.temperature_2m.tolist()), 1)
    w = window(df, y, 9, 1, 10, 31)
    if len(w) > 24 * 50:
        out["frost_hours_m2"] = int((w.temperature_2m <= -2.0).sum())
        out["min_spring_T"] = round(float(w.temperature_2m.min()), 1)
    w = window(df, y, 11, 15, 1, 15, cross=True)
    if len(w) > 24 * 55:
        d = w.precipitation.resample("D").sum()
        out["harvest_rain_days"] = int((d >= 10).sum())
        out["harvest_rain_max3d"] = round(float(d.rolling(3).sum().max()), 1)
    w = window(df, y, 12, 1, 2, 28, cross=True)
    if len(w) > 24 * 85:
        tx = w.temperature_2m.resample("D").max()
        out["heat_days_32"] = int((tx >= 32).sum())
        out["heat_days_35"] = int((tx >= 35).sum())
    w = window(df, y + 1, 1, 15, 2, 20)  # summer following season-year y
    if len(w) > 24 * 35:
        tm = w.temperature_2m.resample("D").mean()
        out["vanazon_run"] = longest_run((tm < 18).tolist())
    return out


def pct(hist, v):
    hist = [h for h in hist if h is not None]
    return round(100 * sum(h <= v for h in hist) / len(hist)) if hist else None


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "openmeteo"
    y0 = 1991 if src == "openmeteo" else 2001
    report = {}
    for name, (lon, lat) in SITES.items():
        try:
            df, dt, nbytes, elev = (fetch if src == "openmeteo" else fetch_power)(lon, lat)
        except requests.HTTPError as e:
            print(f"\n== {name}: {e}")
            continue
        last = df.temperature_2m.last_valid_index()
        print(f"\n== {name} ({lon},{lat}) elev={elev} m  HTTP 200 {dt:.1f}s {nbytes/1e6:.1f} MB "
              f"first={df.index[0].date()} last_valid={last}")
        rows = {y: indicators(df, y) for y in range(y0, 2027)}
        tab = pd.DataFrame(rows).T
        # "current" season per indicator: winter/spring 2026; summer harvest/heat 2025-26
        cur = {"chill_hours": 2026, "chill_portions": 2026, "frost_hours_m2": 2026, "min_spring_T": 2026,
               "harvest_rain_days": 2025, "harvest_rain_max3d": 2025, "heat_days_32": 2025,
               "heat_days_35": 2025, "vanazon_run": 2025}
        site = {}
        for k, y in cur.items():
            if k not in tab or pd.isna(tab.loc[y, k]):
                continue
            base = tab.loc[y0:y - 1, k].dropna().tolist()
            v = float(tab.loc[y, k])
            site[k] = {"season": y, "value": v, "baseline_n": len(base),
                       "baseline_median": float(pd.Series(base).median()),
                       "pctile_le": pct(base, v)}
            print(f"  {k:20s} season {y}: {v:7.1f}  median {site[k]['baseline_median']:7.1f}  "
                  f"pctile {site[k]['pctile_le']}% (n={len(base)})")
        report[name] = {"lonlat": [lon, lat], "elevation_m": elev, "last_valid_hour": str(last),
                        "latency_s": round(dt, 1), "indicators": site,
                        "history": tab.round(1).reset_index(names="season").to_dict(orient="records")}
        time.sleep(2)
    out = f"sample_peril_indicators_{src}.json"
    json.dump(report, open(out, "w"), indent=1, default=float)
    print("\nwrote", out)
