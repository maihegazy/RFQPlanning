"""Seed a database with many projects and time the aggregate endpoints.

A manual check for the N+1 work of the September 2026 review: it is not part
of the test suite because its numbers depend on the machine. Runs against the
database in DATABASE_URL through the app itself (so migrations apply first).

    cd backend
    DATABASE_URL=sqlite:///./timing.db python3 scripts/seed_and_time.py --projects 100

Every aggregate endpoint should stay within a handful of queries whatever the
project count; the wall-clock figures are for comparison between runs.
"""

import argparse
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import event  # noqa: E402

from app.database import engine  # noqa: E402
from app.main import app  # noqa: E402


def seed(client: TestClient, projects: int) -> None:
    catalog = client.post("/api/hardware-catalog", json={"name": "Timing probe", "unit_cost": 5.0})
    catalog_id = catalog.json()["id"]
    for index in range(projects):
        project = client.post("/api/projects", json={
            "name": f"Timing project {index}", "company": "Vehiclevo",
            "start_year": 2026, "start_month": 1, "end_year": 2027, "end_month": 12,
        }).json()
        for feature_name in ("Platform", "Application", "Diagnostics"):
            feature = client.post(f"/api/projects/{project['id']}/features",
                                  json={"name": feature_name}).json()
            client.post(f"/api/features/{feature['id']}/roles", json={
                "name": "Developer", "location": "BCC", "level": "Senior", "ftes": 1.0,
                "use_advanced_allocation": False, "allocations": [],
            })
            client.post(f"/api/features/{feature['id']}/roles", json={
                "name": "Architect", "location": "HCC", "level": "Principal", "ftes": 0.0,
                "use_advanced_allocation": True,
                "allocations": [
                    {"start_month": "2026-01", "end_month": "2026-12", "ftes": 0.5},
                    {"start_month": "2027-01", "end_month": "2027-12", "ftes": 1.0},
                ],
            })
        client.put(f"/api/projects/{project['id']}/hardware", json={"items": [
            {"name": f"Rig {n}", "catalog_item_id": catalog_id, "years": [2026]}
            for n in range(3)
        ]})

        hw_project = client.post("/api/hw/projects", json={
            "name": f"Timing purchasing {index}", "company": "Vehiclevo", "description": "",
            "budget_assets": 10_000.0, "budget_licenses": 5_000.0, "portal_reference": "",
        }).json()
        client.put(f"/api/hw/projects/{hw_project['id']}/assets", json={"items": [
            {"name": f"Asset {n}", "purchase_type": "Purchase", "purchase_cost": 100.0,
             "purchase_date": "2026-03-01"} for n in range(5)
        ]})
        client.put(f"/api/hw/projects/{hw_project['id']}/licenses", json={"items": [
            {"name": f"License {n}", "depreciation": "Leasing", "purchase_cost": 360.0,
             "purchase_date": "2026-01-01", "termination_date": "2028-12-31"}
            for n in range(5)
        ]})


def timed(client: TestClient, path: str, rounds: int = 5) -> tuple[float, int]:
    """Median wall-clock milliseconds and the number of SQL statements of one call."""
    queries = {"count": 0}

    def count(*_args, **_kwargs):
        queries["count"] += 1

    durations = []
    for _ in range(rounds):
        queries["count"] = 0
        event.listen(engine, "before_cursor_execute", count)
        started = time.perf_counter()
        resp = client.get(path)
        durations.append((time.perf_counter() - started) * 1000)
        event.remove(engine, "before_cursor_execute", count)
        resp.raise_for_status()
    return statistics.median(durations), queries["count"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--projects", type=int, default=100)
    parser.add_argument("--skip-seed", action="store_true",
                        help="time an already seeded database")
    args = parser.parse_args()

    with TestClient(app) as client:
        if not args.skip_seed:
            started = time.perf_counter()
            seed(client, args.projects)
            print(f"seeded {args.projects} projects in {time.perf_counter() - started:.1f}s")

        first_project = client.get("/api/projects").json()[0]["id"]
        first_hw = client.get("/api/hw/projects").json()[0]["id"]
        print(f"{'endpoint':<48}{'median ms':>12}{'queries':>10}")
        for path in (
            "/api/projects",
            "/api/portfolio/capacity",
            f"/api/projects/{first_project}",
            f"/api/projects/{first_project}/reports/resource-plan",
            f"/api/projects/{first_project}/hardware",
            "/api/hw/overview",
            "/api/hw/projects",
            f"/api/hw/projects/{first_hw}/summary",
        ):
            millis, queries = timed(client, path)
            print(f"{path:<48}{millis:>12.1f}{queries:>10}")


if __name__ == "__main__":
    main()
