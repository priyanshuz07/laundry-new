"""Sub-admin account management. Admin only, by design."""
from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pymongo.errors import DuplicateKeyError

from ..db import users
from ..deps import require_admin
from ..models import PasswordResetIn, UserCreateIn, UserOut
from ..security import hash_password

router = APIRouter(prefix="/api/users", tags=["users"])


def _out(doc: dict) -> UserOut:
    return UserOut(
        id=str(doc["_id"]),
        name=doc["name"],
        phone=doc.get("phone"),
        username=doc.get("username") or doc.get("phone"),
        email=doc.get("email"),
        role=doc["role"],
        is_active=doc.get("is_active", False),
        created_at=doc.get("created_at"),
    )


def _oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid id")


@router.get("", response_model=list[UserOut])
async def list_users(_: dict = Depends(require_admin)) -> list[UserOut]:
    docs = await users().find({}).sort("created_at", 1).to_list(length=200)
    return [_out(d) for d in docs]


@router.post("", response_model=UserOut, status_code=201)
async def create_subadmin(body: UserCreateIn, admin: dict = Depends(require_admin)) -> UserOut:
    now = datetime.now(timezone.utc)
    if await users().find_one({"username": body.username}):
        raise HTTPException(status.HTTP_409_CONFLICT, "This Sub Admin ID is already in use")
    if body.phone and await users().find_one({"phone": body.phone}):
        raise HTTPException(status.HTTP_409_CONFLICT, "This phone number already has an account")
    doc = {
        "name": body.name.strip(),
        "username": body.username,
        "password_hash": hash_password(body.password),
        "role": "subadmin",
        "is_active": True,
        "created_at": now,
        "updated_at": now,
        "created_by": str(admin["_id"]),
    }
    if body.phone:
        doc["phone"] = body.phone
    try:
        res = await users().insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Sub Admin ID or phone number already exists")
    doc["_id"] = res.inserted_id
    return _out(doc)


@router.patch("/{user_id}/active", response_model=UserOut)
async def set_active(user_id: str, active: bool, admin: dict = Depends(require_admin)) -> UserOut:
    oid = _oid(user_id)
    if oid == admin["_id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate your own account")
    target = await users().find_one({"_id": oid})
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if target["role"] == "admin":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Admin accounts are managed separately")
    await users().update_one(
        {"_id": oid}, {"$set": {"is_active": active, "updated_at": datetime.now(timezone.utc)}}
    )
    target["is_active"] = active
    return _out(target)


@router.post("/{user_id}/password")
async def reset_password(
    user_id: str, body: PasswordResetIn, _: dict = Depends(require_admin)
) -> Response:
    oid = _oid(user_id)
    res = await users().update_one(
        {"_id": oid},
        {
            "$set": {
                "password_hash": hash_password(body.password),
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    if res.matched_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
