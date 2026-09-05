"""Data-model and API hygiene (Phase 8): timestamps, body ids, the rollup budget."""

from datetime import datetime

from test_correctness_fixes import new_feature, new_project, new_role
from test_hw_management import make_project


def test_timestamps_carry_an_explicit_utc_offset(client):
    project = new_project(client, name="Zoned")
    for field in ("created_at", "updated_at"):
        assert project[field].endswith("Z"), project[field]
        assert datetime.fromisoformat(project[field]).utcoffset().total_seconds() == 0
    hw_id = make_project(client, "Zoned hardware")
    hw_project = client.get(f"/api/hw/projects/{hw_id}").json()
    assert hw_project["updated_at"].endswith("Z")
    catalog = client.post("/api/hardware-catalog", json={"name": "Zoned probe"}).json()
    assert catalog["created_at"].endswith("Z")


def test_unknown_ids_in_a_body_are_validation_errors(client):
    project = new_project(client, name="Body ids", start=(2026, 1), end=(2026, 3))
    pid = project["id"]
    # A catalog link that does not exist, on the planning tab's row endpoint
    resp = client.post(f"/api/projects/{pid}/hardware",
                       json={"name": "Ghost", "catalog_item_id": 987654, "years": [2026]})
    assert resp.status_code == 422
    assert "Catalog item not found: 987654" in resp.json()["detail"]
    # ... and a role from another project on the grid
    feature_id = new_feature(client, pid)
    new_role(client, feature_id)
    resp = client.put(f"/api/projects/{pid}/resource-grid", json={"roles": [
        {"role_id": 987654, "ftes_by_month": {"2026-01": 1, "2026-02": 1, "2026-03": 1}},
    ]})
    assert resp.status_code == 422
    assert "not found in this project" in resp.json()["detail"]
    # The path's resource missing is still a 404
    assert client.get("/api/projects/987654/hardware").status_code == 404


def test_rollup_keeps_the_stored_budget_apart_from_the_effective_one(client):
    hw_id = make_project(client, "Two budgets", budget_mode="split",
                         budget_assets=600.0, budget_licenses=300.0, budget_total=1.0)
    row = next(p for p in client.get("/api/hw/projects").json() if p["id"] == hw_id)
    assert row["effective_budget"] == 900.0
    assert row["budget_total"] == 1.0

    # Echoing the list row through PUT leaves the stored figures as they were
    resp = client.put(f"/api/hw/projects/{hw_id}", json=row)
    assert resp.status_code == 200, resp.text
    stored = client.get(f"/api/hw/projects/{hw_id}").json()
    assert (stored["budget_total"], stored["budget_assets"], stored["budget_licenses"]) == (
        1.0, 600.0, 300.0,
    )
    assert client.get(f"/api/hw/projects/{hw_id}/summary").json()["dashboard"]["budget_total"] \
        == 900.0
