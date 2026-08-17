"""Database engine and session management."""

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import DATABASE_URL

# Columns added after the initial release. create_all() only creates missing
# tables — it never alters existing ones — so each (table, column, ddl) entry
# here is applied with ADD COLUMN on startup when absent. DDL must use
# constant defaults so it works on both SQLite and PostgreSQL.
STARTUP_COLUMNS: list[tuple[str, str, str]] = [
    ("projects", "encrypted_money", "TEXT"),
    ("projects", "money_iv", "VARCHAR(64)"),
    ("projects", "status", "VARCHAR(16) NOT NULL DEFAULT 'draft'"),
    ("projects", "win_probability_pct", "FLOAT NOT NULL DEFAULT 50"),
    ("projects", "lost_reason", "VARCHAR(1000)"),
    ("projects", "base_project_id", "INTEGER"),
    ("projects", "is_winning_scenario", "BOOLEAN NOT NULL DEFAULT 0"),
]

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def run_startup_migrations(target_engine=None) -> None:
    """Add any missing STARTUP_COLUMNS to existing tables. Idempotent."""
    target = target_engine if target_engine is not None else engine
    inspector = inspect(target)
    tables = set(inspector.get_table_names())
    with target.begin() as conn:
        for table, column, ddl in STARTUP_COLUMNS:
            if table not in tables:
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
