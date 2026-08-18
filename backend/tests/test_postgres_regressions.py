"""PostgreSQL-only regression coverage for upgrade migrations."""

import os

import pytest
from sqlalchemy import create_engine, inspect, text

from app.database import run_migrations


def test_legacy_projects_table_upgrades_with_scenario_constraints():
    database_url = os.environ.get("TEST_POSTGRES_URL")
    if not database_url:
        pytest.skip("TEST_POSTGRES_URL is only configured in CI")

    upgrade_engine = create_engine(database_url)
    try:
        with upgrade_engine.begin() as connection:
            connection.execute(text("DROP TABLE IF EXISTS projects CASCADE"))
            connection.execute(text(
                "CREATE TABLE projects (id SERIAL PRIMARY KEY, name VARCHAR(255))"
            ))

        run_migrations(upgrade_engine)

        inspector = inspect(upgrade_engine)
        columns = {column["name"] for column in inspector.get_columns("projects")}
        assert "is_winning_scenario" in columns
        assert any(
            foreign_key.get("referred_table") == "projects"
            and foreign_key.get("constrained_columns") == ["base_project_id"]
            for foreign_key in inspector.get_foreign_keys("projects")
        )
        assert inspector.get_table_names().count("alembic_version") == 1
    finally:
        with upgrade_engine.begin() as connection:
            connection.execute(text("DROP TABLE IF EXISTS projects CASCADE"))
        upgrade_engine.dispose()
