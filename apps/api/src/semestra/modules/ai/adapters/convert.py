"""Neutral messages (`llm.py`) → Pydantic AI messages, and request options per provider kind."""

from collections.abc import Sequence
from typing import Any, cast

from pydantic_ai.messages import (
    BinaryContent,
    ModelMessage,
    ModelRequest,
    ModelRequestPart,
    ModelResponse,
    SystemPromptPart,
    TextPart,
    UserContent,
    UserPromptPart,
)
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RequestUsage, RunUsage

from semestra.modules.ai.adapters.base import ModelParams
from semestra.modules.ai.adapters.sdk import REASONING_KINDS
from semestra.modules.ai.llm import Document, Image, Message, Text, Usage


def _user_content(parts: Sequence[object]) -> list[UserContent]:
    out: list[UserContent] = []
    for part in parts:
        match part:
            case Text(text=text):
                out.append(text)
            case Image(data=data, mime=mime) | Document(data=data, mime=mime):
                out.append(BinaryContent(data=data, media_type=mime))
            case _:
                raise TypeError(f"unsupported part {type(part).__name__}")
    return out


def to_messages(messages: Sequence[Message]) -> list[ModelMessage]:
    """Neutral messages → Pydantic AI requests and responses. System text goes first."""
    out: list[ModelMessage] = []
    system = "\n\n".join(
        p.text for m in messages if m.role == "system" for p in m.content if isinstance(p, Text)
    )
    pending: list[ModelRequestPart] = [SystemPromptPart(system)] if system else []
    for msg in messages:
        if msg.role == "system":
            continue
        if msg.role == "assistant":
            if pending:
                out.append(ModelRequest(parts=pending))
                pending = []
            text = "".join(p.text for p in msg.content if isinstance(p, Text))
            out.append(ModelResponse(parts=[TextPart(text)]))
        else:
            pending.append(UserPromptPart(_user_content(msg.content)))
    if pending:
        out.append(ModelRequest(parts=pending))
    return out


def settings_for(kind: str, params: ModelParams, summary: bool = True) -> ModelSettings:
    """The request options for a model's purpose (`SemestraModel` drops the Responses reasoning
    summary for endpoints that refused it)."""
    out: dict[str, Any] = {}
    # Without a cap from the user the provider's own applies: Pydantic AI sends the model's
    # maximum output where the Messages API needs one (16384 for models it does not know; 4096
    # for the Claude models that reject more), Gemini uses the model's maximum. A fixed 4096 cut
    # long structured answers off (a syllabus with evidence for every field, after thinking).
    if params.max_tokens is not None:
        out["max_tokens"] = params.max_tokens
    if params.temperature is not None:
        out["temperature"] = params.temperature
    if params.reasoning_effort is not None and kind in REASONING_KINDS:
        out["openai_reasoning_effort"] = params.reasoning_effort
        if kind == "openai_responses" and summary:
            # Without it the Responses API keeps the reasoning to itself (M12 shows a summary).
            out["openai_reasoning_summary"] = "auto"
    if kind == "openai_responses":
        out["openai_store"] = False  # the whole conversation is sent every time
    return cast(ModelSettings, out)


def usage(raw: RequestUsage | RunUsage) -> Usage:
    """Input tokens include cached ones (Pydantic AI already adds cache reads and writes)."""
    return Usage(
        input_tokens=raw.input_tokens,
        output_tokens=raw.output_tokens,
        cached_tokens=raw.cache_read_tokens or None,
    )
