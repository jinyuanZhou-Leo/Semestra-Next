"""Provider management, model choices, status and usage (M06 §6). Model calls are in `calls.py`."""

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from sqlalchemy import ColumnElement, and_, case, delete, func, or_, select

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.core.http import safe_client
from semestra.core.security import encrypt, mask
from semestra.modules.ai import catalog
from semestra.modules.ai.adapters import adapter_for
from semestra.modules.ai.adapters.base import Endpoint, ModelInfo
from semestra.modules.ai.llm import PURPOSE_NEEDS, PURPOSES, Purpose
from semestra.modules.ai.models import AiModelAssignment, AiProvider, AiUsageEvent
from semestra.modules.ai.resolve import (
    can_serve,
    endpoint_for,
    provider_capabilities,
    try_resolve,
)
from semestra.modules.ai.runtime import runtime
from semestra.modules.ai.schemas import (
    AiStatusGet,
    Assignment,
    AssignmentList,
    AssignmentUpdateInput,
    ModelList,
    ModelOption,
    ModelParams,
    Provider,
    ProviderCheck,
    ProviderCreateInput,
    ProviderDeleted,
    ProviderUpdateInput,
    PurposeStatus,
    RecommendedModel,
    UsageDay,
    UsageInput,
    UsageRow,
    UsageSummary,
    UsageTotals,
)

CHECK_TIMEOUT = httpx.Timeout(20.0, connect=10.0)

# --- providers ------------------------------------------------------------------------------


