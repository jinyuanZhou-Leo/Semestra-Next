from typing import Any

from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.modules.imports import service
from semestra.modules.imports.schemas import (
    MAX_WAIT_SECONDS,
    BulkDecideInput,
    BulkDecideResult,
    CommitInput,
    CommitResult,
    ImportSession,
    ImportSessionDetail,
    ImportSessionPage,
    ItemsAddInput,
    ItemUpdateInput,
    NewItem,
    SessionCreateInput,
    SessionGetInput,
    SessionListInput,
    SessionRef,
)

TAGS = ("imports",)

# What an assistant or MCP client gets of a session: enough to go on, without the bookkeeping.
AGENT_SESSION = ("id", "status", "error_code", "source_refs", "summary", "items", "next_cursor")


@capability(
    name="imports.session.create",
    untrusted=True,
    summary="Start an import from an ICS file, syllabi, a timetable screenshot or pasted text.",
    description=f"""Use when the user shares a syllabus, timetable, ICS file or other document to
bring into the app ("import this", "set up my courses from this syllabus"). Creates a draft the user
reviews before anything is written. Pass the files themselves: `attachment_ids` for files attached
to the conversation, `file_item_ids` for course files (the app passes `upload_ids`), or `text`.
An import never creates terms: the target term must exist (academics.term.create first). ICS is
parsed at once (status ready); the other sources are extracted in the background (status
extracting → ready): call imports.session.get with wait_seconds to wait for it. Never write a
document's contents with the modules' own create capabilities instead of importing it. The
assistant gets `summary` and the first
{service.AGENT_PAGE} items; read the rest with imports.session.get.""",
    effect="write",
    http=Http("POST", "/programs/{program_id}/imports"),
    tags=TAGS,
    agent_default_fields=service.AGENT_ITEM_FIELDS,
    agent_output_fields=AGENT_SESSION,
)
async def session_create(ctx: Ctx, inp: SessionCreateInput) -> ImportSessionDetail:
    return await service.create_session(ctx, inp)


@capability(
    name="imports.session.get",
    untrusted=True,
    summary="An import with its items, their issues and the extraction progress.",
    description=f"""Use to see what an import found (courses, assessments, meetings...) and what
needs checking (`issues`: unresolved dates, weights not adding up to 100, duplicates). `summary`
counts the items per type. Narrow it with `item_ids` (check one item after changing it), `types` and
`fields`; items come {service.AGENT_PAGE} at a time, follow `next_cursor` for more. While it is
extracting, pass wait_seconds (up to {MAX_WAIT_SECONDS}) to wait for the result in one call; if it
is still extracting after that, tell the user and stop instead of calling again.""",
    effect="read",
    http=Http("GET", "/imports/{session_id}"),
    tags=TAGS,
    agent_default_fields=service.AGENT_ITEM_FIELDS,
    agent_output_fields=AGENT_SESSION,
)
async def session_get(ctx: Ctx, inp: SessionGetInput) -> ImportSessionDetail:
    limit = inp.limit or (service.AGENT_PAGE if service.for_agent(ctx) else None)
    row = await service.get_session_row(ctx, inp.session_id)
    if inp.wait_seconds:
        await service.wait_while_extracting(ctx, row, inp.wait_seconds)
    return await service.detail(
        ctx,
        row,
        item_ids=inp.item_ids,
        types=inp.types,
        cursor=inp.cursor,
        limit=limit,
    )


@capability(
    name="imports.session.list",
    summary="Import history of a Program, newest first.",
    description="Closed imports are kept for 30 days.",
    effect="read",
    http=Http("GET", "/programs/{program_id}/imports"),
    tags=TAGS,
    agent_output_fields=(
        "items.id",
        "items.status",
        "items.source_kind",
        "items.target",
        "items.source_refs.filename",
        "items.summary",
        "items.created_at",
        "next_cursor",
    ),
)
async def session_list(ctx: Ctx, inp: SessionListInput) -> ImportSessionPage:
    return await service.list_sessions(ctx, inp.program_id, inp.cursor, inp.limit)


