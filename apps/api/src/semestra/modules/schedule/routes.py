"""ICS download and the public subscription feed (M04 §4): files, not JSON, so plain routes."""

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from semestra.core.context import Ctx, get_anonymous_ctx, get_ctx, run_after_commit
from semestra.core.errors import not_found
from semestra.modules.academics import service as academics
from semestra.modules.auth.models import AuthUser
from semestra.modules.auth.ratelimit import hit
from semestra.modules.schedule import common, feeds
from semestra.modules.schedule.ics import build_calendar
from semestra.modules.schedule.schemas import OccurrencesInput
from semestra.modules.schedule.sources import occurrences

router = APIRouter(tags=["schedule"])

FEED_LIMIT = 60  # fetches per token and hour; calendar apps poll every 15 minutes or slower
FEED_WINDOW = timedelta(hours=1)


def _ics(body: bytes, filename: str, *, cache: str) -> Response:
    return Response(
        body,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": cache,
        },
    )


@router.get("/programs/{program_id}/calendar.ics", include_in_schema=False)
async def export_ics(
    program_id: str,
    ctx: Annotated[Ctx, Depends(get_ctx)],
    start: date,
    end: date,
    sources: Annotated[list[str] | None, Query()] = None,
    term_id: str | None = None,
    course_ids: Annotated[list[str] | None, Query()] = None,
    exclude_course_ids: Annotated[list[str] | None, Query()] = None,
) -> Response:
    """`schedule.export.ics`: the same parameters as `calendar.occurrence.list`, up to 400 days so
    a whole year can be exported, plus `exclude_course_ids` for courses hidden in the calendar
    filters (items without a course stay)."""
    inp = OccurrencesInput(
        program_id=program_id,
        start=start,
        end=end,
        sources=sources,
        term_id=term_id,
        course_ids=course_ids,
    )
    result = await occurrences(ctx, inp, max_days=common.EXPORT_MAX_RANGE_DAYS)
    program = await academics.get_program_row(ctx, program_id)
    hidden = set(exclude_course_ids or ())
    items = [o for o in result.items if o.course_id is None or o.course_id not in hidden]
    body = build_calendar(program.name, result.timezone, items, ctx.now)
    return _ics(body, "semestra.ics", cache="no-store")


@router.get("/feeds/{token}.ics", include_in_schema=False)
async def feed(token: str, ctx: Annotated[Ctx, Depends(get_anonymous_ctx)]) -> Response:
    """Public: the token is the credential. Rate limited per feed; unknown tokens are looked up
    first so they cannot create limiter rows."""
    row = await feeds.feed_by_token(ctx, token)
    await hit(
        ctx.db, ctx.settings, ctx.now, "schedule.feed", row.id, limit=FEED_LIMIT, window=FEED_WINDOW
    )
    user = await ctx.db.get(AuthUser, row.user_id)
    if user is None:
        raise not_found()
    ctx.user = user
    program, items = await feeds.feed_occurrences(ctx, row)
    body = build_calendar(program.name, program.timezone, items, ctx.now)
    await ctx.db.commit()
    await run_after_commit(ctx)
    return _ics(body, "semestra.ics", cache="private, max-age=300")
