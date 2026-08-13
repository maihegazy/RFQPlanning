"""Metadata endpoints exposing domain constants to the frontend."""

from fastapi import APIRouter

from .. import schemas
from ..config import HOURS_PER_FTE_PER_MONTH, LEVELS, LOCATIONS, TICKET_SIZES

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/meta", response_model=schemas.MetaOut)
def get_meta():
    return {
        "locations": LOCATIONS,
        "levels": LEVELS,
        "ticket_sizes": TICKET_SIZES,
        "hours_per_fte_per_month": HOURS_PER_FTE_PER_MONTH,
    }


@router.get("/health")
def health():
    return {"status": "ok"}
