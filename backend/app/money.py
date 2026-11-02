"""All money is handled as integer paise (1 rupee = 100 paise).

Floats are never used for money: 0.1 + 0.2 != 0.3 in binary floating point,
and a laundry bill that is one paisa wrong is a support ticket.
Formatting to rupees happens only at the UI/print boundary.
"""
from __future__ import annotations

from .models import OrderItemIn

MAX_LINE_PAISE = 10_000_000 * 100  # 1 crore rupees per line, sanity ceiling


def line_total_paise(item: OrderItemIn) -> int:
    return item.quantity * item.unit_price_paise


def compute_bill(
    items: list[OrderItemIn],
    discount_paise: int = 0,
    paid_paise: int = 0,
) -> dict:
    """Pure function: items -> authoritative totals.

    The client may send stale prices, so the server always recomputes.
    """
    if not items:
        raise ValueError("order must contain at least one item")
    if discount_paise < 0:
        raise ValueError("discount cannot be negative")

    lines = []
    subtotal = 0
    for item in items:
        total = line_total_paise(item)
        if total > MAX_LINE_PAISE:
            raise ValueError(f"line total too large for item {item.name!r}")
        subtotal += total
        lines.append(
            {
                "name": item.name.strip(),
                "category": item.category,
                "quality": item.quality,
                "quantity": item.quantity,
                "unit_price_paise": item.unit_price_paise,
                "line_total_paise": total,
            }
        )

    if discount_paise > subtotal:
        raise ValueError("discount cannot exceed the subtotal")

    total = subtotal - discount_paise
    return {
        "items": lines,
        "subtotal_paise": subtotal,
        "discount_paise": discount_paise,
        "total_paise": total,
        "paid_paise": min(paid_paise, total),
        "balance_paise": max(total - paid_paise, 0),
    }


def format_rupees(paise: int) -> str:
    """123450 -> '1,234.50' using the Indian digit grouping."""
    sign = "-" if paise < 0 else ""
    paise = abs(paise)
    rupees, paise_part = divmod(paise, 100)
    s = str(rupees)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups + [tail])
    return f"{sign}{s}.{paise_part:02d}"
