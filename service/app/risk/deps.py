"""Calls into the other builder packages, resolved at call time (they are built in parallel).

Domain functions (layering, zones, stages, schedule) PROPAGATE errors: without a template and a stage
nothing can be computed, and the router then serves the labelled contract fixture.

Source functions are wrapped by `safe()`: any exception (including NotImplementedError from a
placeholder) becomes `(None, warning)`, and the caller marks the value unavailable with that reason.
Tests monkeypatch the module-level functions here.
"""

from __future__ import annotations

import importlib
import logging
from datetime import date
from typing import Any, Callable

log = logging.getLogger("clm.risk")


def _fn(module: str, name: str) -> Callable[..., Any] | None:
    return getattr(importlib.import_module(module), name, None)


def safe(label: str, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> tuple[Any, str | None]:
    try:
        return fn(*args, **kwargs), None
    except NotImplementedError:
        return None, f"{label}: not available yet (that service package is still a placeholder)."
    except Exception as exc:  # upstream or builder failure → honest 'unavailable'
        log.warning("%s failed: %r", label, exc)
        reason = getattr(exc, "reason", None) or str(exc) or exc.__class__.__name__
        return None, f"{label}: unavailable ({str(reason)[:200]})."


# ───────────────────────── domain (svc-portfolio) ─────────────────────────

def effective_zone(portfolio, farm):
    return _fn("app.domain", "effective_zone")(portfolio, farm)


def effective_template(portfolio, farm):
    return _fn("app.domain", "effective_template")(portfolio, farm)


def current_stage(template, as_of: date):
    return _fn("app.domain", "current_stage")(template, as_of)


def stage_bands(template, as_of: date):
    return _fn("app.domain", "stage_bands")(template, as_of)


def outstanding_at(loan, as_of: date) -> float:
    return _fn("app.domain", "outstanding_at")(loan, as_of)


def next_installment(loan, as_of: date):
    return _fn("app.domain", "next_installment")(loan, as_of)


# ───────────────────────── sources ─────────────────────────

def weather_series(variable: str, farm, start: date, end: date, country: str):
    return _fn("app.sources.weather", "get_series")(variable, farm, start, end, country=country)


def chill_hours(farm, start: date, end: date, country: str):
    """Optional hourly chill from svc-weather: `chill_hours(farm, start, end, country=...)` ->
    (hours, Provenance). Returns None when svc-weather does not provide it (estimate from daily then)."""
    f = _fn("app.sources.weather", "chill_hours")
    if f is None:
        return None
    return f(farm, start, end, country=country)


def station_events(kind: str, farm, start: date, end: date, country: str):
    """svc-weather frost_events / heat_events / harvest_rain over [start, end]: nearest RAN station (hourly,
    current to today) first. Returns None when svc-weather does not offer it."""
    f = _fn("app.sources.weather", {"frost": "frost_events", "heat": "heat_events", "rain": "harvest_rain"}[kind])
    if f is None:
        return None
    return f(farm, (start, end), country)


def vegetation_series(farm, variable: str, start: date, end: date, baseline_years: int):
    return _fn("app.imagery", "vegetation_series")(farm, variable, start, end, baseline_years=baseline_years)


def water_supply(portfolio, farm, as_of: date):
    return _fn("app.sources.water", "water_supply")(portfolio, farm, as_of)


def decree_history_years(farm, since_year: int = 2008, as_of: date | None = None):
    f = _fn("app.sources.water", "decree_history_years")
    try:
        return f(farm, since_year=since_year, as_of=as_of)
    except TypeError:  # older signature without as_of
        return f(farm, since_year=since_year)


def imagery_vigour(portfolio, farm, as_of: date):
    """svc-imagery's §E.9 peers, §E.10 abandonment, exact §E.6 z and the rung-1 dry-season test in one call:
    {'irrigatedEvidence', 'abandonment', 'ndviZ', 'ndmiZ', 'ndmiPeerDelta', 'peers'}. Peers are fetched on
    shared grids for only the dates the reading needs (much cheaper than a full series per peer)."""
    return _fn("app.imagery", "vigour_signals")(portfolio, farm, as_of)


def list_events(bbox, since: date, until: date | None = None):
    return _fn("app.sources.events", "list_events")(bbox, since, until)


def find_peers(farm, zone, max_peers: int = 20):
    return _fn("app.sources.ciren", "find_peers")(farm, zone, max_peers=max_peers)


def irrigation_check(farm, distance_m: float = 500):
    f = _fn("app.sources.ciren", "irrigation_check")
    if f is None:
        raise NotImplementedError("app.sources.ciren.irrigation_check")
    return f(farm, distance_m=distance_m)


def relative_elevation(centroid, zone_center, radius_m: float, data_tier: str):
    from app.risk import dem

    return dem.relative_elevation(centroid, zone_center, radius_m, data_tier=data_tier)
