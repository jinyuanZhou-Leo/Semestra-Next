import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All configuration. Environment variables use the SEMESTRA_ prefix.

    Modules add their own settings here and document them in deploy/.env.example.
    """

    # `<DATA_DIR>/secrets.env` is where the container entrypoint stores generated keys
    # (SEMESTRA_AUTO_SECRETS); reading it here lets `docker exec ... semestra backup` and other
    # processes that bypass the entrypoint see the same keys. Real environment variables win.
    model_config = SettingsConfigDict(
        env_prefix="SEMESTRA_",
        env_file=(".env", Path(os.environ.get("SEMESTRA_DATA_DIR", "./data")) / "secrets.env"),
        extra="ignore",
    )

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

    # Background jobs (M00 §3.7): worker tasks in the API process. Tests turn autostart off and
    # drive the queue themselves.
    job_concurrency: int = 2
    jobs_autostart: bool = True
    # Outbound requests to user-chosen hosts may reach private networks (self-hosting only).
    allow_private_egress: bool = False

    storage_backend: Literal["local"] = "local"
    storage_local_root: Path = Path("./data/storage")
    user_storage_quota_bytes: int = 52_428_800

    email_backend: Literal["console", "smtp", "resend"] = "console"
    email_from: str = "Semestra <no-reply@semestra.jyleo.cc>"
    email_reply_to: str = ""
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

    # AI (M06). A self-hosted instance may configure one provider every user shares; it is only
    # used when the user has configured nothing that serves the purpose.
    instance_ai_kind: Literal[
        "", "anthropic", "openai", "openai_compatible", "gemini", "ollama"
    ] = ""
    instance_ai_base_url: str = ""
    instance_ai_chat_model: str = ""
    instance_ai_embedding_model: str = ""
    instance_ai_api_key: str = ""
    # Dev only: write prompts and outputs to DATA_DIR/ai-debug/ (never in prod).
    ai_debug_log: bool = False

    # Deployment (M15)
    serve_web: bool = False  # all-in-one image: serve the built SPA from this process
    web_dist_dir: Path = Path("./web")
    sentry_dsn: str = ""  # empty disables error tracking
    backup_dir: str = ""  # non-empty enables the built-in daily backup into this directory
    backup_keep: int = 7  # database snapshots to keep per database

    @model_validator(mode="after")
    def _require_real_secrets_in_prod(self) -> Settings:
        if self.env == "prod" and (
            not self.secret_key or self.secret_key.startswith("dev-only") or not self.encryption_key
        ):
            raise ValueError("SEMESTRA_SECRET_KEY and SEMESTRA_ENCRYPTION_KEY must be set in prod")
        return self

    @model_validator(mode="after")
    def _require_resend_credentials(self) -> Settings:
        if self.email_backend == "resend" and not (self.resend_api_key and self.email_from):
            raise ValueError(
                "SEMESTRA_RESEND_API_KEY and SEMESTRA_EMAIL_FROM must be set when "
                "SEMESTRA_EMAIL_BACKEND=resend"
            )
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
