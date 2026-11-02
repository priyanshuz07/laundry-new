"""Unauthenticated order lookup used by the QR code."""
from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Request, status

from ..db import orders

router = APIRouter(prefix="/api/public", tags=["public"])

TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


@router.get("/orders/{token}")
async def public_order(token: str, request: Request) -> dict:
    """Return only what the customer needs: order number, name, items, status.

    No phone, address, price or payment data is exposed here.
    """
    if not TOKEN_RE.match(token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")

    doc = await orders().find_one({"public_token": token})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")

    items = [
        {
            "name": i["name"],
            "quality": i.get("quality", "normal"),
            "quantity": i["quantity"],
        }
        for i in doc.get("items", [])
    ]
    return {
        "order_no": doc["order_no"],
        "customer_name": doc["customer_name"],
        "status": doc["status"],
        "service_categories": doc.get("service_categories", []),
        "rack_number": doc.get("rack_number"),
        "items": items,
        "total_quantity": sum(i["quantity"] for i in items),
        "created_at": doc.get("created_at"),
    }
