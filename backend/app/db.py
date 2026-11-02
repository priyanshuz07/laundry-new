"""MongoDB (Motor) client, index management and collection accessors."""
from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, IndexModel

from .config import settings

_client: AsyncIOMotorClient | None = None


def connect() -> AsyncIOMotorDatabase:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(
            settings.mongodb_uri,
            tz_aware=True,
            serverSelectionTimeoutMS=8000,
            retryWrites=True,
            w="majority",  # durability: acknowledged writes survive failover
        )
    return _client[settings.mongodb_db]


def client() -> AsyncIOMotorClient:
    connect()
    assert _client is not None
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None


def db() -> AsyncIOMotorDatabase:
    return connect()


# --- collection helpers ----------------------------------------------------
def users():
    return db()["users"]


def customers():
    return db()["customers"]


def orders():
    return db()["orders"]


def payments():
    return db()["payment"]


def counters():
    return db()["counters"]


def outbox():
    """Audit log of every WhatsApp message we tried to send."""
    return db()["whatsapp_outbox"]


async def ensure_indexes() -> None:
    """Every query used by the API has an index here.

    Compounding order follows the ESR rule: Equality, Sort, Range.
    """
    existing_user_indexes = await users().index_information()
    phone_index = existing_user_indexes.get("uq_user_phone")
    if phone_index and not phone_index.get("sparse", False):
        await users().drop_index("uq_user_phone")

    await users().create_indexes(
        [
            IndexModel([("phone", ASCENDING)], unique=True, sparse=True, name="uq_user_phone"),
            IndexModel([("username", ASCENDING)], unique=True, sparse=True, name="uq_user_username"),
            IndexModel(
                [("role", ASCENDING)],
                unique=True,
                partialFilterExpression={"role": "admin"},
                name="uq_single_admin",
            ),
            IndexModel(
                [("email", ASCENDING)],
                unique=True,
                sparse=True,
                name="uq_user_email",
            ),
            IndexModel([("role", ASCENDING), ("is_active", ASCENDING)], name="ix_user_role_active"),
        ]
    )
    await customers().create_indexes(
        [
            IndexModel([("phone", ASCENDING)], unique=True, name="uq_customer_phone"),
            IndexModel([("name", ASCENDING)], name="ix_customer_name"),
            IndexModel([("created_at", DESCENDING)], name="ix_customer_created"),
        ]
    )
    await orders().create_indexes(
        [
            IndexModel([("order_no", ASCENDING)], unique=True, name="uq_order_no"),
            IndexModel([("public_token", ASCENDING)], unique=True, name="uq_order_token"),
            # order list filtered by status, newest first
            IndexModel([("status", ASCENDING), ("created_at", DESCENDING)], name="ix_order_status_created"),
            # customer history
            IndexModel([("customer_id", ASCENDING), ("created_at", DESCENDING)], name="ix_order_customer"),
            # daily/weekly/monthly money reports
            IndexModel([("created_at", DESCENDING), ("total_paise", ASCENDING)], name="ix_order_report"),
            # the 2-day reminder sweep
            IndexModel(
                [("status", ASCENDING), ("whatsapp.reminder_sent_at", ASCENDING), ("ready_at", ASCENDING)],
                name="ix_order_reminder",
            ),
        ]
    )
    await payments().create_indexes(
        [
            IndexModel([("payment_id", ASCENDING)], unique=True, name="uq_payment_id"),
            IndexModel([("order_id", ASCENDING), ("payment_date", DESCENDING)], name="ix_payment_order_date"),
        ]
    )
    await outbox().create_indexes(
        [IndexModel([("order_id", ASCENDING), ("kind", ASCENDING)], name="ix_outbox_order")]
    )
