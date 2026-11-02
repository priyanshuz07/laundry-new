"""QR code generation for order lookup."""
from __future__ import annotations

import base64
import io
import secrets

import qrcode
from qrcode.constants import ERROR_CORRECT_M

from ..config import settings


def new_public_token() -> str:
    """Unguessable token, so a QR scan cannot be used to enumerate orders.

    The order number itself is never the lookup key: LMS-2501-0007 is trivially
    guessable and would expose every customer's item list.
    """
    return secrets.token_urlsafe(24)


def public_url(token: str) -> str:
    return f"{settings.public_base_url.rstrip('/')}/o/{token}"


def qr_png_bytes(text: str, box_size: int = 8) -> bytes:
    qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_M, box_size=box_size, border=2)
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def qr_data_url(token: str) -> str:
    png = qr_png_bytes(public_url(token))
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")
