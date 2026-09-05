"""Hardware/tool planning endpoints.

Hardware planning is deliberately plaintext (not vault-encrypted): it is a
shared procurement plan (catalog + per-project rows) kept separate from the
cost-profit analysis. Catalog values are snapshotted into project rows.
"""

import io
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.calculations import hardware_item_years
from ..services.http import attachment_disposition
from .projects import get_project_or_404

router = APIRouter(prefix="/api", tags=["hardware"])

XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def item_years(item: models.HardwareItem) -> list[int]:
    return hardware_item_years(item)


def item_total(item: models.HardwareItem) -> float:
    """Yearly items cost unit_cost x qty for every selected year; a one-time
    purchase costs unit_cost x qty once (in its selected purchase year)."""
    years = item_years(item)
    occurrences = 1 if item.billing == "once" else len(years)
    return round(item.unit_cost * item.qty * occurrences, 2)


def supplier_email(item: models.HardwareItem) -> str:
    """Supplier contact lives with the vendor in the catalog; fall back to the
    stored snapshot when the catalog entry no longer exists."""
    if item.catalog_item is not None:
        return item.catalog_item.supplier_email
    return item.supplier_email


def serialize_item(item: models.HardwareItem) -> dict:
    return {
        "id": item.id,
        "project_id": item.project_id,
        # Report the link only while the catalog entry still exists: SQLite
        # does not apply the FK's ON DELETE SET NULL unless pragmas are on,
        # so a deleted vendor entry could otherwise leave a dangling id.
        "catalog_item_id": item.catalog_item_id if item.catalog_item else None,
        "name": item.name,
        "aspice": item.aspice,
        "billing": item.billing,
        "unit_cost": item.unit_cost,
        "qty": item.qty,
        "years": item_years(item),
        "supplier_name": item.supplier_name,
        "supplier_email": supplier_email(item),
        "total": item_total(item),
    }


def _year_costs(item: models.HardwareItem, project: models.Project) -> dict[int, float]:
    """Cost the item contributes to each project year."""
    years = item_years(item)
    per_unit = round(item.unit_cost * item.qty, 2)
    if item.billing == "once":
        # A one-time purchase lands in its selected year (or the project
        # start year when no year was picked).
        year = years[0] if years else project.start_year
        return {year: per_unit}
    return {year: per_unit for year in years}


def build_plan(project: models.Project) -> dict:
    items = [serialize_item(i) for i in project.hardware_items]
    per_year: dict[int, float] = {}
    warnings: list[str] = []
    for item in project.hardware_items:
        for year, cost in _year_costs(item, project).items():
            if project.start_year <= year <= project.end_year:
                per_year[year] = round(per_year.get(year, 0.0) + cost, 2)
            else:
                # Only possible for rows written before timeline changes were
                # validated; the year columns cannot place them, so say so.
                warnings.append(
                    f"{item.name} is planned for {year}, outside the project years "
                    f"{project.start_year}-{project.end_year}, and is not shown in a "
                    "year column"
                )
    grand_total = round(sum(i["total"] for i in items), 2)
    return {
        "items": items,
        "per_year": dict(sorted(per_year.items())),
        "grand_total": grand_total,
        "warnings": warnings,
    }


def _validate_years_in_timeline(project: models.Project, years: list[int]):
    for year in years:
        if not project.start_year <= year <= project.end_year:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Year {year} is outside the project timeline "
                    f"({project.start_year}-{project.end_year})"
                ),
            )


# ---------------------------------------------------------------------------
# Master catalog
# ---------------------------------------------------------------------------

@router.get("/hardware-catalog",
            response_model=list[schemas.HardwareCatalogItemOut])
def list_catalog(db: Session = Depends(get_db)):
    return (
        db.query(models.HardwareCatalogItem)
        .order_by(models.HardwareCatalogItem.name, models.HardwareCatalogItem.id)
        .all()
    )


@router.post("/hardware-catalog", status_code=201,
             response_model=schemas.HardwareCatalogItemOut)
