"""WhatsApp delivery behind a provider interface.

`stub` provider records the message without contacting Meta, so the whole flow
can be exercised end to end without a WhatsApp Business account.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from ..config import settings
from ..db import outbox

log = logging.getLogger("lms.whatsapp")

READY_TEMPLATE = (
    "Namaste {name}, your laundry order {order_no} is ready for pickup/delivery. "
    "Total: Rs {total}. Thank you - {shop}."
)
REMINDER_TEMPLATE = (
    "Reminder: your laundry order {order_no} is still waiting at {shop}. "
    "Please collect it at your convenience. Total: Rs {total}."
)


def _rupees(paise: int) -> str:
    return f"{paise / 100:,.2f}"


async def send_message(phone: str, body: str, order_id: str, kind: str) -> dict:
    """Send one message and always record the attempt in the outbox."""
    phone = phone.strip()
    if phone and not phone.startswith("+"):
        # WhatsApp requires E.164. Assume India when no country code is set.
        phone = "+91" + phone.lstrip("0")

    status = "simulated"
    provider_id = None
    error = None

    if settings.whatsapp_provider == "meta":
        if not (settings.whatsapp_phone_id and settings.whatsapp_token):
            status, error = "failed", "WhatsApp credentials are not configured"
        else:
            url = (
                f"https://graph.facebook.com/{settings.whatsapp_api_version}/"
                f"{settings.whatsapp_phone_id}/messages"
            )
            payload = {
                "messaging_product": "whatsapp",
                "to": phone,
                "type": "text",
                "text": {"preview_url": False, "body": body},
            }
            headers = {"Authorization": f"Bearer {settings.whatsapp_token}"}
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code // 100 == 2:
                    data = resp.json()
                    status = "sent"
                    provider_id = (data.get("messages") or [{}])[0].get("id")
                else:
                    status = "failed"
                    error = f"{resp.status_code}: {resp.text[:300]}"
            except httpx.HTTPError as exc:  # network/timeout
                status, error = "failed", str(exc)

    record = {
        "order_id": order_id,
        "phone": phone,
        "kind": kind,
        "body": body,
        "status": status,
        "provider_id": provider_id,
        "error": error,
        "created_at": datetime.now(timezone.utc),
    }
    await outbox().insert_one(record)
    if status == "failed":
        log.warning("whatsapp %s failed for order %s: %s", kind, order_id, error)
    return record


def ready_body(name: str, order_no: str, total_paise: int) -> str:
    return READY_TEMPLATE.format(
        name=name, order_no=order_no, total=_rupees(total_paise), shop=settings.app_name
    )


def reminder_body(order_no: str, total_paise: int) -> str:
    return REMINDER_TEMPLATE.format(
        order_no=order_no, total=_rupees(total_paise), shop=settings.app_name
    )
