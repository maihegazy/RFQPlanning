"""Project CRUD and import/export endpoints."""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import TICKET_SIZES
from ..database import get_db
from ..services import calculations, cloning
from ..services.loading import project_tree
from ..services.rate_config import get_rate_config
from ..templates import resolve_template

router = APIRouter(prefix="/api/projects", tags=["projects"])


def get_project_or_404(project_id: int, db: Session) -> models.Project:
    project = db.get(models.Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def get_project_tree_or_404(project_id: int, db: Session) -> models.Project:
    """The project with its features, roles and periods loaded in four queries."""
    project = (
        db.query(models.Project)
        .options(project_tree())
        .filter(models.Project.id == project_id)
        .one_or_none()
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("", response_model=list[schemas.ProjectSummary])
def list_projects(status: str | None = None, include_scenarios: bool = False,
                  db: Session = Depends(get_db)):
    query = db.query(models.Project)
    if not include_scenarios:
        query = query.filter(models.Project.base_project_id.is_(None))
    if status is not None:
        query = query.filter(models.Project.status == status)
    return query.order_by(models.Project.updated_at.desc()).all()


@router.post("", response_model=schemas.ProjectOut, status_code=201)
def create_project(data: schemas.ProjectCreate, db: Session = Depends(get_db)):
    template = None
    if data.template_id:
        template = resolve_template(db, data.template_id)
        if template is None:
            raise HTTPException(status_code=422,
                                detail=f"Unknown template: {data.template_id}")

    project = models.Project(**data.model_dump(exclude={"template_id"}))
    db.add(project)
    db.flush()

    if template:
        first_month = f"{project.start_year:04d}-{project.start_month:02d}"
        last_month = f"{project.end_year:04d}-{project.end_month:02d}"
        for feature_def in template["features"]:
            feature = models.Feature(project_id=project.id, name=feature_def["name"])
            db.add(feature)
            db.flush()
            for role in feature_def["roles"]:
                ftes = float(role["ftes"])
                # A template may carry an average above the fixed-FTE cap (a
                # variable role snapshotted at 4.0); it becomes one variable period.
                variable = ftes > 2.0
                record = models.Role(
                    feature_id=feature.id,
                    name=role["name"],
                    location=role["location"],
                    level=role["level"],
                    ftes=0.0 if variable else ftes,
                    use_advanced_allocation=variable,
                )
                db.add(record)
                if variable:
                    db.flush()
                    db.add(models.AllocationPeriod(
                        role_id=record.id, start_month=first_month,
                        end_month=last_month, ftes=ftes,
                    ))

    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=schemas.ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)):
    return get_project_tree_or_404(project_id, db)


@router.put("/{project_id}", response_model=schemas.ProjectOut)
def update_project(project_id: int, data: schemas.ProjectUpdate,
                   db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    updates = data.model_dump(exclude_unset=True)
    start = (
        updates.get("start_year", project.start_year),
        updates.get("start_month", project.start_month),
    )
    end = (
        updates.get("end_year", project.end_year),
        updates.get("end_month", project.end_month),
    )
    if start > end:
        raise HTTPException(
            status_code=422,
            detail="Project start date must be before or equal to end date",
        )
    timeline_changed = (
        start != (project.start_year, project.start_month)
        or end != (project.end_year, project.end_month)
    )
    if timeline_changed:
        conflicts = calculations.timeline_conflicts(project, start, end)
        if conflicts:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Changing the timeline would leave data outside it: "
                    + "; ".join(conflicts)
                    + ". Adjust or remove these first."
                ),
            )
    for field, value in updates.items():
        setattr(project, field, value)
    if timeline_changed:
        # A quota for a year the project no longer covers has nothing to apply to.
        for quota in list(project.ticket_quotas):
            if not start[0] <= quota.year <= end[0]:
                db.delete(quota)
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    db.delete(project)
    db.commit()


@router.post("/{project_id}/save-as-template",
             response_model=schemas.TemplateOut, status_code=201)
