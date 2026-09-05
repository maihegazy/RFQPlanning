"""Database engine, migrations, and session management."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import DATABASE_URL

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def enable_sqlite_foreign_keys(target_engine) -> None:
    """Make SQLite honour ON DELETE CASCADE / SET NULL the way PostgreSQL does.

    SQLite ships with foreign-key enforcement off. Without this, a deleted base
    project leaves its scenarios behind and a deleted catalog entry leaves a
    dangling id on every row that pointed at it: behaviour production never shows,
    which is exactly why the tests could not catch it.
    """
    if target_engine.dialect.name != "sqlite":
        return

    @event.listens_for(target_engine, "connect")
    def _enforce_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


enable_sqlite_foreign_keys(engine)


class Base(DeclarativeBase):
    pass


def _set_sqlite_foreign_keys(connection, enabled: bool) -> None:
    """Toggle enforcement on the raw DBAPI connection, outside any transaction.

    `PRAGMA foreign_keys` is a no-op inside a transaction, and SQLAlchemy begins one
    as soon as the Connection executes anything, so the pragma goes to the DBAPI
    connection directly.
    """
    if connection.dialect.name != "sqlite":
        return
    connection.connection.dbapi_connection.execute(
        "PRAGMA foreign_keys=" + ("ON" if enabled else "OFF")
    )


def run_migrations(target_engine=None) -> None:
    """Upgrade the configured database to the latest Alembic revision."""
    target = target_engine if target_engine is not None else engine
    with target.connect() as connection:
        # Alembic's batch operations rebuild a table by dropping and recreating it;
        # with enforcement on, SQLite would cascade that drop into the child tables.
        _set_sqlite_foreign_keys(connection, enabled=False)
        try:
            with connection.begin():
                config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
                config.attributes["connection"] = connection
                command.upgrade(config, "head")
        finally:
            _set_sqlite_foreign_keys(connection, enabled=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
