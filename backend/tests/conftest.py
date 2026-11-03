"""Test harness: the real app wired to an in-memory MongoDB."""
from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("JWT_SECRET", "test-secret-not-a-real-key")
os.environ.setdefault("BOOTSTRAP_ADMIN_PHONE", "9000000001")
os.environ.setdefault("BOOTSTRAP_ADMIN_PASSWORD", "AdminPass123")
os.environ.setdefault("WHATSAPP_PROVIDER", "stub")
os.environ.setdefault("PUBLIC_BASE_URL", "http://testserver")
os.environ["MONGODB_URI"] = "mongodb+srv://test-user:test-password@cluster0.example.mongodb.net/"
os.environ["DB_NAME"] = "laundryDB"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

from app import db  # noqa: E402
from app.config import settings  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402
from app.security import hash_password  # noqa: E402

import datetime as dt  # noqa: E402


@pytest_asyncio.fixture
async def client(monkeypatch):
    mock = AsyncMongoMockClient()
    monkeypatch.setattr(db, "_client", mock)
    await db.ensure_indexes()

    now = dt.datetime.now(dt.timezone.utc)
    await db.users().insert_one(
        {
            "name": "Owner",
            "phone": "9000000001",
            "password_hash": hash_password("AdminPass123"),
            "role": "admin",
            "is_active": True,
            "created_at": now,
        }
    )
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


@pytest_asyncio.fixture
async def admin_token(client):
    r = await client.post("/api/auth/login", json={"phone": "9000000001", "password": "AdminPass123"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _quiet_settings():
    settings.whatsapp_provider = "stub"
    yield
