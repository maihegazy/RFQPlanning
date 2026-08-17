"""Executable specifications for known defects found during the Phase 1 audit.

These tests are strict expected failures: CI stays green while the defects are
being fixed, and an unexpected pass forces the corresponding marker to be
removed in the implementation PR.
"""

import os

import pytest
import yaml

from app.config import CORS_ORIGINS


def test_rejects_reversed_project_dates(client):
    response = client.post("/api/projects", json={
        "name": "Invalid timeline",
        "company": "Vehiclevo",
        "start_year": 2027,
        "start_month": 12,
        "end_year": 2026,
        "end_month": 1,
    })
    assert response.status_code == 422


def test_rejects_project_update_that_reverses_dates(client):
    project = client.post("/api/projects", json={
        "name": "Update timeline",
        "company": "Vehiclevo",
        "start_year": 2026,
        "start_month": 1,
        "end_year": 2026,
        "end_month": 12,
    }).json()

    response = client.put(
        f"/api/projects/{project['id']}",
        json={"start_year": 2027},
    )
    assert response.status_code == 422


def test_rejects_fixed_fte_above_two(client):
    project = client.post("/api/projects", json={
        "name": "Invalid fixed FTE",
        "company": "Vehiclevo",
        "start_year": 2026,
        "start_month": 1,
        "end_year": 2026,
        "end_month": 12,
    }).json()
    feature = client.post(
        f"/api/projects/{project['id']}/features", json={"name": "Feature"}
    ).json()

    response = client.post(f"/api/features/{feature['id']}/roles", json={
        "name": "Developer",
        "location": "BCC",
        "level": "Senior",
        "ftes": 2.1,
        "use_advanced_allocation": False,
        "allocations": [],
    })
    assert response.status_code == 422


def test_rejects_overlapping_allocation_periods(client):
    project = client.post("/api/projects", json={
        "name": "Invalid periods",
        "company": "Vehiclevo",
        "start_year": 2026,
        "start_month": 1,
        "end_year": 2026,
        "end_month": 12,
    }).json()
    feature = client.post(
        f"/api/projects/{project['id']}/features", json={"name": "Feature"}
    ).json()

    response = client.post(f"/api/features/{feature['id']}/roles", json={
        "name": "Developer",
        "location": "BCC",
        "level": "Senior",
        "ftes": 0,
        "use_advanced_allocation": True,
        "allocations": [
            {"start_month": "2026-01", "end_month": "2026-06", "ftes": 0.5},
            {"start_month": "2026-06", "end_month": "2026-12", "ftes": 1.0},
        ],
    })
    assert response.status_code == 422


def test_rejects_allocation_period_outside_project(client):
    project = client.post("/api/projects", json={
        "name": "Bounded periods",
        "company": "Vehiclevo",
        "start_year": 2026,
        "start_month": 2,
        "end_year": 2026,
        "end_month": 11,
    }).json()
    feature = client.post(
        f"/api/projects/{project['id']}/features", json={"name": "Feature"}
    ).json()

    response = client.post(f"/api/features/{feature['id']}/roles", json={
        "name": "Developer",
        "location": "BCC",
        "level": "Senior",
        "ftes": 0,
        "use_advanced_allocation": True,
        "allocations": [
            {"start_month": "2026-01", "end_month": "2026-06", "ftes": 0.5},
        ],
    })
    assert response.status_code == 422


def test_malformed_legacy_import_returns_422(client):
    before = len(client.get("/api/projects").json())
    response = client.post("/api/projects/import", json={
        "project_name": "Malformed import",
        "company_name": "Vehiclevo",
        "dates": ["2026", "1", "2026", "12"],
        "win_probability_pct": "not-a-number",
        "features": [],
    })
    assert response.status_code == 422
    assert len(client.get("/api/projects").json()) == before


def test_malformed_nested_legacy_import_returns_422_without_partial_write(client):
    before = len(client.get("/api/projects").json())
    response = client.post("/api/projects/import", json={
        "project_name": "Malformed nested import",
        "company_name": "Vehiclevo",
        "dates": ["2026", "1", "2026", "12"],
        "features": [{
            "Feature": "Feature",
            "Roles": [{
                "Role": "Developer",
                "Location": "unknown",
                "Level": "Senior",
                "FTEs": 1,
            }],
        }],
    })
    assert response.status_code == 422
    assert len(client.get("/api/projects").json()) == before


def test_partial_resource_grid_payload_is_rejected(client):
    project = client.post("/api/projects", json={
        "name": "Partial grid",
        "company": "Vehiclevo",
        "start_year": 2026,
        "start_month": 1,
        "end_year": 2026,
        "end_month": 3,
    }).json()
    feature = client.post(
        f"/api/projects/{project['id']}/features", json={"name": "Feature"}
    ).json()
    role = client.post(f"/api/features/{feature['id']}/roles", json={
        "name": "Developer",
        "location": "BCC",
        "level": "Senior",
        "ftes": 1.0,
        "use_advanced_allocation": False,
        "allocations": [],
    }).json()

    response = client.put(f"/api/projects/{project['id']}/resource-grid", json={
        "roles": [{
            "role_id": role["id"],
            "ftes_by_month": {"2026-01": 0.5},
        }],
    })
    assert response.status_code == 422


@pytest.mark.xfail(
    strict=True,
    reason="Production defaults allow every CORS origin",
)
def test_default_cors_configuration_is_restricted():
    assert CORS_ORIGINS != ["*"]


@pytest.mark.xfail(
    strict=True,
    reason="The default Compose file publishes the unauthenticated backend port",
)
def test_default_compose_does_not_publish_backend_port():
    compose_path = os.path.join(os.path.dirname(__file__), "..", "..", "docker-compose.yml")
    with open(compose_path, encoding="utf-8") as compose_file:
        compose = yaml.safe_load(compose_file)
    assert "ports" not in compose["services"]["backend"]
