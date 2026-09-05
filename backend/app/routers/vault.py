"""Vault endpoints for end-to-end encrypted financial data.

The server stores only ciphertext and wrapped keys. Passphrases, recovery
keys and the data-encryption key never reach the server; all encryption
and decryption happens in the browser.
"""

import hmac

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services import rate_config
from ..services.versioning import require_version
from .projects import get_project_or_404

router = APIRouter(prefix="/api", tags=["vault"])

VAULT_FIELDS = (
    "kdf_salt",
    "kdf_iterations",
    "wrapped_dek_passphrase_iv",
    "wrapped_dek_passphrase",
    "wrapped_dek_recovery_iv",
    "wrapped_dek_recovery",
)


def _get_vault(db: Session) -> models.Vault | None:
    return db.query(models.Vault).order_by(models.Vault.id).first()


def _get_vault_or_404(db: Session) -> models.Vault:
    vault = _get_vault(db)
    if vault is None:
        raise HTTPException(status_code=404, detail="Vault not set up")
    return vault


def _vault_out(vault: models.Vault) -> dict:
    """The public record: wrapped keys and KDF parameters, never the verifier."""
    return {
        **{field: getattr(vault, field) for field in VAULT_FIELDS},
        "exists": True,
        "has_verifier": vault.dek_verifier is not None,
    }


def _require_current_key(vault: models.Vault, data: schemas.VaultCurrentKey) -> None:
    """A request built from a stale read of the vault is refused, not applied."""
    current = (vault.wrapped_dek_passphrase_iv, vault.wrapped_dek_passphrase)
    sent = (data.current_wrapped_dek_passphrase_iv, data.current_wrapped_dek_passphrase)
    if current != sent:
        raise HTTPException(
            status_code=409,
            detail=(
                "The vault changed since it was loaded (someone else may have changed "
                "the passphrase). Reload and try again."
            ),
        )


def _require_verifier(vault: models.Vault, verifier: str) -> None:
    """Only a caller that unwrapped the data key knows its verifier."""
    if vault.dek_verifier is not None and not hmac.compare_digest(vault.dek_verifier, verifier):
        raise HTTPException(
            status_code=403,
            detail=(
                "The proof of the current data key does not match this vault. Unlock it "
                "with the current passphrase or the recovery file first."
            ),
        )


@router.get("/vault")
def read_vault(db: Session = Depends(get_db)):
    vault = _get_vault(db)
    if vault is None:
        return {"exists": False}
    return _vault_out(vault)


@router.post("/vault", response_model=schemas.VaultOut, status_code=201)
def create_vault(data: schemas.VaultKeys, db: Session = Depends(get_db)):
    if _get_vault(db) is not None:
        raise HTTPException(status_code=409, detail="Vault already exists")
    vault = models.Vault(**data.model_dump())
    db.add(vault)
    try:
        db.commit()
    except IntegrityError as exc:
        # Two first-time users raced: the unique singleton lets only one row in,
        # and the loser must not go on encrypting under a key nobody will load.
        db.rollback()
        raise HTTPException(status_code=409, detail="Vault already exists") from exc
    db.refresh(vault)
    return _vault_out(vault)


@router.put("/vault/passphrase", response_model=schemas.VaultOut)
def change_passphrase(data: schemas.VaultPassphraseUpdate,
                      db: Session = Depends(get_db)):
    """Replace the passphrase copy of the data key.

    Requires the verifier (proof the caller unwrapped the key) once the vault has
    one, and the current wrapped key in every case, so neither a blind request
    nor a stale one can lock everybody out.
    """
    vault = _get_vault_or_404(db)
    _require_verifier(vault, data.dek_verifier)
    _require_current_key(vault, data)
    vault.kdf_salt = data.kdf_salt
    vault.kdf_iterations = data.kdf_iterations
    vault.wrapped_dek_passphrase_iv = data.wrapped_dek_passphrase_iv
    vault.wrapped_dek_passphrase = data.wrapped_dek_passphrase
    vault.dek_verifier = data.dek_verifier
    db.commit()
    db.refresh(vault)
    return _vault_out(vault)


@router.post("/vault/verifier", response_model=schemas.VaultOut)
def register_verifier(data: schemas.VaultVerifierRegistration,
                      db: Session = Depends(get_db)):
    """Give a vault created before verifiers existed its proof of key.

    The browser calls this after the first successful unlock of such a vault;
    from then on the passphrase can only be changed with the verifier.
    """
    vault = _get_vault_or_404(db)
    _require_current_key(vault, data)
    if vault.dek_verifier is not None:
        if hmac.compare_digest(vault.dek_verifier, data.dek_verifier):
            return _vault_out(vault)
        raise HTTPException(
            status_code=409, detail="This vault already carries a different proof of key"
        )
    vault.dek_verifier = data.dek_verifier
    db.commit()
    db.refresh(vault)
    return _vault_out(vault)


def _blob_out(project: models.Project) -> dict:
    return {
        "encrypted_money": project.encrypted_money,
        "money_iv": project.money_iv,
        "version": project.version,
    }


@router.get("/projects/{project_id}/financial-data", response_model=schemas.MoneyBlobOut)
def read_money_blob(project_id: int, db: Session = Depends(get_db)):
    return _blob_out(get_project_or_404(project_id, db))


@router.put("/projects/{project_id}/financial-data", response_model=schemas.MoneyBlobOut)
def write_money_blob(project_id: int, data: schemas.MoneyBlobUpdate,
                     db: Session = Depends(get_db)):
    project = get_project_or_404(project_id, db)
    require_version(db, project, data.expected_version)
    project.encrypted_money = data.encrypted_money
    project.money_iv = data.money_iv
    db.commit()
    db.refresh(project)
    return _blob_out(project)


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
