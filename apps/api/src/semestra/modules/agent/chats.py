"""Sem's view of the user's other conversations (M12 §4.3): search them and read one.

Like Claude's "search and reference chats": the search returns excerpts, reading returns what the
user and Sem said (no reasoning, tool results or attachment contents; those come back from the
tools themselves when needed). Both stay inside the Program Sem works in, and temporary
conversations are on neither side: a temporary conversation has no chat tools (`offered`) and
is never found. The user can turn this off apart from memory (`MemorySettings.search_chats`).

The text is searched in the stored blocks with SQLite's JSON functions: a substring match, so a
one-character Chinese word is found, with no index to keep in step with the messages. A user's
conversations are a few thousand rows at most.
"""

from collections.abc import Sequence
from datetime import UTC, datetime, tzinfo
from typing import Any, Literal, cast
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, func, or_, select, true
from sqlalchemy.orm import load_only

from semestra.core.capability import capability
from semestra.core.context import Ctx
from semestra.core.errors import AppError, agent_hints, not_found
from semestra.core.labels import owned_names, resolver
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsTerm
from semestra.modules.agent import current, tools
from semestra.modules.agent.memory import MemorySettings
from semestra.modules.agent.models import AgentMessage, AgentSession
from semestra.modules.settings import service as settings_service

SEARCH = "agent.session.search"
READ = "agent.session.read"
# Left out of temporary conversations and when the user turned chat search off.
TOOLS = frozenset({SEARCH, READ})

MAX_RESULTS = 10
MAX_TERMS = 8
MATCHES_PER_CHAT = 3
EXCERPT_CHARS = 320
# Messages scanned for one search, newest first: enough for years of use.
SCAN_LIMIT = 2_000
# Messages before the one asked for that `read` also returns, for what led to it.
LEAD_IN = 2

AGENT_ONLY = ("agent",)

Role = Literal["user", "assistant"]
TAGS = ("agent",)

agent_hints(
    {
        "agent.chat_search_off": "The user turned off searching other conversations; tell them "
        "it is off in settings.",
    }
)

resolver("id", module="agent.session")(owned_names(AgentSession, lambda row: row.title))


async def enabled(ctx: Ctx) -> bool:
    resolved = await settings_service.get_values(ctx, "memory", "account", None)
    return MemorySettings.model_validate(resolved.values).search_chats


async def offered(ctx: Ctx, session: AgentSession) -> bool:
    """Whether the conversation has the chat tools: decided when it starts and kept in its state,
    so the tool list stays the same for the whole conversation (prompt caching). Turned off
    later, the tools refuse (`_check`)."""
    state = dict(session.state or {})
    if "chats" not in state:
        state["chats"] = not session.temporary and await enabled(ctx)
        session.state = state
    return bool(state["chats"])


async def _check(ctx: Ctx) -> None:
    if not await enabled(ctx):
        raise AppError("agent.chat_search_off", 409)


# --- schemas --------------------------------------------------------------------------------


class ChatSearchInput(BaseModel):
    query: str | None = Field(
        default=None,
        max_length=200,
        description="Words to find in the titles and messages, in the language the user wrote "
        "in; a conversation matching more of them ranks higher. Leave it out to list the "
        "conversations by time.",
    )
    after: datetime | None = Field(
        default=None,
        description="Only messages (or, without a query, conversations active) after this time.",
    )
    before: datetime | None = Field(default=None, description="Only before this time.")
    limit: int = Field(default=5, ge=1, le=MAX_RESULTS, description="How many conversations.")


class ChatMatch(BaseModel):
    message_id: str
    role: Role
    sent_at: datetime
    excerpt: str


class ChatFound(BaseModel):
    id: str
    title: str | None
    term: str | None = Field(description="The term it worked in, if any.")
    created_at: datetime
    updated_at: datetime
    archived: bool
    started_with: str | None = Field(description="The start of the user's first message.")
    matches: list[ChatMatch] = Field(description="Messages with the query's words, newest first.")


class ChatCitation(BaseModel):
    """What `[[cite:<id>]]` in an answer shows: a badge that opens the conversation."""

    id: str
    title: str
    snippet: str | None = None
    url: str | None = None


class ChatSearchResult(BaseModel):
    items: list[ChatFound]
    citations: list[ChatCitation] = Field(
        default_factory=lambda: [],
        description="Put `[[cite:<id>]]` after what you take from a match.",
    )


