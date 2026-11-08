"""Turn a dispatch.Served into a JSON response (fixture responses carry X-CLM-Fixture: 1)."""

from __future__ import annotations

from fastapi.responses import JSONResponse

from app.routers.dispatch import Served

FIXTURE_HEADER = "X-CLM-Fixture"


def respond(served: Served, status_code: int = 200) -> JSONResponse:
    headers = {FIXTURE_HEADER: "1"} if served.fixture else None
    return JSONResponse(served.data, status_code=status_code, headers=headers)
