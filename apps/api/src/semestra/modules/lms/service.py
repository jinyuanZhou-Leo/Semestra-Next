"""Connections, Program bindings, course links and the read interface (M09 §3-§5).

Provider calls go through `call`: it decrypts the credentials, opens the guarded HTTP client
and, for reads, the cache (`cache.py`). Imports live in `imports.py`, the calendar source in
`calendar.py`.
"""

import json
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin

import structlog
from cryptography.fernet import InvalidToken
from pydantic import BaseModel, SecretStr
from sqlalchemy import delete, func, select, update
from starlette.datastructures import State

from semestra.core.config import Settings
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
from semestra.modules.lms.providers import (
    Io,
    LmsProvider,
    SignInProvider,
    all_providers,
    get_provider,
    sign_in_support,
)
from semestra.modules.lms.schemas.dto import (
    INTERNAL,
    WRITE_FEATURES,
    ConnectionSummary,
    LmsFeature,
)
from semestra.modules.lms.schemas.io import (
    BindingSetInput,
    Connection,
    ConnectionCheck,
    ConnectionCreateInput,
    ConnectionDeleted,
    ConnectionUpdateInput,
    ConnectionValidateInput,
    CourseLink,
    CourseLinkList,
    CourseLinkState,
    ExternalCourse,
    ExternalCourseList,
    LinkSetInput,
    ProgramBinding,
    ProviderInfo,
    SignInStart,
    SignInStartInput,
)
from semestra.modules.lms.settings import writes_allowed

log = structlog.get_logger()

# Bumped when the encryption scheme of stored credentials changes (M09 §3).
CREDENTIALS_VERSION = "v1"


# --- providers ------------------------------------------------------------------------------


def providers(settings: Settings) -> list[ProviderInfo]:
    return [
        ProviderInfo(
            kind=p.kind,
            display_name=p.display_name,
            features=sorted(p.features),
            config_schema=p.config_model.model_json_schema(),
            credentials_schema=p.credentials_model.model_json_schema(),
            sign_in=_sign_in_enabled(p, settings),
        )
        for p in all_providers()
    ]


def _sign_in_enabled(provider: LmsProvider, settings: Settings) -> bool:
    support = sign_in_support(provider)
    return support is not None and support.sign_in_enabled(settings)


def _sign_in(ctx: Ctx, provider: LmsProvider) -> SignInProvider:
    support = sign_in_support(provider)
    if support is None or not support.sign_in_enabled(ctx.settings):
        raise lms_error("lms.sign_in_disabled")
    return support


async def start_sign_in(ctx: Ctx, inp: SignInStartInput) -> SignInStart:
    provider = get_provider(inp.provider)
    support = _sign_in(ctx, provider)
    cfg = provider.normalize_config(inp.config, ctx.settings)
    async with io(ctx) as i:
        return SignInStart(authorize_url=await support.start_sign_in(i, cfg))


# --- credentials ----------------------------------------------------------------------------


def _plain(raw: dict[str, SecretStr] | None) -> dict[str, Any]:
    return {k: v.get_secret_value() for k, v in (raw or {}).items()}


async def _new_credentials(
    ctx: Ctx,
    provider: LmsProvider,
    cfg: BaseModel,
    credentials: dict[str, SecretStr] | None,
    pasted: SecretStr | None,
) -> BaseModel:
    """What the form sent: pasted credentials, or the address a sign-in ended on."""
    if pasted is None:
        return provider.normalize_credentials(_plain(credentials))
    support = _sign_in(ctx, provider)
    async with io(ctx) as i:
        return await support.finish_sign_in(i, cfg, pasted.get_secret_value(), ctx.now)


def _seal(ctx: Ctx, creds: BaseModel) -> str:
    dumped = {
        k: v.get_secret_value() if isinstance(v, SecretStr) else v for k, v in dict(creds).items()
    }
    plain = json.dumps(dumped, default=lambda v: v.isoformat())  # datetimes (expiry)
    return f"{CREDENTIALS_VERSION}:{encrypt(ctx.settings, plain)}"


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
        if exc.code == "lms.not_found":
            raise lms_error("lms.invalid_config", field="base_url", reason="not_canvas") from exc
        raise


