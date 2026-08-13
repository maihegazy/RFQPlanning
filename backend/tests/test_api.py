"""End-to-end API tests against an in-memory SQLite database."""

import os
import sys

os.environ["DATABASE_URL"] = "sqlite:///./test_rfq.db"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
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

    # Fixed-FTE role
    resp = client.post(f"/api/features/{feature_id}/roles", json={
        "name": "Developer", "location": "BCC", "level": "Senior", "ftes": 1.0,
        "use_advanced_allocation": False, "allocations": [],
    })
    assert resp.status_code == 201

    # Variable-allocation role
    resp = client.post(f"/api/features/{feature_id}/roles", json={
        "name": "Architect", "location": "HCC", "level": "Principal", "ftes": 0.0,
        "use_advanced_allocation": True,
        "allocations": [
            {"start_month": "2026-01", "end_month": "2026-06", "ftes": 0.5},
            {"start_month": "2026-07", "end_month": "2027-06", "ftes": 1.0},
        ],
    })
    assert resp.status_code == 201
    role = resp.json()
    assert len(role["allocations"]) == 2

    # Invalid location rejected
    resp = client.post(f"/api/features/{feature_id}/roles", json={
        "name": "X", "location": "ZZZ", "level": "Senior", "ftes": 1.0,
    })
    assert resp.status_code == 422


