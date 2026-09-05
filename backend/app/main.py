"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import CORS_ORIGINS, RUN_MIGRATIONS_ON_STARTUP, TRUSTED_PROXY_USER_HEADER
from .database import run_migrations
from .routers import (
    features,
    hardware,
    hw_management,
    meta,
    portfolio,
    projects,
    rates,
    reports,
    vault,
)

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if RUN_MIGRATIONS_ON_STARTUP:
        run_migrations()
    else:
        log.info("RUN_MIGRATIONS_ON_STARTUP is off: expecting `python -m app.migrate` to have run")
    yield


app = FastAPI(
    title="RFQ Planner API",
    description="RESTful API for RFQ resource and budget planning",
    version="1.0.0",
    lifespan=lifespan,
    # Under /api so the docs are reachable through the web tier's proxy, which
    # is the only route to the API in the shipped deployment.
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

@app.exception_handler(RequestValidationError)
async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """Report validation errors without echoing the offending input.

    FastAPI's default body repeats the client's value under `input`, which can hold
    things JSON cannot carry (a NaN turns the 422 itself into a 500) and which the
    caller already has. Location, message and type are what a client needs to show
    a readable error.
    """
    detail = [
        {"loc": list(error.get("loc", ())), "msg": error.get("msg", ""),
         "type": error.get("type", "")}
        for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": detail})


if CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Health stays reachable without the header so the container check works.
_OPEN_PATHS = ("/api/health",)


@app.middleware("http")
async def _require_trusted_user(request: Request, call_next):
    """Refuse API requests the authenticating proxy has not vouched for.

    Off unless TRUSTED_PROXY_USER_HEADER names the header the proxy sets. The
    check is deliberately simple: the header's presence is the proxy's word that
    the user logged in, which is why the deployment contract insists that only
    the proxy can reach this process.
    """
    path = request.url.path
    if TRUSTED_PROXY_USER_HEADER and path.startswith("/api/") and path not in _OPEN_PATHS:
        user = request.headers.get(TRUSTED_PROXY_USER_HEADER, "").strip()
        if not user:
            return JSONResponse(
                status_code=401,
                content={"detail": "Not authenticated: the request did not come "
                                   "through the authenticating proxy"},
            )
        request.state.user = user
    return await call_next(request)

app.include_router(meta.router)
app.include_router(projects.router)
app.include_router(features.router)
app.include_router(rates.router)
app.include_router(reports.router)
app.include_router(vault.router)
app.include_router(portfolio.router)
app.include_router(hardware.router)
app.include_router(hw_management.router)
