"""Passkeys (WebAuthn): sign in, confirm it's you, and the user's list of them (M01 §4.9).

The relying party is the web app: its ID is the host of `PUBLIC_WEB_ORIGIN` and answers must
come from that origin, so the API may live on another host. Only discoverable credentials are
created, so signing in needs no email address first. Attestation is not requested: which
authenticator made a key only names it in the list.
"""

import base64
import hashlib
import hmac
import json
import os
import struct
from datetime import UTC, datetime, timedelta
from functools import cache
from typing import Any, Literal, cast
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import CursorResult, select
from sqlalchemy.dialects.sqlite import insert
from webauthn import (
    base64url_to_bytes,
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import bytes_to_base64url
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.modules.auth import ratelimit, service
from semestra.modules.auth.models import AuthPasskey, AuthUsedWebAuthnChallenge, AuthUser
from semestra.modules.auth.schemas import PasskeyList, PasskeyOut, WebAuthnOptions

Purpose = Literal["login", "reauth", "register"]

# Signing in waits in the email field's autofill until the user picks a passkey, so its
# challenge lives longer; the browser gives up at the same time and the page asks again.
TTL: dict[Purpose, timedelta] = {
    "login": timedelta(minutes=10),
    "reauth": timedelta(minutes=5),
    "register": timedelta(minutes=5),
}
MAX_PASSKEYS = 20
UV = UserVerificationRequirement.REQUIRED  # a passkey is the only factor: always ask for it
_NONCE, _EXPIRY, _MAC = 16, 8, 16


def _origin(ctx: Ctx) -> str:
    return ctx.settings.public_web_origin.rstrip("/")


def _rp_id(ctx: Ctx) -> str:
    return urlsplit(_origin(ctx)).hostname or "localhost"


def _failed() -> AppError:
    return AppError("auth.passkey_failed", 401)


def passkey_out(row: AuthPasskey) -> PasskeyOut:
    return PasskeyOut(
        id=row.id,
        credential_id=row.credential_id,
        name=row.name,
        aaguid=row.aaguid,
        device=row.device,
        backed_up=row.backed_up,
        created_at=row.created_at,
        last_used_at=row.last_used_at,
    )


async def _passkeys(ctx: Ctx, user_id: str) -> list[AuthPasskey]:
    rows = await ctx.db.scalars(
        select(AuthPasskey).where(AuthPasskey.user_id == user_id).order_by(AuthPasskey.created_at)
    )
    return list(rows)


def _descriptors(rows: list[AuthPasskey]) -> list[PublicKeyCredentialDescriptor]:
    out: list[PublicKeyCredentialDescriptor] = []
    for row in rows:
        transports: list[AuthenticatorTransport] = []
        for t in row.transports:
            try:
                transports.append(AuthenticatorTransport(t))
            except ValueError:
                continue  # one this library does not know yet: the browser can do without
        out.append(
            PublicKeyCredentialDescriptor(
                id=base64url_to_bytes(row.credential_id), transports=transports or None
            )
        )
    return out


# --- challenges -----------------------------------------------------------------------------
# A challenge is `nonce ‖ expiry ‖ MAC(purpose, session, nonce, expiry)`: asking for one stores
# nothing (the sign-in page asks on every visit, without an account). Answering records the
# challenge in `auth_webauthn_used_challenges` first, whose primary key lets only one answer
# through even when two arrive at once, and only then checks the answer.


@cache
def _mac_key(secret_key: str) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=b"semestra webauthn challenge"
    ).derive(secret_key.encode())


def _mac(ctx: Ctx, purpose: Purpose, session_id: str | None, body: bytes) -> bytes:
    message = f"{purpose}\n{session_id or ''}\n".encode() + body
    return hmac.new(_mac_key(ctx.settings.secret_key), message, hashlib.sha256).digest()[:_MAC]


def _new_challenge(ctx: Ctx, purpose: Purpose, session_id: str | None) -> bytes:
    expires = int((ctx.now + TTL[purpose]).timestamp())
    body = os.urandom(_NONCE) + struct.pack(">Q", expires)
    return body + _mac(ctx, purpose, session_id, body)


