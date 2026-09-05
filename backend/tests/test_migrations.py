"""Schema drift: the ORM models and the migration chain must describe one schema.

Two paths build a database. A fresh install runs the baseline revision, which
creates every table with `create_all`; an upgraded install reaches the same
revision through the hand-written DDL of the later revisions. Both are compared
against `Base.metadata` here, so a model change that forgets its migration (or a
migration that drifts from the model) fails CI instead of surfacing in production.
"""

from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app import models  # noqa: F401  (registers every table on Base.metadata)
from app.database import Base, run_migrations

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"
LAST_PRE_HW_REVISION = "20260819_0004"


def _drift(engine) -> list:
    with engine.connect() as connection:
        context = MigrationContext.configure(
            connection, opts={"compare_type": True, "compare_server_default": False}
        )
        return compare_metadata(context, Base.metadata)


@pytest.fixture
def sqlite_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'drift.db'}")
    try:
        yield engine
    finally:
        engine.dispose()


def test_fresh_database_matches_models(sqlite_engine):
    run_migrations(sqlite_engine)
    assert _drift(sqlite_engine) == []


def test_hand_written_ddl_matches_models(sqlite_engine):
    run_migrations(sqlite_engine)
    config = Config(str(ALEMBIC_INI))

    with sqlite_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, LAST_PRE_HW_REVISION)
    with sqlite_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")

    assert _drift(sqlite_engine) == []


def test_upgrade_is_idempotent(sqlite_engine):
    run_migrations(sqlite_engine)
    run_migrations(sqlite_engine)
    assert _drift(sqlite_engine) == []
