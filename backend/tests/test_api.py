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
}


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_login_rejects_bad_password(client):
    r = await client.post("/api/auth/login", json={"phone": "9000000001", "password": "wrong-pass"})
    assert r.status_code == 401


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

    r = await client.patch(f"/api/orders/{order['id']}/status", json={"status": "collected"}, headers=h)
    assert r.status_code == 200
    assert r.json()["balance_paise"] == 0


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
        json={"name": "Suresh", "phone": "9000000002", "password": "SubPass1234"},
        headers=h,
    )
    assert created.status_code == 201, created.text
    sub_id = created.json()["id"]

    login = await client.post("/api/auth/login", json={"phone": "9000000002", "password": "SubPass1234"})
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
    assert (await client.post("/api/auth/login", json={"phone": "9000000002", "password": "SubPass1234"})).status_code == 403


async def test_duplicate_phone_rejected(client, admin_token):
    h = auth(admin_token)
    await client.post("/api/users", json={"name": "Amit", "phone": "9000000003", "password": "Passw0rd123"}, headers=h)
    r = await client.post("/api/users", json={"name": "Balu", "phone": "9000000003", "password": "Passw0rd123"}, headers=h)
    assert r.status_code == 409


async def test_customer_reuse_by_phone(client, admin_token):
    h = auth(admin_token)
    await client.post("/api/orders", json=ORDER, headers=h)
    await client.post("/api/orders", json=ORDER, headers=h)
    customers = (await client.get("/api/customers", headers=h)).json()
    assert len(customers) == 1
    assert customers[0]["order_count"] == 2


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
