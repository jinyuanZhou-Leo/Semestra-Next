from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All configuration. Environment variables use the SEMESTRA_ prefix.

    Modules add their own settings here and document them in deploy/.env.example.
    """

    model_config = SettingsConfigDict(env_prefix="SEMESTRA_", env_file=".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    log_level: str = "INFO"

    data_dir: Path = Path("./data")
    database_url: str = "sqlite+aiosqlite:///./data/semestra.db"

    # SECRET_KEY signs tokens; ENCRYPTION_KEY (Fernet key) encrypts user-provided secrets.
    secret_key: str = "dev-only-secret-change-me-0123456789abcdef"  # noqa: S105
    encryption_key: str = ""

    public_web_origin: str = "http://localhost:5173"
    public_api_origin: str = "http://localhost:8000"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    cookie_domain: str | None = None

    storage_backend: Literal["local"] = "local"
    storage_local_root: Path = Path("./data/storage")
    user_storage_quota_bytes: int = 52_428_800

    email_backend: Literal["console", "smtp", "resend"] = "console"
    email_from: str = "Semestra <no-reply@semestra.jyleo.cc>"
    resend_api_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True
    google_client_id: str = ""

    # Auth (M01). None = derive from PUBLIC_API_ORIGIN (Secure when it is https).
    cookie_secure: bool | None = None
    session_ttl_days: int = 30
    access_token_ttl_seconds: int = 15 * 60
    refresh_token_ttl_days: int = 60
    # How many reverse proxies sit in front of the API; the client IP is taken from the
    # X-Forwarded-For entry that many hops from the right. 0 = ignore the header.
    trusted_proxy_hops: int = 0
    notify_new_sign_in: bool = False

    @model_validator(mode="after")
    def _require_real_secrets_in_prod(self) -> Settings:
        if self.env == "prod" and (
            self.secret_key.startswith("dev-only") or not self.encryption_key
        ):
            raise ValueError("SEMESTRA_SECRET_KEY and SEMESTRA_ENCRYPTION_KEY must be set in prod")
        return self

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"

    @property
    def use_secure_cookies(self) -> bool:
        if self.cookie_secure is not None:
            return self.cookie_secure
        return self.public_api_origin.startswith("https://")


@lru_cache
def get_settings() -> Settings:
    return Settings()
