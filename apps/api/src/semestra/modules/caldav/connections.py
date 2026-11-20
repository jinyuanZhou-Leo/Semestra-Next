"""Devices that sync a Program's to-do lists (M05 §11): their passwords, sign-in and setup."""

import hashlib
import plistlib
import secrets
import uuid
from datetime import timedelta
from urllib.parse import urlsplit

from cryptography.fernet import InvalidToken
from sqlalchemy import delete, select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.core.jobs import periodic
from semestra.core.security import seal_for, unseal_within
from semestra.modules.academics import service as academics
from semestra.modules.caldav import digest
from semestra.modules.caldav.models import CaldavConnection
from semestra.modules.caldav.schemas import (
    CaldavConnectionOut,
    CaldavConnections,
    CaldavNewConnection,
    CaldavSetupLink,
)
from semestra.modules.notifications import service as notifications

ROOT = "/caldav/"
PRINCIPAL = f"{ROOT}principal/"
HOME = f"{ROOT}lists/"
SETUP_SECONDS = 15 * 60
# A request is recorded at most this often: a device polls every few minutes, and each write
# waits for SQLite's one writer.
SEEN_EVERY = timedelta(minutes=10)
# A connection no device has signed in with is removed after this long: long enough to type the
# details in by hand, short enough that "Connect a device" pressed and abandoned leaves nothing.
UNUSED_KEPT = timedelta(days=1)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _require_available(ctx: Ctx) -> None:
    if not ctx.settings.caldav:
        raise AppError("caldav.unavailable", 404)


def server_url(ctx: Ctx) -> str:
    return f"{ctx.settings.public_api_origin.rstrip('/')}{ROOT}"


def _out(row: CaldavConnection) -> CaldavConnectionOut:
    return CaldavConnectionOut(
        id=row.id,
        program_id=row.program_id,
        client=row.client,  # pyright: ignore[reportArgumentType]
        last_seen_at=row.last_seen_at,
        created_at=row.created_at,
    )


async def list_connections(ctx: Ctx, program_id: str) -> CaldavConnections:
    await academics.get_program_row(ctx, program_id)
    rows = await ctx.db.scalars(
        select(CaldavConnection)
        .where(CaldavConnection.user_id == ctx.user_id, CaldavConnection.program_id == program_id)
        .order_by(CaldavConnection.created_at, CaldavConnection.id)
    )
    assert ctx.user is not None
    reminders = (await notifications.settings_of(ctx)).task_reminder != "off"
    return CaldavConnections(
        available=ctx.settings.caldav,
        server_url=server_url(ctx),
        username=ctx.user.email,
        items=[_out(r) for r in rows] if ctx.settings.caldav else [],
        task_notifications=reminders and await notifications.has_devices(ctx),
    )


async def create_connection(ctx: Ctx, program_id: str) -> CaldavNewConnection:
    _require_available(ctx)
    await academics.get_program_row(ctx, program_id)
    token = secrets.token_urlsafe(24)
    row = CaldavConnection(id=new_id(), user_id=ctx.user_id, program_id=program_id)
    _set_password(ctx, row, token)
    ctx.db.add(row)
    await ctx.db.flush()
    await _announce(ctx, row)
    return CaldavNewConnection(
        **_out(row).model_dump(), password=token, setup=_setup_link(ctx, row, token)
    )


async def reset_connection(ctx: Ctx, connection_id: str) -> CaldavNewConnection:
    """A new password for a device being set up again; the old one stops working at once."""
    _require_available(ctx)
    row = await _own(ctx, connection_id)
    token = secrets.token_urlsafe(24)
    _set_password(ctx, row, token)
    row.client, row.last_seen_at = None, None
    await ctx.db.flush()
    await _announce(ctx, row)
    return CaldavNewConnection(
        **_out(row).model_dump(), password=token, setup=_setup_link(ctx, row, token)
    )


def _set_password(ctx: Ctx, row: CaldavConnection, token: str) -> None:
    """The device signs in as the account's email (what setup shows it) with `token`."""
    assert ctx.user is not None
    row.token_hash = _hash(token)
    row.username = ctx.user.email
    row.digest_ha1 = digest.ha1(ctx.user.email, token)
    row.created_at = ctx.now


