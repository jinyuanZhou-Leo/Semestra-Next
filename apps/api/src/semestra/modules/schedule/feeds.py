"""Read-only ICS subscription links (M04 §4); only the token's hash is stored."""

import hashlib
import secrets
from datetime import timedelta

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
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
    FeedCreated,
    FeedCreateInput,
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


def feed_out(row: ScheduleFeed) -> Feed:
    return Feed.model_validate(columns(row))


def feed_url(ctx: Ctx, token: str) -> str:
    return f"{ctx.settings.public_api_origin.rstrip('/')}/feeds/{token}.ics"


async def list_feeds(ctx: Ctx, program_id: str) -> list[Feed]:
    await academics.get_program_row(ctx, program_id)
    rows = (
        await ctx.db.scalars(
            select(ScheduleFeed)
            .where(ScheduleFeed.user_id == ctx.user_id, ScheduleFeed.program_id == program_id)
            .order_by(ScheduleFeed.created_at.desc())
        )
    ).all()
    return [feed_out(r) for r in rows]


async def create_feed(ctx: Ctx, inp: FeedCreateInput) -> FeedCreated:
    await academics.get_program_row(ctx, inp.program_id)
    token = secrets.token_urlsafe(32)
    row = ScheduleFeed(
        id=new_id(),
        user_id=ctx.user_id,
        program_id=inp.program_id,
        token_hash=_token_hash(token),
        prefix=token[:6],
        name=inp.name,
        sources=list(dict.fromkeys(inp.sources)),
        created_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await events.publish(
        ctx, "schedule.feed.created", {"feed_id": row.id, "program_id": row.program_id}
    )
    return FeedCreated(feed=feed_out(row), url=feed_url(ctx, token))


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
    return feed_out(row)


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
