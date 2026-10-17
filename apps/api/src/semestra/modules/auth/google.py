"""Google ID token verification (M01 §4.3)."""

import time
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
import jwt

from semestra.core.config import Settings
from semestra.core.errors import AppError

JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ["https://accounts.google.com", "accounts.google.com"]


@dataclass(frozen=True)
class GoogleClaims:
    subject: str
    email: str
    name: str | None
    picture: str | None


class GoogleVerifier(Protocol):
    async def verify(self, id_token: str) -> GoogleClaims:
        """Raises `auth.google_invalid_token` unless the token is valid for this app."""
        ...


class HttpGoogleVerifier:
    def __init__(self, settings: Settings) -> None:
        self._client_id = settings.google_client_id
        self._keys: dict[str, Any] = {}
        self._fetched_at = 0.0

    async def _jwks(self, force: bool = False) -> dict[str, Any]:
        if force or not self._keys or time.monotonic() - self._fetched_at > 3600:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(JWKS_URL)
            resp.raise_for_status()
            self._keys = {k["kid"]: k for k in resp.json()["keys"]}
            self._fetched_at = time.monotonic()
        return self._keys

    async def verify(self, id_token: str) -> GoogleClaims:
        if not self._client_id:
            raise AppError("common.unavailable", 503, feature="google_login")
        invalid = AppError("auth.google_invalid_token", 401)
        try:
            kid = jwt.get_unverified_header(id_token).get("kid")
            keys = await self._jwks()
            if kid not in keys:
                keys = await self._jwks(force=True)  # keys rotate
            if kid not in keys:
                raise invalid
            claims = jwt.decode(
                id_token,
                jwt.PyJWK(keys[kid]).key,
                algorithms=["RS256"],
                audience=self._client_id,
                issuer=ISSUERS,
                options={"require": ["exp", "iss", "aud", "sub"]},
            )
        except (jwt.PyJWTError, httpx.HTTPError) as exc:
            raise invalid from exc
        if not claims.get("email") or claims.get("email_verified") not in (True, "true"):
            raise invalid
        return GoogleClaims(
            subject=str(claims["sub"]),
            email=str(claims["email"]).lower(),
            name=claims.get("name"),
            picture=claims.get("picture"),
        )
