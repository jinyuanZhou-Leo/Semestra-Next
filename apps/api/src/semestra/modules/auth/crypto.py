"""Hashing, tokens and password policy. Pure functions; no database access."""

import asyncio
import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from semestra.core.config import Settings
from semestra.core.errors import AppError

SESSION_PREFIX = "sses_"
REFRESH_PREFIX = "srt_"
PAT_PREFIX = "spat_"
REGISTRATION_PREFIX = "sreg_"
MIN_PASSWORD_LENGTH = 8

_hasher = PasswordHasher()
# Verified against when the account does not exist, so both paths cost the same.
_DUMMY_HASH = _hasher.hash("semestra-timing-equalizer")


def new_token(prefix: str, nbytes: int = 32) -> str:
    return prefix + secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    """Tokens are high-entropy random strings, so a plain SHA-256 is sufficient."""
    return hashlib.sha256(token.encode()).hexdigest()


def new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def code_hash(settings: Settings, challenge_id: str, code: str) -> str:
    return hmac.new(
        settings.secret_key.encode(), f"code:{challenge_id}:{code}".encode(), hashlib.sha256
    ).hexdigest()


def csrf_token_for(settings: Settings, session_token: str) -> str:
    """The CSRF token is bound to the session: only the holder of the cookie can derive it."""
    digest = hmac.new(
        settings.secret_key.encode(), f"csrf:{session_token}".encode(), hashlib.sha256
    ).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def rate_limit_key(settings: Settings, value: str) -> str:
    return hmac.new(settings.secret_key.encode(), value.encode(), hashlib.sha256).hexdigest()


# --- access tokens (native clients) ---------------------------------------------------------


def issue_access_token(settings: Settings, user_id: str, session_id: str, now: datetime) -> str:
    expires = now + timedelta(seconds=settings.access_token_ttl_seconds)
    claims = {
        "sub": user_id,
        "sid": session_id,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "typ": "access",
    }
    return jwt.encode(claims, settings.secret_key, algorithm="HS256")


def decode_access_token(settings: Settings, token: str, now: datetime) -> tuple[str, str] | None:
    """Returns (user_id, session_id), or None if the token is invalid or expired."""
    try:
        claims = jwt.decode(
            token,
            settings.secret_key,
            algorithms=["HS256"],
            options={"require": ["sub", "sid", "exp"], "verify_exp": False},
        )
    except jwt.PyJWTError:
        return None
    if claims.get("typ") != "access" or claims["exp"] <= int(now.timestamp()):
        return None
    return str(claims["sub"]), str(claims["sid"])


# --- passwords ------------------------------------------------------------------------------


@lru_cache
def _common_passwords() -> frozenset[str]:
    path = Path(__file__).with_name("common_passwords.txt")
    lines = path.read_text(encoding="utf-8").splitlines()
    return frozenset(line for line in lines if line and not line.startswith("#"))


def validate_password(password: str, email: str) -> None:
    """§4.6: at least 8 characters, not the email, not one of the 10k most common passwords."""
    reasons: list[str] = []
    if len(password) < MIN_PASSWORD_LENGTH:
        reasons.append("too_short")
    if password.lower() == email.lower() or password.lower() == email.lower().split("@")[0]:
        reasons.append("same_as_email")
    if password.lower() in _common_passwords():
        reasons.append("too_common")
    if reasons:
        raise AppError("auth.weak_password", 422, reasons=reasons, min_length=MIN_PASSWORD_LENGTH)


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hasher.hash, password)


async def verify_password(password: str, password_hash: str | None) -> bool:
    """Constant-ish time: hashes against a dummy when there is no stored hash."""
    target = password_hash or _DUMMY_HASH
    try:
        ok = await asyncio.to_thread(_hasher.verify, target, password)
    except VerifyMismatchError, VerificationError, InvalidHashError:
        return False
    return ok and password_hash is not None


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)
