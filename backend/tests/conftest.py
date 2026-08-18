"""Shared backend API-test setup."""

import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:///./test_rfq.db"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as test_client:
        yield test_client
    Base.metadata.drop_all(bind=engine)
    if os.path.exists("./test_rfq.db"):
        os.remove("./test_rfq.db")
