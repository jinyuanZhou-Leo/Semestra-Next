"""The conversation an agent tool runs in, set by the loop around every capability call: a memory
records where it came from, the chat tools leave the conversation itself out."""

from contextvars import ContextVar

conversation: ContextVar[str | None] = ContextVar("agent_conversation", default=None)
