"""Backtest of the frost and harvest-rain rules over past seasons (ADR-0013 D9). Pure: no I/O.

A season is the stage window that starts in calendar year Y (windows may wrap the year end).

Rule replay (per candidate threshold, per season):
- frost: the rule ALERTS when any day in the stage window has Tmin <= candidate (°C).
- harvest_rain: the rule ALERTS when any 72 h (3 consecutive daily totals) sum in the window
  >= candidate (mm).

Truth ("damaging event") per season, defined independently of the candidates so the test is not
circular:
- a curated known event (e.g. the September 2013 central-Chile frost) overlapping the window, or
- a station damage proxy: frost -> some night with Tmin <= damage_proxy (default: the stage's
  frostSevereC = T90, the temperature that kills ~90 % of the organ); harvest rain -> a 72 h sum
  >= damage_proxy (default: 1.5 x the template harvestRainMm72h = severity 1 in CONTRACT §E.5).

Counts per candidate: hits (alert and damage), falseAlarms (alert, no damage), missed (damage, no
alert), quiet (neither). Seasons with < MIN_COVERAGE valid days are skipped and listed, never scored
as zeros.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Iterable

MIN_COVERAGE = 0.7


@dataclass(frozen=True)
class KnownEvent:
    id: str
    rule: str  # 'frost' | 'harvest_rain'
    start: date
    end: date
    title: str
    source: str


def _days(start: date, end: date) -> Iterable[date]:
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def _round(v: float | None, n: int = 1) -> float | None:
    return None if v is None else round(v, n)


def season_stats(rule: str, daily: dict[date, float | None], start: date, end: date) -> dict[str, Any]:
    """Coverage and the season's extreme for the rule (min Tmin, or max 72 h rain sum)."""
    days = list(_days(start, end))
    valid = [(d, daily.get(d)) for d in days if daily.get(d) is not None]
    out: dict[str, Any] = {"days": len(days), "validDays": len(valid),
                           "coverage": round(len(valid) / len(days), 3) if days else 0.0}
    if rule == "frost":
        if valid:
            d, v = min(valid, key=lambda t: t[1])
            out.update(extreme=_round(v), extremeDate=d.isoformat())
        else:
            out.update(extreme=None, extremeDate=None)
        out["values"] = [v for _, v in valid]
    else:
        sums: list[tuple[date, float]] = []
        for d in days:
            three = [daily.get(d - timedelta(days=k)) for k in (2, 1, 0)]
            if all(x is not None for x in three):
                sums.append((d, float(sum(three))))  # type: ignore[arg-type]
        if sums:
            d, v = max(sums, key=lambda t: t[1])
            out.update(extreme=_round(v), extremeDate=d.isoformat())
        else:
            out.update(extreme=None, extremeDate=None)
        out["values"] = [v for _, v in sums]
    return out


def alerts(rule: str, values: list[float], candidate: float) -> bool:
    if rule == "frost":
        return any(v <= candidate for v in values)
    return any(v >= candidate for v in values)


def damage(rule: str, values: list[float], proxy: float | None) -> bool:
    if proxy is None:
        return False
    return alerts(rule, values, proxy)


def run_backtest(
    rule: str,
    daily: dict[date, float | None],
    windows: dict[int, tuple[date, date]],
    candidates: list[float],
    damage_proxy: float | None,
    known_events: list[KnownEvent],
) -> dict[str, Any]:
    """Replay `rule` with each candidate threshold over the seasons in `windows` (season -> dates)."""
    if rule not in ("frost", "harvest_rain"):
        raise ValueError("rule must be 'frost' or 'harvest_rain'")
    cands = sorted({round(float(c), 2) for c in candidates}, reverse=(rule == "frost"))
    seasons: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    tally = {c: {"value": c, "hits": 0, "falseAlarms": 0, "missed": 0, "quiet": 0} for c in cands}
    for season in sorted(windows):
        start, end = windows[season]
        st = season_stats(rule, daily, start, end)
        known = [e for e in known_events if e.rule == rule and e.start <= end and e.end >= start]
        if st["coverage"] < MIN_COVERAGE:
            skipped.append({"season": season, "window": [start.isoformat(), end.isoformat()],
                            "coverage": st["coverage"],
                            "knownEvents": [e.id for e in known],
                            "reason": f"only {st['validDays']} of {st['days']} days have data"})
            continue
        proxy_hit = damage(rule, st["values"], damage_proxy)
        is_damage = bool(known) or proxy_hit
        why = [f"known event {e.id}" for e in known]
        if proxy_hit:
            why.append("station damage proxy")
        row = {"season": season, "window": [start.isoformat(), end.isoformat()], "coverage": st["coverage"],
               "extreme": st["extreme"], "extremeDate": st["extremeDate"], "damage": is_damage,
               "damageReasons": why, "alerts": {}}
        for c in cands:
            a = alerts(rule, st["values"], c)
            row["alerts"][str(c)] = a
            t = tally[c]
            if a and is_damage:
                t["hits"] += 1
            elif a:
                t["falseAlarms"] += 1
            elif is_damage:
                t["missed"] += 1
            else:
                t["quiet"] += 1
        seasons.append(row)
    damaging = sum(1 for s in seasons if s["damage"])
    return {
        "rule": rule,
        "seasonsEvaluated": len(seasons),
        "seasonsSkipped": skipped,
        "damagingSeasons": damaging,
        "damageProxy": damage_proxy,
        "candidates": [tally[c] for c in cands],
        "seasons": seasons,
        "knownEventsUsed": [
            {"id": e.id, "title": e.title, "start": e.start.isoformat(), "end": e.end.isoformat(), "source": e.source}
            for e in known_events if e.rule == rule
        ],
    }
