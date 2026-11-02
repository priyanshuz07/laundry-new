"""Customer registry. Shared by admin and active sub-admins."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pymongo import ReturnDocument

from ..db import customers, orders
from ..deps import require_staff
from ..models import CustomerIn, CustomerOut

router = APIRouter(prefix="/api/customers", tags=["customers"])


def _out(doc: dict, order_count: int = 0) -> CustomerOut:
    return CustomerOut(
        id=str(doc["_id"]),
        name=doc["name"],
        phone=doc["phone"],
        address=doc.get("address", ""),
        notes=doc.get("notes", ""),
        created_at=doc.get("created_at"),
        order_count=order_count,
    )


async def upsert_customer(data: CustomerIn, *, allow_update: bool = True) -> dict:
    """Find by phone, else create. Phone is the customer's natural key in a shop."""
    now = datetime.now(timezone.utc)
    existing = await customers().find_one({"phone": data.phone})
    if existing:
        if allow_update:
            await customers().update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "name": data.name.strip(),
                        "address": data.address.strip(),
                        "updated_at": now,
                    }
                },
            )
            existing.update({"name": data.name.strip(), "address": data.address.strip()})
        return existing

    doc = {
        "name": data.name.strip(),
        "phone": data.phone,
        "address": data.address.strip(),
        "notes": data.notes.strip(),
        "created_at": now,
        "updated_at": now,
    }
    res = await customers().insert_one(doc)
    doc["_id"] = res.inserted_id
    return doc


@router.get("", response_model=list[CustomerOut])
async def list_customers(
    q: str = Query(default="", max_length=60),
    limit: int = Query(default=50, ge=1, le=200),
    _: dict = Depends(require_staff),
) -> list[CustomerOut]:
    query: dict = {}
    if q.strip():
        needle = re.escape(q.strip())
        query = {"$or": [{"name": {"$regex": needle, "$options": "i"}}, {"phone": {"$regex": needle}}]}
    docs = await customers().find(query).sort("created_at", -1).limit(limit).to_list(length=limit)
    if not docs:
        return []

    ids = [d["_id"] for d in docs]
    counts = {
        row["_id"]: row["count"]
        async for row in orders().aggregate(
            [
                {"$match": {"customer_id": {"$in": [str(i) for i in ids]}}},
                {"$group": {"_id": "$customer_id", "count": {"$sum": 1}}},
            ]
        )
    }
    return [_out(d, counts.get(str(d["_id"]), 0)) for d in docs]


@router.post("", response_model=CustomerOut, status_code=status.HTTP_201_CREATED)
async def save_customer(body: CustomerIn, _: dict = Depends(require_staff)) -> CustomerOut:
    doc = await upsert_customer(body)
    return _out(doc, await orders().count_documents({"customer_id": str(doc["_id"])}))


@router.get("/{customer_id}", response_model=CustomerOut)
async def get_customer(customer_id: str, _: dict = Depends(require_staff)) -> CustomerOut:
    try:
        oid = ObjectId(customer_id)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid id")
    doc = await customers().find_one({"_id": oid})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    count = await orders().count_documents({"customer_id": customer_id})
    return _out(doc, count)


@router.put("/{customer_id}", response_model=CustomerOut)
async def update_customer(
    customer_id: str, body: CustomerIn, _: dict = Depends(require_staff)
) -> CustomerOut:
    try:
        oid = ObjectId(customer_id)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid id")

    clash = await customers().find_one({"phone": body.phone, "_id": {"$ne": oid}})
    if clash:
        raise HTTPException(status.HTTP_409_CONFLICT, "Phone number belongs to another customer")

    res = await customers().find_one_and_update(
        {"_id": oid},
        {
            "$set": {
                "name": body.name.strip(),
                "phone": body.phone,
                "address": body.address.strip(),
                "notes": body.notes.strip(),
                "updated_at": datetime.now(timezone.utc),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if res is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    count = await orders().count_documents({"customer_id": customer_id})
    return _out(res, count)
