"""Add the hardware management tables (projects, assets, licenses, adjustments).

Replaces the HW purchasing working document: two registers plus the Summary
sheet's per-year "Special Cases Budget" corrections.

Revision ID: 20260904_0005
Revises: 20260819_0004
"""

import sqlalchemy as sa
from alembic import op

revision = "20260904_0005"
down_revision = "20260819_0004"
branch_labels = None
depends_on = None

TABLES = ("hw_projects", "hw_assets", "hw_licenses", "hw_budget_adjustments")


def upgrade() -> None:
    # Tables may already exist when the schema was created via
    # Base.metadata.create_all (dev/test convenience) before this
    # revision ran; skip creation in that case.
    inspector = sa.inspect(op.get_bind())
    existing = set(inspector.get_table_names())

    if set(TABLES) <= existing:
        return

    op.create_table(
        "hw_projects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("company", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("budget_assets", sa.Float(), nullable=False, server_default="0"),
        sa.Column("budget_licenses", sa.Float(), nullable=False, server_default="0"),
        sa.Column("start_year", sa.Integer(), nullable=True),
        sa.Column("end_year", sa.Integer(), nullable=True),
        sa.Column("portal_reference", sa.String(length=255), nullable=False,
                  server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False,
                  server_default=sa.func.now()),
    )

    op.create_table(
        "hw_assets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("hw_project_id", sa.Integer(),
                  sa.ForeignKey("hw_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_tag", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("company", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("serial", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("model", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("category", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("supplier", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("purchase_date", sa.Date(), nullable=True),
        sa.Column("purchase_cost", sa.Float(), nullable=False, server_default="0"),
        sa.Column("order_number", sa.String(length=255), nullable=False,
                  server_default=""),
        sa.Column("eol_date", sa.Date(), nullable=True),
        sa.Column("assigned_employee", sa.String(length=255), nullable=False,
                  server_default=""),
        sa.Column("sw_license", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("purchased_by", sa.String(length=255), nullable=False,
                  server_default=""),
        sa.Column("purchase_type", sa.String(length=32), nullable=False,
                  server_default="Not Purchased"),
        sa.Column("catalog_item_id", sa.Integer(),
                  sa.ForeignKey("hardware_catalog_items.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index("ix_hw_assets_hw_project_id", "hw_assets", ["hw_project_id"])

    op.create_table(
        "hw_licenses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("hw_project_id", sa.Integer(),
                  sa.ForeignKey("hw_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("license_tag", sa.String(length=255), nullable=False,
                  server_default=""),
        sa.Column("company", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("product_key", sa.String(length=255), nullable=False,
                  server_default=""),
        sa.Column("expiration_date", sa.Date(), nullable=True),
        sa.Column("licensed_to_email", sa.String(length=255), nullable=False,
                  server_default=""),
        sa.Column("category", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("supplier", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("manufacturer", sa.String(length=255), nullable=False,
                  server_default=""),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("purchase_date", sa.Date(), nullable=True),
        sa.Column("termination_date", sa.Date(), nullable=True),
        sa.Column("depreciation", sa.String(length=32), nullable=False,
                  server_default="Not Purchased"),
        sa.Column("maintained", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("purchase_cost", sa.Float(), nullable=False, server_default="0"),
        sa.Column("purchase_order_number", sa.String(length=255), nullable=False,
                  server_default=""),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("catalog_item_id", sa.Integer(),
                  sa.ForeignKey("hardware_catalog_items.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index("ix_hw_licenses_hw_project_id", "hw_licenses", ["hw_project_id"])

    op.create_table(
        "hw_budget_adjustments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("hw_project_id", sa.Integer(),
                  sa.ForeignKey("hw_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("note", sa.String(length=1000), nullable=False, server_default=""),
        sa.UniqueConstraint("hw_project_id", "year", "kind"),
    )
    op.create_index(
        "ix_hw_budget_adjustments_hw_project_id",
        "hw_budget_adjustments",
        ["hw_project_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_hw_budget_adjustments_hw_project_id", table_name="hw_budget_adjustments"
    )
    op.drop_table("hw_budget_adjustments")
    op.drop_index("ix_hw_licenses_hw_project_id", table_name="hw_licenses")
    op.drop_table("hw_licenses")
    op.drop_index("ix_hw_assets_hw_project_id", table_name="hw_assets")
    op.drop_table("hw_assets")
    op.drop_table("hw_projects")
