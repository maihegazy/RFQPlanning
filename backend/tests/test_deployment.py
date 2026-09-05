"""The deployment contract (Phase 3 of the September 2026 review).

Runtime behaviour is exercised against the test app; the container and Compose
files are checked for the properties the README promises, so a later edit
cannot quietly publish the API port or drop the upload cap.
"""

import os
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from app import main as app_main
from app import migrate
from app.routers import hw_management, meta
from app.services import hw_excel
from test_hw_management import build_workbook, make_project, upload

ROOT = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------

def test_health_checks_the_database(client, monkeypatch):
    assert client.get("/api/health").json() == {"status": "ok", "database": "ok"}

    def unreachable():
        raise ConnectionError("connection refused")

    monkeypatch.setattr(meta, "check_database", unreachable)
    resp = client.get("/api/health")
    assert resp.status_code == 503
    assert resp.json()["detail"] == {"status": "degraded", "database": "unreachable"}


def test_upload_larger_than_the_cap_is_refused(client, monkeypatch):
    hw_id = make_project(client, "Upload cap")
    workbook = build_workbook([("Assets", hw_excel.ASSET_HEADERS, [])])
    assert len(workbook) > 1024
    monkeypatch.setattr(hw_management, "MAX_UPLOAD_BYTES", 1024)
    resp = upload(client, hw_id, workbook, dry_run=True)
    assert resp.status_code == 413
    assert "upload limit" in resp.json()["detail"]

    monkeypatch.setattr(hw_management, "MAX_UPLOAD_BYTES", len(workbook))
    assert upload(client, hw_id, workbook, dry_run=True).status_code == 200


def test_trusted_proxy_header_is_required_when_configured(client, monkeypatch):
    # Off by default: nothing is checked
    assert client.get("/api/meta").status_code == 200

    monkeypatch.setattr(app_main, "TRUSTED_PROXY_USER_HEADER", "X-Forwarded-User")
    resp = client.get("/api/meta")
    assert resp.status_code == 401
    assert "authenticating proxy" in resp.json()["detail"]
    assert client.get("/api/meta", headers={"X-Forwarded-User": "   "}).status_code == 401
    assert client.get("/api/meta", headers={"X-Forwarded-User": "mai"}).status_code == 200
    # The container health check carries no header and must keep working
    assert client.get("/api/health").status_code == 200


def test_startup_migrations_can_be_switched_off(monkeypatch):
    calls = []
    monkeypatch.setattr(app_main, "run_migrations", lambda: calls.append("ran"))

    monkeypatch.setattr(app_main, "RUN_MIGRATIONS_ON_STARTUP", False)
    with TestClient(app_main.app):
        pass
    assert calls == []

    monkeypatch.setattr(app_main, "RUN_MIGRATIONS_ON_STARTUP", True)
    with TestClient(app_main.app):
        pass
    assert calls == ["ran"]


def test_migrate_entry_point_is_idempotent(client):
    # The Compose `migrate` service runs this once before the API starts.
    migrate.main()
    migrate.main()
    assert client.get("/api/health").status_code == 200


def test_api_docs_live_under_the_proxied_prefix(client):
    assert client.get("/api/docs").status_code == 200
    assert client.get("/api/openapi.json").status_code == 200
    assert client.get("/docs").status_code == 404


# ---------------------------------------------------------------------------
# Container and Compose files
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def compose():
    with open(ROOT / "docker-compose.yml", encoding="utf-8") as compose_file:
        return yaml.safe_load(compose_file)


def test_compose_keeps_the_api_private_and_secrets_out_of_the_file(compose):
    backend = compose["services"]["backend"]
    assert "ports" not in backend
    assert list(compose["services"]["frontend"]["ports"]) == ["${FRONTEND_PORT:-8080}:8080"]
    assert "${POSTGRES_PASSWORD" in compose["services"]["db"]["environment"]["POSTGRES_PASSWORD"]
    assert "${POSTGRES_PASSWORD}" in backend["environment"]["DATABASE_URL"]
    assert ":rfq@" not in backend["environment"]["DATABASE_URL"]


def test_compose_migrates_once_before_the_api_starts(compose):
    services = compose["services"]
    assert services["migrate"]["command"] == ["python", "-m", "app.migrate"]
    assert services["backend"]["environment"]["RUN_MIGRATIONS_ON_STARTUP"] == "false"
    assert services["backend"]["depends_on"]["migrate"] == {
        "condition": "service_completed_successfully"
    }
    assert services["frontend"]["depends_on"]["backend"] == {"condition": "service_healthy"}


def test_env_example_lists_every_setting_the_stack_reads(compose):
    example = (ROOT / ".env.example").read_text(encoding="utf-8")
    for name in ("POSTGRES_PASSWORD", "FRONTEND_PORT", "CORS_ORIGINS",
                 "TRUSTED_PROXY_USER_HEADER"):
        assert f"{name}=" in example
    assert os.path.basename(str(ROOT / ".env")) in (ROOT / ".gitignore").read_text()


def test_containers_run_unprivileged_and_nginx_accepts_the_workbook():
    backend = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    assert "USER app" in backend
    assert "HEALTHCHECK" in backend
    frontend = (ROOT / "frontend" / "Dockerfile").read_text(encoding="utf-8")
    assert "nginx-unprivileged" in frontend
    nginx = (ROOT / "frontend" / "nginx.conf").read_text(encoding="utf-8")
    assert "listen 8080;" in nginx
    assert "client_max_body_size 25m;" in nginx
    assert "gzip on;" in nginx
    assert "immutable" in nginx
