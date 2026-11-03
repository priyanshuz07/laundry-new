"""FastAPI entrypoint for the Laundry Management System."""
from __future__ import annotations

import logging
import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo.errors import DuplicateKeyError, PyMongoError

from .config import settings
from .db import close, ensure_indexes, users
from .routers import auth, customers, orders, public, reports, users as users_router
from .security import hash_password
from .services.reminders import send_due_reminders, start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("lms")


async def bootstrap_admin() -> None:
    """Create the first admin exactly once, from environment config."""
    if await users().find_one({"role": "admin"}):
        return
    if not settings.bootstrap_admin_password:
        log.warning("No admin exists and BOOTSTRAP_ADMIN_PASSWORD is unset - login is impossible")
        return
    now = datetime.now(timezone.utc)
    try:
        await users().insert_one(
            {
                "name": "Owner",
                "phone": settings.bootstrap_admin_phone,
                "password_hash": hash_password(settings.bootstrap_admin_password),
                "role": "admin",
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            }
        )
    except DuplicateKeyError:
        if await users().find_one({"role": "admin"}, {"_id": 1}):
            return
        raise
    log.info("bootstrapped admin account for %s", settings.bootstrap_admin_phone)


def validate_production_settings() -> None:
    settings.validate_database_settings()
    if settings.environment.lower() != "production":
        return

    if settings.jwt_secret.startswith("insecure-dev-secret") or len(settings.jwt_secret) < 32:
        raise RuntimeError("Production requires a JWT_SECRET of at least 32 characters.")
    if not settings.cors_origin_list or any(
        origin == "*" or not origin.startswith("https://") for origin in settings.cors_origin_list
    ):
        raise RuntimeError("Production CORS_ORIGINS must contain explicit HTTPS frontend origins.")
    if not settings.public_base_url.startswith("https://"):
        raise RuntimeError("Production PUBLIC_BASE_URL must be the HTTPS frontend URL.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_production_settings()
    if settings.jwt_secret.startswith("insecure-dev-secret"):
        log.warning("JWT_SECRET is the development default - set a real secret before deploying")
    await ensure_indexes()
    await bootstrap_admin()
    if os.getenv("VERCEL") == "1":
        log.info("reminder scheduler disabled on Vercel; Vercel Cron invokes it")
    else:
        start_scheduler()
    log.info("%s started", settings.app_name)
    try:
        yield
    finally:
        stop_scheduler()
        await close()
        log.info("shut down cleanly")


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Customers, orders, bills, QR codes, WhatsApp notifications and money reports.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router)
app.include_router(users_router.router)
app.include_router(customers.router)
app.include_router(orders.router)
app.include_router(reports.router)
app.include_router(public.router)


@app.exception_handler(ValueError)
async def value_error_handler(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"detail": str(exc)})


@app.get("/api/health")
async def health(response: Response) -> dict:
    try:
        await users().database.command("ping")
        db_ok = True
    except (PyMongoError, RuntimeError) as exc:
        log.error("health check database ping failed (%s)", type(exc).__name__)
        db_ok = False
    if not db_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ok" if db_ok else "degraded", "database": db_ok, "version": "1.0.0"}


@app.get("/api/db-test")
async def database_test(response: Response) -> dict:
    try:
        settings.validate_database_settings()
        await users().database.command("ping")
    except PyMongoError as exc:
        log.error("Atlas database test failed (%s)", type(exc).__name__)
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "error", "message": "MongoDB Atlas connection failed"}
    except RuntimeError as exc:
        log.error("Atlas database configuration invalid: %s", exc)
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "error", "message": "MongoDB Atlas is not configured"}
    return {
        "status": "success",
        "message": "MongoDB Atlas connected successfully",
    }


@app.get("/api/cron/reminders", include_in_schema=False)
async def scheduled_reminders(request: Request) -> dict[str, int]:
    if not settings.cron_secret:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "CRON_SECRET is not configured",
        )
    expected = f"Bearer {settings.cron_secret}"
    if not secrets.compare_digest(request.headers.get("authorization", ""), expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid cron authorization")
    return {"sent": await send_due_reminders()}
