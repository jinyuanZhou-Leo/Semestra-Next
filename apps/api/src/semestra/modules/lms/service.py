"""Connections, Program bindings, course links and the read interface (M09 §3-§5).

Provider calls go through `call`: it decrypts the credentials, opens the guarded HTTP client
and, for reads, the cache (`cache.py`). Imports live in `imports.py`, the calendar source in
`calendar.py`.
"""

import json
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import structlog
from cryptography.fernet import InvalidToken
from pydantic import BaseModel, SecretStr
from sqlalchemy import delete, func, select

from semestra.core.context import Ctx, system_ctx
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.core.http import safe_client
from semestra.core.security import decrypt, encrypt
from semestra.modules.academics import service as academics
from semestra.modules.lms import cache, html
from semestra.modules.lms.errors import BROKEN_ON_READ, CONNECTION_ERRORS, lms_error
from semestra.modules.lms.models import (
    LmsConnection,
    LmsCourseLink,
    LmsImportedRef,
    LmsProgramBinding,
)
from semestra.modules.lms.providers import Io, LmsProvider, all_providers, get_provider
from semestra.modules.lms.schemas.dto import ConnectionSummary, LmsFeature
from semestra.modules.lms.schemas.io import (
    BindingSetInput,
    Connection,
    ConnectionCheck,
    ConnectionCreateInput,
    ConnectionDeleted,
    ConnectionUpdateInput,
    ConnectionValidateInput,
    CourseLink,
    CourseLinkState,
    ExternalCourse,
    ExternalCourseList,
    LinkSetInput,
    ProgramBinding,
    ProviderInfo,
)

log = structlog.get_logger()

# Bumped when the encryption scheme of stored credentials changes (M09 §3).
CREDENTIALS_VERSION = "v1"


# --- providers ------------------------------------------------------------------------------


def providers() -> list[ProviderInfo]:
    return [
        ProviderInfo(
            kind=p.kind,
            display_name=p.display_name,
            features=sorted(p.features),
            config_schema=p.config_model.model_json_schema(),
            credentials_schema=p.credentials_model.model_json_schema(),
        )
        for p in all_providers()
    ]


# --- credentials ----------------------------------------------------------------------------


def _plain(raw: dict[str, SecretStr] | None) -> dict[str, Any]:
    return {k: v.get_secret_value() for k, v in (raw or {}).items()}


def _seal(ctx: Ctx, creds: BaseModel) -> str:
    dumped = {
        k: v.get_secret_value() if isinstance(v, SecretStr) else v for k, v in dict(creds).items()
    }
    return f"{CREDENTIALS_VERSION}:{encrypt(ctx.settings, json.dumps(dumped))}"


def _open(ctx: Ctx, provider: LmsProvider, row: LmsConnection) -> BaseModel:
    sealed = row.credentials_encrypted
    if not sealed:
        raise lms_error("lms.credentials_missing")
    version, _, token = sealed.partition(":")
    if version != CREDENTIALS_VERSION:
        raise lms_error("lms.credentials_missing")
    try:
        data = json.loads(decrypt(ctx.settings, token))
    except InvalidToken:  # the encryption key changed: the user enters the token again
        raise lms_error("lms.credentials_missing") from None
    return provider.credentials_model.model_validate(data)


def _config(provider: LmsProvider, row: LmsConnection) -> BaseModel:
    return provider.config_model.model_validate(row.config_json)


@asynccontextmanager
async def io(ctx: Ctx) -> AsyncIterator[Io]:
    async with safe_client(ctx.settings) as client:
        yield Io(client=client, settings=ctx.settings)


# --- connections ----------------------------------------------------------------------------


