"""FastAPI entrypoint for the Laundry Management System."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .db import close, ensure_indexes, users
from .routers import auth, customers, orders, public, reports, users as users_router
from .security import hash_password
from .services.reminders import start_scheduler, stop_scheduler

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
    log.info("bootstrapped admin account for %s", settings.bootstrap_admin_phone)


def validate_production_settings() -> None:
    if settings.environment.lower() != "production":
        return

    if settings.jwt_secret.startswith("insecure-dev-secret") or len(settings.jwt_secret) < 32:
        raise RuntimeError("Production requires a JWT_SECRET of at least 32 characters.")
    if not settings.mongodb_uri.startswith(("mongodb://", "mongodb+srv://")):
        raise RuntimeError("Production requires MONGODB_URI to be a MongoDB connection string.")
    if "localhost" in settings.mongodb_uri or "127.0.0.1" in settings.mongodb_uri:
        raise RuntimeError("Production MONGODB_URI must not point to localhost.")
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
    except Exception as exc:  # noqa: BLE001 - report, do not crash the probe
        log.error("health check database ping failed: %s", exc)
        db_ok = False
    if not db_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ok" if db_ok else "degraded", "database": db_ok, "version": "1.0.0"}