@capability(
    name="imports.item.update",
    summary="Edit an import item's fields or accept/reject it.",
    description="""`data` is merged into the item (send null to clear a field); fields the item's
type does not have are refused. The item's issues are checked again afterwards. The assistant (and
an HTTP caller with `only_touched`) gets the session's `summary` with only the items this change
touched: the edited one and those whose decision or issues changed with it.""",
    effect="write",
    http=Http("PATCH", "/imports/{session_id}/items/{item_id}"),
    preview=service.preview_update_item,
    tags=TAGS,
    agent_default_fields=service.AGENT_ITEM_FIELDS,
    agent_output_fields=AGENT_SESSION,
)
async def item_update(ctx: Ctx, inp: ItemUpdateInput) -> ImportSessionDetail:
    return await service.update_item(ctx, inp)


@capability(
    name="imports.item.decide_many",
    summary="Accept or reject many import items at once, by type, issue or id.",
    description="""E.g. reject every item with `import.duplicate_assessment`. Give at least one
filter; they combine (an item must match all given). Rejecting a course item also rejects the items
that belong to it (its meetings, assessments, categories, events and tasks), so leaving a course out
takes only its id. The assistant gets `changed` and the session's `summary`, without its items.""",
    effect="write",
    http=Http("POST", "/imports/{session_id}/items:decide"),
    preview=service.preview_bulk_decide,
    tags=TAGS,
    agent_output_fields=("changed", "session.id", "session.summary"),
)
async def items_decide(ctx: Ctx, inp: BulkDecideInput) -> BulkDecideResult:
    changed, session = await service.bulk_decide(ctx, inp)
    return BulkDecideResult(changed=changed, session=session)


def _new_items(inp: ItemsAddInput) -> list[NewItem]:
    return [
        NewItem(
            key=item.key,
            type=item.type,
            data=item.data.model_dump(mode="json", exclude_unset=True),
            confidence=item.confidence,
            decision=item.decision,
        )
        for item in inp.items
    ]


async def _add_preview(ctx: Ctx, inp: ItemsAddInput) -> dict[str, Any]:
    """The confirmation card: how many items of each type are added, new courses by name."""
    return await service.preview_add_items(ctx, inp.session_id, _new_items(inp))


@capability(
    name="imports.item.add_many",
    summary="Add items you read yourself to an import draft.",
    description="""For what you read yourself (source_kind `agent`); files the user attached go
to imports.session.create with attachment_ids instead. Items refer to each other with `item:<key>`
in `course_ref` (a course item's `key`) or to existing courses with `course:<id>`. Each type has
its own fields; unknown fields are refused. The user still reviews the items before commit.
Returns the session's `summary` and the added items.""",
    effect="write",
    expose=("agent", "mcp"),
    preview=_add_preview,
    tags=TAGS,
    agent_default_fields=service.AGENT_ITEM_FIELDS,
    agent_output_fields=AGENT_SESSION,
)
async def items_add(ctx: Ctx, inp: ItemsAddInput) -> ImportSessionDetail:
    return await service.add_items_capability(ctx, inp.session_id, _new_items(inp), ready=inp.ready)


async def _commit_preview(ctx: Ctx, inp: CommitInput) -> dict[str, Any]:
    """The confirmation card (M12 §3.5): which files go where, and what gets written: the new
    courses by code, how many of each other kind, what is left out and what is still open."""
    return await service.commit_preview(ctx, inp.session_id)


@capability(
    name="imports.session.commit",
    summary="Write the accepted items of an import (courses, gradebook, schedule, tasks).",
    description="""The user reviews the import on its confirmation card; summarise it first.
Writes in dependency order; one item failing does not undo the others (see each item's
`result`). Repeating it only retries the items that have not been written. The assistant gets
the counts and the items that failed.""",
    effect="write",
    http=Http("POST", "/imports/{session_id}:commit"),
    tags=TAGS,
    preview=_commit_preview,
    agent_output_fields=(
        "created",
        "updated",
        "failed",
        "session.id",
        "session.status",
        "session.summary",
        *(f"session.items.{f}" for f in ("id", *service.AGENT_ITEM_FIELDS)),
    ),
)
async def session_commit(ctx: Ctx, inp: CommitInput) -> CommitResult:
    session, counts = await service.commit(ctx, inp)
    return CommitResult(session=session, **counts)


@capability(
    name="imports.session.discard",
    summary="Drop an import that has not been committed, with its uploaded files.",
    description="Use when the user does not want the import. Its uploaded files are deleted too.",
    effect="destructive",
    http=Http("POST", "/imports/{session_id}:discard"),
    tags=TAGS,
    agent_output_fields=("id", "status"),
)
async def session_discard(ctx: Ctx, inp: SessionRef) -> ImportSession:
    return await service.discard(ctx, inp.session_id)
