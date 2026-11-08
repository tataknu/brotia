"""Cached fetchers for open climate and satellite data. No API keys needed.

- Weather: Open-Meteo historical archive (ERA5 / ERA5-Land), daily, 1995 -> today.
- Vegetation: MODIS MOD13Q1 NDVI (250 m, 16-day composites) via the ORNL DAAC subset API.
"""
from __future__ import annotations

import datetime as dt
import time
from pathlib import Path

import pandas as pd
import requests_cache

CACHE = Path(__file__).resolve().parent.parent / ".cache"
CACHE.mkdir(exist_ok=True)
http = requests_cache.CachedSession(str(CACHE / "http"), backend="sqlite", expire_after=-1,
                                    allowable_codes=(200,))

WEATHER_START = "1995-01-01"
WEATHER_VARS = ["precipitation_sum", "temperature_2m_max", "temperature_2m_min",
                "et0_fao_evapotranspiration", "soil_moisture_7_to_28cm_mean"]
NDVI_FIRST_YEAR = 2010


def _get(url: str, params: dict, tries: int = 4, timeout: int = 90) -> dict:
    for i in range(tries):
        try:
            r = http.get(url, params=params, timeout=timeout, headers={"Accept": "application/json"})
            if r.status_code == 200:
                return r.json()
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** i * 3)
                continue
            r.raise_for_status()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 ** i * 2)
    raise RuntimeError(f"failed: {url} {params}")


def weather_cell(lat: float, lon: float) -> tuple[float, float]:
    """Snap to a 0.1 deg grid (ERA5-Land resolution) so nearby farms share one download."""
    return round(round(lat * 10) / 10, 1), round(round(lon * 10) / 10, 1)


def weather(lat: float, lon: float, end: str | None = None) -> pd.DataFrame:
    """Daily weather from 1995 to `end` (default: 6 days ago, ERA5 latency)."""
    lat, lon = weather_cell(lat, lon)
    end = end or (dt.date.today() - dt.timedelta(days=6)).isoformat()
    j = _get("https://archive-api.open-meteo.com/v1/archive", {
        "latitude": lat, "longitude": lon, "start_date": WEATHER_START, "end_date": end,
        "daily": ",".join(WEATHER_VARS), "timezone": "auto",
    })
    df = pd.DataFrame(j["daily"])
    df["time"] = pd.to_datetime(df["time"])
    return df.set_index("time").rename(columns={
        "precipitation_sum": "p", "temperature_2m_max": "tmax", "temperature_2m_min": "tmin",
        "et0_fao_evapotranspiration": "et0", "soil_moisture_7_to_28cm_mean": "sm"})


def _modis_date(d: dt.date) -> str:
    return f"A{d.year}{d.timetuple().tm_yday:03d}"


def ndvi(lat: float, lon: float, start: dt.date, end: dt.date) -> pd.Series:
    """NDVI composites between two dates (<=160 days per call; the API caps at 10 composites)."""
    j = _get("https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset", {
        "latitude": round(lat, 4), "longitude": round(lon, 4),
        "startDate": _modis_date(start), "endDate": _modis_date(end),
        "kmAboveBelow": 0, "kmLeftRight": 0, "band": "250m_16_days_NDVI",
    })
    rows = {pd.Timestamp(s["calendar_date"]): s["data"][0] * 0.0001
            for s in j.get("subset", []) if s["data"] and s["data"][0] > -3000}
    return pd.Series(rows, dtype=float).sort_index()


def ndvi_window(lat: float, lon: float, start: dt.date, end: dt.date) -> pd.Series:
    """NDVI for any window, chunked into <=144-day calls."""
    parts, a = [], start
    while a <= end:
        b = min(end, a + dt.timedelta(days=144))
        parts.append(ndvi(lat, lon, a, b))
        a = b + dt.timedelta(days=1)
    s = pd.concat(parts) if parts else pd.Series(dtype=float)
    return s[~s.index.duplicated()].sort_index()