def create_catalog_item(data: schemas.HardwareCatalogItemCreate,
                        db: Session = Depends(get_db)):
    record = models.HardwareCatalogItem(**data.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _get_catalog_or_404(item_id: int, db: Session) -> models.HardwareCatalogItem:
    record = db.get(models.HardwareCatalogItem, item_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Catalog item not found")
    return record


@router.put("/hardware-catalog/{item_id}",
            response_model=schemas.HardwareCatalogItemOut)
def update_catalog_item(item_id: int, data: schemas.HardwareCatalogItemUpdate,
                        db: Session = Depends(get_db)):
    record = _get_catalog_or_404(item_id, db)
    for key, value in data.model_dump().items():
        setattr(record, key, value)
    db.commit()
    db.refresh(record)
    return record


@router.delete("/hardware-catalog/{item_id}", status_code=204)
def delete_catalog_item(item_id: int, db: Session = Depends(get_db)):
    record = _get_catalog_or_404(item_id, db)
    db.delete(record)
    db.commit()


# ---------------------------------------------------------------------------
# Per-project hardware plan
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/hardware",
            response_model=schemas.HardwarePlanOut)
def get_hardware_plan(project_id: int, db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    return build_plan(project)


@router.post("/projects/{project_id}/hardware", status_code=201,
             response_model=schemas.HardwareItemOut)
def create_hardware_item(project_id: int, data: schemas.HardwareItemCreate,
                         db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    _validate_years_in_timeline(project, data.years)
    if data.catalog_item_id is not None:
        _get_catalog_or_404(data.catalog_item_id, db)
    payload = data.model_dump(exclude={"years"})
    record = models.HardwareItem(
        project_id=project.id,
        years_json=json.dumps(data.years),
        **payload,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return serialize_item(record)


def _get_item_or_404(item_id: int, db: Session) -> models.HardwareItem:
    record = db.get(models.HardwareItem, item_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Hardware item not found")
    return record


@router.put("/hardware-items/{item_id}",
            response_model=schemas.HardwareItemOut)
def update_hardware_item(item_id: int, data: schemas.HardwareItemUpdate,
                         db: Session = Depends(get_db)):
    record = _get_item_or_404(item_id, db)
    project = get_project_or_404(record.project_id, db)
    _validate_years_in_timeline(project, data.years)
    if data.catalog_item_id is not None:
        _get_catalog_or_404(data.catalog_item_id, db)
    for key, value in data.model_dump(exclude={"years"}).items():
        setattr(record, key, value)
    record.years_json = json.dumps(data.years)
    db.commit()
    db.refresh(record)
    return serialize_item(record)


@router.delete("/hardware-items/{item_id}", status_code=204)
def delete_hardware_item(item_id: int, db: Session = Depends(get_db)):
    record = _get_item_or_404(item_id, db)
    db.delete(record)
    db.commit()


# ---------------------------------------------------------------------------
# Excel export (mirrors the manual planning sheet)
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/reports/hardware-plan.xlsx")
def hardware_plan_xlsx(project_id: int, db: Session = Depends(get_db)):
    import xlsxwriter

    project = get_project_or_404(project_id, db)
    if not project.hardware_items:
        raise HTTPException(status_code=400, detail="No hardware items to export.")

    plan = build_plan(project)
    years = list(range(project.start_year, project.end_year + 1))

    buffer = io.BytesIO()
    # Item and supplier names are user text: "=..." must stay text, not a formula.
    workbook = xlsxwriter.Workbook(buffer, {"in_memory": True, "strings_to_formulas": False})
    sheet = workbook.add_worksheet("Hardware Plan")

    header_fmt = workbook.add_format({
        "bold": True, "bg_color": "#FFFF00", "border": 1,
        "align": "center", "valign": "vcenter",
    })
    text_fmt = workbook.add_format({"border": 1})
    money_fmt = workbook.add_format({"border": 1, "num_format": "#,##0.00"})
    int_fmt = workbook.add_format({"border": 1, "align": "center"})
    total_fmt = workbook.add_format({
        "bold": True, "bg_color": "#D3D3D3", "border": 1,
        "num_format": "#,##0.00",
    })

    columns = (
        ["ASPICE", "Item", "Yearly/Once", "Unit Cost", "Qty"]
        + [str(y) for y in years]
        + ["Total", "Supplier", "Supplier Email"]
    )
    for col, header in enumerate(columns):
        sheet.write(0, col, header, header_fmt)

    year_offset = 5
    total_col = year_offset + len(years)
    for row_idx, (item, record) in enumerate(
        zip(plan["items"], project.hardware_items, strict=True), start=1
    ):
        sheet.write(row_idx, 0, item["aspice"], text_fmt)
        sheet.write(row_idx, 1, item["name"], text_fmt)
        sheet.write(row_idx, 2, item["billing"], text_fmt)
        sheet.write(row_idx, 3, item["unit_cost"], money_fmt)
        sheet.write(row_idx, 4, item["qty"], int_fmt)
        year_costs = _year_costs(record, project)
        for offset, year in enumerate(years):
            value = year_costs.get(year)
            if value is None:
                sheet.write(row_idx, year_offset + offset, "", text_fmt)
            else:
                sheet.write(row_idx, year_offset + offset, value, money_fmt)
        sheet.write(row_idx, total_col, item["total"], money_fmt)
        sheet.write(row_idx, total_col + 1, item["supplier_name"], text_fmt)
        sheet.write(row_idx, total_col + 2, item["supplier_email"], text_fmt)

    footer_row = len(plan["items"]) + 1
    sheet.write(footer_row, 0, "TOTAL", total_fmt)
    for col in range(1, year_offset):
        sheet.write(footer_row, col, "", total_fmt)
    for offset, year in enumerate(years):
        sheet.write(footer_row, year_offset + offset,
                    plan["per_year"].get(year, 0.0), total_fmt)
    sheet.write(footer_row, total_col, plan["grand_total"], total_fmt)
    sheet.write(footer_row, total_col + 1, "", total_fmt)
    sheet.write(footer_row, total_col + 2, "", total_fmt)

    widths = [10, 32, 12, 12, 6] + [12] * len(years) + [14, 24, 30]
    for idx, width in enumerate(widths):
        sheet.set_column(idx, idx, width)

    workbook.close()
    return Response(
        content=buffer.getvalue(),
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": attachment_disposition(
                f"{project.name} - Hardware Plan.xlsx"
            )
        },
    )
