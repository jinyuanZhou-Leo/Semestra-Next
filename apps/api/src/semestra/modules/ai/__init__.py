"""M06 AI 接入层: bring-your-own-key providers, model calls, structured extraction, usage.

Every module calls models through the functions exported here, never through a provider SDK.
"""

from fastapi import FastAPI

from semestra.modules.ai import capabilities, models, portability  # noqa: F401  (registers on import)
from semestra.modules.ai.calls import (
    UNTRUSTED_NOTICE,
    AgentModel,
    agent_model,
    available,
    complete,
    complete_with,
    embed,
    structured,
    wrap_untrusted,
)
from semestra.modules.ai.extraction import (
    Evidence,
    Evidenced,
    Extraction,
    ExtractionWarning,
    extract,
)
from semestra.modules.ai.llm import (
    Completion,
    Document,
    EmbeddingResult,
    Image,
    Message,
    PageText,
    Purpose,
    Rasterize,
    Text,
    Usage,
)
from semestra.modules.ai.resolve import resolve_provider
from semestra.modules.ai.runtime import AiRuntime

__all__ = [
    "UNTRUSTED_NOTICE",
    "AgentModel",
    "Completion",
    "Document",
    "EmbeddingResult",
    "Evidence",
    "Evidenced",
    "Extraction",
    "ExtractionWarning",
    "Image",
    "Message",
    "PageText",
    "Purpose",
    "Rasterize",
    "Text",
    "Usage",
    "agent_model",
    "available",
    "complete",
    "complete_with",
    "embed",
    "extract",
    "register",
    "resolve_provider",
    "structured",
    "wrap_untrusted",
]


def register(app: FastAPI) -> None:
    app.state.ai = AiRuntime()
