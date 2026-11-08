"""Assembles the sample portfolios (GET /portfolios/sample[?id=], GET /portfolios/samples) from real CIREN
polygons in service/data/*.geojson and the lender-side specs. No network.

- sample-cl      CLSF1 "Chile Specialty Fruit Credit I"  sample_spec.py      sample_portfolio_cl.geojson      (ADR-0016)
- sample-cl-sur  CLSO2 "Southern Orchards Credit II"     sample_spec_sur.py  sample_portfolio_cl_sur.geojson  (ADR-0026)
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any

from app import config
from app.domain import sample_spec, sample_spec_sur
from app.domain.schedule import make_loan
from app.domain.zones import ZONE_RADIUS_M, make_shared_zone, sync_zones
from app.models import CROPS, CreditRule, Farm, Portfolio, RuleChange, RulesPatch, SamplePortfolioSummary, Zone

#: Sample portfolios, in the order GET /portfolios/samples lists them. The first is the default sample.
SPECS: dict[str, ModuleType] = {s.PORTFOLIO_ID: s for s in (sample_spec, sample_spec_sur)}
DEFAULT_SAMPLE_ID = sample_spec.PORTFOLIO_ID


def geojson_file(spec: ModuleType) -> Path:
    return config.DATA_DIR / spec.GEOJSON_NAME


GEOJSON_FILE = geojson_file(sample_spec)


class UnknownSample(KeyError):
    """No sample portfolio with this id (GET /portfolios/sample?id= answers 404 not_found)."""


def _spec(sample_id: str | None) -> ModuleType:
    sid = sample_id or DEFAULT_SAMPLE_ID
    if sid not in SPECS:
        raise UnknownSample(sid)
    return SPECS[sid]


@lru_cache(maxsize=None)
def _geojson(sample_id: str = DEFAULT_SAMPLE_ID) -> dict[str, Any]:
    path = geojson_file(_spec(sample_id))
    if not path.exists():
        raise NotImplementedError(
            f"{path.name} is missing: run `python -m app.domain.build_sample --id {sample_id}` (needs CIREN once)")
    return json.loads(path.read_text(encoding="utf-8"))


def sample_features(sample_id: str | None = DEFAULT_SAMPLE_ID) -> dict[str, dict[str, Any]]:
    """farmId -> GeoJSON Feature (real CIREN polygon + attributes) of one sample portfolio (default: sample-cl),
    or of every sample when sample_id is None (farm ids are unique across the samples). In the all-samples view
    a missing GeoJSON is skipped; for an explicit id it raises NotImplementedError."""
    if sample_id is not None:
        return {f["properties"]["farmId"]: f for f in _geojson(sample_id)["features"]}
    out: dict[str, dict[str, Any]] = {}
    for sid in SPECS:
        try:
            out.update({f["properties"]["farmId"]: f for f in _geojson(sid)["features"]})
        except NotImplementedError:
            continue
    if not out:
        raise NotImplementedError("no sample GeoJSON found: run `python -m app.domain.build_sample`")
    return out


@lru_cache(maxsize=None)
def _build(sample_id: str = DEFAULT_SAMPLE_ID) -> Portfolio:
    spec_mod = _spec(sample_id)
    feats = sample_features(sample_id)
    farms: list[Farm] = []
    for spec in spec_mod.FARMS:
        f = feats.get(spec["id"])
        if f is None:
            raise NotImplementedError(f"sample farm {spec['id']} missing from {spec_mod.GEOJSON_NAME}; rebuild it")
        p = f["properties"]
        ln = spec["loan"]
        loan = make_loan(ln["type"], ln["origination"], ln["maturity"], ln["amount"], spec_mod.CURRENCY,
                         harvest_date=ln.get("harvestDate"), installments=ln.get("installments"))
        farms.append(Farm(
            id=spec["id"],
            name=spec["name"],
            crop=spec["crop"],
            polygon={"type": "Polygon", "coordinates": f["geometry"]["coordinates"]},
            area_ha=p["areaHa"],
            centroid=(p["centroid"][0], p["centroid"][1]),
            zone_id=f"auto-{spec['id']}",
            covered=spec.get("covered"),
            irrigated_declared=spec.get("irrigatedDeclared"),
            planting_year=None,  # CIREN polygons carry no planting year; never invented
            ciren={"especie": p["especie"], "variedad": None, "sourceLayer": p["sourceLayer"], "objectId": p["objectId"]},
            overrides=RulesPatch.model_validate(spec.get("overrides") or {}),
            credit_rule_overrides=spec.get("creditRuleOverrides") or {},
            loan=loan,
        ))
    by_id = {f.id: f for f in farms}
    zones: list[Zone] = []
    for z in spec_mod.SHARED_ZONES:
        pts = [by_id[i].centroid for i in z["farms"]]
        c = (round(sum(x[0] for x in pts) / len(pts), 6), round(sum(x[1] for x in pts) / len(pts), 6))
        zones.append(make_shared_zone(z["id"], z["name"], c, z.get("color")))
    portfolio = Portfolio(
        schema_version=1,
        id=spec_mod.PORTFOLIO_ID,
        name=spec_mod.PORTFOLIO_NAME,
        code=getattr(spec_mod, "PORTFOLIO_CODE", None),
        lender=spec_mod.LENDER,
        country=spec_mod.COUNTRY,
        currency=spec_mod.CURRENCY,
        created_at=spec_mod.CREATED_AT,
        zones=zones,
        farms=farms,
        credit_rules=[CreditRule.model_validate(r) for r in spec_mod.PORTFOLIO_CREDIT_RULES],
        crop_overrides={},
        audit=[RuleChange.model_validate(c) for c in spec_mod.AUDIT],
    )
    # auto zones for every farm (kept even when a shared zone covers the farm) + effective zoneId
    portfolio = sync_zones(portfolio)
    for z in portfolio.zones:
        ov = spec_mod.ZONE_OVERRIDES.get(z.id)
        if ov:
            z.overrides = {k: RulesPatch.model_validate(v) for k, v in ov.items()}
        if z.auto:
            z.radius_m = ZONE_RADIUS_M
    # shared zones first, then auto zones in farm order (stable, readable)
    order = {f"auto-{f.id}": i for i, f in enumerate(portfolio.farms)}
    portfolio.zones.sort(key=lambda z: (z.auto, order.get(z.id, -1)))
    return portfolio


def get_sample_portfolio(sample_id: str | None = None) -> Portfolio:
    """GET /portfolios/sample[?id=]: a sample portfolio on real CIREN orchards with illustrative loans. Without an
    id, the Chilean sample 'sample-cl' (12 orchards, 2 per crop). Unknown id -> UnknownSample."""
    return _build(sample_id or DEFAULT_SAMPLE_ID).model_copy(deep=True)


def get_sample_portfolios() -> list[Portfolio]:
    """Every sample portfolio whose GeoJSON is built, default first (the snapshot export's default set, ADR-0026)."""
    out: list[Portfolio] = []
    for sid in SPECS:
        try:
            out.append(_build(sid).model_copy(deep=True))
        except NotImplementedError:
            continue
    if not out:
        raise NotImplementedError("no sample GeoJSON found: run `python -m app.domain.build_sample`")
    return out


def list_sample_portfolios() -> list[SamplePortfolioSummary]:
    """GET /portfolios/samples: one summary per sample portfolio, default sample first."""
    out: list[SamplePortfolioSummary] = []
    for sid, spec_mod in SPECS.items():
        try:
            p = _build(sid)
        except NotImplementedError:  # GeoJSON not built yet: leave this sample out
            continue
        crops = [c for c in CROPS if any(f.crop == c for f in p.farms)]
        out.append(SamplePortfolioSummary(id=p.id, name=p.name, code=p.code, lender=p.lender, country=p.country, currency=p.currency,
                                          farm_count=len(p.farms), crops=crops, description=spec_mod.DESCRIPTION))
    if not out:
        raise NotImplementedError("no sample GeoJSON found: run `python -m app.domain.build_sample`")
    return out


def sample_commune(farm: Farm):
    """CommuneRef for a farm that is one of the orchards of any sample portfolio (matched by CIREN layer +
    objectId), from the cached GeoJSON attributes; None otherwise."""
    if farm.ciren is None:
        return None
    try:
        feats = sample_features(None)
    except NotImplementedError:
        return None
    from app.sources.ciren import CommuneRef

    for f in feats.values():
        p = f["properties"]
        if p["objectId"] == farm.ciren.object_id and p["sourceLayer"] == farm.ciren.source_layer and p.get("comuna"):
            return CommuneRef(name=p["comuna"], code=p.get("comunaCode"), province_code=p.get("provinciaCode"),
                              region_code=p.get("regionCode"), source_layer=p["sourceLayer"])
    return None


def sample_irrigation(farm_id: str) -> dict[str, Any] | None:
    """Cached CIREN irrigated-area result of a farm of any sample portfolio (from the GeoJSON), or None."""
    try:
        f = sample_features(None).get(farm_id)
    except NotImplementedError:
        return None
    return (f or {}).get("properties", {}).get("irrigated")
