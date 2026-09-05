"""Integrity and concurrency (Phase 2 of the September 2026 review).

Every write path carries an optimistic-concurrency version, the vault cannot be
overwritten blindly or created twice, a half-null money blob is refused, and
whole-plan saves are single transactions that keep row ids.
"""

import threading

import pytest
from sqlalchemy.exc import IntegrityError

from app import models
from app.database import SessionLocal
from test_correctness_fixes import new_feature, new_project, new_role
from test_hw_management import asset, hw_license, make_project

VERIFIER = "dmVyaWZpZXItb2YtdGhlLWRlaw=="


def version_of(client, project_id):
    return client.get(f"/api/projects/{project_id}").json()["version"]


# ---------------------------------------------------------------------------
# Versions move with every write
# ---------------------------------------------------------------------------

def test_project_version_moves_with_every_write(client):
    project = new_project(client, name="Versioned")
    pid = project["id"]
    assert project["version"] == 1

    feature_id = new_feature(client, pid)
    after_feature = version_of(client, pid)
    assert after_feature > 1

    new_role(client, feature_id)
    after_role = version_of(client, pid)
    assert after_role > after_feature

    resp = client.put(f"/api/projects/{pid}/rates", json={"sp_to_hours": 6.0})
    assert resp.status_code == 200
    assert resp.json()["version"] > after_role
    assert version_of(client, pid) == resp.json()["version"]

    resp = client.put(f"/api/projects/{pid}", json={"company": "Other"})
    assert resp.json()["version"] > after_role

    # A read never moves it
    before = version_of(client, pid)
    client.get(f"/api/projects/{pid}/export")
    client.get(f"/api/projects/{pid}/validate")
    assert version_of(client, pid) == before


# ---------------------------------------------------------------------------
# Financial blob (F-10, F-46)
# ---------------------------------------------------------------------------

def test_money_blob_precondition_and_shape(client):
    project = new_project(client, name="Blob")
    pid = project["id"]
    blob = client.get(f"/api/projects/{pid}/financial-data").json()
    assert blob == {"encrypted_money": None, "money_iv": None, "version": 1}

    # A half-null blob can never be decrypted and is refused
    resp = client.put(f"/api/projects/{pid}/financial-data",
                      json={"encrypted_money": "AAAA", "money_iv": None})
    assert resp.status_code == 422
    assert "together" in resp.text

    resp = client.put(f"/api/projects/{pid}/financial-data",
                      json={"encrypted_money": "AAAA", "money_iv": "BBBB",
                            "expected_version": 1})
    assert resp.status_code == 200, resp.text
    saved = resp.json()
    assert saved["version"] > 1

    # Someone working from the old version is told to reload, and writes nothing
    resp = client.put(f"/api/projects/{pid}/financial-data",
                      json={"encrypted_money": "CCCC", "money_iv": "DDDD",
                            "expected_version": 1})
    assert resp.status_code == 409
    assert "version 1" in resp.json()["detail"]
    assert client.get(f"/api/projects/{pid}/financial-data").json()["encrypted_money"] == "AAAA"

    # The current version goes through; no version means "no check" (the import path)
    resp = client.put(f"/api/projects/{pid}/financial-data",
                      json={"encrypted_money": "CCCC", "money_iv": "DDDD",
                            "expected_version": saved["version"]})
    assert resp.status_code == 200
    resp = client.put(f"/api/projects/{pid}/financial-data",
                      json={"encrypted_money": None, "money_iv": None})
    assert resp.status_code == 200


def test_rates_precondition(client):
    project = new_project(client, name="Rates race")
    pid = project["id"]
    resp = client.put(f"/api/projects/{pid}/rates",
                      json={"sp_to_hours": 5.0, "expected_version": 1})
    assert resp.status_code == 200
    current = resp.json()["version"]

    resp = client.put(f"/api/projects/{pid}/rates",
                      json={"sp_to_hours": 9.0, "expected_version": 1})
    assert resp.status_code == 409
    assert client.get(f"/api/projects/{pid}/rates").json()["sp_to_hours"] == 5.0

    resp = client.put(f"/api/projects/{pid}/rates",
                      json={"sp_to_hours": 9.0, "expected_version": current})
    assert resp.status_code == 200
    assert resp.json()["sp_to_hours"] == 9.0


