"""Scheduled WhatsApp reminder for orders not collected after N days."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from ..config import settings
from ..db import orders
from .whatsapp import reminder_body, send_message

log = logging.getLogger("lms.reminders")

_scheduler: AsyncIOScheduler | None = None
BATCH_LIMIT = 200


async def send_due_reminders(now: datetime | None = None) -> int:
    """Send one reminder per uncollected order that became ready > N days ago.

    Exactly-once-ish: each order is claimed with an atomic conditional update
    before the network call, so two workers (or a retry) cannot double-send.
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=settings.reminder_after_days)
    sent = 0

    query = {
        "status": "ready",
        "collected_at": None,
        "ready_at": {"$lte": cutoff},
        "whatsapp.reminder_sent_at": None,
    }

    async for order in orders().find(query).limit(BATCH_LIMIT):
        claim = await orders().update_one(
            {"_id": order["_id"], "whatsapp.reminder_sent_at": None},
            {
                "$set": {
                    "whatsapp.reminder_sent_at": now,
                    "updated_at": now,
                },
                "$inc": {"version": 1},
            },
        )
        if claim.modified_count != 1:
            continue  # someone else claimed it

        await send_message(
            order.get("customer_phone", ""),
            reminder_body(order["order_no"], order.get("total_paise", 0)),
            str(order["_id"]),
            "reminder",
        )
        sent += 1

    if sent:
        log.info("sent %s pickup reminders", sent)
    return sent


def start_scheduler() -> AsyncIOScheduler | None:
    global _scheduler
    if settings.whatsapp_provider == "stub":
        log.info("WhatsApp provider is 'stub' - reminders are recorded, not delivered")
    _scheduler = AsyncIOScheduler(timezone=settings.timezone)
    _scheduler.add_job(
        send_due_reminders,
        trigger=IntervalTrigger(minutes=settings.reminder_scan_minutes),
        id="pickup_reminders",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
        replace_existing=True,
    )
    _scheduler.start()
    log.info("reminder scheduler started (every %s min)", settings.reminder_scan_minutes)
    return _scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
