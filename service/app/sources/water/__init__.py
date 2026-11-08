"""svc-water-events: irrigation water supply for Chilean farms (ADR-0006 D4, CONTRACT §E.11 rung 3, §E.5).

Public API (called by app.risk and app.agent):

    water_supply(portfolio, farm, as_of) -> WaterSupply
        decreeActive / decreeId / decreeUntil from DGA scarcity decrees (XLS + decree page, ArcGIS history),
        snowmeltPctOfNormal + basin from the DGA Sep–Mar snowmelt forecast. Never raises for upstream
        failures: unavailable parts are null (decreeActive False) with the reason in provenance.note.
    decree_history(farm, as_of=None, since_year=2008) -> list[dict]
        Every DGA scarcity decree covering the farm since since_year (ArcGIS polygons to 2023-04-21,
        decree text after), newest last. Keys: id, number, year, start, end, territory, match, source, label.
    decree_history_years(farm, since_year=2008, as_of=None) -> (int, Provenance)
        §E.5 basin_water_security input: calendar years since since_year in which a decree covering the
        farm was in force (decree date → expiry, capped at as_of).
    farm_admin(farm) -> dict | None
        {'commune', 'province', 'region', 'basin', 'cut'} of the farm centroid (CONAF communes).

Chile only: for a non-CL portfolio the supply is null/False with a 'standard tier' note (CONTRACT §B).
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from app import provenance as prov
from app.models import Farm, Portfolio, Provenance, WaterSupply
from app.sources.water import admin, decrees, snowmelt

log = logging.getLogger("clm.water")

__all__ = ["water_supply", "decree_history", "decree_history_years", "farm_admin"]


def _today() -> date:
    from app import config

    return config.utcnow().date()


def _lnglat(farm: Farm) -> tuple[float, float]:
    return float(farm.centroid[0]), float(farm.centroid[1])


def farm_admin(farm: Farm) -> dict[str, Any] | None:
    c = admin.locate(*_lnglat(farm))
    if c is None:
        return None
    return {"commune": c.display_name, "province": c.province_label, "region": c.region_label,
            "basin": c.basin.label if c.basin else None, "cut": c.code}


def water_supply(portfolio: Portfolio, farm: Farm, as_of: date) -> WaterSupply:
    """Water ladder rung 3 (§E.11)."""
    country = (getattr(portfolio, "country", None) or "CL").upper()
    tier = prov.data_tier_for(country)
    if country != "CL":
        p = prov.unavailable("dga_decrees", "DGA decrees and snowmelt forecasts are Chile-only (standard data tier)",
                             data_tier=tier)
        return WaterSupply(decree_active=False, decree_id=None, decree_until=None, snowmelt_pct_of_normal=None,
                           basin=None, provenance=p)

    lng, lat = _lnglat(farm)
    # decrees
    fd = decrees.farm_decrees(lng, lat)
    active = [(d, lvl) for d, lvl in fd.decrees if d.active_on(as_of)]
    active.sort(key=lambda t: t[0].end, reverse=True)
    decree_ok = fd.commune is not None and fd.text_ok
    # snowmelt
    basin = fd.commune.basin if fd.commune else None
    sm = snowmelt.snowmelt_for_basin(basin, as_of)

    notes: list[str] = []
    if active:
        d, lvl = active[0]
        notes.append(f"Active: {d.label()} covering the farm's {lvl} ({d.territory}) until {d.end.isoformat()}")
    elif decree_ok:
        notes.append(f"No DGA scarcity decree in force on {as_of.isoformat()} for "
                     f"{fd.commune.display_name} ({fd.commune.province_label})")
    else:
        notes.append("Decree status unknown: " + (fd.provenance.note or "sources unavailable") +
                     " (decreeActive reported as false)")
    notes.append(sm.text if sm.pct_of_normal is not None else f"Snowmelt: {(sm.provenance.note or '').removeprefix('unavailable: ')}")
    if sm.pct_of_normal is not None and (sm.provenance.estimated or sm.provenance.stale):
        notes.append(f"snowmelt source: {sm.provenance.note}")
    if fd.notes:
        notes.append("decree sources: " + "; ".join(fd.notes))
    if active and sm.pct_of_normal is not None and sm.pct_of_normal >= 100:
        notes.append("decrees lag hydrology: the decree is in force although the snowmelt forecast is above normal")

    text = "; ".join(notes)
    if not decree_ok:
        # app.risk reads a leading 'unavailable' as "decree status could not be checked"
        text = "unavailable: " + text
    p = prov.derived(text, inputs=[fd.provenance, sm.provenance], data_tier=tier)
    p = p.model_copy(update={
        "source": "dga_decrees" if active else ("dga_snowmelt" if sm.pct_of_normal is not None else "dga_decrees"),
        "source_label": "DGA water-scarcity decrees + snowmelt forecast",
        "resolution": "commune / province / basin",
        "estimated": bool(p.estimated or not decree_ok),
    })
    d0 = active[0][0] if active else None
    return WaterSupply(
        decree_active=bool(active),
        decree_id=d0.label() if d0 else None,
        decree_until=d0.end.isoformat() if d0 else None,
        snowmelt_pct_of_normal=sm.pct_of_normal,
        basin=sm.basin or (basin.label if basin else None),
        provenance=p,
    )


def decree_history(farm: Farm, as_of: date | None = None, since_year: int = 2008) -> list[dict[str, Any]]:
    as_of = as_of or _today()
    fd = decrees.farm_decrees(*_lnglat(farm))
    out = []
    for d, lvl in fd.decrees:
        if d.end.year < since_year or d.start > as_of:
            continue
        out.append({"id": f"dga_decree:{d.key}", "number": d.number, "year": d.year, "start": d.start.isoformat(),
                    "end": d.end.isoformat(), "territory": d.territory, "match": lvl, "source": d.source,
                    "label": d.label(), "activeOnAsOf": d.active_on(as_of)})
    return out


def decree_history_years(farm: Farm, since_year: int = 2008, as_of: date | None = None) -> tuple[int, Provenance]:
    """(calendar years since since_year with a DGA scarcity decree in force covering the farm, Provenance)."""
    as_of = as_of or _today()
    fd = decrees.farm_decrees(*_lnglat(farm))
    years = decrees.years_in_force([d for d, _ in fd.decrees], since_year, as_of)
    note = (f"{len(years)} calendar years since {since_year} with a DGA scarcity decree in force covering the farm"
            + (f": {', '.join(map(str, years))}" if years else "") + "; " + (fd.provenance.note or ""))
    p = fd.provenance.model_copy(update={"note": note})
    return len(years), p


def decree_history_year_list(farm: Farm, since_year: int = 2008, as_of: date | None = None) -> list[int]:
    as_of = as_of or _today()
    fd = decrees.farm_decrees(*_lnglat(farm))
    return decrees.years_in_force([d for d, _ in fd.decrees], since_year, as_of)


def reset_caches() -> None:
    """Testing aid: forget in-process parse caches (the DuckDB http cache is separate)."""
    admin.reset_memo()
    decrees.reset_memo()
    snowmelt.reset_memo()
