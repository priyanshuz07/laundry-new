"""Typed application settings loaded from the environment."""
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    app_name: str = "Laundry Management System"
    environment: str = "development"
    mongodb_uri: str = Field(validation_alias="MONGODB_URI", repr=False)
    mongodb_db: str = Field(validation_alias="DB_NAME")
    jwt_secret: str = "insecure-dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 480

    public_base_url: str = "http://localhost:5173"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    bootstrap_admin_phone: str = "9999999999"
    bootstrap_admin_password: str = ""
    cron_secret: str = ""

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

    def validate_database_settings(self) -> None:
        if not self.mongodb_uri.startswith("mongodb+srv://"):
            raise RuntimeError("MONGODB_URI must be an Atlas mongodb+srv connection string.")
        if (
            "<" in self.mongodb_uri
            or ">" in self.mongodb_uri
            or "YOUR_ACTUAL_PASSWORD" in self.mongodb_uri
            or "cluster-host" in self.mongodb_uri
        ):
            raise RuntimeError("MONGODB_URI still contains an unconfigured placeholder.")
        if not self.mongodb_db.strip():
            raise RuntimeError("DB_NAME must be configured.")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
