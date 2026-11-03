"""End-to-end API tests against an in-memory MongoDB."""
import pytest

from .conftest import auth

pytestmark = pytest.mark.asyncio

ORDER = {
    "customer": {"name": "Ramesh Patil", "phone": "9876543210", "address": "Kothrud, Pune"},
    "items": [
        {"name": "Shirt", "category": "shirt", "quality": "normal", "quantity": 3, "unit_price_paise": 2000},
        {"name": "Blanket", "category": "blanket", "quality": "premium", "quantity": 1, "unit_price_paise": 12000},
    ],
    "discount_paise": 1000,
    "paid_paise": 5000,
    "payment_method": "cash",
    "service_categories": ["wash", "press"],
    "rack_number": 4,
}


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_db_test_reports_configured_database(client):
    response = await client.get("/api/db-test")
    assert response.status_code == 200
    assert response.json() == {
        "status": "success",
        "message": "MongoDB Atlas connected successfully",
    }


async def test_db_test_rejects_non_atlas_configuration(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "mongodb_uri", "mongodb://localhost:27017/")
    response = await client.get("/api/db-test")
    assert response.status_code == 503
    assert response.json() == {
        "status": "error",
        "message": "MongoDB Atlas is not configured",
    }


async def test_db_test_hides_connection_error_details(client, monkeypatch):
    from app import main
    from pymongo.errors import ServerSelectionTimeoutError

    class UnavailableDatabase:
        async def command(self, command):
            raise ServerSelectionTimeoutError("connection detail must not be returned")

    class UnavailableCollection:
        database = UnavailableDatabase()

    monkeypatch.setattr(main, "users", lambda: UnavailableCollection())
    response = await client.get("/api/db-test")
    assert response.status_code == 503
    assert response.json() == {
        "status": "error",
        "message": "MongoDB Atlas connection failed",
    }
    assert "connection detail" not in response.text


async def test_login_rejects_bad_password(client):
    r = await client.post("/api/auth/login", json={"phone": "9000000001", "password": "wrong-pass"})
    assert r.status_code == 401


async def test_first_registration_creates_admin_only(client):
    from app.db import users

    await users().delete_many({})
    body = {
        "name": "First Owner",
        "email": "owner@example.test",
        "phone": "9123456789",
        "password": "OwnerPass123",
    }
    registered = await client.post("/api/auth/register", json=body)
    assert registered.status_code == 201
    assert registered.json()["role"] == "admin"
    assert (
        await client.post(
            "/api/auth/login",
            json={"identifier": "owner@example.test", "password": "OwnerPass123"},
        )
    ).status_code == 200
    assert (await client.post("/api/auth/register", json={**body, "email": "another@example.test"})).status_code == 409


async def test_order_creation_computes_server_side_total(client, admin_token):
    r = await client.post("/api/orders", json=ORDER, headers=auth(admin_token))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["subtotal_paise"] == 18000
    assert body["total_paise"] == 17000
    assert body["balance_paise"] == 12000
    assert body["order_no"].startswith("LMS-")
    assert body["status"] == "in_process"
    assert body["customer_phone"] == "9876543210"
    assert body["service_categories"] == ["wash", "press"]
    assert body["rack_number"] == 4
    from app import db

    initial_payment = await db.payments().find_one({"order_id": body["id"], "payment_status": "recorded"})
    assert initial_payment["amount_paise"] == 5000


async def test_order_numbers_increment(client, admin_token):
    first = (await client.post("/api/orders", json=ORDER, headers=auth(admin_token))).json()
    second = (await client.post("/api/orders", json=ORDER, headers=auth(admin_token))).json()
    assert first["order_no"] != second["order_no"]
    assert int(second["order_no"].split("-")[-1]) == int(first["order_no"].split("-")[-1]) + 1


async def test_status_lifecycle_and_whatsapp_on_ready(client, admin_token):
    order = (await client.post("/api/orders", json=ORDER, headers=auth(admin_token))).json()
    h = auth(admin_token)

    r = await client.patch(f"/api/orders/{order['id']}/status", json={"status": "ready"}, headers=h)
    assert r.status_code == 200
    assert r.json()["status"] == "ready"
    assert r.json()["ready_at"] is not None

    from app import db

    msgs = await db.outbox().find({}).to_list(length=10)
    assert any(m["kind"] == "ready" for m in msgs), "ready notification was not queued"

    # cannot go backwards
    r = await client.patch(f"/api/orders/{order['id']}/status", json={"status": "in_process"}, headers=h)
    assert r.status_code == 409

    r = await client.post(f"/api/orders/{order['id']}/deliver", headers=h)
    assert r.status_code == 409

    payment = await client.patch(
        f"/api/orders/{order['id']}/payment",
        json={"amount_paise": 12000, "payment_method": "upi"},
        headers=h,
    )
    assert payment.status_code == 200
    assert payment.json()["balance_paise"] == 0
    delivered = await client.post(f"/api/orders/{order['id']}/deliver", headers=h)
    assert delivered.status_code == 200
    assert delivered.json()["status"] == "delivered"
    assert delivered.json()["delivered_at"] is not None
    assert (await client.post(f"/api/orders/{order['id']}/deliver", headers=h)).status_code == 409

    from app import db

    recorded = await db.payments().find(
        {"order_id": order["id"], "payment_status": "recorded"}
    ).to_list(length=10)
    assert any(payment["amount_paise"] == 12000 and payment["payment_method"] == "upi" for payment in recorded)


