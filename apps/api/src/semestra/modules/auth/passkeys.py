"""Passkeys (WebAuthn): sign in, confirm it's you, and the user's list of them (M01 §4.9).

The relying party is the web app: its ID is the host of `PUBLIC_WEB_ORIGIN` and answers must
come from that origin, so the API may live on another host. Only discoverable credentials are
created, so signing in needs no email address first. Attestation is not requested: which
authenticator made a key only names it in the list.
"""

import json
from datetime import timedelta
from typing import Any, Literal
from urllib.parse import urlsplit

from sqlalchemy import delete, select
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
from semestra.modules.auth.models import AuthPasskey, AuthUser, AuthWebAuthnChallenge
from semestra.modules.auth.schemas import PasskeyOut, WebAuthnOptions

CHALLENGE_TTL = timedelta(minutes=5)
TIMEOUT_MS = 300_000
MAX_PASSKEYS = 20
Purpose = Literal["login", "reauth", "register"]

# Names for well-known passkey providers, by the AAGUID their keys report. Keys of other
# providers (and Apple's, which report zeros) are named after the device by the client.
KNOWN_AAGUIDS = {
    "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
    "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Mac",
    "771b48fd-d3d4-4f74-9232-fc157ab0507a": "Edge on Mac",
    "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
    "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
    "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
    "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
    "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain",
    "d3452668-01fd-4c12-926c-83a4204853aa": "Microsoft Password Manager",
    "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
    "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
    "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
    "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
    "b84e4048-15dc-4dd0-8640-f4f60813c8af": "NordPass",
    "0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6": "Keeper",
    "b78a0a55-6ef8-d246-a042-ba0f6d55050c": "LastPass",
    "50726f74-6f6e-5061-7373-50726f746f6e": "Proton Pass",
    "f3809540-7f14-49c1-a8b3-8f813b225541": "Enpass",
    "fdb141b2-5d84-443e-8a35-4698c205a502": "KeePassXC",
}


def _origin(ctx: Ctx) -> str:
    return ctx.settings.public_web_origin.rstrip("/")


def _rp_id(ctx: Ctx) -> str:
    return urlsplit(_origin(ctx)).hostname or "localhost"


def _failed() -> AppError:
    return AppError("auth.passkey_failed", 401)


def passkey_out(row: AuthPasskey) -> PasskeyOut:
    return PasskeyOut(
        id=row.id,
        name=row.name,
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


async def _challenge(
    ctx: Ctx, purpose: Purpose, challenge: bytes, session_id: str | None
) -> AuthWebAuthnChallenge:
    row = AuthWebAuthnChallenge(
        purpose=purpose,
        session_id=session_id,
        challenge=challenge,
        expires_at=ctx.now + CHALLENGE_TTL,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    return row


async def _take_challenge(
    ctx: Ctx, challenge_id: str, purpose: Purpose, session_id: str | None
) -> bytes:
    """The challenge's bytes; it is used up whether the answer turns out right or not."""
    row = await ctx.db.get(AuthWebAuthnChallenge, challenge_id)
    if row is None or row.purpose != purpose or row.session_id != session_id:
        raise _failed()
    await ctx.db.execute(
        delete(AuthWebAuthnChallenge).where(AuthWebAuthnChallenge.id == challenge_id)
    )
    # Committed now, so a wrong answer cannot be retried against the same challenge.
    await ctx.db.commit()
    if row.expires_at < ctx.now:
        raise _failed()
    return row.challenge


def _options(row: AuthWebAuthnChallenge, options: Any) -> WebAuthnOptions:
    return WebAuthnOptions(challenge_id=row.id, options=json.loads(options_to_json(options)))


# --- signing in -----------------------------------------------------------------------------


async def login_options(ctx: Ctx) -> WebAuthnOptions:
    options = generate_authentication_options(
        rp_id=_rp_id(ctx),
        timeout=TIMEOUT_MS,
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    row = await _challenge(ctx, "login", options.challenge, None)
    return _options(row, options)


async def _verify(
    ctx: Ctx, credential: dict[str, Any], challenge: bytes, user_id: str | None
) -> AuthPasskey:
    """Checks an answer to `navigator.credentials.get`; `user_id` limits it to that user."""
    credential_id = credential.get("id")
    if not isinstance(credential_id, str):
        raise _failed()
    query = select(AuthPasskey).where(AuthPasskey.credential_id == credential_id)
    if user_id is not None:
        query = query.where(AuthPasskey.user_id == user_id)
    passkey = await ctx.db.scalar(query)
    if passkey is None:
        raise _failed()
    try:
        result = verify_authentication_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=_rp_id(ctx),
            expected_origin=_origin(ctx),
            credential_public_key=passkey.public_key,
            credential_current_sign_count=passkey.sign_count,
        )
    except WebAuthnException as exc:
        raise _failed() from exc
    passkey.sign_count = result.new_sign_count
    passkey.backed_up = result.credential_backed_up
    passkey.last_used_at = ctx.now
    return passkey


async def login(
    ctx: Ctx,
    challenge_id: str,
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
    challenge = await _take_challenge(ctx, challenge_id, "login", None)
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
        timeout=TIMEOUT_MS,
        allow_credentials=_descriptors(rows),
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    row = await _challenge(ctx, "reauth", options.challenge, session_id)
    return _options(row, options)


async def reauth(ctx: Ctx, challenge_id: str, credential: dict[str, Any]) -> None:
    user = service.require_user(ctx)
    session_id = service.current_session_id(ctx)
    challenge = await _take_challenge(ctx, challenge_id, "reauth", session_id)
    await _verify(ctx, credential, challenge, user.id)
    await service.mark_verified(ctx, session_id)


# --- the user's passkeys --------------------------------------------------------------------


async def list_passkeys(ctx: Ctx) -> list[PasskeyOut]:
    user = service.require_user(ctx)
    return [passkey_out(row) for row in await _passkeys(ctx, user.id)]


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
        timeout=TIMEOUT_MS,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        # The authenticator refuses to make a second key for the same account.
        exclude_credentials=_descriptors(rows),
    )
    row = await _challenge(ctx, "register", options.challenge, session_id)
    return _options(row, options)


async def register(
    ctx: Ctx, challenge_id: str, credential: dict[str, Any], device: str | None
) -> PasskeyOut:
    user = service.require_user(ctx)
    await service.require_recent_auth(ctx)
    session_id = service.current_session_id(ctx)
    challenge = await _take_challenge(ctx, challenge_id, "register", session_id)
    try:
        result = verify_registration_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=_rp_id(ctx),
            expected_origin=_origin(ctx),
        )
    except WebAuthnException as exc:
        raise _failed() from exc
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
        name=KNOWN_AAGUIDS.get(result.aaguid) or device,
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
