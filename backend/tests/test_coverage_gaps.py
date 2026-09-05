"""The endpoints and code paths the audit found untested (Phase 7, F-19)."""

import io

import openpyxl
import xlsxwriter
from sqlalchemy import create_engine, inspect, text

from app import models
from app.database import SessionLocal, run_migrations
from app.services import hw_excel
from test_correctness_fixes import new_feature, new_project, new_role
from test_hw_management import build_workbook, make_project, upload

# ---------------------------------------------------------------------------
# Feature and role endpoints
# ---------------------------------------------------------------------------

def test_feature_rename_list_and_delete(client):
    project = new_project(client, name="Feature endpoints")
    pid = project["id"]
    feature_id = new_feature(client, pid, "Old name")
    other_id = new_feature(client, pid, "Other")
    role = new_role(client, feature_id)

    resp = client.put(f"/api/features/{feature_id}", json={"name": "New name"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "New name"
    assert [r["id"] for r in resp.json()["roles"]] == [role["id"]]

    listed = client.get(f"/api/projects/{pid}/features").json()
    assert [f["name"] for f in listed] == ["New name", "Other"]

    assert client.put("/api/features/987654", json={"name": "Ghost"}).status_code == 404
    assert client.put(f"/api/features/{feature_id}", json={"name": ""}).status_code == 422

    assert client.delete(f"/api/features/{feature_id}").status_code == 204
    assert client.delete(f"/api/features/{feature_id}").status_code == 404
    listed = client.get(f"/api/projects/{pid}/features").json()
    assert [f["id"] for f in listed] == [other_id]
    # The feature's roles went with it
    assert client.put(f"/api/roles/{role['id']}", json={
        "name": "Gone", "location": "BCC", "level": "Senior", "ftes": 1.0,
        "use_advanced_allocation": False, "allocations": [],
    }).status_code == 404


def test_role_delete(client):
    project = new_project(client, name="Role delete")
    feature_id = new_feature(client, project["id"])
    role = new_role(client, feature_id)
    before = client.get(f"/api/projects/{project['id']}").json()["version"]
    assert client.delete(f"/api/roles/{role['id']}").status_code == 204
    assert client.delete(f"/api/roles/{role['id']}").status_code == 404
    after = client.get(f"/api/projects/{project['id']}").json()
    assert after["features"][0]["roles"] == []
    assert after["version"] > before


# ---------------------------------------------------------------------------
# Legacy plaintext money: the has_data branch and the purge
# ---------------------------------------------------------------------------

def test_legacy_money_is_reported_and_purged(client):
    project = new_project(client, name="Legacy money")
    pid = project["id"]
    db = SessionLocal()
    try:
        db.add(models.HourlyRate(project_id=pid, location="BCC", rate=95.0))
        db.add(models.CostRate(project_id=pid, location="HCC", level="Senior", rate=60.0))
        db.add(models.TicketConfig(project_id=pid, size="small", story_points=2.0, price=250.0))
        stored = db.get(models.Project, pid)
        stored.hw_cost_per_hour = 1.5
        db.commit()
    finally:
        db.close()

    legacy = client.get(f"/api/projects/{pid}/financial-data/legacy").json()
    assert legacy["has_data"] is True
    assert legacy["hourly_rates"] == {"BCC": 95.0}
    assert legacy["cost_rates"] == {"HCC": {"Senior": 60.0}}
    assert legacy["ticket_prices"] == {"small": 250.0}
    assert legacy["hw_cost_per_hour"] == 1.5

    assert client.post(f"/api/projects/{pid}/financial-data/purge-plaintext").status_code == 204
    legacy = client.get(f"/api/projects/{pid}/financial-data/legacy").json()
    assert legacy["has_data"] is False
    assert legacy["hourly_rates"] == {}
    assert legacy["ticket_prices"] == {"small": 0.0}
    # The story points survive the purge; only the price was money
    rates = client.get(f"/api/projects/{pid}/rates").json()
    assert rates["ticket_story_points"]["small"] == 2.0


# ---------------------------------------------------------------------------
# Importer edge paths
# ---------------------------------------------------------------------------

def banner_workbook():
    """A hand-edited file: a merged banner, a note row, the header on row 3."""
    buffer = io.BytesIO()
    workbook = xlsxwriter.Workbook(buffer, {"in_memory": True})
    sheet = workbook.add_worksheet("Assets")
    sheet.merge_range(0, 0, 0, 5, "Hardware register 2026 (working document)")
    sheet.write(1, 0, "prepared by purchasing")
    for col, header in enumerate(hw_excel.ASSET_HEADERS):
        sheet.write(2, col, header)
    rows = [
        ["A-1", "Co", "Bench PC", "SN", "", "PC", "In Stock", "Dell", "2026-03-15", "-1.234,50",
         "", "", "", "", "", "Purchase"],
        ["A-2", "Co", "Broken cell", "", "", "", "", "", "#REF!", "#N/A", "", "", "", "", "",
         "purchase"],
    ]
    for r, row in enumerate(rows, start=3):
        for c, value in enumerate(row):
            sheet.write(r, c, value)
    workbook.close()
    return buffer.getvalue()


def test_importer_handles_banners_merged_cells_errors_and_negatives(client):
    hw_id = make_project(client, "Edge import")
    resp = upload(client, hw_id, banner_workbook(), dry_run=True)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert [row["asset_tag"] for row in data["assets"]] == ["A-1", "A-2"]
    bench, broken = data["assets"]
    # A negative amount is refused, not stored (the API models are ge=0)
    assert bench["purchase_cost"] == 0.0
    assert any("is negative, used 0" in w for w in data["warnings"])
    # Excel error values read as blanks, and the purchase type is matched loosely
    assert broken["purchase_date"] is None
    assert broken["purchase_cost"] == 0.0
    assert broken["purchase_type"] == "Purchase"
    assert not any("#REF!" in w for w in data["warnings"])


def test_importer_reads_the_words_people_type_for_yes_and_no(client):
    hw_id = make_project(client, "Bool words")
    rows = []
    for index, word in enumerate(("ja", "x", "TRUE", "nein", "", "maybe")):
        rows.append([f"L-{index}", "", f"Seat {index}", "", "", "", "Compiler", "", "Tasking",
                     1, "", "", "Purchase", word, 100, "", ""])
    workbook = build_workbook([("Licenses", hw_excel.LICENSE_HEADERS, rows)])
    data = upload(client, hw_id, workbook, dry_run=True).json()
    assert [row["maintained"] for row in data["licenses"]] == [True, True, True, False, False,
                                                                False]
    assert any("is not a yes/no, used No" in w and "maybe" in w for w in data["warnings"])


def test_import_template_parses_after_a_round_trip_through_openpyxl(client):
    """A template opened and re-saved by another tool still imports cleanly."""
    template = client.get("/api/hw/import-template.xlsx").content
    workbook = openpyxl.load_workbook(io.BytesIO(template))
    sheet = workbook["Assets"]
    sheet.append(["A-7", "Co", "Saved elsewhere", "", "", "PC", "In Stock", "", "2026-01-01",
                  1500, "", "", "", "", "", "Purchase"])
    buffer = io.BytesIO()
    workbook.save(buffer)
    hw_id = make_project(client, "Round trip template")
    data = upload(client, hw_id, buffer.getvalue(), dry_run=True).json()
    assert [row["name"] for row in data["assets"]] == ["Saved elsewhere"]
    assert data["assets"][0]["purchase_cost"] == 1500.0


# ---------------------------------------------------------------------------
# Upgrading a database made before Alembic existed
# ---------------------------------------------------------------------------

def test_pre_alembic_sqlite_database_upgrades(tmp_path):
    """A SQLite file from the first release (no alembic_version, a bare
    projects table) reaches head with every later column in place."""
    url = f"sqlite:///{tmp_path / 'legacy.db'}"
    legacy = create_engine(url)
    try:
        with legacy.begin() as connection:
            connection.execute(text(
                "CREATE TABLE projects (id INTEGER PRIMARY KEY, name VARCHAR(255), "
                "company VARCHAR(255), start_year INTEGER, start_month INTEGER, "
                "end_year INTEGER, end_month INTEGER)"
            ))
            connection.execute(text(
                "INSERT INTO projects (name, company, start_year, start_month, end_year, "
                "end_month) VALUES ('Old', 'Co', 2025, 1, 2025, 12)"
            ))
        run_migrations(legacy)
        inspector = inspect(legacy)
        columns = {column["name"] for column in inspector.get_columns("projects")}
        assert {"version", "hardware_pass_through", "is_winning_scenario",
                "encrypted_money"} <= columns
        assert {"vault", "hw_projects", "hw_assets", "alembic_version"} <= set(
            inspector.get_table_names()
        )
        with legacy.connect() as connection:
            row = connection.execute(text(
                "SELECT name, version, hardware_pass_through FROM projects"
            )).one()
        assert row[0] == "Old"
        assert row[1] == 1
        assert not row[2]
    finally:
        legacy.dispose()
