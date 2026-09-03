"""Hardware Management: purchasing projects, asset/license registers, budget summary.

Replaces the `HW_purchasing_working_document_V5.xlsx` working document. Every
register row is returned with the sheet's per-year depreciation columns attached
(`per_year` / `total`) so the grids can render the same numbers the sheet showed.
"""

from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import (
    HW_ASSET_CATEGORIES,
    HW_ASSET_STATUSES,
    HW_LEASING_MONTHS,
    HW_LICENSE_CATEGORIES,
    HW_PURCHASE_TYPES,
)
from ..database import get_db
from ..services import hw_depreciation, hw_excel
from .hardware import XLSX_MEDIA_TYPE

router = APIRouter(prefix="/api", tags=["hw-management"])

ASSET_FIELDS = tuple(schemas.HwAssetInput.model_fields)
LICENSE_FIELDS = tuple(schemas.HwLicenseInput.model_fields)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_hw_project_or_404(project_id: int, db: Session) -> models.HwProject:
    project = db.get(models.HwProject, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Hardware project not found")
    return project


def get_hw_asset_or_404(asset_id: int, db: Session) -> models.HwAsset:
    asset = db.get(models.HwAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Hardware asset not found")
    return asset


def get_hw_license_or_404(license_id: int, db: Session) -> models.HwLicense:
    record = db.get(models.HwLicense, license_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Hardware license not found")
    return record


def check_catalog_items(catalog_item_ids, db: Session) -> None:
    """Reject unknown catalog links before writing.

    SQLite only enforces foreign keys with the pragma on, so an unchecked id
    would otherwise be stored and read back as a dangling reference.
    """
    wanted = {item_id for item_id in catalog_item_ids if item_id is not None}
    if not wanted:
        return
    found = {
        row[0]
        for row in db.query(models.HardwareCatalogItem.id)
        .filter(models.HardwareCatalogItem.id.in_(wanted))
    }
    missing = sorted(wanted - found)
    if missing:
        raise HTTPException(status_code=404,
                            detail=f"Catalog item not found: {missing[0]}")


def extra_years(project: models.HwProject) -> list[int]:
    """Years the summary must cover even when no register row falls in them."""
    years = [adjustment.year for adjustment in project.adjustments]
    years += [year for year in (project.start_year, project.end_year) if year]
    return years


def project_years(project: models.HwProject) -> list[int]:
    return hw_depreciation.year_span(project.assets, project.licenses,
                                     extra_years=extra_years(project))


def summarize_project(project: models.HwProject, today: date) -> dict:
    return hw_depreciation.summarize(
        project.assets, project.licenses, project.adjustments,
        project.budget_assets, project.budget_licenses, today,
        extra_years=extra_years(project),
    )


def project_summary(project: models.HwProject, today: date) -> dict:
    summary = summarize_project(project, today)
    summary["expiring"] = hw_depreciation.expiring_licenses(
        project.licenses, today, {project.id: project.name},
    )
    return summary


def project_rollup(project: models.HwProject, today: date) -> dict:
    summary = summarize_project(project, today)
    risk = summary["risk"]
    data = schemas.HwProjectOut.model_validate(project).model_dump()
    data.update(
        asset_count=summary["asset_count"],
        license_count=summary["license_count"],
        actual_total=summary["totals"]["actual_total"],
        planned_total=summary["totals"]["planned_total"],
        budget_total=summary["dashboard"]["budget_total"],
        remaining=summary["dashboard"]["remaining"],
        licenses_expired=risk["expired"],
        # The renewal-risk tile counts what still has to be renewed, so the
        # already-expired bucket stays out of the 90-day number.
        licenses_expiring_90=(
            risk["in_30_days"] + risk["in_60_days"] + risk["in_90_days"]
        ),
    )
    return data


def _register_row(row, fields: tuple[str, ...], costs: dict[str, float]) -> dict:
    data = {field: getattr(row, field) for field in fields}
    data["id"] = row.id
    data["hw_project_id"] = row.hw_project_id
    data["per_year"] = costs
    # Adding up the year columns, so the row total always matches what the grid
    # displays rather than drifting a cent from it.
    data["total"] = round(sum(costs.values()), 2)
    return data


def serialize_asset(asset: models.HwAsset, years: list[int]) -> dict:
    return _register_row(asset, ASSET_FIELDS, hw_depreciation.per_year(
        asset.purchase_type, asset.purchase_date, asset.eol_date,
        asset.purchase_cost, years,
    ))


def serialize_license(record: models.HwLicense, years: list[int]) -> dict:
    return _register_row(record, LICENSE_FIELDS, hw_depreciation.per_year(
        record.depreciation, record.purchase_date, record.termination_date,
        record.purchase_cost, years,
    ))


# ---------------------------------------------------------------------------
# Vocabularies and management overview
# ---------------------------------------------------------------------------

@router.get("/hw/meta", response_model=schemas.HwMetaOut)
def get_hw_meta():
    return {
        "purchase_types": HW_PURCHASE_TYPES,
        "asset_statuses": HW_ASSET_STATUSES,
        "asset_categories": HW_ASSET_CATEGORIES,
        "license_categories": HW_LICENSE_CATEGORIES,
        "leasing_months": HW_LEASING_MONTHS,
    }


@router.get("/hw/overview", response_model=schemas.HwOverviewOut)
def get_hw_overview(db: Session = Depends(get_db)):
    """The budget position across every hardware project."""
    today = date.today()
    projects = (
        db.query(models.HwProject)
        .order_by(models.HwProject.name, models.HwProject.id)
        .all()
    )
    assets = [asset for project in projects for asset in project.assets]
    licenses = [row for project in projects for row in project.licenses]
    adjustments = [a for project in projects for a in project.adjustments]

    overview = hw_depreciation.overview_summary(
        assets, licenses, adjustments, projects, today,
        extra_years=[year for project in projects for year in extra_years(project)],
    )
    overview["projects"] = [project_rollup(project, today) for project in projects]
    return overview


# ---------------------------------------------------------------------------
# Hardware projects
# ---------------------------------------------------------------------------

@router.get("/hw/projects", response_model=list[schemas.HwProjectRollupOut])
def list_hw_projects(db: Session = Depends(get_db)):
    today = date.today()
    projects = (
        db.query(models.HwProject)
        .order_by(models.HwProject.name, models.HwProject.id)
        .all()
    )
    return [project_rollup(project, today) for project in projects]


@router.post("/hw/projects", response_model=schemas.HwProjectOut, status_code=201)
def create_hw_project(data: schemas.HwProjectInput, db: Session = Depends(get_db)):
    project = models.HwProject(**data.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/hw/projects/{project_id}", response_model=schemas.HwProjectOut)
def get_hw_project(project_id: int, db: Session = Depends(get_db)):
    return get_hw_project_or_404(project_id, db)


@router.put("/hw/projects/{project_id}", response_model=schemas.HwProjectOut)
def update_hw_project(project_id: int, data: schemas.HwProjectInput,
                      db: Session = Depends(get_db)):
    project = get_hw_project_or_404(project_id, db)
    for field, value in data.model_dump().items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return project


@router.delete("/hw/projects/{project_id}", status_code=204)
def delete_hw_project(project_id: int, db: Session = Depends(get_db)):
    project = get_hw_project_or_404(project_id, db)
    db.delete(project)
    db.commit()


@router.get("/hw/projects/{project_id}/summary", response_model=schemas.HwSummaryOut)
def get_hw_project_summary(project_id: int, db: Session = Depends(get_db)):
    project = get_hw_project_or_404(project_id, db)
    return project_summary(project, date.today())


# ---------------------------------------------------------------------------
# Assets register
# ---------------------------------------------------------------------------

@router.get("/hw/projects/{project_id}/assets", response_model=list[schemas.HwAssetOut])
def list_hw_assets(project_id: int, db: Session = Depends(get_db)):
    project = get_hw_project_or_404(project_id, db)
    years = project_years(project)
    return [serialize_asset(asset, years) for asset in project.assets]


@router.post("/hw/projects/{project_id}/assets",
             response_model=schemas.HwAssetOut, status_code=201)
def create_hw_asset(project_id: int, data: schemas.HwAssetInput,
                    db: Session = Depends(get_db)):
    project = get_hw_project_or_404(project_id, db)
    check_catalog_items([data.catalog_item_id], db)
    asset = models.HwAsset(hw_project_id=project.id, **data.model_dump())
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return serialize_asset(asset, project_years(project))


@router.put("/hw/projects/{project_id}/assets", response_model=list[schemas.HwAssetOut])
def replace_hw_assets(project_id: int, data: schemas.HwAssetBulk,
                      db: Session = Depends(get_db)):
    """Save the whole assets grid: the posted list becomes the project's register."""
    project = get_hw_project_or_404(project_id, db)
    check_catalog_items([item.catalog_item_id for item in data.items], db)
    project.assets = [models.HwAsset(**item.model_dump()) for item in data.items]
    db.commit()
    years = project_years(project)
    return [serialize_asset(asset, years) for asset in project.assets]


@router.put("/hw/assets/{asset_id}", response_model=schemas.HwAssetOut)
def update_hw_asset(asset_id: int, data: schemas.HwAssetInput,
                    db: Session = Depends(get_db)):
    asset = get_hw_asset_or_404(asset_id, db)
    check_catalog_items([data.catalog_item_id], db)
    for field, value in data.model_dump().items():
        setattr(asset, field, value)
    db.commit()
    db.refresh(asset)
    return serialize_asset(asset, project_years(asset.hw_project))


@router.delete("/hw/assets/{asset_id}", status_code=204)
def delete_hw_asset(asset_id: int, db: Session = Depends(get_db)):
    asset = get_hw_asset_or_404(asset_id, db)
    db.delete(asset)
    db.commit()


# ---------------------------------------------------------------------------
# Licenses register
# ---------------------------------------------------------------------------

@router.get("/hw/projects/{project_id}/licenses",
            response_model=list[schemas.HwLicenseOut])
def list_hw_licenses(project_id: int, db: Session = Depends(get_db)):
    project = get_hw_project_or_404(project_id, db)
    years = project_years(project)
    return [serialize_license(record, years) for record in project.licenses]


@router.post("/hw/projects/{project_id}/licenses",
             response_model=schemas.HwLicenseOut, status_code=201)
def create_hw_license(project_id: int, data: schemas.HwLicenseInput,
                      db: Session = Depends(get_db)):
    project = get_hw_project_or_404(project_id, db)
    check_catalog_items([data.catalog_item_id], db)
    record = models.HwLicense(hw_project_id=project.id, **data.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    return serialize_license(record, project_years(project))


@router.put("/hw/projects/{project_id}/licenses",
            response_model=list[schemas.HwLicenseOut])
def replace_hw_licenses(project_id: int, data: schemas.HwLicenseBulk,
                        db: Session = Depends(get_db)):
    """Save the whole licenses grid: the posted list becomes the project's register."""
    project = get_hw_project_or_404(project_id, db)
    check_catalog_items([item.catalog_item_id for item in data.items], db)
    project.licenses = [models.HwLicense(**item.model_dump()) for item in data.items]
    db.commit()
    years = project_years(project)
    return [serialize_license(record, years) for record in project.licenses]


@router.put("/hw/licenses/{license_id}", response_model=schemas.HwLicenseOut)
def update_hw_license(license_id: int, data: schemas.HwLicenseInput,
                      db: Session = Depends(get_db)):
    record = get_hw_license_or_404(license_id, db)
    check_catalog_items([data.catalog_item_id], db)
    for field, value in data.model_dump().items():
        setattr(record, field, value)
    db.commit()
    db.refresh(record)
    return serialize_license(record, project_years(record.hw_project))


@router.delete("/hw/licenses/{license_id}", status_code=204)
def delete_hw_license(license_id: int, db: Session = Depends(get_db)):
    record = get_hw_license_or_404(license_id, db)
    db.delete(record)
    db.commit()


# ---------------------------------------------------------------------------
# Special Cases Budget
# ---------------------------------------------------------------------------

@router.get("/hw/projects/{project_id}/adjustments",
            response_model=list[schemas.HwAdjustment])
def list_hw_adjustments(project_id: int, db: Session = Depends(get_db)):
    project = get_hw_project_or_404(project_id, db)
    return sorted(project.adjustments, key=lambda a: (a.year, a.kind))


@router.put("/hw/projects/{project_id}/adjustments",
            response_model=list[schemas.HwAdjustment])
def replace_hw_adjustments(project_id: int, data: schemas.HwAdjustmentBulk,
                           db: Session = Depends(get_db)):
    project = get_hw_project_or_404(project_id, db)
    project.adjustments = []
    # A flush orders the deletes before the inserts; without it a replacement
    # reusing a (year, kind) pair would collide with the row it is replacing.
    db.flush()
    project.adjustments = [
        models.HwBudgetAdjustment(**item.model_dump()) for item in data.items
    ]
    db.commit()
    return sorted(project.adjustments, key=lambda a: (a.year, a.kind))


# ---------------------------------------------------------------------------
# Workbook import / export
# ---------------------------------------------------------------------------

@router.post("/hw/projects/{project_id}/import")
def import_hw_workbook(project_id: int, file: UploadFile = File(...),
                       dry_run: bool = True, db: Session = Depends(get_db)):
    """Read the working document's Assets and Licenses sheets into the registers.

    `dry_run` previews the parse; only `dry_run=false` appends the rows.
    """
    project = get_hw_project_or_404(project_id, db)
    try:
        parsed = hw_excel.parse_workbook(file.file.read())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    preview = schemas.HwImportPreview(
        assets=parsed["assets"],
        licenses=parsed["licenses"],
        warnings=parsed["warnings"],
        sheets_found=parsed["sheets_found"],
    )
    if dry_run:
        return preview

    for item in preview.assets:
        db.add(models.HwAsset(hw_project_id=project.id, **item.model_dump()))
    for item in preview.licenses:
        db.add(models.HwLicense(hw_project_id=project.id, **item.model_dump()))
    db.commit()
    return schemas.HwImportResult(
        created_assets=len(preview.assets),
        created_licenses=len(preview.licenses),
        warnings=preview.warnings,
    )


@router.get("/hw/projects/{project_id}/export.xlsx")
def export_hw_project_xlsx(project_id: int, db: Session = Depends(get_db)):
    project = get_hw_project_or_404(project_id, db)
    today = date.today()
    catalog_items = (
        db.query(models.HardwareCatalogItem)
        .order_by(models.HardwareCatalogItem.name, models.HardwareCatalogItem.id)
        .all()
    )
    content = hw_excel.build_project_workbook(
        project, project.assets, project.licenses,
        project_summary(project, today), catalog_items, today,
    )
    filename = f"{project.name} - Hardware Management"
    return Response(
        content=content,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}.xlsx"'},
    )


@router.get("/hw/import-template.xlsx")
def hw_import_template_xlsx():
    return Response(
        content=hw_excel.build_import_template(),
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition":
                'attachment; filename="Hardware Import Template.xlsx"'
        },
    )
