"""API schemas. Request models are strict: they are the trust boundary."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["admin", "subadmin"]
OrderStatus = Literal["in_process", "done", "ready", "collected"]
Quality = Literal["normal", "premium", "delicate"]


# --- auth ------------------------------------------------------------------
class LoginIn(BaseModel):
    phone: str = Field(min_length=10, max_length=15)
    password: str = Field(min_length=6, max_length=128)

    @field_validator("phone")
    @classmethod
    def digits_only(cls, v: str) -> str:
        v = v.strip().replace(" ", "").replace("-", "")
        if not v.isdigit():
            raise ValueError("phone must contain digits only")
        return v


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: Role
    name: str
    user_id: str


class UserOut(BaseModel):
    id: str
    name: str
    phone: str
    role: Role
    is_active: bool
    created_at: datetime | None = None


class UserCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(min_length=10, max_length=15)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("phone")
    @classmethod
    def digits_only(cls, v: str) -> str:
        v = v.strip().replace(" ", "").replace("-", "")
        if not v.isdigit():
            raise ValueError("phone must contain digits only")
        return v


class PasswordResetIn(BaseModel):
    password: str = Field(min_length=8, max_length=128)


# --- customers -------------------------------------------------------------
class CustomerIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(min_length=10, max_length=15)
    address: str = Field(default="", max_length=300)
    notes: str = Field(default="", max_length=300)

    @field_validator("phone")
    @classmethod
    def digits_only(cls, v: str) -> str:
        v = v.strip().replace(" ", "").replace("-", "")
        if not v.isdigit():
            raise ValueError("phone must contain digits only")
        return v


class CustomerOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    phone: str
    address: str = ""
    notes: str = ""
    created_at: datetime | None = None
    order_count: int = 0


# --- orders ----------------------------------------------------------------
class OrderItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    category: str = Field(default="custom", max_length=40)
    quality: Quality = "normal"
    quantity: int = Field(ge=1, le=500)
    unit_price_paise: int = Field(ge=0, le=10_000_000)


class OrderItemOut(OrderItemIn):
    line_total_paise: int


class OrderCreateIn(BaseModel):
    customer: CustomerIn
    items: list[OrderItemIn] = Field(min_length=1, max_length=50)
    discount_paise: int = Field(default=0, ge=0, le=10_000_000)
    paid_paise: int = Field(default=0, ge=0, le=10_000_000)
    payment_method: Literal["cash", "upi", "card", "unpaid"] = "cash"
    note: str = Field(default="", max_length=300)


class OrderStatusIn(BaseModel):
    status: OrderStatus


class PaymentIn(BaseModel):
    paid_paise: int = Field(ge=0, le=10_000_000)


class OrderOut(BaseModel):
    id: str
    order_no: str
    public_token: str
    customer_id: str
    customer_name: str
    customer_phone: str
    customer_address: str = ""
    items: list[OrderItemOut]
    subtotal_paise: int
    discount_paise: int
    total_paise: int
    paid_paise: int
    balance_paise: int
    payment_method: str
    status: OrderStatus
    note: str = ""
    created_at: datetime | None = None
    ready_at: datetime | None = None
    collected_at: datetime | None = None
    created_by_name: str = ""


class OrderListOut(BaseModel):
    items: list[OrderOut]
    total: int
    page: int
    page_size: int


class QrOut(BaseModel):
    order_no: str
    url: str
    data_url: str


class PublicOrderOut(BaseModel):
    """What a customer sees after scanning the QR.

    Deliberately excludes phone, address and payment data.
    """
    order_no: str
    customer_name: str
    status: OrderStatus
    items: list[dict]
    total_quantity: int
    created_at: datetime | None = None


# --- reports ---------------------------------------------------------------
class ReportBucket(BaseModel):
    period: str
    order_count: int
    revenue_paise: int
    collected_paise: int


class ReportOut(BaseModel):
    granularity: Literal["day", "week", "month"]
    start: datetime
    end: datetime
    buckets: list[ReportBucket]
    totals: ReportBucket
