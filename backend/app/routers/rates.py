"""Rate-configuration endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..services.rate_config import get_rate_config, update_rate_config
from ..services.versioning import require_version
from .projects import get_project_or_404

router = APIRouter(prefix="/api/projects/{project_id}/rates", tags=["rates"])


@router.get("", response_model=schemas.RateConfigOut)
def read_rate_config(project_id: int, db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    return get_rate_config(project)


@router.put("", response_model=schemas.RateConfigOut)
def write_rate_config(project_id: int, data: schemas.RateConfigUpdate,
                      db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    require_version(db, project, data.expected_version)
    update_rate_config(db, project, data)
    db.commit()
    db.refresh(project)
    return get_rate_config(project)
