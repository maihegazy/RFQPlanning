"""Re-seed the standard hardware/tool catalog.

The seed also runs automatically as an Alembic migration; use this script to
restore standard entries that were deleted, or after adding new items to
app/data/hardware_catalog_seed.json.

    cd backend && python3 scripts/seed_hardware_catalog.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal  # noqa: E402
from app.services.hardware_seed import seed_hardware_catalog  # noqa: E402

if __name__ == "__main__":
    with SessionLocal() as db:
        added = seed_hardware_catalog(db)
    print(f"Hardware catalog seeded: {added} item(s) added.")
