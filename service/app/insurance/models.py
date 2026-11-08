"""Pydantic mirror of the v1.1 insurance request types (contracts/v1/types.ts, CONTRACT §A; ADR-0025).

JSON is camelCase through CLMModel's alias generator. The service validates the payload and stores it as sent;
it never recomputes the score, drivers or loan figures.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Literal

from pydantic import Field, field_validator

from app.models import CLMModel, Crop, Currency, Peril, Tier

InsurancePeril = Literal["frost", "water", "harvest_rain", "fire"]
INSURANCE_PERILS: list[str] = ["frost", "water", "harvest_rain", "fire"]

InsuranceRequestStatus = Literal["queued"]

MAX_DRIVERS = 3
MAX_NOTE = 1000

_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def _iso_date(v: str) -> str:
    try:
        date.fromisoformat(v)
    except (TypeError, ValueError):
        raise ValueError(f"'{v}' is not a YYYY-MM-DD date")
    if len(v) != 10:
        raise ValueError(f"'{v}' is not a YYYY-MM-DD date")
    return v


class InsuranceFarm(CLMModel):
    name: str = Field(min_length=1, max_length=200)
    crop: Crop
    area_ha: float = Field(gt=0)
    centroid: tuple[float, float]
    country: str = Field(min_length=2, max_length=16)
    zone_id: str = Field(min_length=1, max_length=128)
    zone_name: str = Field(max_length=200)

    @field_validator("centroid")
    @classmethod
    def _wgs84(cls, v: tuple[float, float]) -> tuple[float, float]:
        lng, lat = v
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            raise ValueError("centroid must be [lng, lat] within WGS84 (lng ±180, lat ±90)")
        return v


class InsuranceLoan(CLMModel):
    currency: Currency
    amount: float = Field(ge=0)
    outstanding: float = Field(ge=0)
    maturity_date: str

    @field_validator("maturity_date")
    @classmethod
    def _date(cls, v: str) -> str:
        return _iso_date(v)


class InsuranceDriver(CLMModel):
    peril: Peril
    text: str = Field(max_length=500)


class InsuranceRisk(CLMModel):
    as_of: str
    score: float = Field(ge=0, le=100)
    tier: Tier
    drivers: list[InsuranceDriver] = Field(default_factory=list, max_length=MAX_DRIVERS)

    @field_validator("as_of")
    @classmethod
    def _date(cls, v: str) -> str:
        return _iso_date(v)


class InsuranceRequestPayload(CLMModel):
    partner: Literal["suyana"]
    lender: str = Field(max_length=200)
    portfolio_name: str = Field(max_length=200)
    farm: InsuranceFarm
    loan: InsuranceLoan | None = None
    risk: InsuranceRisk
    perils: list[InsurancePeril] = Field(min_length=1)
    uncovered_perils: list[Peril] = Field(default_factory=list)
    note: str | None = Field(default=None, max_length=MAX_NOTE)

    @field_validator("perils")
    @classmethod
    def _unique(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("perils must not repeat")
        return v

    @field_validator("note")
    @classmethod
    def _blank_note(cls, v: str | None) -> str | None:
        return v.strip() or None if v is not None else None


class CreateInsuranceRequest(CLMModel):
    portfolio_id: str
    farm_id: str
    payload: InsuranceRequestPayload

    @field_validator("portfolio_id", "farm_id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not _ID.match(v or ""):
            raise ValueError("must be a non-empty id of letters, digits, '.', '_' or '-' (max 128)")
        return v


class InsuranceRequest(CLMModel):
    id: str
    created_at: str
    portfolio_id: str
    farm_id: str
    status: InsuranceRequestStatus = "queued"
    payload: InsuranceRequestPayload