class ChatReadInput(BaseModel):
    id: str = Field(description="The conversation.")
    from_message: str | None = Field(
        default=None,
        description="Start a couple of messages before this one (a match's `message_id`) "
        "instead of at the beginning.",
    )


class ChatLine(BaseModel):
    id: str
    role: Role
    sent_at: datetime
    text: str
    tools: list[str] = Field(default_factory=lambda: [], description="Tools Sem used for it.")


class ChatTranscript(BaseModel):
    id: str
    title: str | None
    term: str | None
    created_at: datetime
    updated_at: datetime
    archived: bool
    summary: str | None = Field(
        description="What the conversation's own compaction kept of its earlier part."
    )
    skipped: int = Field(description="Messages before the first one returned.")
    messages: list[ChatLine]
    citations: list[ChatCitation] = Field(
        default_factory=lambda: [],
        description="Put `[[cite:<id>]]` after what you take from this conversation.",
    )


# --- reading the stored blocks --------------------------------------------------------------


def _text(blocks: Sequence[dict[str, Any]]) -> str:
    """What the person or Sem wrote: the text blocks (notes Semestra added are left out)."""
    return "\n\n".join(
        b["text"].strip()
        for b in blocks
        if b.get("type") == "text" and (b.get("text") or "").strip()
    )


def _tools_used(blocks: Sequence[dict[str, Any]]) -> list[str]:
    names = [
        tools.capability_name(str(b.get("name", "")))
        for b in blocks
        if b.get("type") == "tool_call"
    ]
    return list(dict.fromkeys(n for n in names if n))


