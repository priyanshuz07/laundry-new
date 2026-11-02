"""Shared FastAPI dependencies: current user and role gates."""
from __future__ import annotations

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import users
from .security import decode_token

bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict:
    """Resolve the caller from the token AND re-check the database.

    The DB check is not redundant: deactivating a sub-admin must revoke access
    immediately, not whenever their 8-hour token happens to expire.
    """
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_token(creds.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    try:
        oid = ObjectId(payload["sub"])
    except InvalidId:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token subject")

    user = await users().find_one({"_id": oid})
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found")
    if not user.get("is_active", False):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is deactivated")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user


async def require_staff(user: dict = Depends(get_current_user)) -> dict:
    """Admin or active sub-admin: everything except reports and user management."""
    if user.get("role") not in ("admin", "subadmin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Staff access required")
    return user