def test_rate_config(client, project_id):
    resp = client.put(f"/api/projects/{project_id}/rates", json={
        "hourly_rates": {"BCC": 100.0, "HCC": 80.0, "MCC": 60.0},
        "cost_rates": {"BCC": {"Senior": 50.0}, "HCC": {"Principal": 55.0}},
        "sp_to_hours": 4.0,
        "hw_cost_per_hour": 2.0,
        "risk_factor_pct": 10.0,
        "ticket_story_points": {"small": 2, "medium": 5, "large": 10},
        "ticket_prices": {"small": 500, "medium": 1200, "large": 2500},
        "ticket_quotas": {"2026": {"small": 20, "medium": 30, "large": 10},
                          "2027": {"small": 15, "medium": 25, "large": 20}},
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["hourly_rates"]["BCC"] == 100.0
    assert data["cost_rates"]["BCC"]["Senior"] == 50.0
    assert data["ticket_quotas"]["2026"]["medium"] == 30

    resp = client.get(f"/api/projects/{project_id}/rates")
    assert resp.json()["risk_factor_pct"] == 10.0


def test_budget_plan_calculations(client, project_id):
    resp = client.get(f"/api/projects/{project_id}/reports/budget-plan")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # 2026: Developer 1.0 FTE x 12 months x 160h = 1920h at BCC
    bcc_2026 = next(r for r in data["cost_profit_summary"]
                    if r["year"] == "2026" and r["location"] == "BCC")
    assert bcc_2026["man_hours"] == pytest.approx(1920)
    assert bcc_2026["selling_price"] == pytest.approx(1920 * 100.0)
    assert bcc_2026["cost"] == pytest.approx(1920 * 50.0)
    assert bcc_2026["profit_pct"] == pytest.approx(50.0)

    # Architect: 0.5 FTE Jan-Jun + 1.0 FTE Jul-Dec = (6*0.5 + 6*1.0) * 160 = 1440h at HCC
    hcc_2026 = next(r for r in data["cost_profit_summary"]
                    if r["year"] == "2026" and r["location"] == "HCC")
    assert hcc_2026["man_hours"] == pytest.approx(1440)

    # Ticket analysis 2026: total hours 3360, avg rate = (1920*100+1440*80)/3360
    total_hours = 1920 + 1440
    avg_rate = (1920 * 100.0 + 1440 * 80.0) / total_hours
    final_rate = avg_rate * 1.10 + 2.0
    small = next(r for r in data["ticket_analysis"]
                 if r["year"] == "2026" and r["size"] == "Small")
    assert small["hours_per_ticket"] == pytest.approx(8.0)  # 2 SP * 4 h/SP
    assert small["num_tickets"] == pytest.approx(round(total_hours * 0.20 / 8.0, 2))
    assert small["hourly_rate"] == pytest.approx(round(final_rate, 2))

    # Pivot totals include location subtotals and grand total
    pivot_2026 = next(p for p in data["yearly_pivots"] if p["year"] == "2026")
    features = [r["Feature"] for r in pivot_2026["rows"]]
    assert "TOTAL - BCC" in features and "TOTAL - HCC" in features and "TOTAL" in features
    grand = next(r for r in pivot_2026["rows"] if r["Feature"] == "TOTAL")
    assert grand["Total"] == pytest.approx(1920 * 100.0 + 1440 * 80.0)


def test_resource_plan(client, project_id):
    resp = client.get(f"/api/projects/{project_id}/reports/resource-plan")
    assert resp.status_code == 200
    pivots = resp.json()["yearly_pivots"]
    assert [p["year"] for p in pivots] == ["2026", "2027"]
    pivot_2026 = pivots[0]
    grand = next(r for r in pivot_2026["rows"] if r["Feature"] == "TOTAL")
    # Jan-Jun: 1.5 FTE/month, Jul-Dec: 2.0 FTE/month => total 21 FTE-months
    assert grand["Total"] == pytest.approx(21.0)


def test_excel_exports(client, project_id):
    for report in ["resource-plan.xlsx", "budget-plan.xlsx"]:
        resp = client.get(f"/api/projects/{project_id}/reports/{report}")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument")
        assert resp.content[:2] == b"PK"  # valid xlsx (zip) magic


def test_validation(client, project_id):
    resp = client.get(f"/api/projects/{project_id}/validate")
    assert resp.status_code == 200
    assert resp.json()["valid"] is True

    # A project without features is invalid
    resp = client.post("/api/projects", json={
        "name": "Empty", "company": "C",
        "start_year": 2026, "start_month": 1, "end_year": 2026, "end_month": 12,
    })
    pid = resp.json()["id"]
    resp = client.get(f"/api/projects/{pid}/validate")
    assert resp.json()["valid"] is False
    assert "At least one feature is required" in resp.json()["errors"]


def test_templates(client):
    resp = client.get("/api/templates")
    assert resp.status_code == 200
    templates = resp.json()
    assert [t["id"] for t in templates] == [
        "basic-software", "application-software", "safety"]

    # Create a project from the basic-software template
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
    network = project["features"][0]
    assert [(r["name"], r["location"], r["level"]) for r in network["roles"]] == [
        ("Developer", "BCC", "FO"),
        ("Tester", "BCC", "Standard"),
        ("Developer", "BCC", "Junior"),
    ]
    mgmt = project["features"][-1]
    assert [r["name"] for r in mgmt["roles"]] == [
        "Project Lead (PL)", "Technical Lead (TL)", "Integrator"]
    # Templated project passes validation out of the box
    resp = client.get(f"/api/projects/{project['id']}/validate")
    assert resp.json()["valid"] is True

    # Safety template roles
    resp = client.post("/api/projects", json={
        "name": "Safety", "company": "Vehiclevo",
        "start_year": 2026, "start_month": 1, "end_year": 2026, "end_month": 12,
        "template_id": "safety",
    })
    project = resp.json()
    assert [f["name"] for f in project["features"]] == [
        "Safety Analysis", "Safety Enhancement", "Project Management"]
    analysis = project["features"][0]
    assert [(r["name"], r["level"]) for r in analysis["roles"]] == [
        ("Developer", "FO"), ("Developer", "Principal")]

    # Unknown template rejected
    resp = client.post("/api/projects", json={
        "name": "X", "company": "Y",
        "start_year": 2026, "start_month": 1, "end_year": 2026, "end_month": 12,
        "template_id": "nope",
    })
    assert resp.status_code == 422


def test_export_import_roundtrip(client, project_id):
    resp = client.get(f"/api/projects/{project_id}/export")
    assert resp.status_code == 200
    exported = resp.json()
    assert exported["project_name"] == "Test RFQ"
    assert exported["rate_config"]["hourly_rates"]["BCC"] == 100.0

    resp = client.post("/api/projects/import", json=exported)
    assert resp.status_code == 201
    imported = resp.json()
    assert imported["name"] == "Test RFQ"
    assert len(imported["features"]) == 1
    assert len(imported["features"][0]["roles"]) == 2

    # Imported project produces identical budget numbers
    resp = client.get(f"/api/projects/{imported['id']}/reports/budget-plan")
    data = resp.json()
    bcc_2026 = next(r for r in data["cost_profit_summary"]
                    if r["year"] == "2026" and r["location"] == "BCC")
    assert bcc_2026["selling_price"] == pytest.approx(1920 * 100.0)
