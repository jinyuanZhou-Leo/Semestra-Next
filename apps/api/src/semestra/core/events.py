"""Domain events (M00 §3.8).

`await events.publish(ctx, "academics.course.deleted", {"course_id": ...})` queues the event on
the ctx; it is dispatched only after the transaction commits (`run_after_commit`). Dispatch
pushes it to the user's live connections (SSE, see `core.realtime`) and runs every subscriber in
its own system ctx and transaction, so one failing subscriber cannot affect the others or the
publisher.

A few events must run *inside* the publisher's transaction instead, e.g. `academics.course.deleting`
lets other modules delete their rows together with the course. Those are subscribed with
`in_transaction=True` and published with `publish_in_transaction`: the subscribers run at once
with the publisher's ctx, and an exception aborts the whole operation.
"""

from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import structlog
from starlette.datastructures import State

from semestra.core.context import Ctx, run_as_system

log = structlog.get_logger()


@dataclass(frozen=True)
class Event:
    type: str
    data: dict[str, Any]
    # The user the event concerns; only then is it pushed over SSE.
    user_id: str | None


Subscriber = Callable[[Ctx, Event], Awaitable[None]]


class EventBus:
    def __init__(self) -> None:
        self._subscribers: defaultdict[str, list[Subscriber]] = defaultdict(list)
        self._in_transaction: defaultdict[str, list[Subscriber]] = defaultdict(list)

    def subscribe(
        self, event_type: str, *, in_transaction: bool = False
    ) -> Callable[[Subscriber], Subscriber]:
        def decorate(fn: Subscriber) -> Subscriber:
            target = self._in_transaction if in_transaction else self._subscribers
            target[event_type].append(fn)
            return fn

        return decorate

    async def publish_in_transaction(
        self, ctx: Ctx, event_type: str, data: dict[str, Any], *, user_id: str | None = None
    ) -> None:
        """Run the `in_transaction` subscribers now, in the caller's transaction. Not pushed
        over SSE; errors propagate so the caller's operation is rolled back."""
        target = user_id if user_id is not None else (ctx.user.id if ctx.user else None)
        event = Event(event_type, data, target)
        for subscriber in self._in_transaction.get(event_type, []):
            await subscriber(ctx, event)

    async def publish(
        self, ctx: Ctx, event_type: str, data: dict[str, Any], *, user_id: str | None = None
    ) -> None:
        """Queue an event for after commit. `user_id` defaults to the ctx user."""
        target = user_id if user_id is not None else (ctx.user.id if ctx.user else None)
        event = Event(event_type, data, target)
        state = ctx.state

        async def _dispatch() -> None:
            await self.dispatch(state, event)

        ctx.after_commit.append(_dispatch)

    async def dispatch(self, state: State, event: Event) -> None:
        """Deliver an already committed event. Never raises."""
        realtime = getattr(state, "realtime", None)
        if realtime is not None and event.user_id is not None:
            realtime.send(event.user_id, {"type": event.type, "data": event.data})
        for subscriber in self._subscribers.get(event.type, []):
            try:

                async def _run(ctx: Ctx, fn: Subscriber = subscriber) -> None:
                    await fn(ctx, event)

                await run_as_system(state, event.user_id, _run)
            except Exception:
                log.exception("event_subscriber_failed", event_type=event.type)


events = EventBus()
