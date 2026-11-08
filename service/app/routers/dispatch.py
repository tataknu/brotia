"""Calls into builder packages, with the fixture fallback while they are placeholders.

Every function returns a Served(data, fixture, notes): `data` is JSON-ready camelCase data that has
been validated against the contract model. Routers and app.snapshot use these same functions.

Fallback rule: if the builder function is missing or raises NotImplementedError, and
config.fixture_fallback() is on, the matching contract fixture is served instead, marked with the
X-CLM-Fixture header and a warning. Any other builder exception propagates (-> 500 internal_error):
fixtures never mask bugs. A builder package that fails to import gives 500 for its endpoints only.
"""

from __future__ import annotations

import copy
import importlib
import json
import logging
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from typing import Any, Callable

from pydantic import BaseModel, TypeAdapter

from app import config, store
from app.models import (
    AgentRecommendation,
    AgentRequest,
    CirenOrchardCollection,
    ClimateEventList,
    CountryList,
    CropTemplateList,
    FarmAssessment,
    Health,
    HealthSource,
    ImageryTimeline,
    Portfolio,
    PortfolioAssessment,
    SamplePortfolioSummaryList,
    dump,
)
from app.routers.errors import ApiException, internal_error, not_found

log = logging.getLogger("clm.dispatch")

#: /health must answer well inside the app's 3 s live/offline timeout even if the DB is locked.
HEALTH_DB_TIMEOUT_S = 0.5


@dataclass
class Served:
    data: Any
    fixture: bool = False
    notes: list[str] = field(default_factory=list)


class _Fallback(Exception):
    def __init__(self, where: str):
        self.where = where


@lru_cache(maxsize=None)
def _fixture_text(name: str) -> str:
    return (config.FIXTURES_DIR / name).read_text()


def load_fixture(name: str) -> Any:
    """A fresh (mutable) copy of a contract fixture."""
    return json.loads(_fixture_text(name))


def _module(name: str):
    try:
        return importlib.import_module(name)
    except Exception as exc:
        log.exception("builder package %s failed to import", name)
        raise internal_error(f"{name} failed to import: {exc.__class__.__name__}: {exc}")


def _call(module: str, fn: str, *args: Any, **kwargs: Any) -> Any:
    mod = _module(module)
    func: Callable[..., Any] | None = getattr(mod, fn, None)
    if func is None:
        raise _Fallback(f"{module}.{fn}")
    try:
        return func(*args, **kwargs)
    except NotImplementedError:
        raise _Fallback(f"{module}.{fn}")


def _check(validator: Any, value: Any, where: str) -> Any:
    """Validate a builder result (model or dict) against the contract and return JSON-ready data."""
    try:
        if isinstance(validator, TypeAdapter):
            obj = validator.validate_python(dump(value))
            return validator.dump_python(obj, by_alias=True, mode="json")
        if isinstance(value, validator):
            return value.model_dump(by_alias=True, mode="json")
        return validator.model_validate(dump(value)).model_dump(by_alias=True, mode="json")
    except ApiException:
        raise
    except Exception as exc:
        raise internal_error(f"{where} returned data that does not match the contract: {exc}")


def _fallback_note(where: str) -> str:
    return f"Illustrative contract fixture served: {where} is not implemented yet. These are not real values."


def _serve(module: str, fn: str, validator: Any, fixture_name: str,
           shape: Callable[[Any, str], Any] | None, *args: Any, **kwargs: Any) -> Served:
    where = f"{module}.{fn}"
    try:
        return Served(_check(validator, _call(module, fn, *args, **kwargs), where))
    except _Fallback as fb:
        if not config.fixture_fallback():
            raise internal_error(f"{fb.where} is not implemented (fixture fallback disabled)")
        data = load_fixture(fixture_name)
        note = _fallback_note(fb.where)
        if shape is not None:
            data = shape(data, note)
        return Served(_check(validator, data, f"fixture {fixture_name}"), fixture=True, notes=[note])


# ───────────────────────── endpoints ─────────────────────────


def countries() -> Served:
    return _serve("app.domain", "get_countries", CountryList, "countries.json", None)


def crops() -> Served:
    return _serve("app.domain", "get_crop_templates", CropTemplateList, "crops.json", None)


def sample_portfolio(sample_id: str | None = None) -> Served:
    """GET /portfolios/sample[?id=]. No id: the default sample (sample-cl), exactly as before v1.1."""
    if not sample_id:
        return _serve("app.domain", "get_sample_portfolio", Portfolio, "portfolio-sample.json", None)
    from app.domain.portfolio import UnknownSample

    try:
        return _serve("app.domain", "get_sample_portfolio", Portfolio, "portfolio-sample.json", None, sample_id)
    except UnknownSample:
        raise not_found(f"no sample portfolio with id '{sample_id}' (GET /portfolios/samples lists them)")


