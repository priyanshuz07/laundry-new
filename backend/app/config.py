"""Typed application settings loaded from the environment."""
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    app_name: str = "Laundry Management System"
    environment: str = "development"
    mongodb_uri: str = Field(
        default_factory=lambda: os.getenv(
            "MONGODB_URL",
            os.getenv("MONGODB_URI", "mongodb://localhost:27017/"),
        ),
        validation_alias=AliasChoices("MONGODB_URL", "MONGODB_URI"),
    )
    mongodb_db: str = Field(
        default_factory=lambda: os.getenv("DB_NAME", os.getenv("MONGODB_DB", "laundryDB")),
        validation_alias=AliasChoices("DB_NAME", "MONGODB_DB"),
    )
    jwt_secret: str = "insecure-dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 480

    public_base_url: str = "http://localhost:5173"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    bootstrap_admin_phone: str = "9999999999"
    bootstrap_admin_password: str = ""

    whatsapp_provider: str = "stub"
    whatsapp_phone_id: str = ""
    whatsapp_token: str = ""
    whatsapp_api_version: str = "v21.0"

    reminder_after_days: int = 2
    reminder_scan_minutes: int = 60
    timezone: str = "Asia/Kolkata"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
