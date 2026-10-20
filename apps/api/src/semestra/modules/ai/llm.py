"""The provider-neutral request and response shapes of M06 (§5).

Callers build `Message`s from these parts; each adapter converts them to its provider's format.
They are plain dataclasses on purpose: they carry bytes (images, PDFs) and never go over HTTP.
"""

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

Purpose = Literal["chat", "extraction", "vision", "embedding", "title"]
PURPOSES: tuple[Purpose, ...] = ("chat", "extraction", "vision", "embedding", "title")

ProviderCapability = Literal["chat", "tools", "vision", "structured", "embedding"]
CAPABILITIES: tuple[ProviderCapability, ...] = (
    "chat",
    "tools",
    "vision",
    "structured",
    "embedding",
)

# What a provider must be able to do to serve a purpose (`structured` falls back to JSON mode, so
# extraction only needs chat).
PURPOSE_NEEDS: dict[Purpose, ProviderCapability] = {
    "chat": "chat",
    "extraction": "chat",
    "vision": "vision",
    "embedding": "embedding",
    "title": "chat",
}


@dataclass(frozen=True)
class Text:
    text: str


@dataclass(frozen=True)
class Image:
    data: bytes
    mime: str  # image/png, image/jpeg, image/webp, image/gif


@dataclass(frozen=True)
class Document:
    """A PDF. Providers without PDF input get it rasterized by the caller's `rasterize`."""

    data: bytes
    mime: str = "application/pdf"


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ToolResult:
    call_id: str
    name: str
    content: str
    is_error: bool = False


@dataclass(frozen=True)
class Reasoning:
    """A model's reasoning (Claude thinking, an OpenAI reasoning item), kept as the provider sent
    it so the next turn can send it back. Opaque to callers: `signature` may be encrypted.

    Only replayed to the provider and model that produced it (`source`); others ignore it.
    """

    source: str  # "<provider kind>:<provider id>:<model>"
    content: str = ""
    id: str | None = None
    signature: str | None = None
    provider_name: str | None = None
    details: dict[str, Any] | None = None


Part = Text | Image | Document | ToolCall | ToolResult | Reasoning
Role = Literal["system", "user", "assistant", "tool"]


@dataclass(frozen=True)
class Message:
    role: Role
    content: Sequence[Part]

    @classmethod
    def system(cls, text: str) -> Message:
        return cls("system", [Text(text)])

    @classmethod
    def user(cls, *parts: Part | str) -> Message:
        return cls("user", [Text(p) if isinstance(p, str) else p for p in parts])

    @classmethod
    def assistant(cls, *parts: Part | str) -> Message:
        return cls("assistant", [Text(p) if isinstance(p, str) else p for p in parts])


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int | None = None

    def add(self, other: Usage) -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        if other.cached_tokens is not None:
            self.cached_tokens = (self.cached_tokens or 0) + other.cached_tokens


StopReason = Literal["end", "tool_use", "max_tokens", "other"]


@dataclass
class Completion:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=lambda: [])
    stop_reason: StopReason = "end"
    usage: Usage = field(default_factory=Usage)
    provider_kind: str = ""
    model: str = ""
    # Send back with the assistant's message on the next turn (`Message.assistant(*reasoning, …)`).
    reasoning: list[Reasoning] = field(default_factory=lambda: [])


@dataclass(frozen=True)
class Chunk:
    """One streamed piece: a text delta, a reasoning delta, a finished tool call, or (last) the
    whole completion."""

    text: str | None = None
    # The readable part of the model's reasoning (a summary for most providers), as it streams.
    thinking: str | None = None
    tool_call: ToolCall | None = None
    done: Completion | None = None


@dataclass(frozen=True)
class EmbeddingResult:
    model: str
    dim: int
    vectors: list[list[float]]


@dataclass(frozen=True)
class PageText:
    """Parsed text of one page (M07 `files.document.read`), the input of `extract`."""

    page: int
    text: str


# Renders a PDF's pages as images for providers that cannot read PDFs. M07 passes its renderer,
# so this module never imports the document pipeline.
Rasterize = Callable[[bytes], Awaitable[list[Image]]]
