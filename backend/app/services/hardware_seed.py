"""Standard hardware/tool catalog shipped with the application.

The seed list mirrors the procurement sheet used for quotations (supplier,
asset, price, rent vs. perpetual). Rented/subscription items are stored as
`yearly` billing, one-time purchases and perpetual licenses as `once`.
Seeding is idempotent: only names that are missing are inserted, so edits
and additions made in the UI are never overwritten.
"""

import json
from pathlib import Path

SEED_FILE = Path(__file__).resolve().parents[1] / "data" / "hardware_catalog_seed.json"

DEFAULTS = {
    "aspice": "SWE.3",
    "billing": "yearly",
    "unit_cost": 0.0,
    "supplier_name": "",
    "supplier_email": "",
}


def load_seed_items() -> list[dict]:
    """Read the seed catalog, filling in defaults for omitted fields."""
    raw = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    return [{**DEFAULTS, **item} for item in raw]


def seed_hardware_catalog(db) -> int:
    """Insert missing seed items into the catalog. Returns the number added."""
    from .. import models

    existing = {
        name for (name,) in db.query(models.HardwareCatalogItem.name).all()
    }
    added = 0
    for item in load_seed_items():
        if item["name"] in existing:
            continue
        db.add(models.HardwareCatalogItem(**item))
        added += 1
    if added:
        db.commit()
    return added
