"""Devices that sync a Program's to-do lists (M05 §11): their passwords, sign-in and setup."""

import hashlib
import plistlib
import secrets
import uuid
from contextlib import suppress
from datetime import timedelta
from urllib.parse import urlsplit

from cryptography.fernet import InvalidToken
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.core.security import decrypt, encrypt, seal_for, unseal_within
from semestra.modules.academics import service as academics
from semestra.modules.caldav.models import CaldavConnection
from semestra.modules.caldav.schemas import CaldavConnectionOut, CaldavConnections, CaldavSetupLink

ROOT = "/caldav/"
PRINCIPAL = f"{ROOT}principal/"
HOME = f"{ROOT}lists/"
SETUP_SECONDS = 15 * 60
# A request is recorded at most this often: a device polls every few minutes, and each write
# waits for SQLite's one writer.
SEEN_EVERY = timedelta(minutes=10)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _require_available(ctx: Ctx) -> None:
    if not ctx.settings.caldav:
        raise AppError("caldav.unavailable", 404)


def server_url(ctx: Ctx) -> str:
    return f"{ctx.settings.public_api_origin.rstrip('/')}{ROOT}"


def _out(ctx: Ctx, row: CaldavConnection) -> CaldavConnectionOut:
    password = None
    with suppress(InvalidToken):
        password = decrypt(ctx.settings, row.token_encrypted)
    return CaldavConnectionOut(
        id=row.id,
        program_id=row.program_id,
        client=row.client,  # pyright: ignore[reportArgumentType]
        last_seen_at=row.last_seen_at,
        created_at=row.created_at,
        password=password,
    )


async def list_connections(ctx: Ctx, program_id: str) -> CaldavConnections:
    await academics.get_program_row(ctx, program_id)
    rows = await ctx.db.scalars(
        select(CaldavConnection)
        .where(CaldavConnection.user_id == ctx.user_id, CaldavConnection.program_id == program_id)
        .order_by(CaldavConnection.created_at, CaldavConnection.id)
    )
    assert ctx.user is not None
    return CaldavConnections(
        available=ctx.settings.caldav,
        server_url=server_url(ctx),
        username=ctx.user.email,
        items=[_out(ctx, r) for r in rows] if ctx.settings.caldav else [],
    )


async def create_connection(ctx: Ctx, program_id: str) -> CaldavConnectionOut:
    _require_available(ctx)
    await academics.get_program_row(ctx, program_id)
    token = secrets.token_urlsafe(24)
    row = CaldavConnection(
        id=new_id(),
        user_id=ctx.user_id,
        program_id=program_id,
        token_hash=_hash(token),
        token_encrypted=encrypt(ctx.settings, token),
        created_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await _announce(ctx, row)
    return _out(ctx, row)


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


async def setup_link(ctx: Ctx, connection_id: str) -> CaldavSetupLink:
    """A link that is good for 15 minutes; it carries the connection id, encrypted."""
    _require_available(ctx)
    row = await _own(ctx, connection_id)
    code = seal_for(ctx.settings, row.id, ctx.now)
    origin = ctx.settings.public_api_origin.rstrip("/")
    return CaldavSetupLink(
        url=f"{origin}/caldav-setup/{code}.mobileconfig",
        expires_at=ctx.now + timedelta(seconds=SETUP_SECONDS),
    )


async def connection_by_setup_code(ctx: Ctx, code: str) -> CaldavConnection:
    _require_available(ctx)
    try:
        connection_id = unseal_within(ctx.settings, code, SETUP_SECONDS, ctx.now)
    except InvalidToken:
        raise not_found() from None
    row = await ctx.db.get(CaldavConnection, connection_id)
    if row is None:
        raise not_found()
    return row


def profile(ctx: Ctx, row: CaldavConnection, email: str, program_name: str) -> bytes:
    """An Apple configuration profile with one CalDAV account (Settings opens it to install).
    Unsigned, so the device shows it as unverified; the identifiers are fixed per connection,
    so installing it again replaces the account instead of adding a second one."""
    origin = urlsplit(ctx.settings.public_api_origin)
    ssl = origin.scheme == "https"
    password = decrypt(ctx.settings, row.token_encrypted)
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
        "CalDAVUsername": email,
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
