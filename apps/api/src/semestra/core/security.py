"""Encryption of user-provided secrets (M00 §3.10): LLM keys, LMS tokens.

Store `encrypt(settings, key)`; show `mask(key)`; never log or return the plaintext.
Outside prod an empty `SEMESTRA_ENCRYPTION_KEY` falls back to a key derived from `SECRET_KEY`
(prod refuses to start without a real one, see `Settings`).
"""

import base64
import hashlib
from datetime import datetime
from functools import lru_cache

from cryptography.fernet import Fernet

from semestra.core.config import Settings


@lru_cache
def _fernet(key: str) -> Fernet:
    return Fernet(key.encode())


def _key(settings: Settings) -> str:
    if settings.encryption_key:
        return settings.encryption_key
    derived = hashlib.sha256(b"semestra-dev-encryption:" + settings.secret_key.encode()).digest()
    return base64.urlsafe_b64encode(derived).decode()


def encrypt(settings: Settings, plaintext: str) -> str:
    return _fernet(_key(settings)).encrypt(plaintext.encode()).decode()


def decrypt(settings: Settings, token: str) -> str:
    """Raises `cryptography.fernet.InvalidToken` if the key changed or the value was altered."""
    return _fernet(_key(settings)).decrypt(token.encode()).decode()


def seal_for(settings: Settings, plaintext: str, now: datetime) -> str:
    """Like `encrypt`, stamped with `now`: `unseal_within` refuses it once it is too old (a
    short-lived link). Encrypted, so the value inside cannot be read from the link either."""
    return (
        _fernet(_key(settings)).encrypt_at_time(plaintext.encode(), int(now.timestamp())).decode()
    )


def unseal_within(settings: Settings, token: str, seconds: int, now: datetime) -> str:
    """Raises `cryptography.fernet.InvalidToken` if altered, from another key, or too old."""
    data = _fernet(_key(settings)).decrypt_at_time(token.encode(), seconds, int(now.timestamp()))
    return data.decode()


def mask(secret: str) -> str:
    """`sk-proj-abc…wxyz` → `sk-…wxyz`; short values reveal nothing."""
    if len(secret) < 12:
        return "…"
    return f"{secret[:3]}…{secret[-4:]}"
