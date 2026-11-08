"""Variable registry (ADR-0002 D2, ADR-0011 D2, ADR-0012 D2).

Builders register providers at import time in their package __init__:

    from app import registry
    registry.register("tmin", "enhanced", cr2met_tmin, priority=10, source="cr2met_nrt")
    registry.register("tmin", "any", era5_tmin, priority=90, source="open_meteo")

Provider contract
    provider(farm: models.Farm, **kwargs) -> (value, models.Provenance)
    - value is whatever the variable means (usually a models.Series; may be a dict/number).
    - raise registry.ProviderUnavailable("reason") (or any exception) to fall through to the next one.
    - returning (None, prov) also falls through (value missing); prov.note is kept as the reason.
    - a provider that served stale cache returns normally with prov.stale=True (it is a valid answer).

Resolution
    r = registry.resolve("tmin", farm, country="CL", start=..., end=...)
    if r.ok: series, prov = r.value, r.provenance
    else:    r.reasons -> ["cr2met_nrt: HTTP 503", "open_meteo: quota embargo"], r.provenance (note = reasons)
    value, prov = r  # also unpacks (value None when unavailable)

region_tier: 'enhanced' (Chile only), 'standard' (non-Chile only) or 'any'. Providers are tried in
ascending priority among those matching the farm's data tier. A fallback provider (any provider
after the first matching one) has its provenance marked estimated=True (ADR-0011 D2), unless it
returns estimated explicitly.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator, Literal

from app import provenance as prov
from app.models import DataTier, Provenance

log = logging.getLogger("clm.registry")

RegionTier = Literal["enhanced", "standard", "any"]


class ProviderUnavailable(Exception):
    """Raise from a provider to say 'I cannot answer this; try the next one'."""


@dataclass(order=True)
class Provider:
    priority: int
    variable: str = field(compare=False)
    region_tier: RegionTier = field(compare=False)
    func: Callable[..., Any] = field(compare=False)
    source: str = field(compare=False)


@dataclass
class Resolution:
    variable: str
    ok: bool
    value: Any
    provenance: Provenance
    source: str | None = None
    reasons: list[str] = field(default_factory=list)

    def __iter__(self) -> Iterator[Any]:
        yield self.value
        yield self.provenance


_providers: dict[str, list[Provider]] = {}
_lock = threading.Lock()


def register(
    variable: str,
    region_tier: RegionTier,
    provider_callable: Callable[..., Any],
    priority: int = 50,
    source: str | None = None,
) -> None:
    """Register a provider. Re-registering the same callable for the same variable replaces it."""
    src = source or getattr(provider_callable, "source", None) or provider_callable.__name__
    with _lock:
        lst = [p for p in _providers.get(variable, []) if p.func is not provider_callable]
        lst.append(Provider(priority, variable, region_tier, provider_callable, src))
        lst.sort()
        _providers[variable] = lst


def providers(variable: str, data_tier: DataTier | None = None) -> list[Provider]:
    with _lock:
        lst = list(_providers.get(variable, []))
    if data_tier is None:
        return lst
    return [p for p in lst if p.region_tier in ("any", data_tier)]


def variables() -> list[str]:
    with _lock:
        return sorted(_providers)


def clear(variable: str | None = None) -> None:
    """Testing aid."""
    with _lock:
        if variable is None:
            _providers.clear()
        else:
            _providers.pop(variable, None)


def resolve(variable: str, farm: Any, *, country: str | None = "CL", **kwargs: Any) -> Resolution:
    """Try providers in order; first one returning a value wins. Never raises for provider errors."""
    tier = prov.data_tier_for(country)
    cands = providers(variable, tier)
    reasons: list[str] = []
    for i, p in enumerate(cands):
        try:
            out = p.func(farm, **kwargs)
        except ProviderUnavailable as exc:
            reasons.append(f"{p.source}: {exc}")
            continue
        except Exception as exc:  # a broken provider must not break the request
            log.warning("provider %s for %s failed: %r", p.source, variable, exc)
            reasons.append(f"{p.source}: {exc.__class__.__name__}: {exc}")
            continue
        value, pv = out if isinstance(out, tuple) else (out, None)
        if value is None:
            reasons.append(f"{p.source}: no value" + (f" ({pv.note})" if pv is not None and pv.note else ""))
            continue
        if pv is None:
            pv = prov.build(p.source, data_tier=tier)
        if i > 0 and not pv.estimated:
            note = "; ".join(x for x in [pv.note, "fallback source: " + "; ".join(reasons)] if x)
            pv = pv.model_copy(update={"estimated": True, "note": note})
        return Resolution(variable, True, value, pv, p.source, reasons)

    if not cands:
        reasons.append(f"no provider registered for '{variable}' ({tier} tier)")
    pv = prov.unavailable("unavailable", "; ".join(reasons), data_tier=tier)
    return Resolution(variable, False, None, pv, None, reasons)


def load_providers() -> list[str]:
    """Import every builder package so their import-time registrations run. Returns import errors
    (as text) for packages that failed to import; never raises."""
    import importlib

    errors: list[str] = []
    for mod in BUILDER_PACKAGES:
        try:
            importlib.import_module(mod)
        except Exception as exc:
            log.error("failed to import %s: %r", mod, exc)
            errors.append(f"{mod}: {exc.__class__.__name__}: {exc}")
    return errors


BUILDER_PACKAGES = [
    "app.domain",
    "app.sources.weather",
    "app.sources.water",
    "app.sources.events",
    "app.sources.ciren",
    "app.imagery",
    "app.superres",
    "app.risk",
    "app.agent",
]