def sample_portfolios() -> Served:
    """GET /portfolios/samples (v1.1, ADR-0026). No fixture: the summaries come from the service's own specs."""
    where = "app.domain.portfolio.list_sample_portfolios"
    try:
        return Served(_check(SamplePortfolioSummaryList, _call("app.domain.portfolio", "list_sample_portfolios"), where))
    except _Fallback:
        # no sample GeoJSON at all: list the default sample (its own fixture fallback applies)
        p = Portfolio.model_validate(sample_portfolio().data)
        crops = [c for c in ("cherry", "blueberry", "avocado", "walnut", "hazelnut", "table_grape") if any(f.crop == c for f in p.farms)]
        data = [{"id": p.id, "name": p.name, "lender": p.lender, "country": p.country, "currency": p.currency,
                 "farmCount": len(p.farms), "crops": crops, "description": None}]
        return Served(_check(SamplePortfolioSummaryList, data, where), fixture=True, notes=[_fallback_note(where)])


def all_sample_portfolios() -> list[Portfolio]:
    """Every sample portfolio, default first (snapshot export default). Falls back to the default sample alone."""
    try:
        from app.domain.portfolio import get_sample_portfolios

        return [Portfolio.model_validate(dump(p)) for p in get_sample_portfolios()]
    except (ImportError, NotImplementedError):
        return [Portfolio.model_validate(sample_portfolio().data)]


def ciren_orchards(bbox: tuple[float, float, float, float], crop: str | None) -> Served:
    def shape(d: Any, note: str) -> Any:
        d["provenance"]["note"] = note
        return d

    return _serve("app.sources.ciren", "get_orchards", CirenOrchardCollection, "ciren-orchards.json", shape,
                  bbox, crop)


def events(bbox: tuple[float, float, float, float], since: date) -> Served:
    def shape(d: Any, note: str) -> Any:
        for e in d:
            e["provenance"]["note"] = note
            e["affectedFarmIds"] = []
            e["affectedExposure"] = 0
        return d

    return _serve("app.sources.events", "list_events", ClimateEventList, "events.json", shape, bbox, since)


def assess_portfolio(portfolio: Portfolio, as_of: date) -> Served:
    def shape(d: Any, note: str) -> Any:
        d["warnings"] = [note] + list(d.get("warnings") or [])
        return d

    return _serve("app.risk", "assess_portfolio", PortfolioAssessment, "assessment-portfolio.json", shape,
                  portfolio, as_of)


def assess_farm(portfolio: Portfolio, farm_id: str, as_of: date) -> Served:
    def shape(d: Any, note: str) -> Any:
        d["farmId"] = farm_id
        d["warnings"] = [note] + list(d.get("warnings") or [])
        return d

    return _serve("app.risk", "assess_farm", FarmAssessment, "assessment-farm-cl-ovalle-table-grape.json", shape,
                  portfolio, farm_id, as_of)


def imagery(portfolio: Portfolio, farm_id: str, sr: bool, as_of: date) -> Served:
    def shape(d: Any, note: str) -> Any:
        d["farmId"] = farm_id
        d["provenance"]["note"] = note
        return d

    return _serve("app.imagery", "farm_imagery", ImageryTimeline, "imagery-cl-ovalle-table-grape.json", shape,
                  portfolio, farm_id, sr, as_of)


def agent(request: AgentRequest) -> Served:
    def shape(d: Any, note: str) -> Any:
        d["question"] = request.question
        d["zoneId"] = request.zone_id
        d["farmId"] = request.farm_id
        d["answer"] = f"_{note}_\n\n" + d["answer"]
        return d

    return _serve("app.agent", "recommend", AgentRecommendation, "agent-recommendation.json", shape, request)


def sr_status() -> tuple[str, str | None]:
    try:
        mode, model = _call("app.superres", "status")
        return ("ai" if mode == "ai" else "resampled", model if mode == "ai" else None)
    except (_Fallback, ApiException):
        return ("resampled", None)
    except Exception as exc:
        log.warning("superres.status failed: %r", exc)
        return ("resampled", None)


def health() -> Served:
    """Cheap: no upstream calls. Sources come from the DuckDB source_status table."""
    sources: list[HealthSource] = []
    try:
        for row in store.source_status_list(timeout_s=HEALTH_DB_TIMEOUT_S):
            last = row["last_ok_at"]
            sources.append(
                HealthSource(
                    source=row["source"],
                    ok=bool(row["ok"]),
                    last_fetched_at=config.iso_utc(last) if last else None,
                    stale=bool(row["stale"]),
                )
            )
    except Exception as exc:  # DB busy/locked must not fail health
        log.warning("health: source status unavailable: %r", exc)
    mode, model = sr_status()
    h = Health(
        service_version=config.SERVICE_VERSION,
        time=config.iso_utc(),
        agent_available=config.agent_available(),
        sr_mode=mode,
        sr_model=model,
        sources=sources,
    )
    return Served(h.model_dump(by_alias=True, mode="json"))
