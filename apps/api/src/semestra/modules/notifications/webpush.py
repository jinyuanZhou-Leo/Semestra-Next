"""Web Push delivery (RFC 8030 / 8291 / 8292) with `http_ece` and `py_vapid` (M18 §3).

The VAPID key pair is derived from `SEMESTRA_SECRET_KEY`, so a self-hosted instance needs no extra
configuration and every process signs with the same key. Changing the secret key invalidates the
existing subscriptions, as it already does sessions; browsers subscribe again on their next visit.

The endpoint is a URL the browser hands over, so only the push services of the browsers are
accepted, and requests go through `safe_client` (no private addresses, no redirects)."""

import base64
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.utils import parseaddr
from functools import cache
from typing import Any, Literal
from urllib.parse import urlsplit

import http_ece
import structlog
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from py_vapid import Vapid02

from semestra.core.config import Settings
from semestra.core.http import safe_client

log = structlog.get_logger()

# Chrome, Edge (Chromium), Opera, Samsung Internet → FCM; Firefox → Mozilla; Safari → Apple;
# legacy Edge → WNS.
PUSH_HOSTS = ("fcm.googleapis.com",)
PUSH_HOST_SUFFIXES = (".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com")
TTL_SECONDS = 4 * 3600  # a reminder that arrives hours late is noise


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def is_push_endpoint(endpoint: str) -> bool:
    parts = urlsplit(endpoint)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or parts.username or parts.password or parts.port not in (None, 443):
        return False
    return host in PUSH_HOSTS or any(host.endswith(s) for s in PUSH_HOST_SUFFIXES)


@cache
def _private_key(secret_key: str) -> ec.EllipticCurvePrivateKey:
    order = int("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)
    seed = HKDF(
        algorithm=hashes.SHA256(), length=48, salt=None, info=b"semestra web push vapid"
    ).derive(secret_key.encode())
    # 48 bytes reduced modulo the curve order: uniform enough, and never zero.
    return ec.derive_private_key(int.from_bytes(seed) % (order - 1) + 1, ec.SECP256R1())


def public_key(settings: Settings) -> str:
    """The VAPID public key in the form `PushManager.subscribe` takes (`applicationServerKey`)."""
    raw = (
        _private_key(settings.secret_key)
        .public_key()
        .public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    )
    return b64url_encode(raw)


def _subject(settings: Settings) -> str:
    """Who to contact about these pushes: the site, or the sender address for a local setup."""
    if settings.public_web_origin.startswith("https://"):
        return settings.public_web_origin.rstrip("/")
    address = parseaddr(settings.email_from)[1]
    return f"mailto:{address}" if "@" in address else "mailto:admin@localhost"


@dataclass(frozen=True)
class Subscription:
    endpoint: str
    p256dh: str
    auth: str


Outcome = Literal["sent", "gone", "failed"]


def encrypt(sub: Subscription, payload: bytes) -> bytes:
    return http_ece.encrypt(
        payload,
        salt=os.urandom(16),
        private_key=ec.generate_private_key(ec.SECP256R1()),
        dh=b64url_decode(sub.p256dh),
        auth_secret=b64url_decode(sub.auth),
        version="aes128gcm",
    )


async def send(
    settings: Settings,
    sub: Subscription,
    message: dict[str, Any],
    *,
    now: datetime,
    urgency: Literal["normal", "high"] = "normal",
) -> Outcome:
    """Encrypts and posts one message. `gone`: the subscription no longer exists (delete it)."""
    if not is_push_endpoint(sub.endpoint):
        return "gone"
    parts = urlsplit(sub.endpoint)
    vapid = Vapid02(private_key=_private_key(settings.secret_key))
    # Apple refuses tokens valid for more than an hour.
    claims = {
        "aud": f"{parts.scheme}://{parts.netloc}",
        "sub": _subject(settings),
        "exp": int((now + timedelta(minutes=55)).timestamp()),
    }
    headers = {
        **vapid.sign(claims),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": str(TTL_SECONDS),
        "Urgency": urgency,
    }
    try:
        body = encrypt(sub, json.dumps(message, ensure_ascii=False).encode())
    except Exception:  # keys the browser sent that are not valid P-256 / auth secrets
        log.warning("push_bad_subscription_keys")
        return "gone"
    try:
        async with safe_client(settings) as client:
            response = await client.post(sub.endpoint, content=body, headers=headers)
    except Exception:
        log.warning("push_send_failed", host=parts.hostname)
        return "failed"
    if response.status_code in (404, 410):
        return "gone"
    if response.status_code >= 400:
        log.warning("push_rejected", host=parts.hostname, status=response.status_code)
        return "failed"
    return "sent"