async def create_connection(ctx: Ctx, inp: ConnectionCreateInput) -> Connection:
    provider = get_provider(inp.provider)
    cfg = provider.normalize_config(inp.config, ctx.settings)
    creds = await _new_credentials(ctx, provider, cfg, inp.credentials, inp.sign_in)
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
    if inp.sign_in is not None or ("credentials" in sent and inp.credentials is not None):
        creds = await _new_credentials(ctx, provider, cfg, inp.credentials, inp.sign_in)
        changed = True
    elif changed:
        # The saved credentials never go to a new address: a typo would hand them to that host.
        raise lms_error("lms.credentials_missing")
    else:
        creds = None
    if changed and creds is not None:
        summary = await _check(ctx, provider, cfg, creds)
        _revoke_later(ctx, provider, row)
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
    _revoke_later(ctx, get_provider(row.provider), row)
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
            summary = await _check(ctx, provider, cfg, creds)
        elif row is not None and cfg == _config(provider, row):
            summary = await _check_saved(ctx, await bound(ctx, row))
        else:
            raise lms_error("lms.credentials_missing")
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


# --- calling providers ----------------------------------------------------------------------


@dataclass
class Bound:
    """A connection ready to call: the row, its provider, config and credentials."""

    row: LmsConnection
    provider: LmsProvider
    cfg: BaseModel
    creds: BaseModel

    def rewrite(self, url: str, course: str | None = None) -> Any:
        """What a platform link points at; with `course`, only links into that course (a link
        to another course's page would otherwise open the same slug in this one)."""
        ref = self.provider.rewrite_internal_link(self.cfg, url)
        if ref is not None and course is not None and ref.course not in (None, course):
            return None
        return ref

    def clean(
        self, raw: str | None, web_url: str | None = None, course: str | None = None
    ) -> str | None:
        """Cleans HTML of an item of platform course `course`; its relative links resolve
        against `web_url`, the item's own address on the platform, like they do there, and only
        links into the same course are marked as items the app can open."""
        base = urljoin(self.provider.web_base(self.cfg), web_url or "")
        return html.clean(raw, base=base, rewrite=lambda url: self.rewrite(url, course))


async def bound(ctx: Ctx, row: LmsConnection) -> Bound:
    provider = get_provider(row.provider)
    renewed = cache.runtime(ctx.state).renewed(row.id, row.credentials_encrypted)
    creds = renewed if renewed is not None else _open(ctx, provider, row)
    return Bound(row, provider, _config(provider, row), creds)


async def fresh(ctx: Ctx, b: Bound, *, force: bool = False) -> bool:
    """Renews signed-in credentials that are about to expire (or, with `force`, ones the
    platform just refused); True when `b.creds` changed. Renewed credentials are used at once,
    kept in memory and stored once the request commits, in a short transaction of their own:
    reads never write in the request's transaction (see `cache.py`). Once the server turns the
    sign-in off nothing renews, so these connections fail when their access token expires."""
    support = sign_in_support(b.provider)
    if support is None or not support.sign_in_enabled(ctx.settings):
        return False
    if not support.can_refresh(b.creds):
        return False
    if not force and not support.credentials_stale(b.creds, ctx.now):
        return False
    rt = cache.runtime(ctx.state)
    sealed = b.row.credentials_encrypted
    async with rt.renewal_lock(b.row.id):
        # Another request may have renewed them while this one waited.
        latest = rt.renewed(b.row.id, sealed)
        if latest is not None and latest != b.creds:
            b.creds = latest
            return True
        async with io(ctx) as i:
            b.creds = await support.refresh_credentials(i, b.cfg, b.creds, ctx.now)
        rt.renew(b.row.id, sealed, b.creds)
    ctx.after_commit.append(_StoreRenewed(ctx.state, b.row.id, sealed, _seal(ctx, b.creds)))
    return True


async def _with_fresh[T](ctx: Ctx, b: Bound, run: Callable[[], Awaitable[T]]) -> T:
    """`run` with renewed credentials, once more after renewing them if the platform refused
    them (revoked meanwhile, or the server's clock is off)."""
    await fresh(ctx, b)
    try:
        return await run()
    except AppError as exc:
        if exc.code != "lms.invalid_credentials" or not await fresh(ctx, b, force=True):
            raise
    return await run()


async def _check_saved(ctx: Ctx, b: Bound) -> ConnectionSummary:
    return await _with_fresh(ctx, b, lambda: _check(ctx, b.provider, b.cfg, b.creds))