async def _own(ctx: Ctx, connection_id: str) -> CaldavConnection:
    row = await ctx.db.get(CaldavConnection, connection_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("connection", connection_id)
    return row


async def delete_connection(ctx: Ctx, connection_id: str) -> None:
    """The device stops syncing; what it has stays on it."""
    row = await _own(ctx, connection_id)
    await ctx.db.delete(row)
    await ctx.db.flush()
    await _announce(ctx, row)


async def _announce(ctx: Ctx, row: CaldavConnection) -> None:
    await events.publish(
        ctx, "caldav.connection.changed", {"connection_id": row.id, "program_id": row.program_id}
    )


def _setup_link(ctx: Ctx, row: CaldavConnection, password: str) -> CaldavSetupLink:
    """Good for 15 minutes; it carries the connection id and password, encrypted (the server
    keeps no copy of the password to put in the profile)."""
    code = seal_for(ctx.settings, f"{row.id}\n{password}", ctx.now)
    origin = ctx.settings.public_api_origin.rstrip("/")
    return CaldavSetupLink(
        url=f"{origin}/caldav-setup/{code}.mobileconfig",
        expires_at=ctx.now + timedelta(seconds=SETUP_SECONDS),
    )


async def setup_link(ctx: Ctx, connection_id: str, password: str) -> CaldavSetupLink:
    """A fresh link while the setup is still open (the page holds the password it was given)."""
    _require_available(ctx)
    row = await _own(ctx, connection_id)
    if not secrets.compare_digest(row.token_hash, _hash(password)):
        raise not_found("connection", connection_id)
    return _setup_link(ctx, row, password)


async def connection_by_setup_code(ctx: Ctx, code: str) -> tuple[CaldavConnection, str]:
    _require_available(ctx)
    try:
        sealed = unseal_within(ctx.settings, code, SETUP_SECONDS, ctx.now)
    except InvalidToken:
        raise not_found() from None
    connection_id, _, password = sealed.partition("\n")
    row = await ctx.db.get(CaldavConnection, connection_id)
    if row is None or not secrets.compare_digest(row.token_hash, _hash(password)):
        raise not_found()
    return row, password


def profile(ctx: Ctx, row: CaldavConnection, password: str, email: str, program_name: str) -> bytes:
    """An Apple configuration profile with one CalDAV account (Settings opens it to install).
    Unsigned, so the device shows it as unverified; the identifiers are fixed per connection,
    so installing it again replaces the account instead of adding a second one."""
    origin = urlsplit(ctx.settings.public_api_origin)
    ssl = origin.scheme == "https"
    account = uuid.uuid5(uuid.NAMESPACE_URL, f"semestra-caldav:{row.id}")
    payload = {
        "PayloadType": "com.apple.caldav.account",
        "PayloadVersion": 1,
        "PayloadIdentifier": f"app.semestra.caldav.{row.id}.account",
        "PayloadUUID": str(account).upper(),
        "PayloadDisplayName": "Semestra",
        "CalDAVAccountDescription": f"Semestra · {program_name}",
        "CalDAVHostName": origin.hostname or "",
        "CalDAVPort": origin.port or (443 if ssl else 80),
        "CalDAVUseSSL": ssl,
        "CalDAVPrincipalURL": f"{origin.scheme}://{origin.netloc}{PRINCIPAL}",
        "CalDAVUsername": row.username or email,
        "CalDAVPassword": password,
    }
    container = uuid.uuid5(uuid.NAMESPACE_URL, f"semestra-caldav:{row.id}:profile")
    return plistlib.dumps(
        {
            "PayloadType": "Configuration",
            "PayloadVersion": 1,
            "PayloadIdentifier": f"app.semestra.caldav.{row.id}",
            "PayloadUUID": str(container).upper(),
            "PayloadDisplayName": f"Semestra · {program_name}",
            "PayloadContent": [payload],
        }
    )


async def authenticate(ctx: Ctx, password: str) -> CaldavConnection | None:
    """The connection a device's password belongs to (the user name is not checked: the
    password alone is long enough to name it)."""
    if not ctx.settings.caldav or not password:
        return None
    return await ctx.db.scalar(
        select(CaldavConnection).where(CaldavConnection.token_hash == _hash(password))
    )


async def authenticate_digest(
    ctx: Ctx, credentials: digest.Credentials, method: str
) -> CaldavConnection | None:
    """The connection whose password produced this Digest response (the user name narrows it
    to that person's devices; the password tells them apart)."""
    if not ctx.settings.caldav:
        return None
    rows = await ctx.db.scalars(
        select(CaldavConnection).where(CaldavConnection.username == credentials.username)
    )
    for row in rows:
        if row.digest_ha1 and digest.matches(credentials, row.digest_ha1, method):
            return row
    return None


def mark_seen(ctx: Ctx, row: CaldavConnection, user_agent: str) -> bool:
    """Records the device and when it last synced; True when that changed what users see."""
    changed = False
    if row.client is None:
        row.client = _client(user_agent)
        changed = True
    if row.last_seen_at is None or row.last_seen_at <= ctx.now - SEEN_EVERY:
        row.last_seen_at = ctx.now
        changed = True
    return changed


def _client(user_agent: str) -> str:
    """Apple's sync daemon sends `iOS/18.1 (22B83) dataaccessd/1.0` or `macOS/15.1 …`."""
    agent = user_agent.lower()
    if agent.startswith(("ios/", "ipados/")) or "iphone" in agent or "ipad" in agent:
        return "ios"
    if agent.startswith(("macos/", "mac os x/", "mac_os_x/")) or "macintosh" in agent:
        return "macos"
    return "other"


async def announce_seen(ctx: Ctx, row: CaldavConnection) -> None:
    await _announce(ctx, row)


@periodic("caldav.cleanup", every=timedelta(hours=1))
async def cleanup(ctx: Ctx) -> None:
    """Removes connections no device ever signed in with (`UNUSED_KEPT`)."""
    await ctx.db.execute(
        delete(CaldavConnection).where(
            CaldavConnection.last_seen_at.is_(None),
            CaldavConnection.created_at < ctx.now - UNUSED_KEPT,
        )
    )
