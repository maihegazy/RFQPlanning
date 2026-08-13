"""Project CRUD and import/export endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import LEVELS, LOCATIONS, TICKET_SIZES
from ..database import get_db
from ..services import calculations
from ..services.rate_config import get_rate_config
from ..templates import get_template

router = APIRouter(prefix="/api/projects", tags=["projects"])


def get_project_or_404(project_id: int, db: Session) -> models.Project:
    project = db.get(models.Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("", response_model=list[schemas.ProjectSummary])
def list_projects(db: Session = Depends(get_db)):
    return db.query(models.Project).order_by(models.Project.updated_at.desc()).all()


@router.post("", response_model=schemas.ProjectOut, status_code=201)
def create_project(data: schemas.ProjectCreate, db: Session = Depends(get_db)):
    template = None
    if data.template_id:
        template = get_template(data.template_id)
        if template is None:
            raise HTTPException(status_code=422,
                                detail=f"Unknown template: {data.template_id}")

    project = models.Project(**data.model_dump(exclude={"template_id"}))
    db.add(project)
    db.flush()

    if template:
        for feature_def in template["features"]:
            feature = models.Feature(project_id=project.id, name=feature_def["name"])
            db.add(feature)
            db.flush()
            for role_name, location, level, ftes in feature_def["roles"]:
                db.add(models.Role(
                    feature_id=feature.id,
                    name=role_name,
                    location=location,
                    level=level,
                    ftes=ftes,
                    use_advanced_allocation=False,
                ))

    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=schemas.ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)):
    return get_project_or_404(project_id, db)


@router.put("/{project_id}", response_model=schemas.ProjectOut)
def update_project(project_id: int, data: schemas.ProjectUpdate,
                   db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    db.delete(project)
    db.commit()


@router.get("/{project_id}/validate", response_model=schemas.ValidationResult)
def validate_project(project_id: int, db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    errors = calculations.validate_project(project)
    return {"valid": not errors, "errors": errors}


# ---------------------------------------------------------------------------
# Import / export in the legacy desktop JSON format
# ---------------------------------------------------------------------------

@router.get("/{project_id}/export")
def export_project(project_id: int, db: Session = Depends(get_db)):
    """Export a project in the desktop app's JSON format."""
    project = get_project_or_404(project_id, db)
    rates = get_rate_config(project)
    return {
        "project_name": project.name,
        "company_name": project.company,
        "dates": [
            str(project.start_year), str(project.start_month),
            str(project.end_year), str(project.end_month),
        ],
        "features": [
            {
                "Feature": feature.name,
                "Roles": [
                    {
                        "Role": role.name,
                        "Location": role.location,
                        "Level": role.level,
                        "FTEs": role.ftes,
                        "allocations": [
                            {
                                "start_month": a.start_month,
                                "end_month": a.end_month,
                                "ftes": a.ftes,
                            }
                            for a in role.allocations
                        ],
                        "use_advanced_allocation": role.use_advanced_allocation,
                    }
                    for role in feature.roles
                ],
            }
            for feature in project.features
        ],
        "rate_config": {
            "hourly_rates": rates["hourly_rates"],
            "cost_rates": rates["cost_rates"],
            "sp_to_hours": rates["sp_to_hours"],
            "hw_cost_per_hour": rates["hw_cost_per_hour"],
            "risk_factor_pct": rates["risk_factor_pct"],
            "ticket_sp": rates["ticket_story_points"],
            "ticket_price": rates["ticket_prices"],
            "ticket_quota": {str(y): q for y, q in rates["ticket_quotas"].items()},
        },
    }


@router.post("/import", response_model=schemas.ProjectOut, status_code=201)
def import_project(data: dict, db: Session = Depends(get_db)):
    """Import a project from the desktop app's JSON format."""
    dates = data.get("dates", [])
    try:
        start_year, start_month = int(dates[0]), int(dates[1])
        end_year, end_month = int(dates[2]), int(dates[3])
    except (IndexError, ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Invalid or missing 'dates' array")

    project = models.Project(
        name=data.get("project_name", "Project"),
        company=data.get("company_name", "Company"),
        start_year=start_year, start_month=start_month,
        end_year=end_year, end_month=end_month,
    )
    db.add(project)
    db.flush()

    for feature_data in data.get("features", []):
        feature = models.Feature(project_id=project.id,
                                 name=feature_data.get("Feature", ""))
        db.add(feature)
        db.flush()
        for role_data in feature_data.get("Roles", []):
            role = models.Role(
                feature_id=feature.id,
                name=role_data.get("Role", ""),
                location=role_data.get("Location", ""),
                level=role_data.get("Level", ""),
                ftes=float(role_data.get("FTEs", 0.0)),
                use_advanced_allocation=bool(role_data.get("use_advanced_allocation", False)),
            )
            db.add(role)
            db.flush()
            for alloc in role_data.get("allocations", []):
                db.add(models.AllocationPeriod(
                    role_id=role.id,
                    start_month=alloc.get("start_month", ""),
                    end_month=alloc.get("end_month", ""),
                    ftes=float(alloc.get("ftes", 0.0)),
                ))

    rc = data.get("rate_config", {})
    project.sp_to_hours = float(rc.get("sp_to_hours", 4.0))
    project.hw_cost_per_hour = float(rc.get("hw_cost_per_hour", 0.0))
    project.risk_factor_pct = float(rc.get("risk_factor_pct", 0.0))

    for loc in LOCATIONS:
        rate = float(rc.get("hourly_rates", {}).get(loc, 0.0))
        db.add(models.HourlyRate(project_id=project.id, location=loc, rate=rate))
        for lvl in LEVELS:
            cost = float(rc.get("cost_rates", {}).get(loc, {}).get(lvl, 0.0))
            db.add(models.CostRate(project_id=project.id, location=loc, level=lvl, rate=cost))

    for size in TICKET_SIZES:
        db.add(models.TicketConfig(
            project_id=project.id, size=size,
            story_points=float(rc.get("ticket_sp", {}).get(size, 0.0)),
            price=float(rc.get("ticket_price", {}).get(size, 0.0)),
        ))

    for year_str, quotas in rc.get("ticket_quota", {}).items():
        try:
            year = int(year_str)
        except (ValueError, TypeError):
            continue
        for size in TICKET_SIZES:
            db.add(models.TicketQuota(
                project_id=project.id, year=year, size=size,
                quota_pct=float(quotas.get(size, 0.0)),
            ))

    db.commit()
    db.refresh(project)
    return project