class _StoreRenewed:
    """Writes renewed credentials after the request commits (an `after_commit` callback),
    unless the user replaced the credentials meanwhile."""

    def __init__(self, state: State, connection_id: str, replaces: str | None, sealed: str):
        self.state, self.connection_id = state, connection_id
        self.replaces, self.sealed = replaces, sealed

    async def __call__(self) -> None:
        try:
            async with system_ctx(self.state) as sys:
                await sys.db.execute(
                    update(LmsConnection)
                    .where(
                        LmsConnection.id == self.connection_id,
                        LmsConnection.credentials_encrypted == self.replaces,
                    )
                    .values(credentials_encrypted=self.sealed)
                )
                await sys.db.commit()
        except Exception:
            # Memory still has them; the next renewal stores them again.
            log.warning("lms_credentials_store_failed", exc_info=True)


def _revoke_later(ctx: Ctx, provider: LmsProvider, row: LmsConnection) -> None:
    """Ends a sign-in on the platform once the connection dropping it is committed: the user
    no longer sees it listed under the platform's approved integrations. Best effort, so a
    failure is only logged."""
    support = sign_in_support(provider)
    if support is None or not row.credentials_encrypted:
        return
    try:
        renewed = cache.runtime(ctx.state).renewed(row.id, row.credentials_encrypted)
        creds = renewed if renewed is not None else _open(ctx, provider, row)
        cfg = _config(provider, row)
    except AppError:
        return
    if not support.can_refresh(creds):
        return
    settings, now = ctx.settings, ctx.now

    async def revoke() -> None:
        try:
            async with safe_client(settings) as client:
                io_ = Io(client=client, settings=settings)
                await support.revoke_credentials(io_, cfg, creds, now)
        except AppError as exc:
            log.warning("lms_sign_in_revoke_failed", error=exc.code, params=exc.params)
        except Exception:
            log.warning("lms_sign_in_revoke_failed", exc_info=True)

    ctx.after_commit.append(revoke)


def require_feature(b: Bound, feature: LmsFeature) -> None:
    if feature not in b.provider.features:
        raise lms_error("lms.feature_unsupported", feature=feature)


async def require_write(ctx: Ctx, b: Bound, feature: LmsFeature) -> None:
    """Every change on the platform goes through here: the user's `lms.allow_writes` first,
    then the provider's support. `feature` must be one of `WRITE_FEATURES`."""
    assert feature in WRITE_FEATURES, feature
    if not await writes_allowed(ctx):
        raise lms_error("lms.writes_disabled")
    require_feature(b, feature)


async def attempt[T](ctx: Ctx, b: Bound, run: Callable[[], Awaitable[T]]) -> T:
    """One read from the platform: `run` with renewed credentials, marking the connection if the
    failure says it is broken. `run` reads `b.creds` itself, because a retry changes them."""
    try:
        return await _with_fresh(ctx, b, run)
    except AppError as exc:
        if exc.code in BROKEN_ON_READ:
            await _record_failure(ctx, b.row.id, exc.code)
        raise


async def call[T](ctx: Ctx, b: Bound, fn: Callable[[Io], Awaitable[T]]) -> tuple[T, bool]:
    """Runs one provider call; returns its result and whether a list was truncated."""

    async def run() -> tuple[T, bool]:
        async with io(ctx) as i:
            result = await fn(i)
            return result, i.truncated

    return await attempt(ctx, b, run)


class NotCached(Exception):
    """A read under `cache_only()` that the cache can't answer."""


_cache_only: ContextVar[bool] = ContextVar("lms_cache_only", default=False)


@contextmanager
def cache_only() -> Iterator[None]:
    """Reads inside answer from the cache or raise `NotCached`, never calling the LMS: the
    assistant's confirmation cards name what they can without waiting on the platform."""
    token = _cache_only.set(True)
    try:
        yield
    finally:
        _cache_only.reset(token)


