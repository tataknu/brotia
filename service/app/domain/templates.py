"""Crop templates (ADR-0013 D1, D4, D5; CONTRACT §A CropTemplate) and countries (§A Country).

Data lives in service/data/crop_templates.json (seeded from contracts/v1/fixtures/crops.json, refined with
citations from families/chile-crops-perils and FAO-56 Kc; keys, stage keys and shapes unchanged) and
service/data/countries.json (the 12 South American countries + GLOBAL, static).
"""

from __future__ import annotations

import json
from functools import lru_cache

from app import config
from app.models import CROPS, Country, CountryList, CropTemplate, CropTemplateList

TEMPLATES_FILE = config.DATA_DIR / "crop_templates.json"
COUNTRIES_FILE = config.DATA_DIR / "countries.json"


@lru_cache(maxsize=1)
def _templates() -> tuple[CropTemplate, ...]:
    items = CropTemplateList.validate_python(json.loads(TEMPLATES_FILE.read_text(encoding="utf-8")))
    by_crop = {t.crop: t for t in items}
    missing = [c for c in CROPS if c not in by_crop]
    if missing:
        raise RuntimeError(f"crop_templates.json lacks templates for {missing}")
    return tuple(by_crop[c] for c in CROPS)


def get_crop_templates() -> list[CropTemplate]:
    """GET /crops: the six templates in CROPS order (deep copies: callers may mutate them)."""
    return [t.model_copy(deep=True) for t in _templates()]


def get_crop_template(crop: str) -> CropTemplate:
    for t in _templates():
        if t.crop == crop:
            return t.model_copy(deep=True)
    raise KeyError(f"no crop template for '{crop}'")


@lru_cache(maxsize=1)
def _countries() -> tuple[Country, ...]:
    return tuple(CountryList.validate_python(json.loads(COUNTRIES_FILE.read_text(encoding="utf-8"))))


def get_countries() -> list[Country]:
    """GET /countries: 13 entries (12 South American countries + GLOBAL, comingLater)."""
    return [c.model_copy(deep=True) for c in _countries()]
