"""Every contract fixture validates against app.models and round-trips without losing a key."""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter

from app.models import FIXTURE_TYPES, Driver, Portfolio, WaterDemand, camel, dump


def _subset_diffs(a, b, path=""):
    if isinstance(a, dict):
        if not isinstance(b, dict):
            return [f"{path}: type"]
        out = []
        for k, v in a.items():
            if k not in b:
                out.append(f"{path}.{k}: missing after round trip")
            else:
                out += _subset_diffs(v, b[k], f"{path}.{k}")
        return out
    if isinstance(a, list):
        if not isinstance(b, list) or len(a) != len(b):
            return [f"{path}: list"]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out += _subset_diffs(x, y, f"{path}[{i}]")
        return out
    return [] if a == b else [f"{path}: {a!r} != {b!r}"]


@pytest.mark.parametrize("name", sorted(FIXTURE_TYPES))
def test_fixture_validates_and_round_trips(name, fixture_json):
    data = fixture_json(name)
    t = FIXTURE_TYPES[name]
    if isinstance(t, TypeAdapter):
        out = t.dump_python(t.validate_python(data), by_alias=True, mode="json")
    else:
        out = dump(t.model_validate(data))
    assert _subset_diffs(data, out) == []


def test_every_fixture_file_is_covered():
    from app.config import FIXTURES_DIR

    assert {p.name for p in FIXTURES_DIR.glob("*.json")} == set(FIXTURE_TYPES)


def test_camel_aliases_keep_digits():
    assert camel("eto7d_mm") == "eto7dMm"
    assert camel("harvest_rain_mm72h") == "harvestRainMm72h"
    assert camel("ndvi_p10") == "ndviP10"
    assert "need30dMm" in WaterDemand.model_json_schema(by_alias=True)["properties"]


def test_credit_when_and_alias(fixture_json):
    crops = fixture_json("crops.json")
    pf = Portfolio.model_validate(fixture_json("portfolio-sample.json"))
    assert pf.farms and pf.farms[0].id
    d = dump(pf)
    assert "schemaVersion" in d and "cropOverrides" in d
    from app.models import CropTemplateList

    tpl = CropTemplateList.validate_python(crops)[0]
    assert "and" in dump(tpl)["creditRules"][0]["when"]


def test_populate_by_name_and_nulls_emitted():
    p = Driver.model_validate(
        {
            "component": "climate",
            "peril": "frost",
            "metric": "tmin_7d_min",
            "severity": 0.5,
            "impact": 0.4,
            "text": "x",
            "provenance": {
                "source": "derived",
                "sourceLabel": "d",
                "fetchedAt": "2026-11-07T16:00:00Z",
                "resolution": "n/a",
                "licenceTier": "unresolved",
                "dataTier": "enhanced",
            },
        }
    )
    out = dump(p)
    assert out["sensitivity"] is None and out["value"] is None  # emitted as null, not omitted
    assert out["provenance"]["observedAt"] is None and out["provenance"]["stale"] is False


def test_patch_models_omit_unset_leaves(fixture_json):
    from app.models import CreditRuleOverride, RulesPatch, Zone

    rp = RulesPatch.model_validate({"rules": {"stages": {"harvest": {"harvestRainMm72h": 5}}}})
    assert dump(rp) == {"rules": {"stages": {"harvest": {"harvestRainMm72h": 5.0}}}}
    assert dump(RulesPatch()) == {}
    z = Zone.model_validate(fixture_json("portfolio-sample.json")["zones"][1])
    assert dump(z)["overrides"] == {"table_grape": {"rules": {"stages": {"harvest": {"harvestRainMm72h": 5.0}}}}}
    assert dump(z)["color"] is None  # ordinary optional fields still emit null
    o = CreditRuleOverride.model_validate({"when": {"withinDaysBeforeInstallment": 90}})
    assert dump(o) == {"when": {"withinDaysBeforeInstallment": 90}}
