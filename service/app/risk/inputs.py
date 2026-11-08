"""Data holders shared by the risk modules, plus small text/provenance helpers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

from app import provenance as prov
from app.models import (
    ClimateEvent,
    CropTemplate,
    DataTier,
    Farm,
    Portfolio,
    Provenance,
    Series,
    Stage,
    StageThresholds,
    WaterSupply,
    Zone,
)
from app.risk.signals import PersistentZ, ZPoint


@dataclass
class FarmContext:
    portfolio: Portfolio
    farm: Farm
    as_of: date
    window_start: date
    data_tier: DataTier
    zone: Zone
    template: CropTemplate
    stage: Stage
    thresholds: StageThresholds
    warnings: list[str] = field(default_factory=list)

    @property
    def chile(self) -> bool:
        return self.data_tier == "enhanced"

    @property
    def covered(self) -> bool:
        return bool(self.farm.covered if self.farm.covered is not None else self.template.covered_default)


@dataclass
class Irrigation:
    """Normalised CIREN irrigation check (app.sources.ciren.IrrigationCheck duck type)."""
    value: str  # 'yes' | 'unknown'
    evidence: str
    estimated: bool
    provenance: Provenance


@dataclass
class Peer:
    id: str
    ndvi: PersistentZ | None
    ndmi: PersistentZ | None
    ndvi_points: list[ZPoint]


@dataclass
class PeerData:
    requested: int = 0
    peers: list[Peer] = field(default_factory=list)
    provenance: Provenance | None = None
    note: str | None = None


@dataclass
class Elevation:
    rel_m: float
    farm_m: float
    zone_mean_m: float
    provenance: Provenance


@dataclass
class FarmInputs:
    series: dict[str, Series | None] = field(default_factory=dict)
    supply: WaterSupply | None = None
    irrigation: Irrigation | None = None
    #: Events in the 13-month window near the farm. None = catalogue unavailable.
    events: list[ClimateEvent] | None = None
    #: Fire events since 2012 near the zone (fire recurrence). None = unavailable.
    fire_history: list[ClimateEvent] | None = None
    decree_years: tuple[int, Provenance] | None = None
    elevation: Elevation | None = None
    peers: PeerData = field(default_factory=PeerData)
    #: svc-imagery vigour_signals() result (Chile): peers, abandonment, exact z, dry-season irrigation test.
    vigour: dict | None = None
    #: Last-7-day station measurements (svc-weather WeatherEvents) keyed 'frost' | 'heat' | 'rain'.
    station: dict[str, Any] = field(default_factory=dict)
    #: Hourly chill from svc-weather when it offers it: (hours, Provenance).
    chill_hourly: tuple[float, Provenance] | None = None
    #: Plain-language reasons per input key when unavailable.
    missing: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


# ───────────────────────── text helpers ─────────────────────────

def num(v: float, nd: int = 1) -> str:
    """Number with a typographic minus."""
    s = f"{v:.{nd}f}"
    if s.startswith("-") and float(s) == 0:
        s = s[1:]
    return s.replace("-", "−")


def day(d: date | str) -> str:
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    return f"{d.day} {d.strftime('%b')}"


def long_date(d: date | str) -> str:
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    return f"{d.day} {d.strftime('%b')} {d.year}"


def z_phrase(z: float) -> str:
    if -0.5 <= z <= 0.5:
        return "close to its own normal"
    return f"{num(abs(z))} sd {'below' if z < 0 else 'above'} its own normal"


def unavailable(source: str, reason: str, tier: DataTier) -> Provenance:
    return prov.unavailable(source, reason, data_tier=tier)


def with_observed(p: Provenance | None, observed: Any, tier: DataTier, fallback_source: str = "unavailable",
                  note: str | None = None) -> Provenance:
    """Copy of a series provenance with observedAt set to the value's own date."""
    if p is None:
        return prov.build(fallback_source, observed_at=observed, data_tier=tier, note=note)
    q = p.model_copy()
    if observed is not None:
        q.observed_at = observed.isoformat() if isinstance(observed, date) else str(observed)
    q.data_tier = tier
    if note:
        q.note = f"{q.note}; {note}" if q.note else note
    return q


def note_of(p: Provenance | None) -> str | None:
    return p.note if p is not None else None


def veg_z_provenance(series: Any, pz: Any, tier: DataTier, note: str | None = None,
                     fallback_source: str = "s2_l2a_pc") -> Provenance:
    """Provenance for a persistent NDVI/NDMI z (§E.6) that is honest about gap-filled composites (E.6 trust rule).

    observedAt = the last clear Sentinel-2 observation used (the series provenance), not the grid date.
    estimated = true when any composite in the persistent-z window is gap-filled; the note says how many days
    the value was held from the last clear scene."""
    sp = series.provenance if series is not None else None
    q = with_observed(sp, None, tier, fallback_source, note=note)
    if pz is None:
        return q
    on = pz.on
    pts = []
    if series is not None:
        for p in series.points:
            if p.value is None:
                continue
            try:
                dd = date.fromisoformat(p.date[:10])
            except ValueError:
                continue
            if dd <= on:
                pts.append((dd, bool(p.estimated)))
    pts.sort()
    if getattr(pz, "method", "") == "last2":
        used = pts[-2:]
    else:
        used = [x for x in pts if (on - x[0]).days < 32]
    last_clear = None
    if sp is not None and sp.observed_at:
        try:
            last_clear = date.fromisoformat(str(sp.observed_at)[:10])
        except ValueError:
            last_clear = None
    if last_clear is None:
        clear = [x[0] for x in pts if not x[1]]
        last_clear = clear[-1] if clear else None
    if last_clear is not None:
        q.observed_at = last_clear.isoformat()
    n_est = sum(1 for x in used if x[1])
    if n_est:
        q.estimated = True
        held = f"{(on - last_clear).days} days" if last_clear is not None else "some days"
        extra = (f"{n_est} of {len(used)} composites in the z window are gap-filled; value held {held} from the "
                 f"last clear scene" + (f" ({last_clear.isoformat()})" if last_clear else "") + f"; composite date {on.isoformat()}")
        q.note = f"{q.note}; {extra}" if q.note else extra
    return q
