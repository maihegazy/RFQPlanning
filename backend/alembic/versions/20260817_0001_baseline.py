"""Create the baseline schema and upgrade pre-Alembic project tables.

Revision ID: 20260817_0001
Revises: None
"""

import sqlalchemy as sa
from alembic import op

revision = "20260817_0001"
down_revision = None
branch_labels = None
depends_on = None


PROJECT_COLUMNS = (
    ("encrypted_money", sa.Column("encrypted_money", sa.Text(), nullable=True)),
    ("money_iv", sa.Column("money_iv", sa.String(length=64), nullable=True)),
    (
        "status",
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="draft",
        ),
    ),
    (
        "win_probability_pct",
        sa.Column(
            "win_probability_pct",
            sa.Float(),
            nullable=False,
            server_default="50",
        ),
    ),
    ("lost_reason", sa.Column("lost_reason", sa.String(length=1000), nullable=True)),
    ("base_project_id", sa.Column("base_project_id", sa.Integer(), nullable=True)),
    (
        "is_winning_scenario",
        sa.Column(
            "is_winning_scenario",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    ),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "projects" not in inspector.get_table_names():
        from app import models  # noqa: F401
        from app.database import Base

        Base.metadata.create_all(bind=bind)
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("projects")
    }
    for name, column in PROJECT_COLUMNS:
        if name not in existing_columns:
            op.add_column("projects", column)

    inspector = sa.inspect(bind)
    foreign_keys = inspector.get_foreign_keys("projects")
    has_base_foreign_key = any(
        key.get("referred_table") == "projects"
        and key.get("constrained_columns") == ["base_project_id"]
        for key in foreign_keys
    )
    if not has_base_foreign_key:
        if bind.dialect.name == "sqlite":
            with op.batch_alter_table("projects") as batch_op:
                batch_op.create_foreign_key(
                    "fk_projects_base_project_id_projects",
                    "projects",
                    ["base_project_id"],
                    ["id"],
                    ondelete="CASCADE",
                )
        else:
            op.create_foreign_key(
                "fk_projects_base_project_id_projects",
                "projects",
                "projects",
                ["base_project_id"],
                ["id"],
                ondelete="CASCADE",
            )

    inspector = sa.inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes("projects")}
    if "ix_projects_base_project_id" not in indexes:
        op.create_index(
            "ix_projects_base_project_id",
            "projects",
            ["base_project_id"],
        )

    # create_all is deliberate in this compatibility baseline: it creates
    # tables introduced after the original release while preserving all rows.
    from app import models  # noqa: F401
    from app.database import Base

    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    # This adoption revision may represent a pre-existing production schema.
    # Destructive automatic downgrade is therefore intentionally unsupported.
    pass
