"""The aggregate endpoints issue a bounded number of queries (Phase 4, F-16).

Each test seeds a few projects, counts the SQL statements one request issues,
then doubles the data and checks the count did not grow with it. A lazy load
that creeps back in shows up as a count that scales with the rows.
"""

from contextlib import contextmanager

import pytest
from sqlalchemy import event

from app.database import engine
from test_correctness_fixes import new_feature, new_project, new_role
from test_hw_management import asset, hw_license, make_project


@contextmanager
def counting_queries():
    """Count the statements the engine executes inside the block."""
    counter = {"queries": 0}

    def before_cursor_execute(*_args, **_kwargs):
        counter["queries"] += 1

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        yield counter
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)


def query_count(client, path):
    with counting_queries() as counter:
        resp = client.get(path)
    assert resp.status_code == 200, resp.text
    return counter["queries"]


def staffed_project(client, name):
    project = new_project(client, name=name, start=(2026, 1), end=(2027, 12))
    for feature_name in ("Platform", "Application"):
        feature_id = new_feature(client, project["id"], feature_name)
        new_role(client, feature_id, name="Developer", ftes=1.0)
        new_role(client, feature_id, name="Architect", ftes=0.0, use_advanced_allocation=True,
                 allocations=[{"start_month": "2026-01", "end_month": "2026-12", "ftes": 0.5},
                              {"start_month": "2027-01", "end_month": "2027-12", "ftes": 1.0}])
    resp = client.post("/api/hardware-catalog", json={"name": f"Probe {name}", "unit_cost": 5.0})
    catalog_id = resp.json()["id"]
    for index in range(3):
        resp = client.post(f"/api/projects/{project['id']}/hardware", json={
            "name": f"Rig {index}", "catalog_item_id": catalog_id, "years": [2026],
        })
        assert resp.status_code == 201, resp.text
    return project["id"]


def stocked_hw_project(client, name):
    hw_id = make_project(client, name, budget_assets=1000.0, budget_licenses=500.0)
    resp = client.put(f"/api/hw/projects/{hw_id}/assets", json={"items": [
        asset(name=f"Asset {index}", purchase_type="Purchase", purchase_cost=100.0,
              purchase_date="2026-03-01")
        for index in range(4)
    ]})
    assert resp.status_code == 200, resp.text
    resp = client.put(f"/api/hw/projects/{hw_id}/licenses", json={"items": [
        hw_license(name=f"License {index}", depreciation="Leasing", purchase_cost=360.0,
                   purchase_date="2026-01-01", termination_date="2028-12-31",
                   expiration_date="2027-06-30")
        for index in range(4)
    ]})
    assert resp.status_code == 200, resp.text
    resp = client.put(f"/api/hw/projects/{hw_id}/adjustments", json={"items": [
        {"year": 2026, "kind": "assets", "amount": 10.0, "note": ""},
    ]})
    assert resp.status_code == 200, resp.text
    return hw_id


@pytest.fixture(scope="module")
def staffed_projects(client):
    return [staffed_project(client, f"Capacity {index}") for index in range(3)]


def test_capacity_query_count_does_not_grow_with_projects(client, staffed_projects):
    small = query_count(client, "/api/portfolio/capacity")
    for index in range(3):
        staffed_project(client, f"Capacity extra {index}")
    large = query_count(client, "/api/portfolio/capacity")
    assert large == small
    # One query per level of the tree: projects, features, roles, periods
    assert small <= 5


def test_project_tree_and_plan_load_in_a_handful_of_queries(client, staffed_projects):
    pid = staffed_projects[0]
    assert query_count(client, f"/api/projects/{pid}") <= 5
    assert query_count(client, f"/api/projects/{pid}/reports/resource-plan") <= 5
    # The plan and the catalog entries its rows point at: not one query per row
    assert query_count(client, f"/api/projects/{pid}/hardware") <= 4


@pytest.fixture(scope="module")
def stocked_hw_projects(client):
    return [stocked_hw_project(client, f"Stocked {index}") for index in range(3)]


def test_hw_overview_and_list_query_counts_do_not_grow_with_projects(client,
                                                                     stocked_hw_projects):
    small_overview = query_count(client, "/api/hw/overview")
    small_list = query_count(client, "/api/hw/projects")
    for index in range(3):
        stocked_hw_project(client, f"Stocked extra {index}")
    assert query_count(client, "/api/hw/overview") == small_overview
    assert query_count(client, "/api/hw/projects") == small_list
    # Projects plus one query each for assets, licenses and adjustments
    assert small_overview <= 5
    assert small_list <= 5


def test_hw_project_reads_load_the_registers_once(client, stocked_hw_projects):
    hw_id = stocked_hw_projects[0]
    assert query_count(client, f"/api/hw/projects/{hw_id}/summary") <= 5
    assert query_count(client, f"/api/hw/projects/{hw_id}/assets") <= 5
