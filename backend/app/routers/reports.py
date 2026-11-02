"""Money reports. Admin only - sub-admins are blocked at the dependency."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from pymongo.errors import OperationFailure

from ..config import settings
from ..db import orders
from ..deps import require_admin
from ..models import ReportBucket, ReportOut

router = APIRouter(prefix="/api/reports", tags=["reports"])

TRUNC: dict[str, str] = {"day": "day", "week": "week", "month": "month"}
MAX_FALLBACK_ROWS = 5000


def bucket_start(moment: datetime, granularity: str, tz: str) -> datetime:
    """Start of the day/week/month containing `moment`, in the shop timezone."""
    local = moment.astimezone(ZoneInfo(tz))
    if granularity == "day":
        start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    elif granularity == "week":
        start = (local - timedelta(days=local.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    else:
        start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc)


async def _buckets_in_python(start: datetime, granularity: str) -> list[dict]:
    """Fallback for MongoDB servers older than 5.0 (no $dateTrunc).

    Bounded by design: a single month of orders in a laundry is small, and the
    limit stops a pathological query from scanning forever.
    """
    cursor = (
        orders()
        .find(
            {"created_at": {"$gte": start}, "status": {"$ne": "cancelled"}},
            {"created_at": 1, "total_paise": 1, "paid_paise": 1},
        )
        .sort("created_at", 1)
        .limit(MAX_FALLBACK_ROWS)
    )
    grouped: dict[datetime, dict] = {}
    async for row in cursor:
        key = bucket_start(row["created_at"], granularity, settings.timezone)
        agg = grouped.setdefault(key, {"order_count": 0, "revenue_paise": 0, "collected_paise": 0})
        agg["order_count"] += 1
        agg["revenue_paise"] += row.get("total_paise", 0)
        agg["collected_paise"] += row.get("paid_paise", 0)
    return [{"_id": k, **v} for k, v in sorted(grouped.items())]


@router.get("/money", response_model=ReportOut)
async def money_report(
    granularity: str = Query(default="day", pattern="^(day|week|month)$"),
    days: int = Query(default=30, ge=1, le=366),
    _: dict = Depends(require_admin),
) -> ReportOut:
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

    pipeline = [
        {"$match": {"created_at": {"$gte": start}, "status": {"$ne": "cancelled"}}},
        {
            "$group": {
                "_id": {
                    "$dateTrunc": {
                        "date": "$created_at",
                        "unit": TRUNC[granularity],
                        "timezone": settings.timezone,
                    }
                },
                "order_count": {"$sum": 1},
                "revenue_paise": {"$sum": "$total_paise"},
                "collected_paise": {"$sum": "$paid_paise"},
            }
        },
        {"$sort": {"_id": 1}},
        {"$limit": 400},
    ]
    rows: list[dict] = []
    try:
        async for row in orders().aggregate(pipeline):
            rows.append(row)
    except OperationFailure:
        # server predates $dateTrunc - fall back to identical maths in Python
        rows = await _buckets_in_python(start, granularity)

    buckets = [
        ReportBucket(
            period=row["_id"].isoformat(),
            order_count=row["order_count"],
            revenue_paise=row["revenue_paise"],
            collected_paise=row["collected_paise"],
        )
        for row in rows
    ]

    total = ReportBucket(
        period="total",
        order_count=sum(b.order_count for b in buckets),
        revenue_paise=sum(b.revenue_paise for b in buckets),
        collected_paise=sum(b.collected_paise for b in buckets),
    )
    return ReportOut(
        granularity=granularity, start=start, end=now, buckets=buckets, totals=total
    )


@router.get("/dashboard")
async def dashboard(_: dict = Depends(require_admin)) -> dict:
    """Counters for the admin home screen."""
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    by_status = {}
    async for row in orders().aggregate(
        [
            {"$match": {"status": {"$in": ["in_process", "done", "ready"]}}},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        ]
    ):
        by_status[row["_id"]] = row["count"]

    today_rows = await orders().aggregate(
        [
            {"$match": {"created_at": {"$gte": today}}},
            {
                "$group": {
                    "_id": None,
                    "orders": {"$sum": 1},
                    "revenue": {"$sum": "$total_paise"},
                    "collected": {"$sum": "$paid_paise"},
                }
            },
        ]
    ).to_list(length=1)
    t = today_rows[0] if today_rows else {"orders": 0, "revenue": 0, "collected": 0}

    return {
        "open_orders": by_status,
        "today": {
            "orders": t.get("orders", 0),
            "revenue_paise": t.get("revenue", 0),
            "collected_paise": t.get("collected", 0),
        },
    }
