"""Process-wide assistant state: running generations, stop signals and the model hooks.

A generation runs as its own task, not inside the request that started it: a client that goes
away (a reload, a lost connection, another page) does not stop it. Its events are buffered with
sequential ids, so any client can follow it from the start or pick up after the last event it
saw (`Generation.follow`); only Stop ends it early.

Tests replace `chat_model`, `chat_available`, `small_complete`, `summarize` and `memory_model`
with scripted fakes.
"""

import asyncio
import json
import uuid
from collections import defaultdict
from collections.abc import AsyncIterator, Awaitable, Callable, Coroutine, Generator
from contextlib import AbstractAsyncContextManager, asynccontextmanager, contextmanager
from typing import Any, Protocol

import structlog
from pydantic_ai.models import Model
from starlette.datastructures import State

from semestra.core.context import Ctx, ScopeRef, pick_locale
from semestra.core.errors import AppError
from semestra.modules import ai
from semestra.modules.agent.memory import MemoryUpdates
from semestra.modules.ai import Message

MAX_GENERATIONS_PER_USER = 2
KEEP_FINISHED_SECONDS = 60  # a client reconnecting just after the end still gets the tail

log = structlog.get_logger()

SseItem = dict[str, str]


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


async def _summarize(ctx: Ctx, messages: list[Message]) -> str:
    """Compaction's summary, by the chat model: it holds the whole conversation, which the small
    model may not."""
    result = await ai.complete(ctx, "chat", messages, source_module="agent")
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
        # Followable from the claim on: a client that reloads while the request still checks
        # or stores things waits for this turn's events instead of getting the last turn's.
        self.generation = Generation(session_id)
        self._released = False

    def release(self) -> None:
        if not self._released:
            self._released = True
            self._rt._release(self)  # pyright: ignore[reportPrivateUsage]


class Generation:
    """The events of one running (or just finished) generation."""

    def __init__(self, session_id: str) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.session_id = session_id
        self.items: list[SseItem] = []
        self.done = False
        self.task: asyncio.Task[None] | None = None
        self._changed = asyncio.Condition()

    async def push(self, item: SseItem) -> None:
        async with self._changed:
            self.items.append({**item, "id": f"{self.id}:{len(self.items)}"})
            self._changed.notify_all()

    async def close(self) -> None:
        async with self._changed:
            self.done = True
            self._changed.notify_all()

    def position(self, last_event_id: str | None) -> int:
        """The index after `Last-Event-ID`; the start for an id of another generation."""
        gen, _, n = (last_event_id or "").partition(":")
        return int(n) + 1 if gen == self.id and n.isdigit() else 0

    async def follow(self, start: int = 0) -> AsyncIterator[SseItem]:
        i = start
        while True:
            while i < len(self.items):
                yield self.items[i]
                i += 1
            if self.done:
                return
            async with self._changed:
                await self._changed.wait_for(lambda seen=i: len(self.items) > seen or self.done)


class AgentRuntime:
    def __init__(self) -> None:
        self.chat_model: Callable[[Ctx], AbstractAsyncContextManager[ChatLike]] = _chat_model
        self.chat_available: Callable[[Ctx], Awaitable[bool]] = _chat_available
        self.small_complete: Callable[[Ctx, list[Message]], Awaitable[str]] = _small_complete
        self.summarize: Callable[[Ctx, list[Message]], Awaitable[str]] = _summarize
        self.memory_model: Callable[[Ctx, list[Message]], Awaitable[MemoryUpdates]] = _memory_model
        self._per_user: defaultdict[str, int] = defaultdict(int)
        self._running: dict[str, asyncio.Event] = {}
        self._generations: dict[str, Generation] = {}
        self._background: set[asyncio.Task[Any]] = set()
        self._keyed: dict[str, asyncio.Task[Any]] = {}

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
        claim = Claim(self, user_id, session_id, cancel)
        self._generations[session_id] = claim.generation
        return claim

    def _release(self, claim: Claim) -> None:
        if self._running.get(claim.session_id) is claim.cancel:
            del self._running[claim.session_id]
        self._per_user[claim.user_id] -= 1
        if self._per_user[claim.user_id] <= 0:
            del self._per_user[claim.user_id]
        gen = claim.generation
        if gen.task is None:
            # Released before it started (the request failed): nothing to follow.
            gen.done = True
            self._forget(gen)
            self.background(gen.close())

    @contextmanager
    def slot(self, user_id: str, session_id: str) -> Generator[asyncio.Event]:
        """`claim` for a block; the event is set by `stop`."""
        claim = self.claim(user_id, session_id)
        try:
            yield claim.cancel
        finally:
            claim.release()

    def start(self, claim: Claim, events: AsyncIterator[SseItem]) -> Generation:
        """Runs `events` as the session's generation; the claim is released when it ends."""
        gen = claim.generation
        self._generations[claim.session_id] = gen
        gen.task = asyncio.create_task(self._drive(gen, events, claim))
        return gen

    async def _drive(self, gen: Generation, events: AsyncIterator[SseItem], claim: Claim) -> None:
        try:
            async for item in events:
                await gen.push(item)
        except asyncio.CancelledError:
            raise
        except Exception:
            # The run itself reports its errors; this is anything before it or around it. No one
            # awaits this task, so without the event the chat would wait for nothing.
            log.exception("agent_turn_failed", session_id=gen.session_id)
            await gen.push(
                {"event": "error", "data": json.dumps({"code": "common.internal", "params": {}})}
            )
        finally:
            claim.release()
            await asyncio.shield(gen.close())
            loop = asyncio.get_running_loop()
            loop.call_later(KEEP_FINISHED_SECONDS, self._forget, gen)

    def background(self, work: Coroutine[Any, Any, Any], *, key: str | None = None) -> None:
        """Runs work that belongs to no turn (a title): kept until it ends, logged if it fails,
        cancelled at shutdown. With a `key`, skipped while work with that key is still running
        (a second turn before the first title came back)."""
        if key is not None and key in self._keyed:
            work.close()
            return
        task = asyncio.create_task(work)
        self._background.add(task)
        if key is not None:
            self._keyed[key] = task

        def done(t: asyncio.Task[Any]) -> None:
            self._background.discard(t)
            if key is not None and self._keyed.get(key) is t:
                del self._keyed[key]
            if not t.cancelled() and t.exception() is not None:
                log.error("agent_background_failed", exc_info=t.exception())

        task.add_done_callback(done)

    async def drain(self) -> None:
        """Waits for the background work (tests)."""
        # Unfinished ones only, as in `core.events.drain`: gathering finished tasks never yields.
        while running := [t for t in self._background if not t.done()]:
            await asyncio.gather(*running, return_exceptions=True)

    def _forget(self, gen: Generation) -> None:
        if self._generations.get(gen.session_id) is gen:
            del self._generations[gen.session_id]

    async def announce(self, session_id: str, item: SseItem) -> bool:
        """Adds an event to the session's running turn; False when none runs."""
        gen = self._generations.get(session_id)
        if gen is None or gen.done or gen.task is None:
            return False
        await gen.push(item)
        return True

    def generation(self, session_id: str) -> Generation | None:
        """The session's running generation, or the one that just ended."""
        return self._generations.get(session_id)

    async def shutdown(self) -> None:
        """Stops every generation; each keeps what it said and did so far."""
        tasks = [g.task for g in self._generations.values() if g.task and not g.task.done()]
        tasks += [t for t in self._background if not t.done()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

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
        from semestra.modules.auth.service import user_by_id

        user = await user_by_id(db, user_id)
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
