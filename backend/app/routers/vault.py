"""Vault endpoints for end-to-end encrypted financial data.

The server stores only ciphertext and wrapped keys. Passphrases, recovery
keys and the data-encryption key never reach the server; all encryption
and decryption happens in the browser.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services import rate_config
from .projects import get_project_or_404

router = APIRouter(prefix="/api", tags=["vault"])


def _get_vault(db: Session) -> models.Vault | None:
    return db.query(models.Vault).first()


@router.get("/vault")
def read_vault(db: Session = Depends(get_db)):
    vault = _get_vault(db)
    if vault is None:
        return {"exists": False}
    return schemas.VaultOut.model_validate(vault)


@router.post("/vault", response_model=schemas.VaultOut, status_code=201)
def create_vault(data: schemas.VaultKeys, db: Session = Depends(get_db)):
    if _get_vault(db) is not None:
        raise HTTPException(status_code=409, detail="Vault already exists")
    vault = models.Vault(**data.model_dump())
    db.add(vault)
    db.commit()
    db.refresh(vault)
    return vault


@router.put("/vault/passphrase", response_model=schemas.VaultOut)
def change_passphrase(data: schemas.VaultPassphraseUpdate,
                      db: Session = Depends(get_db)):
    vault = _get_vault(db)
    if vault is None:
        raise HTTPException(status_code=404, detail="Vault not set up")
    vault.kdf_salt = data.kdf_salt
    vault.kdf_iterations = data.kdf_iterations
    vault.wrapped_dek_passphrase_iv = data.wrapped_dek_passphrase_iv
    vault.wrapped_dek_passphrase = data.wrapped_dek_passphrase
    db.commit()
    db.refresh(vault)
    return vault


@router.get("/projects/{project_id}/financial-data", response_model=schemas.MoneyBlob)
def read_money_blob(project_id: int, db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    return {"encrypted_money": project.encrypted_money, "money_iv": project.money_iv}


@router.put("/projects/{project_id}/financial-data", response_model=schemas.MoneyBlob)
def write_money_blob(project_id: int, data: schemas.MoneyBlob,
                     db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    project.encrypted_money = data.encrypted_money
    project.money_iv = data.money_iv
    db.commit()
    return {"encrypted_money": project.encrypted_money, "money_iv": project.money_iv}


@router.get("/projects/{project_id}/financial-data/legacy",
            response_model=schemas.LegacyMoneyOut)
def read_legacy_money(project_id: int, db: Session = Depends(get_db)):
    """One-time read of pre-encryption plaintext financial values for client migration."""
    project = get_project_or_404(project_id, db)
    legacy = rate_config.get_legacy_plaintext_money(project)
    has_data = (
        any(v != 0 for v in legacy["hourly_rates"].values())
        or any(v != 0 for lv in legacy["cost_rates"].values() for v in lv.values())
        or legacy["hw_cost_per_hour"] != 0
        or any(v != 0 for v in legacy["ticket_prices"].values())
    )
    return {**legacy, "has_data": has_data}


@router.post("/projects/{project_id}/financial-data/purge-plaintext", status_code=204)
def purge_legacy_money(project_id: int, db: Session = Depends(get_db)):
    """Delete plaintext financial values after the client migrated them."""
    project = get_project_or_404(project_id, db)
    rate_config.purge_legacy_plaintext_money(db, project)
    db.commit()