async def test_invalid_transition_rejected(client, admin_token):
    order = (await client.post("/api/orders", json=ORDER, headers=auth(admin_token))).json()
    r = await client.patch(
        f"/api/orders/{order['id']}/status", json={"status": "collected"}, headers=auth(admin_token)
    )
    assert r.status_code == 409


async def test_qr_and_public_lookup_hides_private_data(client, admin_token):
    order = (await client.post("/api/orders", json=ORDER, headers=auth(admin_token))).json()
    h = auth(admin_token)

    qr = (await client.get(f"/api/orders/{order['id']}/qr", headers=h)).json()
    assert qr["url"].startswith("http://testserver/o/")
    assert qr["data_url"].startswith("data:image/png;base64,")

    png = await client.get(f"/api/orders/{order['id']}/qr.png", headers=h)
    assert png.status_code == 200
    assert png.headers["content-type"] == "image/png"

    public = await client.get(f"/api/public/orders/{order['public_token']}")
    assert public.status_code == 200
    payload = public.json()
    assert payload["order_no"] == order["order_no"]
    assert payload["total_quantity"] == 4
    assert "customer_phone" not in payload
    assert "total_paise" not in payload

    assert (await client.get("/api/public/orders/not-a-real-token-at-all-xx")).status_code == 404


async def test_subadmin_permissions_and_deactivation(client, admin_token):
    h = auth(admin_token)
    created = await client.post(
        "/api/users",
        json={"name": "Suresh", "username": "suresh", "phone": "9000000002", "password": "SubPass1234"},
        headers=h,
    )
    assert created.status_code == 201, created.text
    sub_id = created.json()["id"]

    login = await client.post("/api/auth/login", json={"identifier": "suresh", "password": "SubPass1234"})
    assert login.status_code == 200
    sub_h = auth(login.json()["access_token"])

    # sub-admin can run the shop floor
    assert (await client.post("/api/orders", json=ORDER, headers=sub_h)).status_code == 201
    assert (await client.get("/api/customers", headers=sub_h)).status_code == 200

    # ...but not reports or staff management
    assert (await client.get("/api/reports/money", headers=sub_h)).status_code == 403
    assert (await client.get("/api/users", headers=sub_h)).status_code == 403

    # deactivation takes effect immediately for an already-issued token
    r = await client.patch(f"/api/users/{sub_id}/active?active=false", headers=h)
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert (await client.get("/api/customers", headers=sub_h)).status_code == 403
    assert (await client.post("/api/auth/login", json={"identifier": "suresh", "password": "SubPass1234"})).status_code == 403
    r = await client.patch(f"/api/users/{sub_id}/active?active=true", headers=h)
    assert r.status_code == 200 and r.json()["is_active"] is True
    assert (await client.post("/api/auth/login", json={"identifier": "suresh", "password": "SubPass1234"})).status_code == 200


async def test_duplicate_phone_rejected(client, admin_token):
    h = auth(admin_token)
    await client.post("/api/users", json={"name": "Amit", "username": "amit", "phone": "9000000003", "password": "Passw0rd123"}, headers=h)
    r = await client.post("/api/users", json={"name": "Balu", "username": "balu", "phone": "9000000003", "password": "Passw0rd123"}, headers=h)
    assert r.status_code == 409


async def test_duplicate_subadmin_id_rejected(client, admin_token):
    h = auth(admin_token)
    body = {"name": "Amit", "username": "shop.user", "password": "Passw0rd123"}
    assert (await client.post("/api/users", json=body, headers=h)).status_code == 201
    duplicate = await client.post(
        "/api/users",
        json={**body, "name": "Another User"},
        headers=h,
    )
    assert duplicate.status_code == 409


