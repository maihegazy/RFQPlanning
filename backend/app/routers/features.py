"""Feature and role CRUD endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from .projects import get_project_or_404

router = APIRouter(prefix="/api", tags=["features"])


def get_feature_or_404(feature_id: int, db: Session) -> models.Feature:
    feature = db.get(models.Feature, feature_id)
    if feature is None:
        raise HTTPException(status_code=404, detail="Feature not found")
    return feature


def get_role_or_404(role_id: int, db: Session) -> models.Role:
    role = db.get(models.Role, role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    return role


@router.get("/projects/{project_id}/features", response_model=list[schemas.FeatureOut])
def list_features(project_id: int, db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    return project.features


@router.post("/projects/{project_id}/features",
             response_model=schemas.FeatureOut, status_code=201)
def create_feature(project_id: int, data: schemas.FeatureCreate,
                   db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    feature = models.Feature(project_id=project.id, name=data.name)
    db.add(feature)
    db.commit()
    db.refresh(feature)
    return feature


@router.put("/features/{feature_id}", response_model=schemas.FeatureOut)
def update_feature(feature_id: int, data: schemas.FeatureUpdate,
                   db: Session = Depends(get_db)):
    feature = get_feature_or_404(feature_id, db)
    feature.name = data.name
    db.commit()
    db.refresh(feature)
    return feature


@router.delete("/features/{feature_id}", status_code=204)
def delete_feature(feature_id: int, db: Session = Depends(get_db)):
    feature = get_feature_or_404(feature_id, db)
    db.delete(feature)
    db.commit()


@router.post("/features/{feature_id}/roles",
             response_model=schemas.RoleOut, status_code=201)
def create_role(feature_id: int, data: schemas.RoleCreate,
                db: Session = Depends(get_db)):
    feature = get_feature_or_404(feature_id, db)
    role = models.Role(
        feature_id=feature.id,
        name=data.name,
        location=data.location,
        level=data.level,
        ftes=data.ftes,
        use_advanced_allocation=data.use_advanced_allocation,
    )
    db.add(role)
    db.flush()
    for alloc in data.allocations:
        db.add(models.AllocationPeriod(role_id=role.id, **alloc.model_dump()))
    db.commit()
    db.refresh(role)
    return role


@router.put("/roles/{role_id}", response_model=schemas.RoleOut)
def update_role(role_id: int, data: schemas.RoleUpdate,
                db: Session = Depends(get_db)):
    role = get_role_or_404(role_id, db)
    role.name = data.name
    role.location = data.location
    role.level = data.level
    role.ftes = data.ftes
    role.use_advanced_allocation = data.use_advanced_allocation

    # Replace allocation periods wholesale
    for alloc in list(role.allocations):
        db.delete(alloc)
    db.flush()
    for alloc in data.allocations:
        db.add(models.AllocationPeriod(role_id=role.id, **alloc.model_dump()))

    db.commit()
    db.refresh(role)
    return role


@router.delete("/roles/{role_id}", status_code=204)
def delete_role(role_id: int, db: Session = Depends(get_db)):
    role = get_role_or_404(role_id, db)
    db.delete(role)
    db.commit()
