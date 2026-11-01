"""Read-only ICS subscription links (M04 §4).

Looked up by the token's hash; the token is also kept encrypted so the link can be copied again
(a calendar URL is not a credential to show once, and a leaked one is reset).
"""

import hashlib
import secrets
from contextlib import suppress
from datetime import timedelta

from cryptography.fernet import InvalidToken
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.core.security import decrypt, encrypt
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.schedule.calendar import (
    Occurrence,
    collect,
)
from semestra.modules.schedule.common import columns
from semestra.modules.schedule.models import (
    ScheduleFeed,
)
from semestra.modules.schedule.schemas import (
    Feed,
    FeedCreateInput,
    FeedUpdateInput,
)
from semestra.modules.schedule.sources import calendar_query

# What each feed option includes (M04 §2 `schedule_feeds.sources`).
FEED_SOURCES: dict[str, tuple[str, ...]] = {
    "schedule": ("schedule.meetings", "schedule.events"),
    "assessments": ("grading.assessments",),
    "tasks": ("tasks.due",),
    "lms": ("lms.events",),
}


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def feed_out(ctx: Ctx, row: ScheduleFeed) -> Feed:
    data = columns(row)
    data["url"] = None
    if row.token_encrypted and row.revoked_at is None:
        # A changed encryption key leaves the link unreadable: reset gives a new one.
        with suppress(InvalidToken):
            data["url"] = feed_url(ctx, decrypt(ctx.settings, row.token_encrypted))
    return Feed.model_validate(data)


def _set_token(ctx: Ctx, row: ScheduleFeed) -> None:
    token = secrets.token_urlsafe(32)
    row.token_hash = _token_hash(token)
    row.prefix = token[:6]
    row.token_encrypted = encrypt(ctx.settings, token)


def feed_url(ctx: Ctx, token: str) -> str:
    return f"{ctx.settings.public_api_origin.rstrip('/')}/feeds/{token}.ics"


async def _active(ctx: Ctx, program_id: str) -> ScheduleFeed | None:
    return await ctx.db.scalar(
        select(ScheduleFeed)
        .where(
            ScheduleFeed.user_id == ctx.user_id,
            ScheduleFeed.program_id == program_id,
            ScheduleFeed.revoked_at.is_(None),
        )
        .order_by(ScheduleFeed.created_at.desc())
        .limit(1)
    )


async def get_feed(ctx: Ctx, program_id: str) -> Feed | None:
    """The Program's subscription link (one per Program, like Google Calendar's secret address)."""
    await academics.get_program_row(ctx, program_id)
    row = await _active(ctx, program_id)
    return feed_out(ctx, row) if row else None


async def create_feed(ctx: Ctx, inp: FeedCreateInput) -> Feed:
    """Turns the link on; the existing one is returned if it is already on (also when two requests
    race: the partial unique index keeps one live link per Program)."""
    await academics.get_program_row(ctx, inp.program_id)
    token = secrets.token_urlsafe(32)
    created = await ctx.db.execute(
        insert(ScheduleFeed)
        .values(
            id=new_id(),
            user_id=ctx.user_id,
            program_id=inp.program_id,
            token_hash=_token_hash(token),
            prefix=token[:6],
            token_encrypted=encrypt(ctx.settings, token),
            sources=list(dict.fromkeys(inp.sources)),
            created_at=ctx.now,
        )
        .on_conflict_do_nothing()
    )
    row = await _active(ctx, inp.program_id)
    assert row is not None
    if created.rowcount:  # pyright: ignore[reportAttributeAccessIssue]
        await events.publish(
            ctx, "schedule.feed.created", {"feed_id": row.id, "program_id": row.program_id}
        )
    return feed_out(ctx, row)


async def _own_feed(ctx: Ctx, feed_id: str) -> ScheduleFeed:
    row = await ctx.db.get(ScheduleFeed, feed_id)
    if row is None or row.user_id != ctx.user_id or row.revoked_at is not None:
        raise not_found("feed", feed_id)
    return row


async def _updated(ctx: Ctx, row: ScheduleFeed) -> Feed:
    await ctx.db.flush()
    await events.publish(
        ctx, "schedule.feed.updated", {"feed_id": row.id, "program_id": row.program_id}
    )
    return feed_out(ctx, row)


async def update_feed(ctx: Ctx, inp: FeedUpdateInput) -> Feed:
    row = await _own_feed(ctx, inp.feed_id)
    row.sources = list(dict.fromkeys(inp.sources))
    return await _updated(ctx, row)


async def reset_feed(ctx: Ctx, feed_id: str) -> Feed:
    """A new address for the same feed; calendars on the old one stop updating."""
    row = await _own_feed(ctx, feed_id)
    _set_token(ctx, row)
    row.last_fetched_at = None
    return await _updated(ctx, row)


async def revoke_feed(ctx: Ctx, feed_id: str) -> Feed:
    row = await ctx.db.get(ScheduleFeed, feed_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("feed", feed_id)
    if row.revoked_at is None:
        row.revoked_at = ctx.now
        await ctx.db.flush()
        await events.publish(
            ctx, "schedule.feed.revoked", {"feed_id": row.id, "program_id": row.program_id}
        )
    return feed_out(ctx, row)


async def feed_by_token(ctx: Ctx, token: str) -> ScheduleFeed:
    """Unknown tokens are not found; revoked ones say so (same status, nothing to leak)."""
    row = await ctx.db.scalar(
        select(ScheduleFeed).where(ScheduleFeed.token_hash == _token_hash(token))
    )
    if row is None:
        raise not_found()
    if row.revoked_at is not None:
        raise AppError("schedule.feed_revoked", 404)
    return row


async def feed_occurrences(
    ctx: Ctx, feed: ScheduleFeed
) -> tuple[AcademicsProgram, list[Occurrence]]:
    """The last 12 months and the next 6 months of the feed's sources."""
    program = await academics.get_program_row(ctx, feed.program_id)
    day = academics.program_today(ctx, program)
    q = calendar_query(
        program, day - timedelta(days=365), day + timedelta(days=183), None, None, max_days=600
    )
    names = [n for s in feed.sources for n in FEED_SOURCES.get(s, ())]
    feed.last_fetched_at = ctx.now
    return program, await collect(ctx, q, names)
