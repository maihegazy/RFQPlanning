"""Let a hardware budget be one overall number instead of a split by type.

Existing projects were all entered as a split, which is the default, so the
backfill needs no data pass.

Revision ID: 20260904_0006
Revises: 20260904_0005
"""

import sqlalchemy as sa
from alembic import op

revision = "20260904_0006"
down_revision = "20260904_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The columns may already exist when the schema was created via
    # Base.metadata.create_all (dev/test convenience) before this revision ran.
    inspector = sa.inspect(op.get_bind())
    existing = {column["name"] for column in inspector.get_columns("hw_projects")}

    if "budget_mode" not in existing:
        op.add_column(
            "hw_projects",
            sa.Column("budget_mode", sa.String(length=16), nullable=False,
                      server_default="split"),
        )
    if "budget_total" not in existing:
        op.add_column(
            "hw_projects",
            sa.Column("budget_total", sa.Float(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    op.drop_column("hw_projects", "budget_total")
    op.drop_column("hw_projects", "budget_mode")