# ---------------------------------------------------------------------------
# Registers and adjustments (F-10)
# ---------------------------------------------------------------------------

def test_register_save_keeps_ids_and_checks_the_version(client):
    hw_id = make_project(client, "Upsert")
    project = client.get(f"/api/hw/projects/{hw_id}").json()
    assert project["version"] == 1

    resp = client.put(f"/api/hw/projects/{hw_id}/assets", json={
        "expected_version": 1,
        "items": [asset(name="Bench PC"), asset(name="Probe")],
    })
    assert resp.status_code == 200, resp.text
    first = resp.json()
    assert first["version"] > 1
    ids = [row["id"] for row in first["items"]]

    # Editing one row and dropping the other keeps the edited row's id
    edited = {**first["items"][0], "name": "Bench PC (renamed)"}
    resp = client.put(f"/api/hw/projects/{hw_id}/assets", json={
        "expected_version": first["version"],
        "items": [edited],
    })
    assert resp.status_code == 200, resp.text
    second = resp.json()
    assert [row["id"] for row in second["items"]] == [ids[0]]
    assert second["items"][0]["name"] == "Bench PC (renamed)"
    assert second["version"] > first["version"]

    # A stale save is refused and changes nothing
    resp = client.put(f"/api/hw/projects/{hw_id}/assets", json={
        "expected_version": first["version"],
        "items": [],
    })
    assert resp.status_code == 409
    assert len(client.get(f"/api/hw/projects/{hw_id}/assets").json()) == 1

    # An id from nowhere, or listed twice, is a validation error, not a new row
    resp = client.put(f"/api/hw/projects/{hw_id}/assets", json={
        "items": [{**edited, "id": 999_999}],
    })
    assert resp.status_code == 422
    assert "not in this register" in resp.json()["detail"]
    resp = client.put(f"/api/hw/projects/{hw_id}/assets", json={
        "items": [edited, edited],
    })
    assert resp.status_code == 422
    assert "listed twice" in resp.json()["detail"]
    assert len(client.get(f"/api/hw/projects/{hw_id}/assets").json()) == 1


