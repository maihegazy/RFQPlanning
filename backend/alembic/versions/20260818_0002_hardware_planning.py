"""Add hardware planning tables (catalog + per-project items).

Revision ID: 20260818_0002
Revises: 20260817_0001
"""

import sqlalchemy as sa
from alembic import op

revision = "20260818_0002"
down_revision = "20260817_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Tables may already exist when the schema was created via
    # Base.metadata.create_all (dev/test convenience) before this
    # revision ran; skip creation in that case.
    inspector = sa.inspect(op.get_bind())
    existing = set(inspector.get_table_names())

    if "hardware_catalog_items" in existing and "hardware_items" in existing:
        return

    op.create_table(
        "hardware_catalog_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("aspice", sa.String(length=16), nullable=False, server_default="SWE.3"),
        sa.Column("billing", sa.String(length=16), nullable=False, server_default="yearly"),
        sa.Column("unit_cost", sa.Float(), nullable=False, server_default="0"),
        sa.Column("supplier_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("supplier_email", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_table(
        "hardware_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("catalog_item_id", sa.Integer(),
                  sa.ForeignKey("hardware_catalog_items.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("aspice", sa.String(length=16), nullable=False, server_default="SWE.3"),
        sa.Column("billing", sa.String(length=16), nullable=False, server_default="yearly"),
        sa.Column("unit_cost", sa.Float(), nullable=False, server_default="0"),
        sa.Column("qty", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("years_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("supplier_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("supplier_email", sa.String(length=255), nullable=False, server_default=""),
    )
    op.create_index("ix_hardware_items_project_id", "hardware_items", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_hardware_items_project_id", table_name="hardware_items")
    op.drop_table("hardware_items")
    op.drop_table("hardware_catalog_items")
