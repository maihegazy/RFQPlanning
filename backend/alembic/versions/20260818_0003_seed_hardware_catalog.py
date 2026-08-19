"""Seed the hardware catalog with the standard procurement list.

Revision ID: 20260818_0003
Revises: 20260818_0002
"""

import json
from datetime import datetime
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "20260818_0003"
down_revision = "20260818_0002"
branch_labels = None
depends_on = None

SEED_FILE = (
    Path(__file__).resolve().parents[2] / "app" / "data" / "hardware_catalog_seed.json"
)

DEFAULTS = {
    "aspice": "SWE.3",
    "billing": "yearly",
    "unit_cost": 0.0,
    "supplier_name": "",
    "supplier_email": "",
}


def _seed_items() -> list[dict]:
    raw = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    return [{**DEFAULTS, **item} for item in raw]


def upgrade() -> None:
    bind = op.get_bind()
    catalog = sa.table(
        "hardware_catalog_items",
        sa.column("name", sa.String),
        sa.column("aspice", sa.String),
        sa.column("billing", sa.String),
        sa.column("unit_cost", sa.Float),
        sa.column("supplier_name", sa.String),
        sa.column("supplier_email", sa.String),
        sa.column("created_at", sa.DateTime),
    )
    existing = {
        row[0] for row in bind.execute(sa.text("SELECT name FROM hardware_catalog_items"))
    }
    missing = [item for item in _seed_items() if item["name"] not in existing]
    if missing:
        now = datetime.utcnow()
        op.bulk_insert(catalog, [{**item, "created_at": now} for item in missing])


def downgrade() -> None:
    bind = op.get_bind()
    names = [item["name"] for item in _seed_items()]
    for name in names:
        bind.execute(
            sa.text("DELETE FROM hardware_catalog_items WHERE name = :name"),
            {"name": name},
        )
