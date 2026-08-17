"""Report endpoints: resource plan (effort only) as JSON and Excel.

Budget reports contain monetary values, which are end-to-end encrypted;
they are computed and exported entirely in the browser.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..services import calculations, excel_export
from .projects import get_project_or_404

router = APIRouter(prefix="/api/projects/{project_id}/reports", tags=["reports"])

XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


def _get_months_or_400(project):
    months = calculations.get_project_months(project)
    if not months:
        raise HTTPException(status_code=400, detail="No months in the selected period.")
    return months


@router.get("/resource-plan", response_model=schemas.ResourcePlanOut)
def resource_plan(project_id: int, db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    months = _get_months_or_400(project)
    pivots = calculations.generate_resource_pivots(project, months)
    return {"yearly_pivots": pivots}


@router.get("/resource-plan.xlsx")
def resource_plan_xlsx(project_id: int, db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    months = _get_months_or_400(project)
    pivots = calculations.generate_resource_pivots(project, months)
    if not pivots:
        raise HTTPException(status_code=400, detail="No resource data to export.")
    content = excel_export.build_resource_plan_xlsx(pivots)
    filename = f"{project.name} - Resource Plan.xlsx"
    return Response(
        content=content,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
