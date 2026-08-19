"""Metadata endpoints exposing domain constants and templates."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..config import (
    ASPICE_PROCESSES,
    HARDWARE_BILLING,
    HOURS_PER_FTE_PER_MONTH,
    LEVELS,
    LOCATIONS,
    PROJECT_STATUSES,
    TICKET_SIZES,
)
from ..templates import TEMPLATES, normalize_roles

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/templates", response_model=list[schemas.TemplateOut])
def list_templates(db: Session = Depends(get_db)):
    import json

    built_in = [
        {
            "id": t["id"],
            "name": t["name"],
            "description": t["description"],
            "custom": False,
            "features": [
                {"name": f["name"], "roles": normalize_roles(f)}
                for f in t["features"]
            ],
        }
        for t in TEMPLATES
    ]
    custom = [
        {
            "id": f"custom-{record.id}",
            "name": record.name,
            "description": record.description,
            "custom": True,
            "features": json.loads(record.features_json),
        }
        for record in db.query(models.CustomTemplate)
        .order_by(models.CustomTemplate.created_at)
        .all()
    ]
    return built_in + custom


@router.delete("/templates/{template_id}", status_code=204)
def delete_template(template_id: str, db: Session = Depends(get_db)):
    """Delete a custom template. Built-in templates cannot be deleted."""
    if not template_id.startswith("custom-"):
        raise HTTPException(status_code=403, detail="Built-in templates cannot be deleted")
    try:
        custom_id = int(template_id.removeprefix("custom-"))
    except ValueError:
        raise HTTPException(status_code=404, detail="Template not found")
    record = db.get(models.CustomTemplate, custom_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(record)
    db.commit()


@router.get("/meta", response_model=schemas.MetaOut)
def get_meta():
    return {
        "locations": LOCATIONS,
        "levels": LEVELS,
        "ticket_sizes": TICKET_SIZES,
        "project_statuses": PROJECT_STATUSES,
        "hours_per_fte_per_month": HOURS_PER_FTE_PER_MONTH,
        "aspice_processes": ASPICE_PROCESSES,
        "hardware_billing": HARDWARE_BILLING,
    }


@router.get("/health")
def health():
    return {"status": "ok"}
