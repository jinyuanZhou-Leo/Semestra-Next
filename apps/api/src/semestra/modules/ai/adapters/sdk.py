"""Pydantic AI models and SDK clients per provider kind, all sending through our `httpx` client.

| kind                   | Pydantic AI model      | wire API                                  |
|------------------------|------------------------|-------------------------------------------|
| `anthropic`            | `AnthropicModel`       | Messages API                              |
| `anthropic_compatible` | `AnthropicModel`       | Messages API at the user's base URL       |
| `openai`               | `OpenAIChatModel`      | Chat Completions                          |
| `openai_compatible`    | `OpenAIChatModel`      | Chat Completions at the user's base URL   |
| `openai_responses`     | `OpenAIResponsesModel` | Responses API at the user's base URL      |
| `gemini`               | `GoogleModel`          | Gemini API                                |
| `ollama`               | `OpenAIChatModel`      | Ollama's OpenAI-compatible API (`/v1`)    |

The SDKs' own retries are off: `adapters/__init__.py` retries the M06 way (§5).

The SDKs are imported on first use, each kind importing only its own: importing them takes
seconds, which every start of the API (and every reload of `semestra dev`, every test worker)
would otherwise pay. `warm_up()` imports them off the event loop after start, so the first
request usually finds them loaded.
"""

import functools
import importlib
from typing import TYPE_CHECKING, Any

import httpx
from pydantic_ai.models import Model

from semestra.modules.ai.adapters.base import Endpoint
from semestra.modules.ai.adapters.bridge import NO_KEY, sdk_client

if TYPE_CHECKING:
    from anthropic import AsyncAnthropic
    from google.genai import Client as GoogleClient
    from openai import AsyncOpenAI
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.google import GoogleProvider

ANTHROPIC_KINDS = frozenset(("anthropic", "anthropic_compatible"))
OPENAI_KINDS = frozenset(("openai", "openai_compatible", "openai_responses", "ollama"))
# Only OpenAI's own API takes `reasoning_effort` (a compatible endpoint may reject it).
REASONING_KINDS = frozenset(("openai", "openai_responses"))
# What `chat_model()` imports across every kind (each SDK comes with its Pydantic AI model).
_SDK_MODULES = (
    "pydantic_ai.models.anthropic",
    "pydantic_ai.models.google",
    "pydantic_ai.models.openai",
    "pydantic_ai.providers.anthropic",
    "pydantic_ai.providers.google",
    "pydantic_ai.providers.ollama",
    "pydantic_ai.providers.openai",
)


def warm_up() -> None:
    """Import every SDK. Blocking: run it in a thread (Python's import lock makes a request
    importing the same module meanwhile wait for it, not import it twice)."""
    for name in _SDK_MODULES:
        importlib.import_module(name)


def _strip(url: str, *suffixes: str) -> str:
    url = url.rstrip("/")
    for suffix in suffixes:
        if url.endswith(suffix):
            return url[: -len(suffix)]
    return url


def openai_client(client: httpx.AsyncClient, ep: Endpoint) -> AsyncOpenAI:
    from openai import AsyncOpenAI

    base_url = ep.base_url
    if ep.kind == "ollama":  # the user gives Ollama's address; its OpenAI API is under /v1
        base_url = f"{_strip(base_url, '/v1')}/v1"
    return AsyncOpenAI(
        base_url=base_url,
        api_key=ep.api_key or NO_KEY,
        http_client=sdk_client(client, has_key=bool(ep.api_key)),
        max_retries=0,
    )


def anthropic_client(client: httpx.AsyncClient, ep: Endpoint) -> AsyncAnthropic:
    from anthropic import AsyncAnthropic

    # The SDK adds `/v1/messages`; a base URL typed with a trailing `/v1` works too.
    key = ep.api_key or NO_KEY
    return AsyncAnthropic(
        base_url=_strip(ep.base_url, "/v1"),
        api_key=key,
        # Some compatible gateways read a bearer token instead of `x-api-key`: send both.
        auth_token=key if ep.kind == "anthropic_compatible" else None,
        http_client=sdk_client(client, has_key=bool(ep.api_key)),
        max_retries=0,
    )


def google_provider(client: httpx.AsyncClient, ep: Endpoint) -> GoogleProvider:
    from pydantic_ai.providers.google import GoogleProvider

    # The SDK adds the API version (v1beta) itself.
    return GoogleProvider(
        api_key=ep.api_key or NO_KEY,
        http_client=sdk_client(client, has_key=bool(ep.api_key)),
        base_url=_strip(ep.base_url, "/v1beta", "/v1") + "/",
    )


def google_client(client: httpx.AsyncClient, ep: Endpoint) -> GoogleClient:
    return google_provider(client, ep).client


@functools.cache
def _compatible_chat_model() -> type[OpenAIChatModel]:
    from openai import omit as OMIT
    from pydantic_ai.models.openai import OpenAIChatModel

    class _CompatibleChatModel(OpenAIChatModel):
        """Chat Completions at a compatible server: no `stream_options`, which some of them
        reject (usage then comes from the final chunk when the server sends it)."""

        def _get_stream_options(self, model_settings: Any) -> Any:
            return OMIT

    return _CompatibleChatModel


def chat_model(client: httpx.AsyncClient, ep: Endpoint, model: str) -> Model:
    if ep.kind in ANTHROPIC_KINDS:
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        return AnthropicModel(
            model, provider=AnthropicProvider(anthropic_client=anthropic_client(client, ep))
        )
    if ep.kind == "gemini":
        from pydantic_ai.models.google import GoogleModel

        return GoogleModel(model, provider=google_provider(client, ep))
    from pydantic_ai.models.openai import OpenAIChatModel, OpenAIResponsesModel
    from pydantic_ai.profiles.openai import OpenAIModelProfile
    from pydantic_ai.providers.ollama import OllamaProvider
    from pydantic_ai.providers.openai import OpenAIProvider

    oai = openai_client(client, ep)
    if ep.kind == "openai_responses":
        return OpenAIResponsesModel(model, provider=OpenAIProvider(openai_client=oai))
    profile: OpenAIModelProfile | None = None
    if ep.kind in ("openai_compatible", "ollama"):
        # Most compatible servers know `max_tokens`, not OpenAI's `max_completion_tokens`.
        profile = {"openai_chat_supports_max_completion_tokens": False}
    provider: Any = (
        OllamaProvider(openai_client=oai)
        if ep.kind == "ollama"
        else OpenAIProvider(openai_client=oai)
    )
    cls = _compatible_chat_model() if ep.kind == "openai_compatible" else OpenAIChatModel
    return cls(model, provider=provider, profile=profile)
