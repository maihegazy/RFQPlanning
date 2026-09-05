"""PostgreSQL-only regression coverage for upgrade migrations."""

import os
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import create_engine, inspect, text

from app.database import run_migrations


def _postgres_url() -> str:
    database_url = os.environ.get("TEST_POSTGRES_URL")
    if not database_url:
        pytest.skip("TEST_POSTGRES_URL is only configured in CI")
    return database_url


def _reset_schema(database_url: str) -> None:
    reset_engine = create_engine(database_url)
    try:
        with reset_engine.begin() as connection:
            connection.execute(text("DROP SCHEMA public CASCADE"))
            connection.execute(text("CREATE SCHEMA public"))
    finally:
        reset_engine.dispose()


def test_concurrent_startups_take_turns_migrating():
    """Three processes starting at once used to race on CREATE TABLE.

    The advisory lock makes the second and third wait for the first, after
    which they find the database at head and do nothing.
    """
    database_url = _postgres_url()
    _reset_schema(database_url)
    engines = [create_engine(database_url) for _ in range(3)]
    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(run_migrations, engines))  # raises if any worker failed
        with engines[0].connect() as connection:
            versions = connection.execute(text("SELECT version_num FROM alembic_version"))
            assert len(versions.fetchall()) == 1
        assert "projects" in inspect(engines[0]).get_table_names()
    finally:
        for upgrade_engine in engines:
            upgrade_engine.dispose()
        _reset_schema(database_url)


def test_legacy_projects_table_upgrades_with_scenario_constraints():
    database_url = _postgres_url()
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