def _answered_challenge(credential: dict[str, Any]) -> bytes:
    """The challenge the authenticator signed, read from the answer's client data."""
    response = credential.get("response")
    data = response.get("clientDataJSON") if isinstance(response, dict) else None
    try:
        challenge = json.loads(base64url_to_bytes(str(data)))["challenge"]
        return base64url_to_bytes(challenge)
    except (ValueError, KeyError, TypeError) as exc:
        raise _failed() from exc


async def _use_challenge(
    ctx: Ctx, credential: dict[str, Any], purpose: Purpose, session_id: str | None
) -> bytes:
    """The challenge of an answer, if this server made it for this purpose and session and it
    has not been answered before; used up whether the answer turns out right or not."""
    challenge = _answered_challenge(credential)
    body, mac = challenge[:-_MAC], challenge[-_MAC:]
    if len(body) != _NONCE + _EXPIRY or not hmac.compare_digest(
        mac, _mac(ctx, purpose, session_id, body)
    ):
        raise _failed()
    expires = datetime.fromtimestamp(struct.unpack(">Q", body[_NONCE:])[0], UTC)
    if expires < ctx.now:
        raise AppError("auth.passkey_expired", 401)
    used = base64.urlsafe_b64encode(hashlib.sha256(challenge).digest()).decode()
    result = await ctx.db.execute(
        insert(AuthUsedWebAuthnChallenge)
        .values(id=used, expires_at=expires)
        .on_conflict_do_nothing()
    )
    if not cast(CursorResult[Any], result).rowcount:
        raise _failed()  # answered before
    # Committed now, so a wrong answer cannot be retried against the same challenge.
    await ctx.db.commit()
    return challenge


def _options(options: Any) -> WebAuthnOptions:
    return WebAuthnOptions(options=json.loads(options_to_json(options)))


# --- signing in -----------------------------------------------------------------------------


def login_options(ctx: Ctx) -> WebAuthnOptions:
    options = generate_authentication_options(
        rp_id=_rp_id(ctx),
        challenge=_new_challenge(ctx, "login", None),
        timeout=int(TTL["login"].total_seconds() * 1000),
        user_verification=UV,
    )
    return _options(options)


async def _verify(
    ctx: Ctx, credential: dict[str, Any], challenge: bytes, user_id: str | None
) -> AuthPasskey:
    """Checks an answer to `navigator.credentials.get`; `user_id` limits it to that user."""
    credential_id = credential.get("id")
    if not isinstance(credential_id, str):
        raise _failed()
    passkey = await ctx.db.scalar(
        select(AuthPasskey).where(AuthPasskey.credential_id == credential_id)
    )
    if passkey is None:
        # Removed here (or never saved): the client tells the password manager to drop it.
        raise AppError("auth.passkey_unknown", 401, credential_id=credential_id)
    if user_id is not None and passkey.user_id != user_id:
        raise _failed()
    try:
        result = verify_authentication_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=_rp_id(ctx),
            expected_origin=_origin(ctx),
            credential_public_key=passkey.public_key,
            credential_current_sign_count=passkey.sign_count,
            require_user_verification=True,
        )
    except WebAuthnException as error:
        raise _failed() from error
    passkey.sign_count = result.new_sign_count
    passkey.backed_up = result.credential_backed_up
    passkey.last_used_at = ctx.now
    return passkey


async def login(
    ctx: Ctx,
    credential: dict[str, Any],
    client: service.Client,
    meta: service.RequestMeta,
) -> service.SignedIn:
    if meta.ip:
        count, window = service.LOGIN_PER_IP
        await ratelimit.hit(
            ctx.db,
            ctx.settings,
            ctx.now,
            "login_ip",
            ratelimit.network(meta.ip),
            limit=count,
            window=window,
        )
    challenge = await _use_challenge(ctx, credential, "login", None)
    passkey = await _verify(ctx, credential, challenge, None)
    user = await ctx.db.get(AuthUser, passkey.user_id)
    if user is None or user.deleted_at is not None:
        raise _failed()
    signed_in = await service.create_session(ctx, user, client, meta)
    await service.notify_new_sign_in(ctx, signed_in, meta)
    return signed_in


# --- confirming it's you --------------------------------------------------------------------


