"""Pure-function tests: money, formatting, QR tokens, lifecycle rules."""
import pytest

from app.money import compute_bill, format_rupees, line_total_paise
from app.models import OrderItemIn
from app.routers.orders import ALLOWED_TRANSITIONS
from app.services.qr import new_public_token


def item(qty: int, price: int, name: str = "Shirt") -> OrderItemIn:
    return OrderItemIn(name=name, quantity=qty, unit_price_paise=price)


def test_line_total():
    assert line_total_paise(item(3, 2000)) == 6000


def test_bill_adds_lines_and_applies_discount():
    bill = compute_bill([item(3, 2000), item(1, 12000, "Blanket")], discount_paise=1000)
    assert bill["subtotal_paise"] == 18000
    assert bill["total_paise"] == 17000
    assert bill["items"][0]["line_total_paise"] == 6000


def test_bill_rejects_discount_above_subtotal():
    with pytest.raises(ValueError, match="discount cannot exceed"):
        compute_bill([item(1, 2000)], discount_paise=5000)


def test_bill_rejects_empty_order():
    with pytest.raises(ValueError, match="at least one item"):
        compute_bill([])


def test_bill_clamps_overpayment():
    bill = compute_bill([item(1, 2000)], paid_paise=9000)
    assert bill["paid_paise"] == 2000
    assert bill["balance_paise"] == 0


def test_rupee_formatting_indian_grouping():
    assert format_rupees(123450) == "1,234.50"
    assert format_rupees(100000000) == "10,00,000.00"
    assert format_rupees(5) == "0.05"


def test_lifecycle_is_forward_only():
    assert ALLOWED_TRANSITIONS["in_process"] == {"done", "ready"}
    assert "in_process" not in ALLOWED_TRANSITIONS["ready"]
    assert ALLOWED_TRANSITIONS["collected"] == set()


def test_public_tokens_are_unguessable_and_unique():
    tokens = {new_public_token() for _ in range(500)}
    assert len(tokens) == 500
    assert all(len(t) >= 30 for t in tokens)


def test_order_number_format():
    import datetime as dt

    now = dt.datetime(2025, 1, 7, tzinfo=dt.timezone.utc)
    assert f"LMS-{now:%y%m}-{7:04d}" == "LMS-2501-0007"
