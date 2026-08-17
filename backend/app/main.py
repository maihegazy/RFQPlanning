"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ORIGINS
from .database import Base, engine, run_startup_migrations
from .routers import features, meta, portfolio, projects, rates, reports, vault


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    run_startup_migrations()
    yield


app = FastAPI(
    title="RFQ Planner API",
    description="RESTful API for RFQ resource and budget planning",
    version="1.0.0",
    lifespan=lifespan,
)

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
