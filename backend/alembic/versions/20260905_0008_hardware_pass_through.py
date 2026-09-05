"""Let the hardware plan flow into the cost-profit analysis.

`projects.hardware_pass_through` says whether the plan's cost is also billed
to the customer (a pass-through) or carried as cost only. The plan's per-year
totals themselves are computed, not stored.

Revision ID: 20260905_0008
Revises: 20260905_0007
"""

import sqlalchemy as sa
from alembic import op

revision = "20260905_0008"
down_revision = "20260905_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {column["name"] for column in inspector.get_columns("projects")}
    if "hardware_pass_through" not in existing:
        op.add_column(
            "projects",
            sa.Column("hardware_pass_through", sa.Boolean(), nullable=False,
                      server_default=sa.false()),
        )


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("hardware_pass_through")