def save_as_template(project_id: int, data: schemas.SaveTemplateRequest,
                     db: Session = Depends(get_db)):
    """Snapshot the project's features and roles as a reusable template.

    Templates are timeline-independent, so roles with variable allocation
    periods are captured as a fixed FTE equal to their average utilization
    over the project's months (rounded to 1 decimal). Money is never part
    of a template.
    """
    project = get_project_or_404(project_id, db)
    months = calculations.get_project_months(project)

    features = []
    for feature in project.features:
        roles = []
        for role in feature.roles:
            if role.use_advanced_allocation and months:
                total = sum(calculations.get_ftes_for_month(role, m) for m in months)
                ftes = round(total / len(months), 1)
            else:
                ftes = role.ftes
            roles.append({
                "name": role.name,
                "location": role.location,
                "level": role.level,
                "ftes": ftes,
            })
        features.append({"name": feature.name, "roles": roles})

    if not features:
        raise HTTPException(status_code=400,
                            detail="Project has no features to save as a template")

    record = models.CustomTemplate(
        name=data.name,
        description=data.description,
        features_json=json.dumps(features),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {
        "id": f"custom-{record.id}",
        "name": record.name,
        "description": record.description,
        "custom": True,
        "features": features,
    }


@router.post("/{project_id}/clone", response_model=schemas.ProjectOut, status_code=201)
def clone_project_endpoint(project_id: int, data: schemas.CloneRequest,
                           db: Session = Depends(get_db)):
    """Duplicate a project. as_scenario=true links the copy to the base
    project (scenarios of a scenario attach to the same base)."""
    source = get_project_or_404(project_id, db)
    base_id = None
    if data.as_scenario:
        base_id = source.base_project_id or source.id
    clone = cloning.clone_project(db, source, data.name, base_id)
    db.commit()
    db.refresh(clone)
    return clone


@router.get("/{project_id}/scenarios", response_model=list[schemas.ProjectSummary])
def list_scenarios(project_id: int, db: Session = Depends(get_db)):
    """The scenario family of a project: the base first, then scenarios."""
    project = get_project_or_404(project_id, db)
    base_id = project.base_project_id or project.id
    base = db.get(models.Project, base_id)
    scenarios = (
        db.query(models.Project)
        .filter(models.Project.base_project_id == base_id)
        .order_by(models.Project.id)
        .all()
    )
    return ([base] if base else []) + scenarios


@router.post("/{project_id}/promote", response_model=schemas.ProjectSummary)
def promote_scenario(project_id: int, db: Session = Depends(get_db)):
    """Mark a scenario as the winning one (exclusive among its family)."""
    project = get_project_or_404(project_id, db)
    base_id = project.base_project_id or project.id
    family = (
        db.query(models.Project)
        .filter((models.Project.id == base_id) |
                (models.Project.base_project_id == base_id))
        .all()
    )
    for p in family:
        p.is_winning_scenario = (p.id == project.id)
    db.commit()
    db.refresh(project)
    return project


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
    """Export a project's non-monetary data in the desktop app's JSON format.

    Money values are end-to-end encrypted; the browser merges the decrypted
    money into this structure before offering the download.
    """
    project = get_project_or_404(project_id, db)
    rates = get_rate_config(project)
    return {
        "project_name": project.name,
        "company_name": project.company,
        "status": project.status,
        "win_probability_pct": project.win_probability_pct,
        "lost_reason": project.lost_reason,
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
                        # Only a variable role's periods mean anything; a fixed
                        # role exports none so the file always re-imports.
                        "allocations": [
                            {
                                "start_month": a.start_month,
                                "end_month": a.end_month,
                                "ftes": a.ftes,
                            }
                            for a in role.allocations
                        ] if role.use_advanced_allocation else [],
                        "use_advanced_allocation": role.use_advanced_allocation,
                    }
                    for role in feature.roles
                ],
            }
            for feature in project.features
        ],
        "rate_config": {
            "sp_to_hours": rates["sp_to_hours"],
            "risk_factor_pct": rates["risk_factor_pct"],
            "ticket_sp": rates["ticket_story_points"],
            "ticket_quota": {str(y): q for y, q in rates["ticket_quotas"].items()},
        },
        "hardware_items": [
            {
                "name": item.name,
                "aspice": item.aspice,
                "billing": item.billing,
                "unit_cost": item.unit_cost,
                "qty": item.qty,
                "years": calculations.hardware_item_years(item),
                "supplier_name": item.supplier_name,
                "supplier_email": item.supplier_email,
                # The catalog link travels by name: ids differ between databases.
                "catalog_item_name": item.catalog_item.name if item.catalog_item else "",
            }
            for item in project.hardware_items
        ],
    }


@router.post("/import", response_model=schemas.ProjectOut, status_code=201)
def import_project(data: schemas.LegacyProjectImport, db: Session = Depends(get_db)):
    """Import a project from the desktop app's JSON format."""
    start_year, start_month, end_year, end_month = data.dates
    project = models.Project(
        name=data.project_name,
        company=data.company_name,
        start_year=start_year, start_month=start_month,
        end_year=end_year, end_month=end_month,
        status=data.status,
        win_probability_pct=data.win_probability_pct,
        lost_reason=data.lost_reason,
    )
    db.add(project)
    db.flush()

    for feature_data in data.features:
        feature = models.Feature(project_id=project.id,
                                 name=feature_data.name)
        db.add(feature)
        db.flush()
        for role_data in feature_data.roles:
            role = models.Role(
                feature_id=feature.id,
                name=role_data.name,
                location=role_data.location,
                level=role_data.level,
                ftes=role_data.ftes,
                use_advanced_allocation=role_data.use_advanced_allocation,
            )
            db.add(role)
            db.flush()
            for alloc in role_data.allocations:
                db.add(models.AllocationPeriod(
                    role_id=role.id,
                    start_month=alloc.start_month,
                    end_month=alloc.end_month,
                    ftes=alloc.ftes,
                ))

    # Monetary values in the file (hourly_rates, cost_rates, ticket_price,
    # hw_cost_per_hour) are NOT stored in plaintext — the browser encrypts
    # them into the project's money blob after this import returns.
    rc = data.rate_config
    project.sp_to_hours = rc.sp_to_hours
    project.risk_factor_pct = rc.risk_factor_pct

    for size in TICKET_SIZES:
        db.add(models.TicketConfig(
            project_id=project.id, size=size,
            story_points=rc.ticket_sp.get(size, 0.0),
        ))

    for year, quotas in rc.ticket_quota.items():
        for size in TICKET_SIZES:
            db.add(models.TicketQuota(
                project_id=project.id, year=year, size=size,
                quota_pct=quotas.get(size, 0.0),
            ))

    catalog_by_name: dict[str, int] = {}
    if data.hardware_items:
        catalog_by_name = {
            record.name: record.id for record in db.query(models.HardwareCatalogItem)
        }
    for item in data.hardware_items:
        db.add(models.HardwareItem(
            project_id=project.id,
            catalog_item_id=catalog_by_name.get(item.catalog_item_name),
            name=item.name,
            aspice=item.aspice,
            billing=item.billing,
            unit_cost=item.unit_cost,
            qty=item.qty,
            years_json=json.dumps(sorted(set(item.years))),
            supplier_name=item.supplier_name,
            supplier_email=item.supplier_email,
        ))

    db.commit()
    db.refresh(project)
    return project
