"""One adapter per provider kind; each converts the neutral request (`llm.py`) to its API."""

from semestra.modules.ai.adapters.anthropic import AnthropicAdapter
from semestra.modules.ai.adapters.base import Adapter
from semestra.modules.ai.adapters.gemini import GeminiAdapter
from semestra.modules.ai.adapters.ollama import OllamaAdapter
from semestra.modules.ai.adapters.openai import OpenAIAdapter

ADAPTERS: dict[str, Adapter] = {
    "anthropic": AnthropicAdapter(),
    "openai": OpenAIAdapter(),
    "openai_compatible": OpenAIAdapter(compatible=True),
    "gemini": GeminiAdapter(),
    "ollama": OllamaAdapter(),
}


def adapter_for(kind: str) -> Adapter:
    return ADAPTERS[kind]
