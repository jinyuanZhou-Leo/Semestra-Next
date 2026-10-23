"""Running one capability for the assistant or an MCP client, and what a call gave (M12 §3.2).

`invoke` is the only way the loop, the cards (`decisions`) and MCP run a capability; tests
replace it here. `result_meta` is what the chat stores with every tool result.
"""

from dataclasses import dataclass, field
from typing import Any

import structlog
from pydantic import BaseModel
from starlette.datastructures import State

from semestra.core.capability import Capability, Surface, registry
from semestra.core.context import AuthInfo, Ctx, ScopeRef, run_after_commit
from semestra.core.errors import AppError
from semestra.modules.agent import display, history, tools
from semestra.modules.agent.models import AgentProposal
from semestra.modules.agent.runtime import agent_ctx

log = structlog.get_logger()

REJECTED = "The user rejected this action; it was not executed."


@dataclass
class Outcome:
    ok: bool
    payload: Any
    error_code: str | None = None
    citations: list[dict[str, Any]] = field(default_factory=lambda: [])
    ran: bool = True  # False for a rejected proposal or a skipped call: nothing was executed
    display: dict[str, Any] = field(default_factory=lambda: {})  # the chat's line (display.py)

    @property
    def content(self) -> str:
        return tools.serialize(self.payload)


def citations(payload: Any) -> list[dict[str, Any]]:
    """Results that quote files carry `citations: [{id, ...}]` (M07); the UI resolves
    `[[cite:<id>]]` markers against them."""
    raw = payload.get("citations") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return []
    return [c for c in raw if isinstance(c, dict) and isinstance(c.get("id"), str)]  # pyright: ignore[reportUnknownVariableType]


def error_payload(exc: AppError) -> dict[str, Any]:
    return {"error": {"code": exc.code, "params": exc.params}}


def error(code: str, *, ran: bool = True, **params: Any) -> Outcome:
    return Outcome(False, {"error": {"code": code, "params": params}}, code, ran=ran)


def result_meta(cap: Capability | None, outcome: Outcome) -> dict[str, Any]:
    """What the chat keeps with a tool result (the model never sees it): whether it worked and
    whether it changed the user's data (then the answer can no longer be regenerated)."""
    return {
        "ok": outcome.ok,
        "error_code": outcome.error_code,
        "changed": bool(outcome.ok and outcome.ran and cap is not None and cap.effect != "read"),
        "citations": outcome.citations,
        "display": outcome.display,
    }


async def invoke(
    state: State,
    user_id: str,
    scope: ScopeRef | None,
    name: str,
    args: dict[str, Any],
    *,
    surface: Surface = "agent",
    auth: AuthInfo | None = None,
) -> Outcome:
    """Runs a capability in its own transaction as the agent (or MCP client), then dispatches
    its events so open pages refresh."""
    async with agent_ctx(state, user_id, scope=scope, actor=surface) as ctx:
        ctx.auth = auth
        try:
            out = await registry.invoke(ctx, name, args, surface)
            await ctx.db.commit()
            payload = out.model_dump(mode="json") if isinstance(out, BaseModel) else out
            shown = await _display(ctx, name, args, payload) if surface == "agent" else {}
        except AppError as exc:
            await ctx.db.rollback()
            return Outcome(False, error_payload(exc), exc.code)
        except Exception:
            # A bug in one capability fails that call, not the whole turn.
            log.exception("agent_capability_failed", capability=name)
            await ctx.db.rollback()
            return error("common.internal")
    await run_after_commit(ctx)
    return Outcome(True, payload, citations=citations(payload), display=shown)


async def _display(ctx: Ctx, name: str, args: dict[str, Any], payload: Any) -> dict[str, Any]:
    """The chat's names and counts for this call; a failure here never fails the call."""
    try:
        return await display.describe(ctx, name, args, payload)
    except Exception:
        log.exception("agent_display_failed", capability=name)
        return {}


def proposal_outcome(row: AgentProposal) -> Outcome:
    """What a decided proposal gave, as the tool's result."""
    shown = row.display or {}
    if row.status == "executed":
        return Outcome(True, row.result, citations=citations(row.result), display=shown)
    if row.status == "failed":
        code = row.error_code or "agent.interrupted"
        payload = row.result if row.result is not None else {"error": {"code": code, "params": {}}}
        return Outcome(False, payload, code, display=shown)
    if row.status == "rejected":
        message = (row.result or {}).get("message") if isinstance(row.result, dict) else None
        return Outcome(True, {"rejected": True, "message": message or REJECTED}, ran=False)
    return Outcome(True, history.EXPIRED if row.status == "expired" else history.PENDING, ran=False)
