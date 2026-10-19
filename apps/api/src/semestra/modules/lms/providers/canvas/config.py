"""Canvas configuration and credentials (M09 §2.3), with the old app's base URL rules."""

import re
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, SecretStr

from semestra.core.config import Settings
from semestra.modules.lms.errors import lms_error

API_PREFIX = "/api/v1"


class CanvasConfig(BaseModel):
    base_url: str = Field(
        description="Address of the Canvas instance, e.g. https://school.instructure.com"
    )


class CanvasCredentials(BaseModel):
    access_token: SecretStr = Field(description="Canvas access token (Account → Settings)")


def normalize_base_url(raw: str, settings: Settings) -> str:
    """Adds `https://` when there is no scheme; refuses other schemes (plain http only where
    private addresses are allowed, i.e. self-hosting), credentials, query strings, fragments and
    the API path; drops the trailing slash."""
    value = raw.strip()
    if not value:
        raise lms_error("lms.invalid_config", field="base_url", reason="missing")
    if not re.match(r"^[a-z][a-z0-9+.-]*://", value, re.I):
        value = f"https://{value}"
    parts = urlsplit(value)
    scheme = parts.scheme.lower()
    allowed = (
        ("http", "https") if settings.allow_private_egress or settings.env != "prod" else ("https",)
    )
    if scheme not in allowed:
        raise lms_error("lms.invalid_config", field="base_url", reason="scheme")
    if not parts.hostname or parts.username or parts.password or re.search(r"\s", value):
        raise lms_error("lms.invalid_config", field="base_url", reason="url")
    if parts.query or parts.fragment or value.endswith(("?", "#")):
        raise lms_error("lms.invalid_config", field="base_url", reason="query")
    path = parts.path.rstrip("/")
    if path == API_PREFIX or path.startswith(f"{API_PREFIX}/"):
        raise lms_error("lms.invalid_config", field="base_url", reason="api_path")
    host = parts.hostname.lower()
    port = f":{parts.port}" if parts.port else ""
    return f"{scheme}://{host}{port}{path}"


def normalize_token(raw: str) -> str:
    token = raw.strip()
    if len(token) < 8 or re.search(r"\s", token) or "@" in token:
        raise lms_error("lms.invalid_config", field="access_token", reason="token")
    return token


def mask_token(token: str) -> str:
    """`7~abcdef…` → `7~ab…xy`; short tokens reveal nothing."""
    if len(token) < 12:
        return "…"
    return f"{token[:4]}…{token[-2:]}"
