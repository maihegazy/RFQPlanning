"""Optimistic-concurrency versions and the vault's single-row guarantee.

`projects.version` and `hw_projects.version` move on every write to the
project or anything inside it; the write endpoints compare them with the
version the client last saw and answer 409 instead of overwriting someone
else's save.

`vault.dek_verifier` is the proof a caller holds the data key (a digest of the
unwrapped key that the browser computes after unlocking); the passphrase copy
of the key can no longer be replaced without it. `vault.singleton` carries a
unique constraint so a second vault row cannot be created by a race. A database
that already holds several vault rows keeps the lowest id, which is the row the
app has always loaded; the others were never loadable.

Revision ID: 20260905_0007
Revises: 20260904_0006
"""

import sqlalchemy as sa
from alembic import op

revision = "20260905_0007"
down_revision = "20260904_0006"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    # The columns already exist when the schema was created via
    # Base.metadata.create_all (dev/test convenience) before this revision ran.
    for table in ("projects", "hw_projects"):
        if "version" not in _columns(table):
            op.add_column(
                table,
                sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            )

    vault_columns = _columns("vault")
    if "dek_verifier" not in vault_columns:
        op.add_column("vault", sa.Column("dek_verifier", sa.String(length=64), nullable=True))
    if "singleton" not in vault_columns:
        op.execute("DELETE FROM vault WHERE id <> (SELECT MIN(id) FROM vault)")
        with op.batch_alter_table("vault") as batch:
            batch.add_column(
                sa.Column("singleton", sa.Integer(), nullable=False, server_default="1")
            )
            batch.create_unique_constraint("uq_vault_singleton", ["singleton"])
            batch.create_check_constraint("ck_vault_singleton", "singleton = 1")


def downgrade() -> None:
    with op.batch_alter_table("vault") as batch:
        batch.drop_constraint("ck_vault_singleton", type_="check")
        batch.drop_constraint("uq_vault_singleton", type_="unique")
        batch.drop_column("singleton")
        batch.drop_column("dek_verifier")
    for table in ("hw_projects", "projects"):
        with op.batch_alter_table(table) as batch:
            batch.drop_column("version")
