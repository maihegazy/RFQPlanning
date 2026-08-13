"""Metadata endpoints exposing domain constants to the frontend."""

from fastapi import APIRouter

from .. import schemas
from ..config import HOURS_PER_FTE_PER_MONTH, LEVELS, LOCATIONS, TICKET_SIZES
from ..templates import TEMPLATES

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/templates", response_model=list[schemas.TemplateOut])
def list_templates():
    return [
        {
            "id": t["id"],
            "name": t["name"],
            "description": t["description"],
            "features": [
                {
                    "name": f["name"],
                    "roles": [
                        {"name": n, "location": loc, "level": lvl, "ftes": ftes}
                        for n, loc, lvl, ftes in f["roles"]
                    ],
                }
                for f in t["features"]
            ],
        }
        for t in TEMPLATES
    ]


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
