"""End-to-end API tests against a SQLite database.

Money values are end-to-end encrypted client-side; the server only stores
opaque blobs, so these tests cover effort data, vault key storage, and the
plaintext-migration path. Monetary math is tested in the frontend engine
suite (frontend/src/money/engine.test.ts).
"""

import os
import sys

os.environ["DATABASE_URL"] = "sqlite:///./test_rfq.db"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine, run_startup_migrations
from app.main import app


@pytest.fixture(scope="module")
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(bind=engine)
    if os.path.exists("./test_rfq.db"):
        os.remove("./test_rfq.db")


@pytest.fixture(scope="module")
def project_id(client):
    resp = client.post("/api/projects", json={
        "name": "Test RFQ", "company": "Vehiclevo",
        "start_year": 2026, "start_month": 1,
        "end_year": 2027, "end_month": 6,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_startup_migrations_idempotent():
    # Running the column migrations repeatedly must be a no-op
    run_startup_migrations(engine)
    run_startup_migrations(engine)


def test_meta(client):
    resp = client.get("/api/meta")
    assert resp.status_code == 200
    data = resp.json()
    assert data["locations"] == ["BCC", "HCC", "MCC"]
    assert data["levels"][0] == "PM/TL"
    assert data["hours_per_fte_per_month"] == 160


def test_project_crud(client, project_id):
    resp = client.get(f"/api/projects/{project_id}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Test RFQ"

    resp = client.put(f"/api/projects/{project_id}", json={"company": "Vehiclevo GmbH"})
    assert resp.status_code == 200
    assert resp.json()["company"] == "Vehiclevo GmbH"

    resp = client.get("/api/projects")
    assert len(resp.json()) == 1


def test_features_and_roles(client, project_id):
    resp = client.post(f"/api/projects/{project_id}/features", json={"name": "ADAS"})
    assert resp.status_code == 201
    feature_id = resp.json()["id"]

    resp = client.post(f"/api/features/{feature_id}/roles", json={
        "name": "Developer", "location": "BCC", "level": "Senior", "ftes": 1.0,
        "use_advanced_allocation": False, "allocations": [],
    })
    assert resp.status_code == 201

    resp = client.post(f"/api/features/{feature_id}/roles", json={
        "name": "Architect", "location": "HCC", "level": "Principal", "ftes": 0.0,
        "use_advanced_allocation": True,
        "allocations": [
            {"start_month": "2026-01", "end_month": "2026-06", "ftes": 0.5},
            {"start_month": "2026-07", "end_month": "2027-06", "ftes": 1.0},
        ],
    })
    assert resp.status_code == 201
    assert len(resp.json()["allocations"]) == 2

    resp = client.post(f"/api/features/{feature_id}/roles", json={
        "name": "X", "location": "ZZZ", "level": "Senior", "ftes": 1.0,
    })
    assert resp.status_code == 422


def test_rate_config_non_monetary(client, project_id):
    resp = client.put(f"/api/projects/{project_id}/rates", json={
        "sp_to_hours": 4.0,
        "risk_factor_pct": 10.0,
        "ticket_story_points": {"small": 2, "medium": 5, "large": 10},
        "ticket_quotas": {"2026": {"small": 20, "medium": 30, "large": 10},
                          "2027": {"small": 15, "medium": 25, "large": 20}},
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["risk_factor_pct"] == 10.0
    assert data["ticket_quotas"]["2026"]["medium"] == 30
    # No monetary keys are exposed by the server
    assert "hourly_rates" not in data
    assert "cost_rates" not in data
    assert "ticket_prices" not in data


def test_resource_plan(client, project_id):
    resp = client.get(f"/api/projects/{project_id}/reports/resource-plan")
    assert resp.status_code == 200
    pivots = resp.json()["yearly_pivots"]
    assert [p["year"] for p in pivots] == ["2026", "2027"]
    grand = next(r for r in pivots[0]["rows"] if r["Feature"] == "TOTAL")
    # Jan-Jun: 1.5 FTE/month, Jul-Dec: 2.0 FTE/month => total 21 FTE-months
    assert grand["Total"] == pytest.approx(21.0)

    resp = client.get(f"/api/projects/{project_id}/reports/resource-plan.xlsx")
    assert resp.status_code == 200
    assert resp.content[:2] == b"PK"


def test_budget_plan_no_longer_server_side(client, project_id):
    assert client.get(
        f"/api/projects/{project_id}/reports/budget-plan").status_code == 404
    assert client.get(
        f"/api/projects/{project_id}/reports/budget-plan.xlsx").status_code == 404


def test_vault_lifecycle(client):
    resp = client.get("/api/vault")
    assert resp.status_code == 200
    assert resp.json() == {"exists": False}

    keys = {
        "kdf_salt": "c2FsdA==",
        "kdf_iterations": 600000,
        "wrapped_dek_passphrase_iv": "aXYxaXYxaXYx",
        "wrapped_dek_passphrase": "d3JhcHBlZC1wYXNz",
        "wrapped_dek_recovery_iv": "aXYyaXYyaXYy",
        "wrapped_dek_recovery": "d3JhcHBlZC1yZWM=",
    }
    resp = client.post("/api/vault", json=keys)
    assert resp.status_code == 201, resp.text

    # Second setup rejected
    assert client.post("/api/vault", json=keys).status_code == 409

    resp = client.get("/api/vault")
    data = resp.json()
    assert data["exists"] is True
    assert data["wrapped_dek_recovery"] == keys["wrapped_dek_recovery"]

    # Passphrase change re-wraps only the passphrase copy
    resp = client.put("/api/vault/passphrase", json={
        "kdf_salt": "bmV3c2FsdA==",
        "kdf_iterations": 700000,
        "wrapped_dek_passphrase_iv": "bmV3aXY=",
        "wrapped_dek_passphrase": "bmV3LXdyYXBwZWQ=",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["kdf_iterations"] == 700000
    assert data["wrapped_dek_recovery"] == keys["wrapped_dek_recovery"]


def test_money_blob_roundtrip(client, project_id):
    resp = client.get(f"/api/projects/{project_id}/money")
    assert resp.json() == {"encrypted_money": None, "money_iv": None}

    blob = {"encrypted_money": "b3BhcXVlLWNpcGhlcnRleHQ=", "money_iv": "aXZpdml2"}
    resp = client.put(f"/api/projects/{project_id}/money", json=blob)
    assert resp.status_code == 200

    resp = client.get(f"/api/projects/{project_id}/money")
    assert resp.json() == blob


def test_legacy_money_migration(client, project_id):
    # Fresh project has no legacy plaintext money
    resp = client.get(f"/api/projects/{project_id}/money/legacy")
    assert resp.status_code == 200
    assert resp.json()["has_data"] is False

    # Purge is idempotent and safe on empty data
    assert client.post(
        f"/api/projects/{project_id}/money/purge-plaintext").status_code == 204


def test_no_plaintext_money_in_db(client, project_id):
    """After setting rates + blob, no monetary number may exist in plaintext."""
    import sqlite3
    conn = sqlite3.connect("./test_rfq.db")
    try:
        for table in ["hourly_rates", "cost_rates"]:
            rows = conn.execute(f"SELECT * FROM {table}").fetchall()
            assert rows == [], f"plaintext rows found in {table}: {rows}"
        prices = conn.execute("SELECT price FROM ticket_configs").fetchall()
        assert all(p == (0.0,) for p in prices)
        hw = conn.execute("SELECT hw_cost_per_hour FROM projects").fetchall()
        assert all(h == (0.0,) for h in hw)
    finally:
        conn.close()


def test_resource_grid_update(client):
    resp = client.post("/api/projects", json={
        "name": "Grid", "company": "V",
        "start_year": 2026, "start_month": 1, "end_year": 2026, "end_month": 6,
    })
    pid = resp.json()["id"]
    fid = client.post(f"/api/projects/{pid}/features",
                      json={"name": "F1"}).json()["id"]
    r1 = client.post(f"/api/features/{fid}/roles", json={
        "name": "Dev", "location": "BCC", "level": "Senior", "ftes": 1.0,
    }).json()["id"]
    r2 = client.post(f"/api/features/{fid}/roles", json={
        "name": "Tester", "location": "BCC", "level": "Standard", "ftes": 1.0,
    }).json()["id"]

    resp = client.put(f"/api/projects/{pid}/resource-grid", json={
        "roles": [
            {"role_id": r1, "ftes_by_month": {
                "2026-01": 0.5, "2026-02": 0.5, "2026-03": 1.0,
                "2026-04": 1.0, "2026-05": 0.0, "2026-06": 0.8,
            }},
            {"role_id": r2, "ftes_by_month": {
                m: 0.6 for m in ["2026-01", "2026-02", "2026-03",
                                 "2026-04", "2026-05", "2026-06"]
            }},
        ],
    })
    assert resp.status_code == 200, resp.text
    roles = {r["id"]: r for r in resp.json()["features"][0]["roles"]}

    assert roles[r1]["use_advanced_allocation"] is True
    periods = [(a["start_month"], a["end_month"], a["ftes"])
               for a in roles[r1]["allocations"]]
    assert periods == [
        ("2026-01", "2026-02", 0.5),
        ("2026-03", "2026-04", 1.0),
        ("2026-06", "2026-06", 0.8),
    ]
    assert roles[r2]["use_advanced_allocation"] is False
    assert roles[r2]["ftes"] == 0.6

    pivots = client.get(
        f"/api/projects/{pid}/reports/resource-plan").json()["yearly_pivots"]
    grand = next(r for r in pivots[0]["rows"] if r["Feature"] == "TOTAL")
    assert grand["Total"] == pytest.approx(0.5*2 + 1.0*2 + 0.8 + 0.6*6)


def test_templates(client):
    resp = client.get("/api/templates")
    templates = resp.json()
    assert [t["id"] for t in templates] == [
        "basic-software", "application-software", "safety"]

    resp = client.post("/api/projects", json={
        "name": "Templated", "company": "Vehiclevo",
        "start_year": 2026, "start_month": 1, "end_year": 2026, "end_month": 12,
        "template_id": "basic-software",
    })
    assert resp.status_code == 201, resp.text
    project = resp.json()
    feature_names = [f["name"] for f in project["features"]]
    assert feature_names == [
        "Network", "Cyber Security", "Functional Safety", "Diagnostics",
        "Programming", "Life Cycle", "Calibration", "Project Management",
    ]
    mgmt = project["features"][-1]
    assert [r["name"] for r in mgmt["roles"]] == [
        "Project Lead (PL)", "Technical Lead (TL)", "Integrator"]

    resp = client.get(f"/api/projects/{project['id']}/validate")
    assert resp.json()["valid"] is True


def test_validation(client):
    resp = client.post("/api/projects", json={
        "name": "Empty", "company": "C",
        "start_year": 2026, "start_month": 1, "end_year": 2026, "end_month": 12,
    })
    pid = resp.json()["id"]
    resp = client.get(f"/api/projects/{pid}/validate")
    assert resp.json()["valid"] is False
    assert "At least one feature is required" in resp.json()["errors"]


def test_export_import_roundtrip(client, project_id):
    resp = client.get(f"/api/projects/{project_id}/export")
    assert resp.status_code == 200
    exported = resp.json()
    assert exported["project_name"] == "Test RFQ"
    # No monetary values in the server-side export
    assert "hourly_rates" not in exported["rate_config"]
    assert "ticket_price" not in exported["rate_config"]

    resp = client.post("/api/projects/import", json=exported)
    assert resp.status_code == 201
    imported = resp.json()
    assert imported["name"] == "Test RFQ"
    assert len(imported["features"]) == 1
    assert len(imported["features"][0]["roles"]) == 2

    # Old desktop files containing money import cleanly; money is ignored
    legacy_file = {**exported}
    legacy_file["rate_config"] = {
        **exported["rate_config"],
        "hourly_rates": {"BCC": 100.0},
        "cost_rates": {"BCC": {"Senior": 50.0}},
        "ticket_price": {"small": 500},
        "hw_cost_per_hour": 2.0,
    }
    resp = client.post("/api/projects/import", json=legacy_file)
    assert resp.status_code == 201
    pid = resp.json()["id"]
    resp = client.get(f"/api/projects/{pid}/money/legacy")
    assert resp.json()["has_data"] is False
