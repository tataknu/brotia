"""Thin adapters over other builders' data functions, with a per-process memo and time budgets.

The agent never fetches upstream itself: daily weather comes from app.sources.weather.get_series,
NDVI/NDMI from app.imagery.vegetation_series and events from app.sources.events.list_events. Those
builders own the network etiquette (ADR-0012) and the DuckDB cache. Here we only:
- request the windows we need (season windows, not whole years, to keep calls cheap);
- run at most 2 window requests at once and stop waiting after a time budget;
- memoise results for MEMO_TTL_S so a follow-up question does not refetch.
A failure is reported per window with its reason; nothing is filled in.
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import FIRST_EXCEPTION, ThreadPoolExecutor, wait
from datetime import date
from typing import Any

from app.models import Farm, Polygon, Portfolio, Zone, dump

log = logging.getLogger("clm.agent.data")

MEMO_TTL_S = 3600.0
MAX_PARALLEL = 2

_memo: dict[tuple, tuple[float, Any]] = {}
_memo_lock = threading.Lock()


def _memo_get(key: tuple) -> Any:
    with _memo_lock:
        hit = _memo.get(key)
        if hit and time.monotonic() - hit[0] < MEMO_TTL_S:
            return hit[1]
    return None


def _memo_put(key: tuple, value: Any) -> None:
    with _memo_lock:
        _memo[key] = (time.monotonic(), value)


def clear_memo() -> None:
    with _memo_lock:
        _memo.clear()


def representative_farm(portfolio: Portfolio, zone: Zone, crop: str | None, farms: list[Farm]) -> Farm:
    """The farm whose weather stands for the zone: a same-crop farm in the zone, else any farm in it,
    else a point at the zone centre (a tiny square, so builders that read the centroid work)."""
    same = [f for f in farms if crop is None or f.crop == crop]
    if same:
        return same[0]
    if farms:
        return farms[0]
    lng, lat = zone.center
    d = 0.0005
    ring = [[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]
    return Farm(id=f"zone-{''.join(c if c.isalnum() else '-' for c in zone.id.lower())}", name=f"Centre of {zone.name}",
                crop=crop or "cherry", polygon=Polygon(type="Polygon", coordinates=[ring]), area_ha=0.0,
                centroid=(lng, lat), zone_id=zone.id)


def _fetch_window(variable: str, farm: Farm, start: date, end: date, country: str) -> dict[str, Any]:
    key = ("series", variable, farm.id, tuple(farm.centroid), start, end, country)
    hit = _memo_get(key)
    if hit is not None:
        return hit
    if variable in ("ndvi", "ndmi"):
        from app import imagery

        series = imagery.vegetation_series(farm, variable, start, end)
    else:
        from app.sources import weather

        series = weather.get_series(variable, farm, start, end, country=country)
    s = dump(series)
    values: dict[date, float | None] = {}
    for p in s.get("points") or []:
        try:
            values[date.fromisoformat(p["date"][:10])] = p.get("value")
        except (KeyError, ValueError, TypeError):
            continue
    out = {"values": values, "provenance": s.get("provenance") or {}, "unit": s.get("unit")}
    if values:  # never memoise an empty answer: the builder may have been down
        _memo_put(key, out)
    return out


def fetch_windows(variable: str, farm: Farm, windows: dict[Any, tuple[date, date]], country: str,
                  budget_s: float) -> dict[str, Any]:
    """Fetch several windows of one variable. Returns {daily, perWindow, provenances, errors, timedOut}."""
    daily: dict[date, float | None] = {}
    per_window: dict[Any, dict[str, Any]] = {}
    provenances: list[dict[str, Any]] = []
    errors: list[str] = []
    timed_out: list[Any] = []
    pool = ThreadPoolExecutor(max_workers=MAX_PARALLEL, thread_name_prefix="clm-agent-data")
    futs = {pool.submit(_fetch_window, variable, farm, s, e, country): k for k, (s, e) in windows.items()}
    try:
        done, pending = wait(futs, timeout=max(0.1, budget_s))
        for f in pending:
            f.cancel()
            timed_out.append(futs[f])
        for f in done:
            k = futs[f]
            try:
                r = f.result()
            except NotImplementedError:
                errors.append(f"{variable}: the weather/imagery builder is not implemented yet")
                per_window[k] = {"ok": False}
                continue
            except Exception as exc:  # builder failure: report, never fill in
                errors.append(f"{variable} {k}: {exc.__class__.__name__}: {str(exc)[:160]}")
                per_window[k] = {"ok": False}
                continue
            per_window[k] = {"ok": bool(r["values"]), "points": len(r["values"])}
            daily.update(r["values"])
            if r["provenance"]:
                provenances.append(r["provenance"])
            if not r["values"]:
                note = (r["provenance"] or {}).get("note")
                errors.append(f"{variable} {k}: no data" + (f" ({note})" if note else ""))
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return {"daily": daily, "perWindow": per_window, "provenances": provenances,
            "errors": sorted(set(errors)), "timedOut": sorted(timed_out, key=str)}


def provenance_summary(provs: list[dict[str, Any]]) -> dict[str, Any]:
    """Collapse window provenances into one honest summary (sources, flags, latest observation)."""
    if not provs:
        return {"sources": [], "stale": False, "estimated": False, "note": "no provenance (no data returned)"}
    labels = sorted({p.get("sourceLabel") or p.get("source") or "?" for p in provs})
    notes = sorted({p["note"] for p in provs if p.get("note")})
    observed = sorted(p["observedAt"] for p in provs if p.get("observedAt"))
    return {
        "sources": labels,
        "resolution": sorted({p.get("resolution") for p in provs if p.get("resolution")}),
        "licenceTier": sorted({p.get("licenceTier") for p in provs if p.get("licenceTier")}),
        "latestObservedAt": observed[-1] if observed else None,
        "stale": any(p.get("stale") for p in provs),
        "estimated": any(p.get("estimated") for p in provs),
        "notes": notes[:5],
    }


def list_events(bbox: tuple[float, float, float, float], since: date) -> list[dict[str, Any]]:
    key = ("events", bbox, since)
    hit = _memo_get(key)
    if hit is not None:
        return hit
    from app.sources import events

    out = dump(events.list_events(bbox, since))
    if out:  # an empty list may mean every provider failed: do not memoise it
        _memo_put(key, out)
    return out
