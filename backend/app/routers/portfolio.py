"""Cross-project portfolio endpoints (effort only).

Monetary portfolio KPIs (pipeline value, weighted revenue, margins) are
computed client-side from decrypted money blobs; the server aggregates
only FTE capacity, which is not monetary.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..config import LOCATIONS
from ..database import get_db
from ..services import calculations
from ..services.loading import project_tree

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


@router.get("/capacity")
def capacity(statuses: str | None = None, db: Session = Depends(get_db)):
    """Aggregate FTE demand per month and location across projects.

    statuses: optional comma-separated filter (e.g. "draft,quoted,won"). Omitting
    the parameter means every status; sending it empty means no status at all,
    so a page whose user deselected every filter shows nothing rather than all.
    Scenario children are excluded — only base projects count.
    """
    query = (
        db.query(models.Project)
        .options(project_tree())
        .filter(models.Project.base_project_id.is_(None))
    )
    if statuses is not None:
        wanted = [s.strip() for s in statuses.split(",") if s.strip()]
        if not wanted:
            return {
                "months": [], "locations": LOCATIONS, "cells": {},
                "totals_by_month": {}, "project_count": 0,
            }
        query = query.filter(models.Project.status.in_(wanted))
    projects = query.all()

    cells: dict[str, dict[str, float]] = {}
    for project in projects:
        months = calculations.get_project_months(project)
        for month in months:
            cells.setdefault(month, {loc: 0.0 for loc in LOCATIONS})
            for feature in project.features:
                for role in feature.roles:
                    ftes = calculations.get_ftes_for_month(role, month)
                    cells[month][role.location] = cells[month].get(role.location, 0.0) + ftes

    months_sorted = sorted(cells.keys())
    return {
        "months": months_sorted,
        "locations": LOCATIONS,
        "cells": {m: cells[m] for m in months_sorted},
        "totals_by_month": {m: sum(cells[m].values()) for m in months_sorted},
        "project_count": len(projects),
    }
