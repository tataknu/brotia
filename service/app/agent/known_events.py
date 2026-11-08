"""Curated reference events the backtest scores against (ADR-0013 D9).

Only events documented in the project's discovery notes are listed. Dates and regions are given as
broad, approximate bounds and are labelled so in every output. Fires (e.g. February 2023) and DGA
decree periods are NOT frost or harvest-rain truth labels: the agent reads them from the event
builder (list_events) as context only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.agent.backtest import KnownEvent


@dataclass(frozen=True)
class Region:
    min_lat: float
    max_lat: float

    def contains(self, lng: float, lat: float) -> bool:
        return self.min_lat <= lat <= self.max_lat


REFERENCE_EVENTS: list[tuple[KnownEvent, Region]] = [
    (
        KnownEvent(
            id="ref:frost-2013-09-central-chile",
            rule="frost",
            start=date(2013, 9, 16),
            end=date(2013, 9, 21),
            title="September 2013 spring frost, central Chile (dates approximate: the nights around 18 Sep 2013)",
            source=(
                "Reference event named in ADR-0013 D9 and docs/data-discovery/families/chile-crops-perils/notes.md "
                "(Agroseguros frost reference). Region bound approximate: Valparaíso to Biobío (lat −32.0 to −38.5)."
            ),
        ),
        Region(min_lat=-38.5, max_lat=-32.0),
    ),
]


def reference_events_for(lng: float, lat: float) -> list[KnownEvent]:
    return [e for e, region in REFERENCE_EVENTS if region.contains(lng, lat)]


def all_reference_events() -> list[KnownEvent]:
    return [e for e, _ in REFERENCE_EVENTS]
