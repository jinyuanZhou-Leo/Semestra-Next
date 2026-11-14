"""What MCP clients changed (M12 §5): every write made with an API token is recorded in the same
transaction, by the registry's token policy, so REST calls with a token count too. "Recent
changes" lists them for the account (filterable by connection) and keeps them for `RETENTION`
whatever happens to the token: a revoked connection's changes stay listed under its name. The UI
names the action by its capability title."""

from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any

import structlog
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from semestra.core.capability import Capability, Http, capability
from semestra.core.context import Ctx
from semestra.core.jobs import periodic
from semestra.modules.agent import display, service
from semestra.modules.agent.models import AgentMcpChange
from semestra.modules.auth import service as auth_service

log = structlog.get_logger()

RETENTION = timedelta(days=90)
LIST_LIMIT = 100


async def _target(ctx: Ctx, cap: Capability, args: dict[str, Any]) -> list[str]:
    """The names behind the call's ids, read before it runs (a deleted row has no name after).
    A failure leaves the record without names, never the change undone."""
    try:
        return await display.labels(ctx, cap.name, args)
    except Exception:
        log.exception("mcp_change_target_failed", capability=cap.name)
        return []


class McpTokenPolicy:
    async def check(self, ctx: Ctx, cap: Capability) -> None:
        await service.check_token_call(ctx, cap)

    async def write(
        self, ctx: Ctx, cap: Capability, inp: BaseModel, run: Callable[[], Awaitable[Any]]
    ) -> Any:
        token_id = ctx.auth.token_id if ctx.auth is not None else None
        assert token_id is not None
        client = await auth_service.token_name(ctx, token_id) or ""
        target = await _target(ctx, cap, inp.model_dump(mode="json"))
        out = await run()
        own = display.named(out.model_dump(mode="json") if isinstance(out, BaseModel) else out)
        if own and own not in target:
            target.append(own)
        ctx.db.add(
            AgentMcpChange(
                user_id=ctx.user_id,
                token_id=token_id,
                client=client,
                capability=cap.name,
                target=target,
                created_at=ctx.now,
            )
        )
        return out


@periodic("agent.mcp_changes.cleanup", every=timedelta(days=1), first_after=timedelta(minutes=15))
async def cleanup(ctx: Ctx) -> None:
    await ctx.db.execute(
        delete(AgentMcpChange).where(AgentMcpChange.created_at < ctx.now - RETENTION)
    )


# --- capability -----------------------------------------------------------------------------


class McpChangeListInput(BaseModel):
    token_id: str | None = Field(
        default=None, description="Only the changes made with this API token"
    )


class McpChangeOut(BaseModel):
    id: str
    # None once the token row is gone; `client` still names the connection.
    token_id: str | None
    client: str
    capability: str
    target: list[str]
    created_at: datetime


class McpChangeList(BaseModel):
    items: list[McpChangeOut]


@capability(
    name="agent.mcp_change.list",
    summary="List what MCP clients changed.",
    description=(
        "The latest changes made with the user's API tokens, newest first, optionally for one "
        "token (kept for 90 days, revoked tokens included). Not for agents."
    ),
    effect="read",
    http=Http("GET", "/agent/mcp-changes"),
    expose=("http",),
    tags=("agent",),
)
async def list_changes(ctx: Ctx, inp: McpChangeListInput) -> McpChangeList:
    query = select(AgentMcpChange).where(AgentMcpChange.user_id == ctx.user_id)
    if inp.token_id is not None:
        query = query.where(AgentMcpChange.token_id == inp.token_id)
    rows = await ctx.db.scalars(
        query.order_by(AgentMcpChange.created_at.desc(), AgentMcpChange.id.desc()).limit(LIST_LIMIT)
    )
    return McpChangeList(
        items=[
            McpChangeOut(
                id=r.id,
                token_id=r.token_id,
                client=r.client,
                capability=r.capability,
                target=r.target,
                created_at=r.created_at,
            )
            for r in rows
        ]
    )