async def reauth_options(ctx: Ctx) -> WebAuthnOptions:
    user = service.require_user(ctx)
    session_id = service.current_session_id(ctx)
    rows = await _passkeys(ctx, user.id)
    if not rows:
        raise AppError("auth.passkey_none", 409)
    options = generate_authentication_options(
        rp_id=_rp_id(ctx),
        challenge=_new_challenge(ctx, "reauth", session_id),
        timeout=int(TTL["reauth"].total_seconds() * 1000),
        allow_credentials=_descriptors(rows),
        user_verification=UV,
    )
    return _options(options)


async def reauth(ctx: Ctx, credential: dict[str, Any]) -> None:
    user = service.require_user(ctx)
    session_id = service.current_session_id(ctx)
    challenge = await _use_challenge(ctx, credential, "reauth", session_id)
    await _verify(ctx, credential, challenge, user.id)
    await service.mark_verified(ctx, session_id)


# --- the user's passkeys --------------------------------------------------------------------


async def list_passkeys(ctx: Ctx) -> PasskeyList:
    """With what the browser needs to tell the user's password manager which ones still work."""
    user = service.require_user(ctx)
    return PasskeyList(
        items=[passkey_out(row) for row in await _passkeys(ctx, user.id)],
        rp_id=_rp_id(ctx),
        user_handle=bytes_to_base64url(user.id.encode()),
    )


async def register_options(ctx: Ctx) -> WebAuthnOptions:
    """A new passkey is a way into the account: it needs a recent confirmation, like Google."""
    user = service.require_user(ctx)
    await service.require_recent_auth(ctx)
    session_id = service.current_session_id(ctx)
    rows = await _passkeys(ctx, user.id)
    if len(rows) >= MAX_PASSKEYS:
        raise AppError("auth.passkey_limit", 409, max=MAX_PASSKEYS)
    options = generate_registration_options(
        rp_id=_rp_id(ctx),
        rp_name="Semestra",
        user_id=user.id.encode(),
        user_name=user.email,
        user_display_name=user.display_name,
        challenge=_new_challenge(ctx, "register", session_id),
        timeout=int(TTL["register"].total_seconds() * 1000),
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED, user_verification=UV
        ),
        # The authenticator refuses to make a second key for the same account.
        exclude_credentials=_descriptors(rows),
    )
    return _options(options)


async def register(ctx: Ctx, credential: dict[str, Any], device: str | None) -> PasskeyOut:
    user = service.require_user(ctx)
    await service.require_recent_auth(ctx)
    session_id = service.current_session_id(ctx)
    challenge = await _use_challenge(ctx, credential, "register", session_id)
    try:
        result = verify_registration_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=_rp_id(ctx),
            expected_origin=_origin(ctx),
            require_user_verification=True,
        )
    except WebAuthnException as error:
        raise _failed() from error
    credential_id = bytes_to_base64url(result.credential_id)
    taken = await ctx.db.scalar(
        select(AuthPasskey.id).where(AuthPasskey.credential_id == credential_id)
    )
    if taken is not None:
        raise AppError("auth.passkey_exists", 409)
    response = credential.get("response")
    transports = response.get("transports") if isinstance(response, dict) else None
    row = AuthPasskey(
        user_id=user.id,
        credential_id=credential_id,
        public_key=result.credential_public_key,
        sign_count=result.sign_count,
        transports=[t for t in transports if isinstance(t, str)]
        if isinstance(transports, list)
        else [],
        aaguid=result.aaguid,
        device=device,
        backed_up=result.credential_backed_up,
        created_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    return passkey_out(row)


async def _own(ctx: Ctx, passkey_id: str) -> AuthPasskey:
    user = service.require_user(ctx)
    row = await ctx.db.get(AuthPasskey, passkey_id)
    if row is None or row.user_id != user.id:
        raise not_found()
    return row


async def rename(ctx: Ctx, passkey_id: str, name: str) -> PasskeyOut:
    row = await _own(ctx, passkey_id)
    row.name = name
    return passkey_out(row)


async def delete_passkey(ctx: Ctx, passkey_id: str) -> None:
    """Always allowed: the email code remains a way in that cannot be removed."""
    await ctx.db.delete(await _own(ctx, passkey_id))