async def cached(
    ctx: Ctx,
    b: Bound,
    method: str,
    params: dict[str, Any],
    fn: Callable[[Io], Awaitable[Any]],
    *,
    refresh: bool = False,
    scope: str | None = None,
) -> tuple[Any, bool]:
    """A read through the cache. `fn` returns DTOs (or lists of them); what comes back is their
    JSON form, the same whether it came from the LMS or the cache. `scope` groups entries that
    are dropped together (`cache.course_scope`)."""
    key = cache.cache_key(ctx.user_id, b.row.id, method, params)
    if not refresh:
        hit = await cache.get(ctx, key)
        if hit is not None:
            return hit["data"], bool(hit["truncated"])
    if _cache_only.get():
        raise NotCached
    result, truncated = await call(ctx, b, fn)
    data = dump(result)
    await cache.put(ctx, key, b.row.id, {"data": data, "truncated": truncated}, scope=scope)
    return data, truncated


def dump(value: Any) -> Any:
    """JSON form for the cache, with the fields kept from clients (`dto.INTERNAL`), nested
    DTOs included: the cache is server-side, and reads rebuild their DTOs from it."""
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", context=INTERNAL)
    if isinstance(value, list):
        return [dump(v) for v in value]  # pyright: ignore[reportUnknownVariableType]
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
        synced_at=row.synced_at,
        sync_errors=row.sync_errors,
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


async def link_list(ctx: Ctx, program_id: str) -> CourseLinkList:
    await academics.get_program_row(ctx, program_id)
    rows = (
        await ctx.db.execute(
            select(LmsCourseLink, LmsConnection.provider)
            .join(LmsConnection, LmsConnection.id == LmsCourseLink.connection_id)
            .where(LmsCourseLink.user_id == ctx.user_id, LmsCourseLink.program_id == program_id)
        )
    ).all()
    return CourseLinkList(items=[link_out(link, provider) for link, provider in rows])


async def external_courses(
    ctx: Ctx, program_id: str, *, include_past: bool, refresh: bool = False
) -> ExternalCourseList:
    program = await academics.get_program_row(ctx, program_id)
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
        rows = await academics.courses_by_id(ctx, [li.course_id for li in links.values()])
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


async def linked_course_ids(ctx: Ctx, course_ids: list[str]) -> set[str]:
    """Which of the courses are linked (academics' `sources` of a course: `lms`)."""
    rows = await ctx.db.scalars(
        select(LmsCourseLink.course_id).where(
            LmsCourseLink.user_id == ctx.user_id, LmsCourseLink.course_id.in_(course_ids)
        )
    )
    return set(rows)


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
    # Not synced yet: the scheduler's next round picks it up first.
    link.synced_at, link.sync_errors = None, {}
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
    external, _ = await call(
        ctx, b, lambda i: b.provider.get_course(i, b.cfg, b.creds, inp.external_course_id)
    )
    await create_link(
        ctx,
        course_id=inp.course_id,
        connection=connection,
        external=external.model_dump(mode="json"),
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


async def refresh_link(ctx: Ctx, link: LmsCourseLink, b: Bound) -> None:
    """The course stage of the sync: the external course's code, name, term and address (the
    course itself is untouched). Reading it also tells whether the connection works."""
    external, _ = await call(
        ctx, b, lambda i: b.provider.get_course(i, b.cfg, b.creds, link.external_course_id)
    )
    _apply_meta(link, external.model_dump(mode="json"))
    link.updated_at = ctx.now
    # Only what shows the course's own details; its content is not affected.
    key = cache.cache_key(ctx.user_id, b.row.id, "overview", {"course": link.external_course_id})
    await cache.drop(ctx, key)
    if b.row.status != "connected" or b.row.last_error_code is not None:
        await _record(ctx, b.row, None)
    await events.publish(ctx, "lms.course.link_updated", {"course_id": link.course_id})


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


async def forget_target(ctx: Ctx, target_kind: str, target_id: str) -> bool:
    """Forgets what was imported as this object; whether anything was."""
    result = await ctx.db.execute(
        delete(LmsImportedRef).where(
            LmsImportedRef.target_kind == target_kind, LmsImportedRef.target_id == target_id
        )
    )
    return bool(getattr(result, "rowcount", 0))


async def is_imported(ctx: Ctx, target_kind: str, target_id: str) -> bool:
    return (
        await ctx.db.scalar(
            select(LmsImportedRef.id).where(
                LmsImportedRef.user_id == ctx.user_id,
                LmsImportedRef.target_kind == target_kind,
                LmsImportedRef.target_id == target_id,
            )
        )
    ) is not None
