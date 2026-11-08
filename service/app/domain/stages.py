"""Growth stages (CONTRACT §E.3): current stage at a date, stage tiling check, dated stage bands."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from app.models import Stage, StageBand


def md(d: date | str) -> str:
    """'MM-DD' of a date with 29 Feb folded to 28 Feb."""
    s = d.isoformat() if isinstance(d, date) else d
    m = s[5:10]
    return "02-28" if m == "02-29" else m


def in_window(mmdd: str, start: str, end: str) -> bool:
    """Inclusive 'MM-DD' window; wraps the year end when start > end."""
    return (start <= mmdd <= end) if start <= end else (mmdd >= start or mmdd <= end)


@dataclass
class CurrentStage:
    stage: Stage
    gap: bool
    overlap: bool


def find_current_stage(stages: list[Stage], d: date | str) -> CurrentStage | None:
    """Port of rules.ts currentStage: first matching window wins on overlap; on a gap the stage with
    the latest start on or before the date (wrapping to the latest start overall)."""
    if not stages:
        return None
    x = md(d)
    hits = [s for s in stages if in_window(x, s.start, s.end)]
    if hits:
        return CurrentStage(hits[0], False, len(hits) > 1)
    before = sorted((s for s in stages if s.start <= x), key=lambda s: s.start, reverse=True)
    wrap = sorted(stages, key=lambda s: s.start, reverse=True)
    return CurrentStage((before or wrap)[0], True, False)


_NON_LEAP = [(date(2025, 1, 1) + timedelta(days=i)).strftime("%m-%d") for i in range(365)]


def check_stage_tiling(stages: list[Stage]) -> tuple[list[str], list[str]]:
    """(gaps, overlaps) as lists of 'MM-DD' days not covered / covered more than once."""
    gaps: list[str] = []
    overlaps: list[str] = []
    for d in _NON_LEAP:
        n = sum(1 for s in stages if in_window(d, s.start, s.end))
        if n == 0:
            gaps.append(d)
        elif n > 1:
            overlaps.append(d)
    return gaps, overlaps


def tiling_warnings(crop: str, stages: list[Stage]) -> list[str]:
    gaps, overlaps = check_stage_tiling(stages)
    out = []
    if gaps:
        out.append(f"{crop}: stage windows leave {len(gaps)} day(s) uncovered (first {gaps[0]}); "
                   "the stage with the latest start before the date is used there.")
    if overlaps:
        out.append(f"{crop}: stage windows overlap on {len(overlaps)} day(s) (first {overlaps[0]}); "
                   "the first stage in order wins there.")
    return out


def stage_bands_for(stages: list[Stage], window_start: date, window_end: date) -> list[StageBand]:
    """Concrete dated bands covering [window_start, window_end]: each day is assigned its current stage
    (§E.3 rules, so gaps/overlaps resolve exactly as find_current_stage), consecutive days with the same
    stage form one band. Ascending."""
    bands: list[StageBand] = []
    if not stages or window_end < window_start:
        return bands
    d = window_start
    cur_key: str | None = None
    cur_label = ""
    cur_start = d
    prev = d
    while d <= window_end:
        cs = find_current_stage(stages, d)
        key = cs.stage.key if cs else None
        if key != cur_key:
            if cur_key is not None:
                bands.append(StageBand(stage=cur_key, label=cur_label, start=cur_start.isoformat(), end=prev.isoformat()))
            cur_key, cur_label, cur_start = key, (cs.stage.label if cs else ""), d
        prev = d
        d += timedelta(days=1)
    if cur_key is not None:
        bands.append(StageBand(stage=cur_key, label=cur_label, start=cur_start.isoformat(), end=prev.isoformat()))
    return bands
