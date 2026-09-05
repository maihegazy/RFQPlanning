"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import CORS_ORIGINS
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations()
    yield


app = FastAPI(
    title="RFQ Planner API",
    description="RESTful API for RFQ resource and budget planning",
    version="1.0.0",
    lifespan=lifespan,
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


app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(meta.router)
app.include_router(projects.router)
app.include_router(features.router)
app.include_router(rates.router)
app.include_router(reports.router)
app.include_router(vault.router)
app.include_router(portfolio.router)
app.include_router(hardware.router)
app.include_router(hw_management.router)
