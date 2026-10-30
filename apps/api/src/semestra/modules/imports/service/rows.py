"""Import sessions' rows and their outputs (M08)."""

import asyncio
import time as time_
from collections.abc import Collection

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import not_found
from semestra.modules.imports.models import ImportsItem, ImportsSession
from semestra.modules.imports.schemas import (
    ImportItem,
    ImportSession,
    ImportSessionDetail,
)

WAIT_POLL_SECONDS = 0.5


async def get_session_row(ctx: Ctx, session_id: str) -> ImportsSession:
    row = await ctx.db.get(ImportsSession, session_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("session", session_id)
    return row


async def wait_while_extracting(ctx: Ctx, row: ImportsSession, seconds: int) -> None:
    """Holds the call until the background extraction ends or `seconds` pass, so the assistant
    can wait with one call instead of polling. Reads through its own session: the caller's
    transaction may not see the job's commits."""
    deadline = time_.monotonic() + seconds
    status = row.status
    while status == "extracting" and time_.monotonic() < deadline:
        await asyncio.sleep(WAIT_POLL_SECONDS)
        async with ctx.state.session_factory() as db:
            status = await db.scalar(
                select(ImportsSession.status).where(ImportsSession.id == row.id)
            )
    if status != row.status:
        # No rollback first: the driver opens a transaction only for writes, so this read sees the
        # job's commit, and a rollback would expire what the request already loaded (the user).
        await ctx.db.refresh(row)


async def session_items(ctx: Ctx, session_id: str) -> list[ImportsItem]:
    return list(
        (
            await ctx.db.scalars(
                select(ImportsItem)
                .where(ImportsItem.user_id == ctx.user_id, ImportsItem.session_id == session_id)
                .order_by(ImportsItem.position, ImportsItem.id)
            )
        ).all()
    )


async def items_of(ctx: Ctx, session_id: str) -> list[ImportsItem]:
    """The items of a session the caller already loaded (the assistant's display labels)."""
    return await session_items(ctx, session_id)


def session_out(row: ImportsSession) -> ImportSession:
    return ImportSession.model_validate(
        {
            "id": row.id,
            "program_id": row.program_id,
            "source_kind": row.source_kind,
            "target": row.target,
            "status": row.status,
            "job_id": row.job_id,
            "source_refs": row.source_refs,
            "source_meta": row.source_meta,
            "summary": row.summary,
            "error_code": row.error_code,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
            "committed_at": row.committed_at,
        }
    )


def item_out(row: ImportsItem, *, agent: bool = False) -> ImportItem:
    # `source_ref` only ties an item to its source for re-imports; an assistant never needs it.
    data = {k: v for k, v in row.data.items() if k != "source_ref"} if agent else row.data
    return ImportItem.model_validate(
        {
            "id": row.id,
            "session_id": row.session_id,
            "type": row.type,
            "data": data,
            "evidence": row.evidence,
            "confidence": row.confidence,
            "decision": row.decision,
            "issues": row.issues,
            "depends_on": row.depends_on,
            "result": row.result,
            "position": row.position,
        }
    )


# What the assistant and MCP clients get of each item unless they ask for other `fields`, and
# how many items per page: a whole session can be tens of thousands of characters.
AGENT_ITEM_FIELDS = ("type", "data", "decision", "issues", "result")


AGENT_PAGE = 25


def for_agent(ctx: Ctx) -> bool:
    """Called by an assistant or MCP client: they get trimmed, paged results. HTTP callers
    (personal access tokens included) always get the whole session."""
    return ctx.surface != "http"


async def detail(
    ctx: Ctx,
    row: ImportsSession,
    *,
    item_ids: Collection[str] | None = None,
    types: Collection[str] | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> ImportSessionDetail:
    """The session with its items: all of them, or those with these ids or types, a page at a
    time when `limit` is given (`cursor` is the position to go on from)."""
    items = [
        i
        for i in await session_items(ctx, row.id)
        if (item_ids is None or i.id in item_ids) and (types is None or i.type in types)
    ]
    start = int(cursor) if cursor and cursor.isdigit() else 0
    end = start + limit if limit is not None else len(items)
    return ImportSessionDetail(
        **session_out(row).model_dump(),
        items=[item_out(i, agent=for_agent(ctx)) for i in items[start:end]],
        next_cursor=str(end) if end < len(items) else None,
    )