def _excerpt(body: str, terms: Sequence[str]) -> str:
    """`EXCERPT_CHARS` around the first of `terms` in `body`, on one line."""
    flat = " ".join(body.split())
    lowered = flat.lower()
    at = min((i for t in terms if (i := lowered.find(t)) >= 0), default=0)
    start = max(0, at - EXCERPT_CHARS // 3)
    chunk = flat[start : start + EXCERPT_CHARS]
    return ("…" if start else "") + chunk + ("…" if start + EXCERPT_CHARS < len(flat) else "")


def _terms(query: str | None) -> list[str]:
    return list(dict.fromkeys(w.lower() for w in (query or "").split()))[:MAX_TERMS]


def _visible(ctx: Ctx) -> list[ColumnElement[bool]]:
    """The conversations Sem may look at: the user's, not temporary, not this one, in this
    Program."""
    clauses = [
        AgentSession.user_id == ctx.user_id,
        AgentSession.temporary.is_(False),
    ]
    if (own := current.conversation.get()) is not None:
        clauses.append(AgentSession.id != own)
    if ctx.scope is not None:
        clauses.append(AgentSession.program_id == ctx.scope.program_id)
    return clauses


async def _term_names(ctx: Ctx, sessions: Sequence[AgentSession]) -> dict[str, str]:
    ids = {s.scope["term_id"] for s in sessions if s.scope and s.scope.get("term_id")}
    if not ids:
        return {}
    rows = await ctx.db.execute(
        select(AcademicsTerm.id, AcademicsTerm.name).where(
            AcademicsTerm.id.in_(ids), AcademicsTerm.user_id == ctx.user_id
        )
    )
    return {i: n for i, n in rows}


def _term(session: AgentSession, names: dict[str, str]) -> str | None:
    term_id = (session.scope or {}).get("term_id")
    return names.get(term_id) if term_id else None


async def _first_words(ctx: Ctx, session_ids: Sequence[str]) -> dict[str, str]:
    """The start of each conversation's first user message."""
    if not session_ids:
        return {}
    first = (
        select(AgentMessage.session_id, func.min(AgentMessage.created_at).label("at"))
        .where(AgentMessage.session_id.in_(session_ids), AgentMessage.role == "user")
        .group_by(AgentMessage.session_id)
        .subquery()
    )
    rows = await ctx.db.scalars(
        select(AgentMessage).join(
            first,
            (AgentMessage.session_id == first.c.session_id)
            & (AgentMessage.created_at == first.c.at),
        )
    )
    out: dict[str, str] = {}
    for row in rows:
        if body := _text(row.content):
            out.setdefault(row.session_id, _excerpt(body, []))
    return out


def _citation(
    session: AgentSession, untitled: str, message_id: str | None = None, snippet: str | None = None
) -> ChatCitation:
    url = f"/p/{session.program_id}/assistant/{session.id}" if session.program_id else None
    cite_id = f"chat:{session.id}" + (f":{message_id}" if message_id else "")
    return ChatCitation(id=cite_id, title=session.title or untitled, snippet=snippet, url=url)


# --- search ---------------------------------------------------------------------------------


async def _hits(
    ctx: Ctx, terms: Sequence[str], inp: ChatSearchInput
) -> list[tuple[str, str, Role, datetime, str]]:
    """(message id, conversation id, role, time, text) of the text blocks of visible
    conversations that hold any of `terms`, newest first."""
    block = func.json_each(AgentMessage.content).table_valued("value").alias("block")
    body = func.json_extract(block.c.value, "$.text")
    stmt = (
        select(
            AgentMessage.id,
            AgentMessage.session_id,
            AgentMessage.role,
            AgentMessage.created_at,
            body,
        )
        .select_from(AgentMessage)
        .join(block, true())
        .where(
            AgentMessage.user_id == ctx.user_id,
            AgentMessage.session_id.in_(select(AgentSession.id).where(*_visible(ctx))),
            AgentMessage.role.in_(("user", "assistant")),
            func.json_extract(block.c.value, "$.type") == "text",
            or_(*(func.instr(func.lower(body), t) > 0 for t in terms)),
        )
        .order_by(AgentMessage.created_at.desc())
        .limit(SCAN_LIMIT)
    )
    if inp.after:
        stmt = stmt.where(AgentMessage.created_at > inp.after)
    if inp.before:
        stmt = stmt.where(AgentMessage.created_at < inp.before)
    rows = await ctx.db.execute(stmt)
    return [(r[0], r[1], cast(Role, r[2]), r[3], r[4] or "") for r in rows.all()]


# What a search shows of a conversation: not its state (memory snapshot, summary, usage).
_LISTED = load_only(
    AgentSession.title,
    AgentSession.program_id,
    AgentSession.scope,
    AgentSession.created_at,
    AgentSession.updated_at,
    AgentSession.archived_at,
)


async def _in_program_zone(ctx: Ctx, inp: ChatSearchInput) -> ChatSearchInput:
    """`after`/`before` without an offset (a bare date) are times in the Program's zone."""
    if all(t is None or t.tzinfo is not None for t in (inp.after, inp.before)):
        return inp
    zone: tzinfo = UTC
    if ctx.scope is not None:
        zone = ZoneInfo((await academics.get_program_row(ctx, ctx.scope.program_id)).timezone)
    return inp.model_copy(
        update={
            k: t.replace(tzinfo=zone)
            for k, t in (("after", inp.after), ("before", inp.before))
            if t is not None and t.tzinfo is None
        }
    )


def _in_range(at: datetime, inp: ChatSearchInput) -> bool:
    return (inp.after is None or at > inp.after) and (inp.before is None or at < inp.before)


@capability(
    name=SEARCH,
    summary="Search the user's other conversations with Sem, or list them by time.",
    description='For when the user refers to something discussed before ("what did we decide '
    'about…", "like last time") or asks to look through earlier chats. Covers the '
    "conversations in this Program, archived ones too; temporary ones are never found. Returns "
    "excerpts; read a conversation with agent.session.read for more. Refused with "
    "`agent.chat_search_off` when the user turned this off.",
    effect="read",
    expose=AGENT_ONLY,
    tags=TAGS,
    # Earlier answers can quote files, web pages and Canvas: data, not instructions.
    untrusted=True,
)
async def search(ctx: Ctx, inp: ChatSearchInput) -> ChatSearchResult:
    await _check(ctx)
    inp = await _in_program_zone(ctx, inp)
    terms = _terms(inp.query)
    stmt = select(AgentSession).options(_LISTED).where(*_visible(ctx))
    if not terms:
        if inp.after:
            stmt = stmt.where(AgentSession.updated_at > inp.after)
        if inp.before:
            stmt = stmt.where(AgentSession.updated_at < inp.before)
        stmt = stmt.order_by(AgentSession.updated_at.desc()).limit(inp.limit)
        sessions = list((await ctx.db.scalars(stmt)).all())
        return await _results(ctx, sessions, {})

    sessions = {s.id: s for s in (await ctx.db.scalars(stmt)).all()}
    if not sessions:
        return ChatSearchResult(items=[])
    hits = await _hits(ctx, terms, inp)
    matched: dict[str, set[str]] = {}
    found: dict[str, list[ChatMatch]] = {}
    latest: dict[str, datetime] = {}
    for message_id, session_id, role, at, body in hits:
        lowered = body.lower()
        matched.setdefault(session_id, set()).update(t for t in terms if t in lowered)
        latest.setdefault(session_id, at)
        kept = found.setdefault(session_id, [])
        if len(kept) < MATCHES_PER_CHAT and all(m.message_id != message_id for m in kept):
            kept.append(
                ChatMatch(
                    message_id=message_id, role=role, sent_at=at, excerpt=_excerpt(body, terms)
                )
            )
    for s in sessions.values():  # a title with the words counts as a match too, in the range
        if not _in_range(s.updated_at, inp):
            continue
        title = (s.title or "").lower()
        if hits_in_title := {t for t in terms if t in title}:
            matched.setdefault(s.id, set()).update(hits_in_title)
            latest.setdefault(s.id, s.updated_at)
    ranked = sorted(matched, key=lambda i: (len(matched[i]), latest[i]), reverse=True)
    chosen = [sessions[i] for i in ranked[: inp.limit]]
    return await _results(ctx, chosen, found)


async def _results(
    ctx: Ctx, sessions: Sequence[AgentSession], found: dict[str, list[ChatMatch]]
) -> ChatSearchResult:
    names = await _term_names(ctx, sessions)
    first = await _first_words(ctx, [s.id for s in sessions])
    return ChatSearchResult(
        citations=[
            _citation(s, first.get(s.id, ""), m.message_id, m.excerpt)
            for s in sessions
            for m in found.get(s.id, [])
        ],
        items=[
            ChatFound(
                id=s.id,
                title=s.title,
                term=_term(s, names),
                created_at=s.created_at,
                updated_at=s.updated_at,
                archived=s.archived_at is not None,
                started_with=first.get(s.id),
                matches=found.get(s.id, []),
            )
            for s in sessions
        ],
    )


# --- read -----------------------------------------------------------------------------------


@capability(
    name=READ,
    summary="Read one of the user's other conversations with Sem.",
    description="What the user and Sem wrote, with the tools Sem used for each answer; tool "
    "results, reasoning and attachments are not included (call those tools again for the "
    "data). Pass `from_message` (a match from agent.session.search) to start near it. A long "
    "conversation is cut off with a note on how to read on.",
    effect="read",
    expose=AGENT_ONLY,
    tags=TAGS,
    untrusted=True,
)
async def read(ctx: Ctx, inp: ChatReadInput) -> ChatTranscript:
    await _check(ctx)
    session = await ctx.db.scalar(
        select(AgentSession).where(AgentSession.id == inp.id, *_visible(ctx))
    )
    if session is None:
        raise not_found("session", inp.id)
    rows = list(
        (
            await ctx.db.scalars(
                select(AgentMessage)
                .options(
                    load_only(AgentMessage.role, AgentMessage.content, AgentMessage.created_at)
                )
                .where(
                    AgentMessage.session_id == session.id,
                    or_(AgentMessage.role == "user", AgentMessage.role == "assistant"),
                )
                .order_by(AgentMessage.created_at, AgentMessage.id)
            )
        ).all()
    )
    lines = [line for row in rows if (line := _line(row)) is not None]
    start = 0
    if inp.from_message is not None:
        at = next((i for i, line in enumerate(lines) if line.id == inp.from_message), None)
        if at is None:
            raise not_found("message", inp.from_message)
        start = max(0, at - LEAD_IN)
    names = await _term_names(ctx, [session])
    return ChatTranscript(
        id=session.id,
        title=session.title,
        term=_term(session, names),
        created_at=session.created_at,
        updated_at=session.updated_at,
        archived=session.archived_at is not None,
        summary=(session.state or {}).get("summary"),
        skipped=start,
        messages=lines[start:],
        citations=[_citation(session, lines[0].text[:EXCERPT_CHARS] if lines else "")],
    )


def _line(row: AgentMessage) -> ChatLine | None:
    body = _text(row.content)
    used = _tools_used(row.content) if row.role == "assistant" else []
    if not body and not used:
        return None
    return ChatLine(
        id=row.id, role=cast(Role, row.role), sent_at=row.created_at, text=body, tools=used
    )