async def test_pending_payment_list_excludes_settled_orders(client, admin_token):
    headers = auth(admin_token)
    pending = (await client.post("/api/orders", json=ORDER, headers=headers)).json()
    settled_input = {**ORDER, "paid_paise": 17000}
    settled = (await client.post("/api/orders", json=settled_input, headers=headers)).json()

    response = await client.get("/api/orders/pending-payments", headers=headers)
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [pending["id"]]

    payment = await client.patch(
        f"/api/orders/{pending['id']}/payment",
        json={"amount_paise": 12000, "payment_method": "cash"},
        headers=headers,
    )
    assert payment.status_code == 200
    assert payment.json()["balance_paise"] == 0
    response = await client.get("/api/orders/pending-payments", headers=headers)
    assert response.json() == []
    assert settled["balance_paise"] == 0


async def test_subadmin_cannot_manage_accounts(client, admin_token):
    h = auth(admin_token)
    created = await client.post(
        "/api/users",
        json={"name": "Suresh", "username": "suresh", "password": "SubPass1234"},
        headers=h,
    )
    token = (
        await client.post(
            "/api/auth/login",
            json={"identifier": "suresh", "password": "SubPass1234"},
        )
    ).json()["access_token"]
    sub_h = auth(token)
    assert (await client.post("/api/users", json={"name": "Other", "username": "other", "password": "OtherPass123"}, headers=sub_h)).status_code == 403
    assert (await client.patch(f"/api/users/{created.json()['id']}/active?active=false", headers=sub_h)).status_code == 403


async def test_customer_reuse_by_phone(client, admin_token):
    h = auth(admin_token)
    await client.post("/api/orders", json=ORDER, headers=h)
    await client.post("/api/orders", json=ORDER, headers=h)
    customers = (await client.get("/api/customers", headers=h)).json()
    assert len(customers) == 1
    assert customers[0]["order_count"] == 2


async def test_customer_crud_and_delete_protection(client, admin_token):
    headers = auth(admin_token)
    created = await client.post(
        "/api/customers",
        json={"name": "Customer One", "phone": "9123456789", "address": "Old address"},
        headers=headers,
    )
    assert created.status_code == 201
    customer_id = created.json()["id"]

    fetched = await client.get(f"/api/customers/{customer_id}", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "Customer One"

    updated = await client.put(
        f"/api/customers/{customer_id}",
        json={"name": "Customer Updated", "phone": "9123456789", "address": "New address"},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["address"] == "New address"

    deleted = await client.delete(f"/api/customers/{customer_id}", headers=headers)
    assert deleted.status_code == 204
    assert (await client.get(f"/api/customers/{customer_id}", headers=headers)).status_code == 404

    order = (await client.post("/api/orders", json=ORDER, headers=headers)).json()
    protected = await client.delete(f"/api/customers/{order['customer_id']}", headers=headers)
    assert protected.status_code == 409


async def test_reminder_cron_requires_secret(client, monkeypatch):
    from app import main
    from app.config import settings

    async def send_reminders():
        return 2

    monkeypatch.setattr(settings, "cron_secret", "test-cron-secret")
    monkeypatch.setattr(main, "send_due_reminders", send_reminders)

    unauthorized = await client.get("/api/cron/reminders")
    assert unauthorized.status_code == 401

    authorized = await client.get(
        "/api/cron/reminders",
        headers={"Authorization": "Bearer test-cron-secret"},
    )
    assert authorized.status_code == 200
    assert authorized.json() == {"sent": 2}


async def test_reports_aggregate_revenue(client, admin_token):
    h = auth(admin_token)
    await client.post("/api/orders", json=ORDER, headers=h)
    await client.post("/api/orders", json=ORDER, headers=h)

    r = await client.get("/api/reports/money?granularity=day&days=7", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["totals"]["order_count"] == 2
    assert body["totals"]["revenue_paise"] == 34000
    assert body["totals"]["collected_paise"] == 10000

    dash = (await client.get("/api/reports/dashboard", headers=h)).json()
    assert dash["open_orders"]["in_process"] == 2


async def test_reminder_sent_once_for_stale_ready_order(client, admin_token):
    import datetime as dt

    from app import db
    from app.services.reminders import send_due_reminders

    order = (await client.post("/api/orders", json=ORDER, headers=auth(admin_token))).json()
    old = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)
    await db.orders().update_one(
        {"order_no": order["order_no"]},
        {"$set": {"status": "ready", "ready_at": old}},
    )

    assert await send_due_reminders() == 1
    assert await send_due_reminders() == 0, "reminder must not repeat"

    reminders = await db.outbox().find({"kind": "reminder"}).to_list(length=10)
    assert len(reminders) == 1


async def test_reminder_skips_collected_order(client, admin_token):
    import datetime as dt

    from app import db
    from app.services.reminders import send_due_reminders

    order = (await client.post("/api/orders", json=ORDER, headers=auth(admin_token))).json()
    old = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=5)
    await db.orders().update_one(
        {"order_no": order["order_no"]},
        {"$set": {"status": "ready", "ready_at": old, "collected_at": old}},
    )
    assert await send_due_reminders() == 0
