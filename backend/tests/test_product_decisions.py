"""The product decisions of the September 2026 review (Phase 5).

Winning scenarios speak for their family in the portfolio and the capacity
heatmap (F-11); the hardware plan reaches the cost-profit analysis through the
rate configuration with a pass-through flag (F-12); hardware projects expose
their planning window (F-15); a new hardware project's budget is one overall
figure unless split figures say otherwise (F-22).
"""

from test_correctness_fixes import new_feature, new_project, new_role
from test_hw_management import make_project


def capacity_total(client, statuses=None):
    params = {"statuses": statuses} if statuses is not None else {}
    data = client.get("/api/portfolio/capacity", params=params).json()
    return data["project_count"], sum(data["totals_by_month"].values())


def test_winning_scenario_speaks_for_its_family(client):
    base = new_project(client, name="Family base", start=(2030, 1), end=(2030, 12))
    base_feature = new_feature(client, base["id"])
    new_role(client, base_feature, ftes=1.0)
    resp = client.post(f"/api/projects/{base['id']}/clone",
                       json={"name": "Offshore scenario", "as_scenario": True})
    assert resp.status_code == 201, resp.text
    scenario = resp.json()
    scenario_role = scenario["features"][0]["roles"][0]
    resp = client.put(f"/api/roles/{scenario_role['id']}", json={
        "name": "Developer", "location": "MCC", "level": "Senior", "ftes": 2.0,
        "use_advanced_allocation": False, "allocations": [],
    })
    assert resp.status_code == 200, resp.text

    def family_rows(effective):
        rows = client.get("/api/projects", params={"effective": str(effective).lower()}).json()
        return [row for row in rows if row["id"] in (base["id"], scenario["id"])]

    # No winner yet: the base stands for the family
    assert [row["id"] for row in family_rows(True)] == [base["id"]]
    assert [row["id"] for row in family_rows(False)] == [base["id"]]
    count_before, ftes_before = capacity_total(client)

    assert client.post(f"/api/projects/{scenario['id']}/promote").status_code == 200
    assert [row["id"] for row in family_rows(True)] == [scenario["id"]]
    # The plain listing still shows base projects only
    assert [row["id"] for row in family_rows(False)] == [base["id"]]
    count_after, ftes_after = capacity_total(client)
    assert count_after == count_before
    assert ftes_after == ftes_before + 12.0  # 2 FTE instead of 1 over 12 months

    # A base marked as the winner is itself the effective project
    assert client.post(f"/api/projects/{base['id']}/promote").status_code == 200
    assert [row["id"] for row in family_rows(True)] == [base["id"]]
    _, ftes_back = capacity_total(client)
    assert ftes_back == ftes_before

    # The status filter applies to the effective project's own status
    assert client.post(f"/api/projects/{scenario['id']}/promote").status_code == 200
    resp = client.put(f"/api/projects/{scenario['id']}", json={"status": "won"})
    assert resp.status_code == 200, resp.text
    won = client.get("/api/projects", params={"effective": "true", "status": "won"}).json()
    assert scenario["id"] in [row["id"] for row in won]
    assert base["id"] not in [row["id"] for row in won]
    count_won, _ = capacity_total(client, "won")
    assert count_won >= 1


def test_hardware_plan_reaches_the_rate_configuration(client):
    project = new_project(client, name="Plan into budget", start=(2026, 1), end=(2027, 12))
    pid = project["id"]
    rates = client.get(f"/api/projects/{pid}/rates").json()
    assert rates["hardware_costs_per_year"] == {}
    assert rates["hardware_pass_through"] is False

    resp = client.put(f"/api/projects/{pid}/hardware", json={"items": [
        {"name": "CANoe", "billing": "yearly", "unit_cost": 100.0, "qty": 2,
         "years": [2026, 2027]},
        {"name": "Debugger", "billing": "once", "unit_cost": 1000.0, "qty": 1,
         "years": [2027]},
    ]})
    assert resp.status_code == 200, resp.text
    rates = client.get(f"/api/projects/{pid}/rates").json()
    assert rates["hardware_costs_per_year"] == {"2026": 200.0, "2027": 1200.0}

    resp = client.put(f"/api/projects/{pid}/rates", json={"hardware_pass_through": True})
    assert resp.status_code == 200, resp.text
    assert resp.json()["hardware_pass_through"] is True
    assert client.get(f"/api/projects/{pid}").json()["version"] == resp.json()["version"]
    # The export carries the flag alongside the plan
    exported = client.get(f"/api/projects/{pid}/export").json()
    assert exported["rate_config"]["hardware_pass_through"] is True
    resp = client.post("/api/projects/import", json=exported)
    assert resp.status_code == 201, resp.text
    imported = client.get(f"/api/projects/{resp.json()['id']}/rates").json()
    assert imported["hardware_pass_through"] is True
    assert imported["hardware_costs_per_year"] == {"2026": 200.0, "2027": 1200.0}


def test_hardware_project_planning_window(client):
    hw_id = make_project(client, "Windowed", start_year=2026, end_year=2028)
    project = client.get(f"/api/hw/projects/{hw_id}").json()
    assert (project["start_year"], project["end_year"]) == (2026, 2028)
    summary = client.get(f"/api/hw/projects/{hw_id}/summary").json()
    assert [row["year"] for row in summary["years"]] == [2026, 2027, 2028]

    resp = client.post("/api/hw/projects", json={
        "name": "Backwards", "start_year": 2028, "end_year": 2026,
    })
    assert resp.status_code == 422
    resp = client.post("/api/hw/projects", json={"name": "Typo", "start_year": 226})
    assert resp.status_code == 422

    # Both years are optional and can be cleared again
    resp = client.put(f"/api/hw/projects/{hw_id}", json={
        **{k: project[k] for k in ("name", "company", "description", "budget_mode",
                                   "budget_total", "budget_assets", "budget_licenses",
                                   "portal_reference")},
        "start_year": None, "end_year": None,
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["start_year"] is None


def test_new_hardware_project_defaults_to_one_overall_budget(client):
    resp = client.post("/api/hw/projects", json={"name": "Just a name"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["budget_mode"] == "overall"

    resp = client.post("/api/hw/projects", json={"name": "Overall figure", "budget_total": 900.0})
    assert resp.json()["budget_mode"] == "overall"

    # Split figures without a mode mean a split budget (an older client)
    resp = client.post("/api/hw/projects",
                       json={"name": "Split figures", "budget_assets": 600.0,
                             "budget_licenses": 300.0})
    assert resp.json()["budget_mode"] == "split"
    dashboard = client.get(f"/api/hw/projects/{resp.json()['id']}/summary").json()["dashboard"]
    assert dashboard["budget_total"] == 900.0

    # An explicit mode always wins
    resp = client.post("/api/hw/projects",
                       json={"name": "Explicit", "budget_mode": "overall",
                             "budget_assets": 600.0, "budget_total": 100.0})
    assert resp.json()["budget_mode"] == "overall"