async def get_connection_row(ctx: Ctx, connection_id: str) -> LmsConnection:
    row = await ctx.db.get(LmsConnection, connection_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("connection", connection_id)
    return row


async def _usage(
    ctx: Ctx, connection_ids: list[str]
) -> tuple[dict[str, list[str]], dict[str, int]]:
    bindings: dict[str, list[str]] = {c: [] for c in connection_ids}
    for b in await ctx.db.scalars(
        select(LmsProgramBinding).where(
            LmsProgramBinding.user_id == ctx.user_id,
            LmsProgramBinding.connection_id.in_(connection_ids),
        )
    ):
        bindings[b.connection_id].append(b.program_id)
    result = await ctx.db.execute(
        select(LmsCourseLink.connection_id, func.count())
        .where(
            LmsCourseLink.user_id == ctx.user_id,
            LmsCourseLink.connection_id.in_(connection_ids),
        )
        .group_by(LmsCourseLink.connection_id)
    )
    counts = {connection_id: int(n) for connection_id, n in result.all()}
    return bindings, counts


def _connection_out(
    row: LmsConnection, programs: list[str] | None = None, links: int = 0
) -> Connection:
    return Connection(
        id=row.id,
        provider=row.provider,
        display_name=row.display_name,
        config=row.config_json,
        credentials_hint=row.credentials_hint_json,
        has_credentials=bool(row.credentials_encrypted),
        account_name=row.account_name,
        status=row.status,  # pyright: ignore[reportArgumentType]
        last_checked_at=row.last_checked_at,
        last_error_code=row.last_error_code,
        program_ids=sorted(programs or []),
        link_count=links,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def connection_out(ctx: Ctx, row: LmsConnection) -> Connection:
    bindings, counts = await _usage(ctx, [row.id])
    return _connection_out(row, bindings[row.id], counts.get(row.id, 0))


async def list_connections(ctx: Ctx) -> list[Connection]:
    rows = list(
        await ctx.db.scalars(
            select(LmsConnection)
            .where(LmsConnection.user_id == ctx.user_id)
            .order_by(LmsConnection.created_at, LmsConnection.id)
        )
    )
    bindings, counts = await _usage(ctx, [r.id for r in rows])
    return [_connection_out(r, bindings[r.id], counts.get(r.id, 0)) for r in rows]


async def _check(
    ctx: Ctx, provider: LmsProvider, cfg: BaseModel, creds: BaseModel
) -> ConnectionSummary:
    try:
        async with io(ctx) as i:
            return await provider.validate(i, cfg, creds)
    except AppError as exc:
        # A reachable host without the platform's API answers the profile read with 404.
        if exc.code == "common.not_found":
            raise lms_error("lms.invalid_config", field="base_url", reason="not_canvas") from exc
        raise


async def create_connection(ctx: Ctx, inp: ConnectionCreateInput) -> Connection:
    provider = get_provider(inp.provider)
    cfg = provider.normalize_config(inp.config, ctx.settings)
    creds = provider.normalize_credentials(_plain(inp.credentials))
    summary = await _check(ctx, provider, cfg, creds)
    row = LmsConnection(
        user_id=ctx.user_id,
        provider=provider.kind,
        display_name=(inp.display_name or "").strip()
        or summary.instance_name
        or provider.display_name,
        config_json=cfg.model_dump(mode="json"),
        credentials_encrypted=_seal(ctx, creds),
        credentials_hint_json=provider.mask_credentials(creds),
        account_name=summary.account_name,
        status="connected",
        last_checked_at=ctx.now,
        last_error_code=None,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await events.publish(ctx, "lms.connection.created", {"connection_id": row.id})
    return _connection_out(row)


async def update_connection(ctx: Ctx, inp: ConnectionUpdateInput) -> Connection:
    row = await get_connection_row(ctx, inp.id)
    provider = get_provider(row.provider)
    sent = inp.model_fields_set
    if "display_name" in sent and inp.display_name is not None:
        row.display_name = inp.display_name.strip()
    cfg = _config(provider, row)
    changed = False
    if "config" in sent and inp.config is not None:
        new_cfg = provider.normalize_config(inp.config, ctx.settings)
        changed |= new_cfg != cfg
        cfg = new_cfg
    if "credentials" in sent and inp.credentials is not None:
        creds = provider.normalize_credentials(_plain(inp.credentials))
        changed = True
    elif changed:
        # The saved credentials never go to a new address: a typo would hand them to that host.
        raise lms_error("lms.credentials_missing")
    else:
        creds = None
    if changed and creds is not None:
        summary = await _check(ctx, provider, cfg, creds)
        row.config_json = cfg.model_dump(mode="json")
        row.credentials_encrypted = _seal(ctx, creds)
        row.credentials_hint_json = provider.mask_credentials(creds)
        row.account_name = summary.account_name
        row.last_checked_at = ctx.now
        before = row.status
        row.status, row.last_error_code = "connected", None
        await cache.drop_connection(ctx, row.id)
        if before != row.status:
            await _status_changed(ctx, row)
    row.updated_at = ctx.now
    await events.publish(ctx, "lms.connection.updated", {"connection_id": row.id})
    return await connection_out(ctx, row)


async def _status_changed(ctx: Ctx, row: LmsConnection) -> None:
    await events.publish(
        ctx,
        "lms.connection.status_changed",
        {"connection_id": row.id, "status": row.status, "error_code": row.last_error_code},
        user_id=row.user_id,
    )


async def delete_connection(ctx: Ctx, connection_id: str, detach_all: bool) -> ConnectionDeleted:
    row = await get_connection_row(ctx, connection_id)
    bindings, _ = await _usage(ctx, [row.id])
    programs = bindings[row.id]
    if programs and not detach_all:
        raise lms_error("lms.connection_in_use", programs=programs)
    links = list(
        await ctx.db.scalars(select(LmsCourseLink).where(LmsCourseLink.connection_id == row.id))
    )
    for link in links:
        await _remove_link(ctx, link)
    await ctx.db.execute(delete(LmsProgramBinding).where(LmsProgramBinding.connection_id == row.id))
    await cache.drop_connection(ctx, row.id)
    await ctx.db.delete(row)
    await ctx.db.flush()
    await events.publish(ctx, "lms.connection.deleted", {"connection_id": connection_id})
    return ConnectionDeleted(
        id=connection_id, unbound_programs=len(programs), unlinked_courses=len(links)
    )


async def validate(ctx: Ctx, inp: ConnectionValidateInput) -> ConnectionCheck:
    """Tests settings before saving, or re-checks a saved connection (and records the result)."""
    row = await get_connection_row(ctx, inp.connection_id) if inp.connection_id else None
    kind = row.provider if row is not None else inp.provider
    if kind is None:
        raise AppError("common.validation", 422, errors=[{"loc": ["provider"], "code": "missing"}])
    provider = get_provider(kind)
    try:
        cfg = (
            provider.normalize_config(inp.config, ctx.settings)
            if inp.config is not None
            else _config(provider, row)  # pyright: ignore[reportArgumentType]
        )
        if inp.credentials is not None:
            creds = provider.normalize_credentials(_plain(inp.credentials))
        elif row is not None and cfg == _config(provider, row):
            creds = _open(ctx, provider, row)
        else:
            raise lms_error("lms.credentials_missing")
        summary = await _check(ctx, provider, cfg, creds)
    except AppError as exc:
        if row is not None and inp.config is None and inp.credentials is None:
            await _record(ctx, row, exc.code)
        return ConnectionCheck(
            ok=False,
            error_code=exc.code,
            error_params=_jsonable(exc.params),
            summary=None,
            connection=await connection_out(ctx, row) if row is not None else None,
        )
    if row is not None and inp.config is None and inp.credentials is None:
        row.account_name = summary.account_name or row.account_name
        await _record(ctx, row, None)
    return ConnectionCheck(
        ok=True,
        error_code=None,
        summary=summary,
        connection=await connection_out(ctx, row) if row is not None else None,
    )


def _jsonable(params: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in params.items() if isinstance(v, str | int | float | bool | list)}


async def _record(ctx: Ctx, row: LmsConnection, error_code: str | None) -> None:
    # Same-status changes count too: a transient error appearing or clearing shows on the row.
    before = (row.status, row.last_error_code)
    row.last_checked_at = ctx.now
    if error_code is None:
        row.status, row.last_error_code = "connected", None
    elif error_code in CONNECTION_ERRORS:
        row.status, row.last_error_code = "error", error_code
    else:  # unreachable, rate limited: the connection itself may be fine
        row.last_error_code = error_code
    if before != (row.status, row.last_error_code):
        await _status_changed(ctx, row)


async def _record_failure(ctx: Ctx, connection_id: str, code: str) -> None:
    """A read failed because the connection is broken: mark it, outside the failing request's
    transaction (which is rolled back)."""
    try:
        async with system_ctx(ctx.state, ctx.user_id) as sys:
            row = await sys.db.get(LmsConnection, connection_id)
            if row is None:
                return
            await _record(sys, row, code)
            await sys.db.commit()
        from semestra.core.context import run_after_commit

        await run_after_commit(sys)
    except Exception:
        log.exception("lms_record_failure_failed")


async def refresh_all(ctx: Ctx) -> None:
    """Periodic check of every connection (M09 §4)."""
    rows = list(await ctx.db.scalars(select(LmsConnection)))
    for row in rows:
        if not row.credentials_encrypted:
            continue
        try:
            provider = get_provider(row.provider)
            await _check(ctx, provider, _config(provider, row), _open(ctx, provider, row))
        except AppError as exc:
            await _record(ctx, row, exc.code)
        except Exception:
            # One broken connection (old config, a provider bug) must not stop the round.
            log.exception("lms.refresh_failed", connection_id=row.id)
        else:
            await _record(ctx, row, None)


# --- calling providers ----------------------------------------------------------------------


@dataclass
class Bound:
    """A connection ready to call: the row, its provider, config and credentials."""

    row: LmsConnection
    provider: LmsProvider
    cfg: BaseModel
    creds: BaseModel

    def rewrite(self, url: str) -> Any:
        return self.provider.rewrite_internal_link(self.cfg, url)

    def clean(self, raw: str | None) -> str | None:
        return html.clean(raw, self.rewrite)


async def bound(ctx: Ctx, row: LmsConnection) -> Bound:
    provider = get_provider(row.provider)
    return Bound(row, provider, _config(provider, row), _open(ctx, provider, row))


def require_feature(b: Bound, feature: LmsFeature) -> None:
    if feature not in b.provider.features:
        raise lms_error("lms.feature_unsupported", feature=feature)


async def call[T](ctx: Ctx, b: Bound, fn: Callable[[Io], Awaitable[T]]) -> tuple[T, bool]:
    """Runs one provider call; returns its result and whether a list was truncated."""
    try:
        async with io(ctx) as i:
            result = await fn(i)
            return result, i.truncated
    except AppError as exc:
        if exc.code in BROKEN_ON_READ:
            await _record_failure(ctx, b.row.id, exc.code)
        raise


async def cached(
    ctx: Ctx,
    b: Bound,
    method: str,
    params: dict[str, Any],
    fn: Callable[[Io], Awaitable[Any]],
    *,
    refresh: bool = False,
) -> tuple[Any, bool]:
    """A read through the cache. `fn` returns DTOs (or lists of them); what comes back is their
    JSON form, the same whether it came from the LMS or the cache."""
    key = cache.cache_key(ctx.user_id, b.row.id, method, params)
    if not refresh:
        hit = await cache.get(ctx, key)
        if hit is not None:
            return hit["data"], bool(hit["truncated"])
    result, truncated = await call(ctx, b, fn)
    data = _dump(result)
    await cache.put(ctx, key, b.row.id, {"data": data, "truncated": truncated})
    return data, truncated


def _dump(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [_dump(v) for v in value]  # pyright: ignore[reportUnknownVariableType]
    return value


# --- Program bindings -----------------------------------------------------------------------


async def binding_row(ctx: Ctx, program_id: str) -> LmsProgramBinding | None:
    row = await ctx.db.get(LmsProgramBinding, program_id)
    return row if row is not None and row.user_id == ctx.user_id else None


async def _program_link_count(ctx: Ctx, program_id: str) -> int:
    return int(
        await ctx.db.scalar(
            select(func.count()).where(
                LmsCourseLink.user_id == ctx.user_id, LmsCourseLink.program_id == program_id
            )
        )
        or 0
    )


async def get_binding(ctx: Ctx, program_id: str) -> ProgramBinding:
    await academics.get_program_row(ctx, program_id)
    row = await binding_row(ctx, program_id)
    connection = None
    if row is not None:
        connection = await connection_out(ctx, await get_connection_row(ctx, row.connection_id))
    return ProgramBinding(
        program_id=program_id,
        connection_id=row.connection_id if row else None,
        connection=connection,
        link_count=await _program_link_count(ctx, program_id),
    )


async def set_binding(ctx: Ctx, inp: BindingSetInput) -> ProgramBinding:
    await academics.get_program_row(ctx, inp.program_id)
    await get_connection_row(ctx, inp.connection_id)
    row = await binding_row(ctx, inp.program_id)
    if row is not None and row.connection_id == inp.connection_id:
        return await get_binding(ctx, inp.program_id)
    if row is not None:
        count = await _program_link_count(ctx, inp.program_id)
        if count:
            raise lms_error("lms.program_has_links", count=count)
        row.connection_id = inp.connection_id
        row.updated_at = ctx.now
    else:
        ctx.db.add(
            LmsProgramBinding(
                program_id=inp.program_id,
                user_id=ctx.user_id,
                connection_id=inp.connection_id,
                created_at=ctx.now,
                updated_at=ctx.now,
            )
        )
    await ctx.db.flush()
    await events.publish(ctx, "lms.program.bound", {"program_id": inp.program_id})
    return await get_binding(ctx, inp.program_id)


async def clear_binding(ctx: Ctx, program_id: str) -> ProgramBinding:
    await academics.get_program_row(ctx, program_id)
    row = await binding_row(ctx, program_id)
    if row is not None:
        count = await _program_link_count(ctx, program_id)
        if count:
            raise lms_error("lms.program_has_links", count=count)
        await ctx.db.delete(row)
        await ctx.db.flush()
        await events.publish(ctx, "lms.program.bound", {"program_id": program_id})
    return await get_binding(ctx, program_id)


async def program_connection(ctx: Ctx, program_id: str) -> LmsConnection:
    """The Program's bound connection, or `lms.program_not_configured`."""
    row = await binding_row(ctx, program_id)
    if row is None:
        raise lms_error("lms.program_not_configured")
    return await get_connection_row(ctx, row.connection_id)


# --- external courses and links -------------------------------------------------------------


def link_out(row: LmsCourseLink, provider: str) -> CourseLink:
    return CourseLink(
        id=row.id,
        course_id=row.course_id,
        program_id=row.program_id,
        connection_id=row.connection_id,
        provider=provider,
        external_course_id=row.external_course_id,
        external_code=row.external_code,
        external_name=row.external_name,
        external_term=row.external_term,
        web_url=row.web_url,
        sync_enabled=row.sync_enabled,
        last_synced_at=row.last_synced_at,
        last_error_code=row.last_error_code,
        created_at=row.created_at,
    )


async def program_links(ctx: Ctx, program_id: str) -> list[LmsCourseLink]:
    return list(
        await ctx.db.scalars(
            select(LmsCourseLink).where(
                LmsCourseLink.user_id == ctx.user_id, LmsCourseLink.program_id == program_id
            )
        )
    )


async def external_courses(
    ctx: Ctx, program_id: str, *, include_past: bool, refresh: bool = False
) -> ExternalCourseList:
    await academics.get_program_row(ctx, program_id)
    b = await bound(ctx, await program_connection(ctx, program_id))
    require_feature(b, "courses")
    data, truncated = await cached(
        ctx,
        b,
        "courses",
        {"include_past": include_past},
        lambda i: b.provider.list_courses(i, b.cfg, b.creds, include_past=include_past),
        refresh=refresh,
    )
    links = {link.external_course_id: link for link in await program_links(ctx, program_id)}
    titles: dict[str, str] = {}
    if links:
        program = await academics.get_program_row(ctx, program_id)
        rows = [await academics.get_course_row(ctx, li.course_id) for li in links.values()]
        titles = {
            c.id: c.alias or c.code or c.title
            for c in await academics.courses_out(ctx, program, rows)
        }
    items = []
    for course in data:
        link = links.get(course["external_id"])
        items.append(
            ExternalCourse.model_validate(
                {
                    **course,
                    "linked_course_id": link.course_id if link else None,
                    "linked_course_name": titles.get(link.course_id) if link else None,
                }
            )
        )
    return ExternalCourseList(
        connection_id=b.row.id, provider=b.row.provider, items=items, truncated=truncated
    )


async def link_row(ctx: Ctx, course_id: str) -> LmsCourseLink | None:
    return await ctx.db.scalar(
        select(LmsCourseLink).where(
            LmsCourseLink.user_id == ctx.user_id, LmsCourseLink.course_id == course_id
        )
    )


async def require_link(ctx: Ctx, course_id: str) -> tuple[LmsCourseLink, Bound]:
    await academics.get_course_row(ctx, course_id)
    link = await link_row(ctx, course_id)
    if link is None:
        raise lms_error("lms.course_not_linked")
    return link, await bound(ctx, await get_connection_row(ctx, link.connection_id))


async def link_state(ctx: Ctx, course_id: str) -> CourseLinkState:
    course = await academics.get_course_row(ctx, course_id)
    link = await link_row(ctx, course_id)
    binding = await binding_row(ctx, course.program_id)
    out = None
    if link is not None:
        conn = await get_connection_row(ctx, link.connection_id)
        out = link_out(link, conn.provider)
    return CourseLinkState(
        course_id=course_id,
        link=out,
        program_connection_id=binding.connection_id if binding else None,
    )


def _apply_meta(link: LmsCourseLink, course: dict[str, Any]) -> None:
    link.external_code = course.get("code")
    link.external_name = course.get("name")
    link.external_term = course.get("term")
    link.web_url = course.get("web_url")


async def create_link(
    ctx: Ctx,
    *,
    course_id: str,
    connection: LmsConnection,
    external: dict[str, Any],
    sync_enabled: bool = True,
) -> LmsCourseLink:
    """Links a course through the Program's current connection; used by imports too."""
    course = await academics.get_course_row(ctx, course_id)
    taken = await ctx.db.scalar(
        select(LmsCourseLink).where(
            LmsCourseLink.program_id == course.program_id,
            LmsCourseLink.connection_id == connection.id,
            LmsCourseLink.external_course_id == external["external_id"],
        )
    )
    if taken is not None and taken.course_id != course_id:
        raise lms_error("lms.course_already_linked", course_id=taken.course_id)
    link = await link_row(ctx, course_id)
    if link is not None and (
        link.connection_id != connection.id or link.external_course_id != external["external_id"]
    ):
        await _remove_link(ctx, link)
        link = None
    if link is None:
        link = LmsCourseLink(
            user_id=ctx.user_id,
            course_id=course_id,
            program_id=course.program_id,
            connection_id=connection.id,
            external_course_id=external["external_id"],
            sync_enabled=sync_enabled,
            created_at=ctx.now,
            updated_at=ctx.now,
        )
        ctx.db.add(link)
    link.sync_enabled = sync_enabled
    _apply_meta(link, external)
    link.last_synced_at = ctx.now
    link.last_error_code = None
    link.updated_at = ctx.now
    await ctx.db.flush()
    # The link is written first, so this transaction holds the write lock: a binding change
    # that slipped in while the platform was being asked has committed and shows up here, and
    # none can commit after. Re-read rather than trust the session's copy.
    binding = await ctx.db.scalar(
        select(LmsProgramBinding)
        .where(LmsProgramBinding.program_id == course.program_id)
        .execution_options(populate_existing=True)
    )
    if binding is None or binding.connection_id != connection.id:
        raise lms_error("lms.program_not_configured")
    data = {"course_id": course_id, "program_id": course.program_id, "link_id": link.id}
    await events.publish(ctx, "lms.course.linked", data)
    await events.publish(ctx, "calendar.changed", {"program_id": course.program_id})
    return link


async def check_link(ctx: Ctx, inp: LinkSetInput) -> None:
    """Refuses replacing an existing link unless asked to (also before the agent's card)."""
    await academics.get_course_row(ctx, inp.course_id)
    current = await link_row(ctx, inp.course_id)
    if (
        current is not None
        and not inp.replace
        and current.external_course_id != inp.external_course_id
    ):
        # Replacing drops the tracking of what came through the old link: only on request. The
        # same platform course through a new connection (reconnected) is not a replacement.
        raise lms_error(
            "lms.course_link_exists",
            external_course_id=current.external_course_id,
            external_code=current.external_code,
            external_name=current.external_name,
        )


async def set_link(ctx: Ctx, inp: LinkSetInput) -> CourseLinkState:
    await check_link(ctx, inp)
    course = await academics.get_course_row(ctx, inp.course_id)
    connection = await program_connection(ctx, course.program_id)
    b = await bound(ctx, connection)
    external, _ = await cached(
        ctx,
        b,
        "course",
        {"course": inp.external_course_id},
        lambda i: b.provider.get_course(i, b.cfg, b.creds, inp.external_course_id),
        refresh=True,
    )
    await create_link(
        ctx,
        course_id=inp.course_id,
        connection=connection,
        external=external,
        sync_enabled=inp.sync_enabled,
    )
    return await link_state(ctx, inp.course_id)


async def update_link(ctx: Ctx, course_id: str, sync_enabled: bool) -> CourseLinkState:
    link, _ = await require_link(ctx, course_id)
    if link.sync_enabled != sync_enabled:
        link.sync_enabled = sync_enabled
        link.updated_at = ctx.now
        await events.publish(ctx, "calendar.changed", {"program_id": link.program_id})
        await events.publish(ctx, "lms.course.link_updated", {"course_id": course_id})
    return await link_state(ctx, course_id)


async def sync_link(ctx: Ctx, course_id: str) -> CourseLinkState:
    """Refreshes the external course's code, name, term and address; the course is untouched.
    A failure is recorded on the link rather than raised."""
    link, b = await require_link(ctx, course_id)
    try:
        external, _ = await call(
            ctx, b, lambda i: b.provider.get_course(i, b.cfg, b.creds, link.external_course_id)
        )
    except AppError as exc:
        link.last_error_code = exc.code
    else:
        _apply_meta(link, external.model_dump(mode="json"))
        link.last_error_code = None
        link.last_synced_at = ctx.now
        await cache.drop_connection(ctx, b.row.id)
    link.updated_at = ctx.now
    await events.publish(ctx, "lms.course.link_updated", {"course_id": course_id})
    return await link_state(ctx, course_id)


async def _remove_link(ctx: Ctx, link: LmsCourseLink) -> None:
    data = {"course_id": link.course_id, "program_id": link.program_id, "link_id": link.id}
    await ctx.db.execute(delete(LmsImportedRef).where(LmsImportedRef.link_id == link.id))
    await ctx.db.delete(link)
    await ctx.db.flush()
    await events.publish(ctx, "lms.course.unlinked", data)
    await events.publish(ctx, "calendar.changed", {"program_id": link.program_id})


async def delete_link(ctx: Ctx, course_id: str) -> CourseLinkState:
    link, _ = await require_link(ctx, course_id)
    await _remove_link(ctx, link)
    return await link_state(ctx, course_id)


# --- clean-up (subscribers) -----------------------------------------------------------------


async def forget_course(ctx: Ctx, course_id: str) -> None:
    link = await link_row(ctx, course_id)
    if link is not None:
        await ctx.db.execute(delete(LmsImportedRef).where(LmsImportedRef.link_id == link.id))
        await ctx.db.delete(link)
        await ctx.db.flush()


async def forget_program(ctx: Ctx, program_id: str) -> None:
    for link in await program_links(ctx, program_id):
        await ctx.db.execute(delete(LmsImportedRef).where(LmsImportedRef.link_id == link.id))
        await ctx.db.delete(link)
    row = await binding_row(ctx, program_id)
    if row is not None:
        await ctx.db.delete(row)
    await ctx.db.flush()


async def forget_target(ctx: Ctx, target_kind: str, target_id: str) -> None:
    await ctx.db.execute(
        delete(LmsImportedRef).where(
            LmsImportedRef.target_kind == target_kind, LmsImportedRef.target_id == target_id
        )
    )