def to_schema(row: AiProvider) -> Provider:
    return Provider(
        id=row.id,
        kind=row.kind,  # pyright: ignore[reportArgumentType]
        display_name=row.display_name,
        base_url=row.base_url,
        key_hint=row.key_hint,
        capabilities=list(provider_capabilities(row)),
        capabilities_editable=catalog.KIND_INFO[row.kind].capabilities is None,  # pyright: ignore[reportArgumentType]
        enabled=row.enabled,
        last_checked_at=row.last_checked_at,
        last_error_code=row.last_error_code,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _get_row(ctx: Ctx, provider_id: str) -> AiProvider:
    row = await ctx.db.get(AiProvider, provider_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("provider", provider_id)
    return row


async def list_providers(ctx: Ctx) -> list[Provider]:
    rows = await ctx.db.scalars(
        select(AiProvider)
        .where(AiProvider.user_id == ctx.user_id)
        .order_by(AiProvider.created_at, AiProvider.id)
    )
    return [to_schema(r) for r in rows]


def _invalid(field: str, code: str) -> AppError:
    return AppError("common.validation", 422, errors=[{"loc": [field], "code": code}])


def _clean_base_url(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    url = value.strip().rstrip("/")
    parsed = httpx.URL(url)
    if parsed.scheme not in ("http", "https") or not parsed.host:
        raise _invalid("base_url", "url")
    if parsed.userinfo or parsed.query or parsed.fragment:
        raise _invalid("base_url", "url")
    return url


async def _fetch_models(ctx: Ctx, ep: Endpoint) -> list[ModelInfo]:
    async with safe_client(ctx.settings, timeout=CHECK_TIMEOUT) as client:
        return await adapter_for(ep.kind).list_models(client, ep)


async def _check(ctx: Ctx, ep: Endpoint) -> None:
    """Verifies a key and URL by listing the provider's models (M06 §6)."""
    try:
        await _fetch_models(ctx, ep)
    except AppError as exc:
        raise AppError("ai.provider_check_failed", 400, reason=exc.code) from None


async def _effective(ctx: Ctx) -> dict[Purpose, tuple[str | None, str] | None]:
    """Which provider and model each purpose resolves to now, to see what a change affected."""
    out: dict[Purpose, tuple[str | None, str] | None] = {}
    for purpose in PURPOSES:
        resolved = await try_resolve(ctx, purpose, with_key=False)
        out[purpose] = (resolved.endpoint.provider_id, resolved.model) if resolved else None
    return out


async def _publish_changes(ctx: Ctx, before: dict[Purpose, tuple[str | None, str] | None]) -> None:
    """`ai.assignment.updated` for every purpose whose effective model changed, so M07 can
    rebuild vectors when the embedding model changes however it changed."""
    await ctx.db.flush()
    after = await _effective(ctx)
    for purpose in PURPOSES:
        if before[purpose] != after[purpose]:
            await events.publish(ctx, "ai.assignment.updated", {"purpose": purpose})


async def create_provider(ctx: Ctx, inp: ProviderCreateInput) -> Provider:
    info = catalog.KIND_INFO[inp.kind]
    base_url = _clean_base_url(inp.base_url)
    key = inp.api_key.get_secret_value().strip() if inp.api_key else ""
    if info.needs_base_url and not base_url:
        raise _invalid("base_url", "missing")
    if info.needs_key and not key:
        raise _invalid("api_key", "missing")
    if info.capabilities is not None and inp.capabilities is not None:
        raise _invalid("capabilities", "not_editable")
    capabilities = (
        list(dict.fromkeys(inp.capabilities or catalog.DEFAULT_CHOSEN_CAPABILITIES[inp.kind]))
        if info.capabilities is None
        else []
    )
    row = AiProvider(
        user_id=ctx.user_id,
        kind=inp.kind,
        display_name=(inp.display_name or "").strip() or _default_name(inp.kind),
        base_url=base_url,
        api_key_encrypted=encrypt(ctx.settings, key) if key else None,
        key_hint=mask(key) if key else None,
        capabilities=capabilities,
        enabled=True,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    await _check(ctx, endpoint_for(ctx.settings, row))
    row.last_checked_at = ctx.now
    before = await _effective(ctx)
    ctx.db.add(row)
    await ctx.db.flush()
    await events.publish(ctx, "ai.provider.created", {"provider_id": row.id})
    await _publish_changes(ctx, before)
    return to_schema(row)


def _default_name(kind: str) -> str:
    return {
        "anthropic": "Anthropic",
        "anthropic_compatible": "Anthropic-compatible",
        "openai": "OpenAI",
        "openai_compatible": "OpenAI-compatible",
        "openai_responses": "OpenAI Responses",
        "gemini": "Gemini",
        "ollama": "Ollama",
    }[kind]


async def update_provider(ctx: Ctx, inp: ProviderUpdateInput) -> Provider:
    row = await _get_row(ctx, inp.id)
    info = catalog.KIND_INFO[row.kind]  # pyright: ignore[reportArgumentType]
    sent = inp.model_fields_set
    before = await _effective(ctx)
    recheck = False
    if "display_name" in sent:
        name = (inp.display_name or "").strip()
        if not name:
            raise _invalid("display_name", "missing")
        row.display_name = name
    if "base_url" in sent:
        base_url = _clean_base_url(inp.base_url)
        if info.needs_base_url and not base_url:
            raise _invalid("base_url", "missing")
        recheck |= base_url != row.base_url
        row.base_url = base_url
    if "api_key" in sent:
        key = inp.api_key.get_secret_value().strip() if inp.api_key else ""
        if info.needs_key and not key:
            raise _invalid("api_key", "missing")
        row.api_key_encrypted = encrypt(ctx.settings, key) if key else None
        row.key_hint = mask(key) if key else None
        recheck = True
    if "capabilities" in sent:
        if info.capabilities is not None:
            raise _invalid("capabilities", "not_editable")
        row.capabilities = list(dict.fromkeys(inp.capabilities or []))
    if "enabled" in sent and inp.enabled is not None:
        row.enabled = inp.enabled
    if recheck:
        await _check(ctx, endpoint_for(ctx.settings, row))
        row.last_checked_at = ctx.now
        row.last_error_code = None
    row.updated_at = ctx.now
    await events.publish(ctx, "ai.provider.updated", {"provider_id": row.id})
    await _publish_changes(ctx, before)
    return to_schema(row)


async def delete_provider(ctx: Ctx, provider_id: str) -> ProviderDeleted:
    row = await _get_row(ctx, provider_id)
    before = await _effective(ctx)
    cleared = list(
        await ctx.db.scalars(
            select(AiModelAssignment.purpose).where(
                AiModelAssignment.user_id == ctx.user_id,
                AiModelAssignment.provider_id == provider_id,
            )
        )
    )
    await ctx.db.execute(
        delete(AiModelAssignment).where(
            AiModelAssignment.user_id == ctx.user_id,
            AiModelAssignment.provider_id == provider_id,
        )
    )
    await ctx.db.delete(row)
    await events.publish(ctx, "ai.provider.deleted", {"provider_id": provider_id})
    await _publish_changes(ctx, before)
    return ProviderDeleted(id=provider_id, cleared_purposes=cleared)  # pyright: ignore[reportArgumentType]


async def test_provider(ctx: Ctx, provider_id: str) -> ProviderCheck:
    row = await _get_row(ctx, provider_id)
    error: str | None = None
    try:
        await _fetch_models(ctx, endpoint_for(ctx.settings, row))
    except AppError as exc:
        error = exc.code
    row.last_checked_at = ctx.now
    row.last_error_code = error
    return ProviderCheck(ok=error is None, error_code=error, checked_at=ctx.now)


async def provider_models(ctx: Ctx, provider_id: str) -> ModelList:
    row = await _get_row(ctx, provider_id)
    rt = runtime(ctx.state)
    key = (row.id, row.updated_at.isoformat())
    models = rt.cached_models(key, ctx.now)
    if models is None:
        models = await _fetch_models(ctx, endpoint_for(ctx.settings, row))
        rt.cache_models(key, ctx.now, models)
    return ModelList(
        items=[ModelOption(id=m.id, display_name=m.display_name) for m in models],
        manual_entry=row.kind in catalog.COMPATIBLE_KINDS and not models,
    )


# --- assignments ----------------------------------------------------------------------------


async def _recommended(ctx: Ctx, purpose: Purpose) -> RecommendedModel | None:
    rows = await ctx.db.scalars(
        select(AiProvider)
        .where(AiProvider.user_id == ctx.user_id, AiProvider.enabled.is_(True))
        .order_by(AiProvider.created_at, AiProvider.id)
    )
    for row in rows:
        model = catalog.default_model(row.kind, purpose)
        if model and can_serve(provider_capabilities(row), purpose):
            return RecommendedModel(provider_id=row.id, model=model)
    return None


async def list_assignments(ctx: Ctx) -> AssignmentList:
    rows = {
        a.purpose: a
        for a in await ctx.db.scalars(
            select(AiModelAssignment).where(AiModelAssignment.user_id == ctx.user_id)
        )
    }
    items: list[Assignment] = []
    for purpose in PURPOSES:
        row = rows.get(purpose)
        items.append(
            Assignment(
                purpose=purpose,
                provider_id=row.provider_id if row else None,
                model=row.model if row else None,
                params=ModelParams(**row.params) if row else ModelParams(),
                recommended=await _recommended(ctx, purpose),
            )
        )
    return AssignmentList(items=items)


async def update_assignment(ctx: Ctx, inp: AssignmentUpdateInput) -> AssignmentList:
    before = await _effective(ctx)
    row = await ctx.db.get(AiModelAssignment, (ctx.user_id, inp.purpose))
    if inp.provider_id is None:
        if row is not None:
            await ctx.db.delete(row)
    else:
        provider = await _get_row(ctx, inp.provider_id)
        if not can_serve(provider_capabilities(provider), inp.purpose):
            raise AppError("ai.capability_unsupported", 400, capability=PURPOSE_NEEDS[inp.purpose])
        if not inp.model or not inp.model.strip():
            raise _invalid("model", "missing")
        params = inp.params.model_dump(exclude_none=True)
        if row is None:
            ctx.db.add(
                AiModelAssignment(
                    user_id=ctx.user_id,
                    purpose=inp.purpose,
                    provider_id=provider.id,
                    model=inp.model.strip(),
                    params=params,
                )
            )
        else:
            row.provider_id = provider.id
            row.model = inp.model.strip()
            row.params = params
    await _publish_changes(ctx, before)
    return await list_assignments(ctx)


# --- status ---------------------------------------------------------------------------------


async def status(ctx: Ctx) -> AiStatusGet:
    items: list[PurposeStatus] = []
    for purpose in PURPOSES:
        resolved = await try_resolve(ctx, purpose, with_key=False)
        if resolved is None:
            items.append(
                PurposeStatus(
                    purpose=purpose,
                    available=False,
                    source=None,
                    provider_id=None,
                    provider_kind=None,
                    provider_name=None,
                    model=None,
                )
            )
            continue
        ep = resolved.endpoint
        items.append(
            PurposeStatus(
                purpose=purpose,
                available=True,
                source=resolved.source,
                provider_id=ep.provider_id,
                provider_kind=ep.kind,  # pyright: ignore[reportArgumentType]
                provider_name=ep.display_name if ep.provider_id else None,
                model=resolved.model,
            )
        )
    return AiStatusGet(items=items)


# --- usage ----------------------------------------------------------------------------------


class _Acc:
    def __init__(self) -> None:
        self.calls = 0
        self.errors = 0
        self.input_tokens = 0
        self.cached_tokens = 0
        self.output_tokens = 0
        self.cost: float | None = None
        self.cost_complete = True

    def add(self, row: Any) -> None:
        """Adds a group of calls summed up by the database (`usage_summary`)."""
        self.calls += row.calls
        self.errors += row.errors
        self.input_tokens += row.input_tokens
        self.cached_tokens += row.cached_tokens
        self.output_tokens += row.output_tokens
        if row.cost is not None:
            self.cost = round((self.cost or 0.0) + row.cost, 6)
        if row.unpriced:
            self.cost_complete = False

    def totals(self) -> UsageTotals:
        return UsageTotals(
            calls=self.calls,
            errors=self.errors,
            input_tokens=self.input_tokens,
            cached_tokens=self.cached_tokens,
            output_tokens=self.output_tokens,
            cost_usd=self.cost,
        )

    def row(self, key: str) -> UsageRow:
        return UsageRow(key=key, cost_complete=self.cost_complete, **self.totals().model_dump())


def _rows(groups: dict[str, _Acc]) -> list[UsageRow]:
    return sorted(
        (acc.row(key) for key, acc in groups.items()),
        key=lambda r: (-(r.input_tokens + r.output_tokens), r.key),
    )


def _local_day(column: Any, tz: ZoneInfo, first: datetime, last: datetime) -> ColumnElement[str]:
    """`column`'s day in `tz`, worked out by SQLite. SQLite knows no time zones, only fixed
    offsets, so the span is cut where the zone's offset changes (daylight saving time) and each
    piece shifts by its own offset."""
    pieces: list[tuple[datetime, int]] = []  # (until, offset in minutes)
    at, offset = first, _offset(tz, first)
    # Checked once a day: no zone changes its offset and back within one day.
    while at < last:
        step = min(at + timedelta(days=1), last)
        if _offset(tz, step) != offset:
            # Offsets change on a whole second: find it exactly, in whole POSIX seconds.
            low, high = int(at.timestamp()), int(step.timestamp())
            while high - low > 1:
                mid = (low + high) // 2
                low, high = (mid, high) if _offset(tz, _utc(mid)) == offset else (low, mid)
            change = _utc(high)
            pieces.append((change, offset))
            offset = _offset(tz, change)
            step = change
        at = step
    shifted = [func.date(column, f"{minutes:+d} minutes") for _, minutes in pieces]
    shifted.append(func.date(column, f"{offset:+d} minutes"))
    if not pieces:
        return shifted[0]
    whens = [(column < until, expr) for (until, _), expr in zip(pieces, shifted, strict=False)]
    return case(*whens, else_=shifted[-1])


def _utc(seconds: int) -> datetime:
    return datetime.fromtimestamp(seconds, UTC)


def _offset(tz: ZoneInfo, at: datetime) -> int:
    delta = at.astimezone(tz).utcoffset()
    return int(delta.total_seconds() // 60) if delta else 0


async def usage_summary(ctx: Ctx, inp: UsageInput) -> UsageSummary:
    try:
        tz = ZoneInfo(inp.tz)
    except ZoneInfoNotFoundError, ValueError:
        raise _invalid("tz", "timezone") from None
    today = ctx.now.astimezone(tz).date()
    end_day = inp.end or today
    start_day = inp.start or (end_day - timedelta(days=inp.days - 1) if inp.days else None)
    if start_day is not None and start_day > end_day:
        raise _invalid("start", "after_end")
    mine = [
        AiUsageEvent.user_id == ctx.user_id,
        AiUsageEvent.created_at < datetime.combine(end_day + timedelta(days=1), time.min, tz),
    ]
    if start_day is not None:
        mine.append(AiUsageEvent.created_at >= datetime.combine(start_day, time.min, tz))
    first = await ctx.db.scalar(select(func.min(AiUsageEvent.created_at)).where(*mine))
    total = _Acc()
    days: defaultdict[tuple[Any, str], _Acc] = defaultdict(_Acc)
    purposes: defaultdict[str, _Acc] = defaultdict(_Acc)
    modules: defaultdict[str, _Acc] = defaultdict(_Acc)
    models: defaultdict[str, _Acc] = defaultdict(_Acc)
    if first is not None:
        # Summed by the database per day and kind of call: a busy year is tens of thousands
        # of calls, but only a few hundred groups.
        last = datetime.combine(end_day + timedelta(days=1), time.min, tz)
        day = _local_day(AiUsageEvent.created_at, tz, first, last).label("day")
        keys = (
            day,
            AiUsageEvent.purpose,
            AiUsageEvent.source_module,
            AiUsageEvent.provider_kind,
            AiUsageEvent.model,
        )
        unpriced = and_(
            AiUsageEvent.cost_usd_estimate.is_(None),
            or_(AiUsageEvent.input_tokens > 0, AiUsageEvent.output_tokens > 0),
        )
        result = await ctx.db.execute(
            select(
                *keys,
                func.count().label("calls"),
                func.sum(case((AiUsageEvent.status == "error", 1), else_=0)).label("errors"),
                func.sum(AiUsageEvent.input_tokens).label("input_tokens"),
                func.coalesce(func.sum(AiUsageEvent.cached_tokens), 0).label("cached_tokens"),
                func.sum(AiUsageEvent.output_tokens).label("output_tokens"),
                func.sum(AiUsageEvent.cost_usd_estimate).label("cost"),
                func.max(case((unpriced, 1), else_=0)).label("unpriced"),
            )
            .where(*mine)
            .group_by(*keys)
        )
        for row in result:
            local = date.fromisoformat(row.day)
            total.add(row)
            days[(local, row.purpose)].add(row)
            purposes[row.purpose].add(row)
            modules[row.source_module].add(row)
            models[f"{row.provider_kind}/{row.model}"].add(row)
    by_day = [
        UsageDay(
            date=day,
            purpose=purpose,  # pyright: ignore[reportArgumentType]
            calls=acc.calls,
            input_tokens=acc.input_tokens,
            output_tokens=acc.output_tokens,
            cost_usd=acc.cost,
            cost_complete=acc.cost_complete,
        )
        for (day, purpose), acc in sorted(days.items())
    ]
    if start_day is None:
        start_day = min((day for day, _ in days), default=end_day)
    return UsageSummary(
        since=datetime.combine(start_day, time.min, tz),
        until=end_day,
        totals=total.totals(),
        cost_complete=total.cost_complete,
        by_day=by_day,
        by_purpose=_rows(purposes),
        by_module=_rows(modules),
        by_model=_rows(models),
    )
