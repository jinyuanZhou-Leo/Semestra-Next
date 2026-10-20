"""Process-wide assistant state: running generations, stop signals and the model hooks.

Tests replace `chat_model`, `chat_available`, `small_complete` and `memory_model` with scripted
fakes.
"""

import asyncio
import uuid
from collections import defaultdict
from collections.abc import AsyncIterator, Awaitable, Callable, Generator
from contextlib import AbstractAsyncContextManager, asynccontextmanager, contextmanager
from typing import Protocol

from pydantic_ai.models import Model
from starlette.datastructures import State

from semestra.core.context import Ctx, ScopeRef, pick_locale
from semestra.core.errors import AppError
from semestra.modules import ai
from semestra.modules.agent.memory import MemoryUpdates
from semestra.modules.ai import Message

MAX_GENERATIONS_PER_USER = 2


class ChatLike(Protocol):
    """What the loop needs from a model: M06's `AgentModel` or a test fake."""

    @property
    def model(self) -> Model: ...

    @property
    def name(self) -> str: ...

    @property
    def source(self) -> str: ...

    @property
    def supports_tools(self) -> bool: ...

    @property
    def vision(self) -> bool: ...

    @property
    def reads_pdf(self) -> bool: ...

    @property
    def context_window(self) -> int: ...


def _chat_model(ctx: Ctx) -> AbstractAsyncContextManager[ChatLike]:
    return ai.agent_model(ctx, "chat", source_module="agent")


async def _chat_available(ctx: Ctx) -> bool:
    return await ai.available(ctx, "chat")


async def _small_complete(ctx: Ctx, messages: list[Message]) -> str:
    result = await ai.complete(ctx, "title", messages, source_module="agent")
    assert isinstance(result, ai.Completion)
    return result.text


async def _memory_model(ctx: Ctx, messages: list[Message]) -> MemoryUpdates:
    return await ai.structured(ctx, "title", messages, MemoryUpdates, source_module="agent")


class Claim:
    """A held generation slot. `release` is idempotent."""

    def __init__(self, rt: AgentRuntime, user_id: str, session_id: str, cancel: asyncio.Event):
        self._rt = rt
        self.user_id = user_id
        self.session_id = session_id
        self.cancel = cancel
        self._released = False

    def release(self) -> None:
        if not self._released:
            self._released = True
            self._rt._release(self)  # pyright: ignore[reportPrivateUsage]


class AgentRuntime:
    def __init__(self) -> None:
        self.chat_model: Callable[[Ctx], AbstractAsyncContextManager[ChatLike]] = _chat_model
        self.chat_available: Callable[[Ctx], Awaitable[bool]] = _chat_available
        self.small_complete: Callable[[Ctx, list[Message]], Awaitable[str]] = _small_complete
        self.memory_model: Callable[[Ctx, list[Message]], Awaitable[MemoryUpdates]] = _memory_model
        self._per_user: defaultdict[str, int] = defaultdict(int)
        self._running: dict[str, asyncio.Event] = {}

    def generating(self, session_id: str) -> bool:
        return session_id in self._running

    def claim(self, user_id: str, session_id: str) -> Claim:
        """Claims one of the user's generation slots until `Claim.release`; raises `agent.busy`.
        The routes claim before changing anything, so two requests for one session can never
        both store a message or both execute a proposal."""
        if session_id in self._running or self._per_user[user_id] >= MAX_GENERATIONS_PER_USER:
            raise AppError("agent.busy", 429)
        cancel = asyncio.Event()
        self._running[session_id] = cancel
        self._per_user[user_id] += 1
        return Claim(self, user_id, session_id, cancel)

    def _release(self, claim: Claim) -> None:
        if self._running.get(claim.session_id) is claim.cancel:
            del self._running[claim.session_id]
        self._per_user[claim.user_id] -= 1
        if self._per_user[claim.user_id] <= 0:
            del self._per_user[claim.user_id]

    @contextmanager
    def slot(self, user_id: str, session_id: str) -> Generator[asyncio.Event]:
        """`claim` for a block; the event is set by `stop`."""
        claim = self.claim(user_id, session_id)
        try:
            yield claim.cancel
        finally:
            claim.release()

    def stop(self, session_id: str) -> bool:
        cancel = self._running.get(session_id)
        if cancel is None:
            return False
        cancel.set()
        return True


def runtime(state: State) -> AgentRuntime:
    return state.agent


@asynccontextmanager
async def agent_ctx(
    state: State, user_id: str, *, scope: ScopeRef | None, actor: str = "agent"
) -> AsyncIterator[Ctx]:
    """A ctx with its own database session, for one step of a generation (tool calls run in
    parallel, so each needs its own session). The caller commits."""
    async with state.session_factory() as db:
        from semestra.modules.auth.models import AuthUser

        user = await db.get(AuthUser, user_id)
        if user is None:
            raise AppError("common.unauthenticated", 401)
        yield Ctx(
            db=db,
            user=user,
            locale=pick_locale(None, user.locale),
            now=state.now(),
            scope=scope,
            actor=actor,  # pyright: ignore[reportArgumentType]
            request_id=str(uuid.uuid7()),
            state=state,
        )