def test_license_register_upsert_and_adjustment_precondition(client):
    hw_id = make_project(client, "Upsert licenses")
    resp = client.put(f"/api/hw/projects/{hw_id}/licenses", json={
        "items": [hw_license(name="Seat A"), hw_license(name="Seat B")],
    })
    assert resp.status_code == 200, resp.text
    rows = resp.json()["items"]
    kept = {**rows[1], "quantity": 5}
    resp = client.put(f"/api/hw/projects/{hw_id}/licenses", json={"items": [kept]})
    assert resp.status_code == 200, resp.text
    assert [(row["id"], row["quantity"]) for row in resp.json()["items"]] == [(rows[1]["id"], 5)]

    version = resp.json()["version"]
    resp = client.put(f"/api/hw/projects/{hw_id}/adjustments", json={
        "expected_version": version - 1,
        "items": [{"year": 2026, "kind": "assets", "amount": 10.0, "note": ""}],
    })
    assert resp.status_code == 409
    assert client.get(f"/api/hw/projects/{hw_id}/adjustments").json() == []
    resp = client.put(f"/api/hw/projects/{hw_id}/adjustments", json={
        "expected_version": version,
        "items": [{"year": 2026, "kind": "assets", "amount": 10.0, "note": ""}],
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["version"] > version
    assert resp.json()["items"][0]["amount"] == 10.0


# ---------------------------------------------------------------------------
# Whole-plan hardware save (F-09)
# ---------------------------------------------------------------------------

def test_hardware_plan_save_is_one_transaction_that_keeps_ids(client):
    project = new_project(client, name="Plan save", start=(2026, 1), end=(2027, 12))
    pid = project["id"]
    resp = client.put(f"/api/projects/{pid}/hardware", json={
        "expected_version": project["version"],
        "items": [
            {"name": "Debugger", "billing": "once", "unit_cost": 100.0, "qty": 1,
             "years": [2026]},
            {"name": "CANoe", "billing": "yearly", "unit_cost": 10.0, "qty": 2,
             "years": [2026, 2027]},
        ],
    })
    assert resp.status_code == 200, resp.text
    plan = resp.json()
    assert plan["grand_total"] == 140.0
    assert plan["version"] > project["version"]
    debugger_id = plan["items"][0]["id"]

    # Keep one row (by id), change it, drop the other, add a third — atomically
    resp = client.put(f"/api/projects/{pid}/hardware", json={
        "expected_version": plan["version"],
        "items": [
            {"id": debugger_id, "name": "Debugger", "billing": "once", "unit_cost": 150.0,
             "qty": 1, "years": [2027]},
            {"name": "Bench PC", "billing": "once", "unit_cost": 1000.0, "qty": 1,
             "years": [2026]},
        ],
    })
    assert resp.status_code == 200, resp.text
    plan = resp.json()
    assert [item["name"] for item in plan["items"]] == ["Debugger", "Bench PC"]
    assert plan["items"][0]["id"] == debugger_id
    assert plan["items"][0]["unit_cost"] == 150.0
    assert plan["per_year"] == {"2026": 1000.0, "2027": 150.0}

    # One bad row (outside the timeline) rejects the whole save; nothing changed
    resp = client.put(f"/api/projects/{pid}/hardware", json={
        "items": [
            {"name": "Good", "years": [2026]},
            {"name": "Bad", "years": [2031]},
        ],
    })
    assert resp.status_code == 422
    assert [item["name"] for item in client.get(f"/api/projects/{pid}/hardware").json()["items"]] \
        == ["Debugger", "Bench PC"]

    resp = client.put(f"/api/projects/{pid}/hardware", json={
        "items": [{"name": "Ghost", "catalog_item_id": 999_999, "years": [2026]}],
    })
    assert resp.status_code == 422
    assert "do not exist" in resp.json()["detail"]

    resp = client.put(f"/api/projects/{pid}/hardware",
                      json={"expected_version": 1, "items": []})
    assert resp.status_code == 409

    resp = client.put(f"/api/projects/{pid}/hardware", json={"items": []})
    assert resp.status_code == 200
    assert resp.json()["items"] == []


# ---------------------------------------------------------------------------
# Vault (F-03)
# ---------------------------------------------------------------------------

def vault_keys(**overrides):
    return {
        "kdf_salt": "c2FsdA==",
        "kdf_iterations": 600000,
        "wrapped_dek_passphrase_iv": "aXYxaXYxaXYx",
        "wrapped_dek_passphrase": "d3JhcHBlZC1wYXNz",
        "wrapped_dek_recovery_iv": "aXYyaXYyaXYy",
        "wrapped_dek_recovery": "d3JhcHBlZC1yZWM=",
        "dek_verifier": VERIFIER,
        **overrides,
    }


@pytest.fixture
def fresh_vault(client):
    """The suite shares one database; every vault test starts from no vault."""
    db = SessionLocal()
    try:
        db.query(models.Vault).delete()
        db.commit()
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        db.query(models.Vault).delete()
        db.commit()
    finally:
        db.close()


def test_passphrase_change_needs_proof_of_the_current_key(client, fresh_vault):
    keys = vault_keys()
    assert client.post("/api/vault", json=keys).status_code == 201

    new_copy = {
        "kdf_salt": "bmV3c2FsdA==",
        "kdf_iterations": 700000,
        "wrapped_dek_passphrase_iv": "bmV3aXY=",
        "wrapped_dek_passphrase": "bmV3LXdyYXBwZWQ=",
        "current_wrapped_dek_passphrase_iv": keys["wrapped_dek_passphrase_iv"],
        "current_wrapped_dek_passphrase": keys["wrapped_dek_passphrase"],
    }
    # No proof at all
    resp = client.put("/api/vault/passphrase", json=new_copy)
    assert resp.status_code == 422
    # A wrong proof: the blind overwrite of the audit
    resp = client.put("/api/vault/passphrase",
                      json={**new_copy, "dek_verifier": "bm90LXRoZS12ZXJpZmllcg=="})
    assert resp.status_code == 403
    untouched = client.get("/api/vault").json()
    assert untouched["wrapped_dek_passphrase"] == keys["wrapped_dek_passphrase"]
    # A stale current key: someone else changed the passphrase first
    resp = client.put("/api/vault/passphrase", json={
        **new_copy, "dek_verifier": VERIFIER, "current_wrapped_dek_passphrase": "c3RhbGU=",
    })
    assert resp.status_code == 409
    # The real thing
    resp = client.put("/api/vault/passphrase", json={**new_copy, "dek_verifier": VERIFIER})
    assert resp.status_code == 200, resp.text
    assert resp.json()["wrapped_dek_passphrase"] == "bmV3LXdyYXBwZWQ="


def test_legacy_vault_registers_its_verifier_on_first_unlock(client, fresh_vault):
    """A vault from before verifiers existed: the first unlock adds the proof."""
    db = SessionLocal()
    try:
        db.add(models.Vault(**{k: v for k, v in vault_keys().items() if k != "dek_verifier"}))
        db.commit()
    finally:
        db.close()
    assert client.get("/api/vault").json()["has_verifier"] is False

    keys = vault_keys()
    current = {
        "current_wrapped_dek_passphrase_iv": keys["wrapped_dek_passphrase_iv"],
        "current_wrapped_dek_passphrase": keys["wrapped_dek_passphrase"],
    }
    # Until then a passphrase change only needs the current wrapped key
    resp = client.post("/api/vault/verifier",
                       json={**current, "current_wrapped_dek_passphrase": "c3RhbGU=",
                             "dek_verifier": VERIFIER})
    assert resp.status_code == 409
    resp = client.post("/api/vault/verifier", json={**current, "dek_verifier": VERIFIER})
    assert resp.status_code == 200, resp.text
    assert resp.json()["has_verifier"] is True
    # Registering the same proof again is fine, a different one is not
    assert client.post("/api/vault/verifier",
                       json={**current, "dek_verifier": VERIFIER}).status_code == 200
    resp = client.post("/api/vault/verifier",
                       json={**current, "dek_verifier": "bm90LXRoZS12ZXJpZmllcg=="})
    assert resp.status_code == 409


def test_vault_cannot_be_created_twice_even_by_a_race(client, fresh_vault):
    """Two first-time users racing past the existence check hit the unique row."""
    assert client.post("/api/vault", json=vault_keys()).status_code == 201
    assert client.post("/api/vault", json=vault_keys()).status_code == 409

    # Straight at the database, the way a race would land
    db = SessionLocal()
    try:
        db.add(models.Vault(**vault_keys(kdf_salt="b3RoZXI=")))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        assert db.query(models.Vault).count() == 1
    finally:
        db.close()


def test_concurrent_register_saves_do_not_both_win(client):
    """Two saves built from the same version: exactly one is applied."""
    hw_id = make_project(client, "Two editors")
    version = client.get(f"/api/hw/projects/{hw_id}").json()["version"]
    outcomes = []

    def save(name):
        resp = client.put(f"/api/hw/projects/{hw_id}/assets", json={
            "expected_version": version, "items": [asset(name=name)],
        })
        outcomes.append((name, resp.status_code))

    threads = [threading.Thread(target=save, args=(name,)) for name in ("Alice", "Bob")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(code for _, code in outcomes) == [200, 409]
    winner = next(name for name, code in outcomes if code == 200)
    assert [row["name"] for row in client.get(f"/api/hw/projects/{hw_id}/assets").json()] \
        == [winner]
