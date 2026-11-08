"""svc-imagery: Sentinel-2 NDVI/NDMI via Planetary Computer, time-lapse frames, PNGs, peers and vigour
signals (ADR-0007, ADR-0013 D3/D7/D8, CONTRACT §E.6, §E.9-§E.12).

Trust rule: every number here (frame stats, series, z, peers, abandonment, irrigated evidence) is
computed from native-resolution Sentinel-2 pixels. Super-resolved images from app.superres are
written as PNGs for display and never read back.

Public API (routers and other builders call these; names from the service README are kept):

    farm_imagery(portfolio, farm_id, sr=True, as_of=None) -> ImageryTimeline        # POST /imagery/farm
    vegetation_series(farm, variable, start, end, baseline_years=5, country='CL') -> Series
    timeline(portfolio, farm, sr=True, as_of=None) -> ImageryTimeline              # farm or farm id
    ndvi_series(farm, as_of=None, baseline_years=5, country='CL') -> Series        # 13-month window
    ndmi_series(farm, as_of=None, baseline_years=5, country='CL') -> Series
    persistent_z(farm, variable, as_of=None, baseline_years=5) -> float | None      # §E.6
    peers(portfolio, farm, as_of=None) -> PeerComparison                           # §E.9
    vigour_signals(portfolio, farm, as_of=None) -> dict                            # §E.10, §E.11 rung 1
        {'irrigatedEvidence': {'value': 'yes'|'unknown', 'evidence', 'farmDryNdvi', 'zoneP25Ndvi', 'provenance'},
         'abandonment': WaterAbandonment, 'ndviZ', 'ndmiZ', 'ndmiPeerDelta', 'peers': PeerComparison}

Cold cost for one farm: timeline ~30-60 s (window scenes only); series/peers/vigour add the farm
history (~1.5 min) and up to PEER_BUDGET_S for peers. Everything is cached (DuckDB + npz), so warm
calls take well under a second. Warm the sample portfolio with `python -m app.imagery.warm`.
"""

from __future__ import annotations

from datetime import date

from app import config
from app.models import Farm, ImageryTimeline, PeerComparison, Portfolio, Series

from . import s2 as _s2  # noqa: F401  (registers the http source at import time)
from .series import window_start as _window_start


def _today() -> date:
    return config.utcnow().date()


def _farm(portfolio: Portfolio, farm: Farm | str) -> Farm:
    if isinstance(farm, Farm):
        return farm
    f = portfolio.farm(farm)
    if f is None:
        raise KeyError(f"farm {farm!r} not in portfolio {portfolio.id!r}")
    return f


def farm_imagery(portfolio: Portfolio, farm_id: str, sr: bool = True, as_of: date | None = None) -> ImageryTimeline:
    """POST /imagery/farm. farm_id already checked by the router. Metrics from native pixels only."""
    from .timeline import build_timeline

    return build_timeline(portfolio, _farm(portfolio, farm_id), sr, as_of or _today())


def timeline(portfolio: Portfolio, farm: Farm | str, sr: bool = True, as_of: date | None = None) -> ImageryTimeline:
    from .timeline import build_timeline

    return build_timeline(portfolio, _farm(portfolio, farm), sr, as_of or _today())


def vegetation_series(farm: Farm, variable: str, start: date, end: date, baseline_years: int = 5,
                      country: str = "CL") -> Series:
    """'ndvi' | 'ndmi' on the 5-day grid ending `end` with baseline band (§E.6); gap-filled points
    estimated=True; null beyond 32 days from a clear scene."""
    from .signals import vegetation_series as _vs

    return _vs(farm, variable, start, end, baseline_years, country)


def ndvi_series(farm: Farm, as_of: date | None = None, baseline_years: int = 5, country: str = "CL") -> Series:
    a = as_of or _today()
    return vegetation_series(farm, "ndvi", _window_start(a), a, baseline_years, country)


def ndmi_series(farm: Farm, as_of: date | None = None, baseline_years: int = 5, country: str = "CL") -> Series:
    a = as_of or _today()
    return vegetation_series(farm, "ndmi", _window_start(a), a, baseline_years, country)


def persistent_z(farm: Farm, variable: str, as_of: date | None = None, baseline_years: int = 5,
                 evergreen: bool | None = None) -> float | None:
    """§E.6 persistent z of the farm's NDVI or NDMI vs its own same-date history."""
    from . import ctx
    from .signals import farm_persistent_z

    ev = ctx.evergreen(None, farm) if evergreen is None else evergreen
    z, _ = farm_persistent_z(farm, variable, as_of or _today(), baseline_years, ev)
    return z


def peers(portfolio: Portfolio, farm: Farm | str, as_of: date | None = None) -> PeerComparison:
    from .signals import peers as _peers

    return _peers(portfolio, _farm(portfolio, farm), as_of or _today())


def vigour_signals(portfolio: Portfolio, farm: Farm | str, as_of: date | None = None) -> dict:
    from .signals import vigour_signals as _vs

    return _vs(portfolio, _farm(portfolio, farm), as_of or _today())
