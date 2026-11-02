"""Login and self-service."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..deps import get_current_user
from ..db import users
from ..models import LoginIn, PasswordResetIn, TokenOut, UserOut
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_out(doc: dict) -> UserOut:
    return UserOut(
        id=str(doc["_id"]),
        name=doc["name"],
        phone=doc["phone"],
        role=doc["role"],
        is_active=doc.get("is_active", False),
        created_at=doc.get("created_at"),
    )


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn) -> TokenOut:
    user = await users().find_one({"phone": body.phone})
    # Verify even when the user is missing to keep the timing comparable.
    stored_hash = user["password_hash"] if user else ""
    if not verify_password(body.password, stored_hash) or user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid phone or password")
    if not user.get("is_active", False):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is deactivated")

    await users().update_one(
        {"_id": user["_id"]}, {"$set": {"last_login_at": datetime.now(timezone.utc)}}
    )
    token = create_access_token(str(user["_id"]), user["role"])
    return TokenOut(
        access_token=token, role=user["role"], name=user["name"], user_id=str(user["_id"])
    )


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)) -> UserOut:
    return _user_out(user)


@router.post("/change-password")
async def change_password(
    body: PasswordResetIn, user: dict = Depends(get_current_user)
) -> Response:
    await users().update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "password_hash": hash_password(body.password),
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
