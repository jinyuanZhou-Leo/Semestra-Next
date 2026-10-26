"""What one run of the assistant shares: Pydantic AI's `deps` (`Turn`), the per-message counts,
and which stored row each part of the history came from."""

import asyncio
from dataclasses import dataclass, field, fields
from typing import Any, Literal

from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse
from starlette.datastructures import State

from semestra.core.capability import Capability
from semestra.core.context import ScopeRef
from semestra.modules.agent import skills
from semestra.modules.agent.outcome import Outcome
from semestra.modules.agent.runtime import ChatLike

PARALLEL_READS = 4

PauseReason = Literal["tool_limit", "loop"]


@dataclass
class Counters:
    """Per user message, kept in `session.state["turn"]` across approvals; Continue resets it."""

    tool_calls: int = 0
    requests: int = 0
    last_call: str | None = None
    repeats: int = 0
    # Set at the limit or on a loop: a run resumed after approvals goes straight to the answer.
    pause: PauseReason | None = None

    @classmethod
    def load(cls, raw: Any) -> Counters:
        if not isinstance(raw, dict):
            return cls()
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in raw.items() if k in names})  # pyright: ignore[reportUnknownArgumentType]


class Rows:
    """The stored row each request part came from, and whether the user typed it.

    Kept by part object, not on the message: Pydantic AI merges consecutive requests (a tool row
    followed by the user's next message) into one and keeps only its own metadata, while the
    parts themselves survive the merge. The parts are held here too, so an `id()` is never
    reused while the run lasts."""

    def __init__(self) -> None:
        self._parts: dict[int, tuple[object, str, bool]] = {}

    def mark(self, request: ModelRequest, row_id: str, *, typed: bool = False) -> None:
        for part in request.parts:
            self._parts[id(part)] = (part, row_id, typed)

    def same_row(self, old: object, new: object) -> None:
        """`new` stands in for `old` in a request (a cleared tool result): same row."""
        if (mark := self._parts.get(id(old))) is not None:
            self._parts[id(new)] = (new, mark[1], mark[2])

    def row_id(self, message: ModelMessage) -> str | None:
        """The row a message ends with: a response's own, a request's newest (ids are UUIDv7,
        so they sort by time; a merged request holds several rows)."""
        if isinstance(message, ModelResponse):
            rid = (message.metadata or {}).get("row_id")
            return rid if isinstance(rid, str) else None
        found = [self._parts[id(p)][1] for p in message.parts if id(p) in self._parts]
        return max(found) if found else None

    def holds(self, message: ModelMessage, row_id: str) -> bool:
        """Whether the message carries that row (a merged request holds several)."""
        if isinstance(message, ModelResponse):
            return self.row_id(message) == row_id
        return any(self._parts.get(id(p), (None, None))[1] == row_id for p in message.parts)

    def typed(self, message: ModelMessage) -> bool:
        """A request carrying something the user wrote."""
        return isinstance(message, ModelRequest) and any(
            self._parts[id(p)][2] for p in message.parts if id(p) in self._parts
        )


@dataclass
class Turn:
    """Pydantic AI's `deps` for one run: what the tools and the hooks share."""

    state: State
    user_id: str
    session_id: str
    scope: ScopeRef | None
    model: ChatLike
    caps: dict[str, Capability]
    auto_approve: frozenset[str]
    skills: dict[str, skills.Skill]
    counters: Counters
    memo: dict[str, Any]  # session.state without "turn": the compaction summary
    work: str  # the work context (second part of the instructions)
    decided: dict[str, Outcome] = field(default_factory=lambda: {})  # approved, by call id
    edited: dict[str, dict[str, Any]] = field(
        default_factory=lambda: {}
    )  # args changed on the card
    full: dict[str, tuple[str, str]] = field(default_factory=lambda: {})  # uncut results
    sem: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(PARALLEL_READS))
    rows: Rows = field(default_factory=Rows)
    # Set by Stop: reads still running give up, calls not started yet are skipped.
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
