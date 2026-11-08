"""FastAPI app: `.venv/bin/python -m uvicorn app.main:app --port 8787` (from service/).

- Imports every builder package at startup (registry registrations run at import time). A package
  that fails to import is logged; its endpoints return 500 with the reason, the others keep working.
- Errors: every non-2xx body is {error, detail} (CONTRACT §B); FastAPI's 422 becomes 400 invalid_request.
- CORS: http://localhost:5190 and http://127.0.0.1:5190.
- Static files: /files -> config.files_dir() (imagery PNGs under /files/imagery/...).
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import config, store
from app.registry import load_providers
from app.routers import agent, assess, ciren, events, imagery, insurance, meta, snapshot
from app.routers.errors import ApiException

log = logging.getLogger("clm")

_STATUS_CODES = {400: "invalid_request", 404: "not_found", 405: "invalid_request", 503: "no_api_key"}


def _err(status: int, error: str, detail: str) -> JSONResponse:
    return JSONResponse({"error": error, "detail": detail}, status_code=status)


def _loc(loc: tuple) -> str:
    out = ""
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out


def create_app() -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    app = FastAPI(
        title="BrotIA service",
        version=config.SERVICE_VERSION,
        description="v1 contract: contracts/v1/CONTRACT.md",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ORIGINS,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
        expose_headers=["X-CLM-Fixture"],
    )

    @app.exception_handler(ApiException)
    async def _api_exc(_: Request, exc: ApiException):
        return _err(exc.status, exc.error, exc.detail)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errs = exc.errors()
        if errs:
            e = errs[0]
            detail = f"{_loc(tuple(e.get('loc', ())))}: {e.get('msg', 'invalid')}"
            if len(errs) > 1:
                detail += f" (+{len(errs) - 1} more)"
        else:
            detail = "invalid request"
        return _err(400, "invalid_request", detail)

    @app.exception_handler(StarletteHTTPException)
    async def _http_exc(_: Request, exc: StarletteHTTPException):
        code = _STATUS_CODES.get(exc.status_code, "internal_error" if exc.status_code >= 500 else "invalid_request")
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return _err(exc.status_code, code, detail)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        log.exception("unhandled error")
        return _err(500, "internal_error", f"{exc.__class__.__name__}: {exc}")

    for r in (meta, ciren, assess, imagery, events, agent, snapshot, insurance):
        app.include_router(r.router)

    files = config.files_dir()
    (files / "imagery").mkdir(parents=True, exist_ok=True)
    app.mount("/files", StaticFiles(directory=str(files), check_dir=False), name="files")

    try:
        store.init()
    except Exception as exc:  # e.g. another process holds the DB: the service still answers
        log.error("DuckDB init failed (%s): caching disabled until it is available", exc)

    errors = load_providers()
    for e in errors:
        log.error("builder import error: %s", e)
    app.state.import_errors = errors

    _start_superres_warm()
    return app


def _start_superres_warm() -> None:
    """Load the SR model in the background so the first imagery request does not pay for it and /health
    reflects a real load. Off under pytest and with CLM_SR_WARM=0."""
    import os
    import sys
    import threading

    if "pytest" in sys.modules or os.environ.get("CLM_SR_WARM", "1").strip().lower() in {"0", "false", "no"}:
        return

    def run() -> None:
        try:
            from app import superres

            info = superres.warm()
            log.info("superres warm: mode=%s device=%s", info.get("mode") or info.get("srMode"), info.get("device"))
        except Exception as exc:  # never break startup
            log.warning("superres warm failed: %r", exc)

    threading.Thread(target=run, name="superres-warm", daemon=True).start()


app = create_app()
