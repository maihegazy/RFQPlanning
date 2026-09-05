"""Optimistic concurrency for the two kinds of project.

Every write to a project, or to anything inside it, moves its `version` (see
`models.touch_owner_timestamps`). A client that wants to be sure it is not
overwriting someone else's work sends the version it last saw; a mismatch is
answered with 409 and nothing is written.
"""

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from .. import models


def require_version(db: Session, record: models.Project | models.HwProject,
                    expected: int | None) -> None:
    """Claim the write: raise 409 when `expected` no longer matches the stored version.

    The check is a conditional UPDATE rather than a comparison in Python, so two
    requests built from the same version cannot both pass it: the second one
    waits on the row lock, sees the first one's new version and is refused.
    Rows touched afterwards in the same transaction move the version again;
    it only ever has to grow.
    """
    if expected is None:
        return
    model = type(record)
    claimed = db.execute(
        update(model)
        .where(model.id == record.id, model.version == expected)
        .values(version=expected + 1)
    )
    if claimed.rowcount != 1:
        db.rollback()
        db.refresh(record)
        label = "hardware project" if isinstance(record, models.HwProject) else "project"
        raise HTTPException(
            status_code=409,
            detail=(
                f"This {label} was changed by someone else since you loaded it "
                f"(you had version {expected}, it is now version {record.version}). "
                "Reload to see their changes, then apply yours again."
            ),
        )
    record.version = expected + 1
