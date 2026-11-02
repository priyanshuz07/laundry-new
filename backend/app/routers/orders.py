"""Order lifecycle: create, list, status, payment, QR."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..db import counters, orders, payments
from ..deps import require_staff
from ..models import (
    OrderCreateIn,
    OrderListOut,
    OrderOut,
    OrderStatusIn,
    PaymentIn,
    QrOut,
)
from ..money import compute_bill
from ..services import qr as qr_service
from ..services.whatsapp import ready_body, send_message
from .customers import upsert_customer

router = APIRouter(prefix="/api/orders", tags=["orders"])

# Forward-only lifecycle. Money already taken is handled separately.
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "in_process": {"done", "ready"},
    "done": {"ready"},
    "ready": {"collected"},
    "collected": set(),
    "delivered": set(),
}

CATALOGUE = [
    {"key": "shirt", "label": {"en": "Shirt", "mr": "शर्ट", "hi": "शर्ट"}, "price_paise": 2000},
    {"key": "pant", "label": {"en": "Trouser", "mr": "पँट", "hi": "पैंट"}, "price_paise": 3000},
    {"key": "saree", "label": {"en": "Saree", "mr": "साडी", "hi": "साड़ी"}, "price_paise": 7000},
    {"key": "kurta", "label": {"en": "Kurta", "mr": "कुर्ता", "hi": "कुर्ता"}, "price_paise": 2500},
    {"key": "bedsheet", "label": {"en": "Bedsheet", "mr": "चादर", "hi": "चादर"}, "price_paise": 5000},
    {"key": "blanket", "label": {"en": "Blanket", "mr": "पांघरूण", "hi": "कंबल"}, "price_paise": 12000},
    {"key": "jacket", "label": {"en": "Jacket", "mr": "जॅकेट", "hi": "जैकेट"}, "price_paise": 8000},
    {"key": "custom", "label": {"en": "Custom item", "mr": "इतर वस्तू", "hi": "अन्य वस्तु"}, "price_paise": 0},
]


def _oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid id")


def _order_out(doc: dict) -> OrderOut:
    return OrderOut(
        id=str(doc["_id"]),
        order_no=doc["order_no"],
        public_token=doc["public_token"],
        customer_id=doc["customer_id"],
        customer_name=doc["customer_name"],
        customer_phone=doc["customer_phone"],
        customer_address=doc.get("customer_address", ""),
        service_categories=doc.get("service_categories", []),
        rack_number=doc.get("rack_number"),
        items=doc["items"],
        subtotal_paise=doc["subtotal_paise"],
        discount_paise=doc["discount_paise"],
        total_paise=doc["total_paise"],
        paid_paise=doc.get("paid_paise", 0),
        balance_paise=max(0, doc["total_paise"] - doc.get("paid_paise", 0)),
        payment_method=doc.get("payment_method", "cash"),
        status=doc["status"],
        note=doc.get("note", ""),
        created_at=doc.get("created_at"),
        ready_at=doc.get("ready_at"),
        collected_at=doc.get("collected_at"),
        delivered_at=doc.get("delivered_at"),
        created_by_name=doc.get("created_by_name", ""),
    )


async def next_order_no(now: datetime) -> str:
    """Atomic per-month sequence - never count() the collection."""
    key = f"order:{now:%y%m}"
    doc = await counters().find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return f"LMS-{now:%y%m}-{doc['seq']:04d}"


@router.get("/catalogue")
async def get_catalogue(_: dict = Depends(require_staff)) -> dict:
    return {"items": CATALOGUE, "qualities": ["normal", "premium", "delicate"]}


@router.post("", response_model=OrderOut, status_code=201)
async def create_order(body: OrderCreateIn, user: dict = Depends(require_staff)) -> OrderOut:
    try:
        bill = compute_bill(body.items, body.discount_paise, body.paid_paise)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    if body.paid_paise > bill["total_paise"]:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Paid amount cannot exceed the order total",
        )

    customer = await upsert_customer(body.customer)
    now = datetime.now(timezone.utc)
    order_no = await next_order_no(now)

    doc = {
        "order_no": order_no,
        "public_token": qr_service.new_public_token(),
        "customer_id": str(customer["_id"]),
        "customer_name": customer["name"],
        "customer_phone": customer["phone"],
        "customer_address": customer.get("address", ""),
        "service_categories": body.service_categories,
        "rack_number": body.rack_number,
        **bill,
        "payment_method": body.payment_method,
        "status": "in_process",
        "note": body.note.strip(),
        "whatsapp": {"ready_sent_at": None, "reminder_sent_at": None},
        "ready_at": None,
        "collected_at": None,
        "created_at": now,
        "updated_at": now,
        "created_by": str(user["_id"]),
        "created_by_name": user["name"],
        "version": 0,
    }
    try:
        res = await orders().insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The order number was already used. Please try again.",
        )
    doc["_id"] = res.inserted_id
    if body.paid_paise > 0:
        await payments().insert_one(
            {
                "payment_id": str(uuid4()),
                "order_id": str(res.inserted_id),
                "order_no": order_no,
                "customer_id": str(customer["_id"]),
                "amount_paise": body.paid_paise,
                "payment_method": body.payment_method,
                "payment_status": "recorded",
                "transaction_reference": None,
                "payment_date": now,
                "recorded_by": str(user["_id"]),
                "recorded_by_name": user["name"],
            }
        )
    return _order_out(doc)


@router.get("", response_model=OrderListOut)
async def list_orders(
    status_filter: str = Query(default="", alias="status"),
    q: str = Query(default="", max_length=60),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    _: dict = Depends(require_staff),
) -> OrderListOut:
    query: dict = {}
    if status_filter:
        query["status"] = status_filter
    if q.strip():
        needle = q.strip()
        query["$or"] = [
            {"order_no": {"$regex": f"^{needle}", "$options": "i"}},
            {"customer_name": {"$regex": needle, "$options": "i"}},
            {"customer_phone": {"$regex": needle}},
        ]

    total = await orders().count_documents(query)
    cursor = (
        orders()
        .find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    docs = await cursor.to_list(length=page_size)
    return OrderListOut(
        items=[_order_out(d) for d in docs], total=total, page=page, page_size=page_size
    )


@router.get("/pending-payments", response_model=list[OrderOut])
async def pending_payments(_: dict = Depends(require_staff)) -> list[OrderOut]:
    cursor = (
        orders()
        .find(
            {
                "$expr": {
                    "$lt": [
                        {"$ifNull": ["$paid_paise", 0]},
                        {"$ifNull": ["$total_paise", 0]},
                    ]
                }
            }
        )
        .sort("created_at", -1)
        .limit(5000)
    )
    return [_order_out(doc) async for doc in cursor]


@router.get("/{order_id}", response_model=OrderOut)
async def get_order(order_id: str, _: dict = Depends(require_staff)) -> OrderOut:
    doc = await orders().find_one({"_id": _oid(order_id)})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return _order_out(doc)


async def _notify_ready(order: dict) -> None:
    """Send the 'ready' WhatsApp message once, claiming the flag atomically."""
    claimed = await orders().find_one_and_update(
        {"_id": order["_id"], "whatsapp.ready_sent_at": None},
        {"$set": {"whatsapp.ready_sent_at": datetime.now(timezone.utc)}},
        return_document=ReturnDocument.AFTER,
    )
    if claimed is None:
        return
    await send_message(
        claimed.get("customer_phone", ""),
        ready_body(claimed["customer_name"], claimed["order_no"], claimed["total_paise"]),
        str(claimed["_id"]),
        "ready",
    )


@router.patch("/{order_id}/status", response_model=OrderOut)
async def update_status(
    order_id: str,
    body: OrderStatusIn,
    background: BackgroundTasks,
    _: dict = Depends(require_staff),
) -> OrderOut:
    oid = _oid(order_id)
    current = await orders().find_one({"_id": oid})
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    if body.status == current["status"]:
        return _order_out(current)
    if body.status not in ALLOWED_TRANSITIONS.get(current["status"], set()):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Cannot move an order from {current['status']} to {body.status}",
        )
    if body.status == "collected" and current.get("paid_paise", 0) < current["total_paise"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Complete the payment before collecting the order",
        )

    now = datetime.now(timezone.utc)
    update: dict = {"status": body.status, "updated_at": now}
    if body.status == "ready":
        update["ready_at"] = now
    if body.status == "collected":
        update["collected_at"] = now
    if body.status == "delivered":
        update["delivered_at"] = now

    doc = await orders().find_one_and_update(
        {"_id": oid, "status": current["status"]},  # optimistic concurrency on status
        {"$set": update, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Order changed meanwhile, please reload")

    if body.status == "ready":
        background.add_task(_notify_ready, doc)
    return _order_out(doc)


@router.post("/{order_id}/deliver", response_model=OrderOut)
async def deliver_order(order_id: str, _: dict = Depends(require_staff)) -> OrderOut:
    oid = _oid(order_id)
    current = await orders().find_one({"_id": oid})
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    if current["status"] == "delivered":
        raise HTTPException(status.HTTP_409_CONFLICT, "This order has already been delivered")
    if current["status"] != "ready":
        raise HTTPException(status.HTTP_409_CONFLICT, "The order must be ready for pickup before delivery")
    if current.get("paid_paise", 0) != current["total_paise"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "Complete the payment before delivering the order")

    now = datetime.now(timezone.utc)
    doc = await orders().find_one_and_update(
        {
            "_id": oid,
            "status": "ready",
            "paid_paise": current["total_paise"],
        },
        {"$set": {"status": "delivered", "delivered_at": now, "updated_at": now}, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Order changed meanwhile, please reload")
    return _order_out(doc)


@router.patch("/{order_id}/payment", response_model=OrderOut)
async def record_payment(order_id: str, body: PaymentIn, user: dict = Depends(require_staff)) -> OrderOut:
    oid = _oid(order_id)
    current = await orders().find_one({"_id": oid})
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    paid = current.get("paid_paise", 0)
    if body.amount_paise > current["total_paise"] - paid:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Payment cannot exceed the outstanding balance",
        )

    now = datetime.now(timezone.utc)
    payment_id = str(uuid4())
    payment_doc = {
        "payment_id": payment_id,
        "order_id": str(oid),
        "order_no": current["order_no"],
        "customer_id": current["customer_id"],
        "amount_paise": body.amount_paise,
        "payment_method": body.payment_method,
        "payment_status": "pending",
        "transaction_reference": None,
        "payment_date": now,
        "recorded_by": str(user["_id"]),
        "recorded_by_name": user["name"],
    }
    await payments().insert_one(payment_doc)
    doc = await orders().find_one_and_update(
        {
            "_id": oid,
            "paid_paise": paid,
            "total_paise": {"$gte": paid + body.amount_paise},
        },
        {
            "$set": {
                "paid_paise": paid + body.amount_paise,
                "updated_at": now,
                "payment_method": body.payment_method,
            },
            "$inc": {"version": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        await payments().update_one(
            {"payment_id": payment_id},
            {"$set": {"payment_status": "rejected"}},
        )
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The order balance changed. Reload the order and try again.",
        )
    await payments().update_one(
        {"payment_id": payment_id},
        {"$set": {"payment_status": "recorded"}},
    )
    return _order_out(doc)


@router.get("/{order_id}/qr", response_model=QrOut)
async def get_qr(order_id: str, _: dict = Depends(require_staff)) -> QrOut:
    doc = await orders().find_one({"_id": _oid(order_id)})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    token = doc["public_token"]
    return QrOut(
        order_no=doc["order_no"],
        url=qr_service.public_url(token),
        data_url=qr_service.qr_data_url(token),
    )


@router.get("/{order_id}/qr.png")
async def get_qr_png(order_id: str, _: dict = Depends(require_staff)) -> Response:
    doc = await orders().find_one({"_id": _oid(order_id)})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    png = qr_service.qr_png_bytes(qr_service.public_url(doc["public_token"]))
    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": f'inline; filename="{doc["order_no"]}.png"'},
    )
