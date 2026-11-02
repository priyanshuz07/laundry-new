"""Order lifecycle: create, list, status, payment, QR."""
from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from pymongo import ReturnDocument

from ..db import counters, orders
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
        items=doc["items"],
        subtotal_paise=doc["subtotal_paise"],
        discount_paise=doc["discount_paise"],
        total_paise=doc["total_paise"],
        paid_paise=doc["paid_paise"],
        balance_paise=doc["total_paise"] - doc["paid_paise"],
        payment_method=doc.get("payment_method", "cash"),
        status=doc["status"],
        note=doc.get("note", ""),
        created_at=doc.get("created_at"),
        ready_at=doc.get("ready_at"),
        collected_at=doc.get("collected_at"),
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
    except Exception as exc:  # duplicate order_no on extreme contention
        raise HTTPException(status.HTTP_409_CONFLICT, f"Could not allocate an order number: {exc}")
    doc["_id"] = res.inserted_id
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

    now = datetime.now(timezone.utc)
    update: dict = {"status": body.status, "updated_at": now}
    if body.status == "ready":
        update["ready_at"] = now
    if body.status == "collected":
        update["collected_at"] = now
        # Collection implies the customer took the clothes, so settle the balance.
        update["paid_paise"] = current["total_paise"]

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


@router.patch("/{order_id}/payment", response_model=OrderOut)
async def record_payment(
    order_id: str, body: PaymentIn, _: dict = Depends(require_staff)
) -> OrderOut:
    oid = _oid(order_id)
    current = await orders().find_one({"_id": oid})
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    if body.paid_paise > current["total_paise"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Payment exceeds the bill total")

    doc = await orders().find_one_and_update(
        {"_id": oid},
        {
            "$set": {
                "paid_paise": body.paid_paise,
                "updated_at": datetime.now(timezone.utc),
                "payment_method": "cash" if current.get("payment_method") == "unpaid" else current.get("payment_method"),
            },
            "$inc": {"version": 1},
        },
        return_document=ReturnDocument.AFTER,
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
