"""Static knowledge about provider kinds: capabilities, endpoints, default models, prices."""

import tomllib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from functools import cache
from pathlib import Path
from typing import Any, Literal

from genai_prices import Usage, calc_price
from genai_prices.types import PriceCalculation

from semestra.modules.ai.llm import ProviderCapability, Purpose

ProviderKind = Literal[
    "anthropic",
    "anthropic_compatible",
    "openai",
    "openai_compatible",
    "openai_responses",
    "gemini",
    "ollama",
]
KINDS: tuple[ProviderKind, ...] = (
    "anthropic",
    "anthropic_compatible",
    "openai",
    "openai_compatible",
    "openai_responses",
    "gemini",
    "ollama",
)
# Kinds whose endpoint the user brings: no recommended models, and a model name may be typed when
# the endpoint cannot list its models.
COMPATIBLE_KINDS: frozenset[str] = frozenset(
    ("anthropic_compatible", "openai_compatible", "openai_responses")
)

_HERE = Path(__file__).parent


@dataclass(frozen=True)
class KindInfo:
    default_base_url: str | None
    needs_key: bool  # an API key is required
    needs_base_url: bool
    # Fixed capabilities; None = the user chooses (endpoints and local models differ).
    capabilities: tuple[ProviderCapability, ...] | None
    reads_pdf: bool


KIND_INFO: dict[ProviderKind, KindInfo] = {
    "anthropic": KindInfo(
        "https://api.anthropic.com", True, False, ("chat", "tools", "vision", "structured"), True
    ),
    "anthropic_compatible": KindInfo(None, False, True, None, False),
    "openai": KindInfo(
        "https://api.openai.com/v1",
        True,
        False,
        ("chat", "tools", "vision", "structured", "embedding"),
        True,
    ),
    "openai_compatible": KindInfo(None, False, True, None, False),
    # The Responses API at any base URL (OpenAI's own is https://api.openai.com/v1).
    "openai_responses": KindInfo(None, False, True, None, False),
    "gemini": KindInfo(
        "https://generativelanguage.googleapis.com/v1beta",
        True,
        False,
        ("chat", "tools", "vision", "structured", "embedding"),
        True,
    ),
    "ollama": KindInfo(None, False, True, None, False),
}

# Offered when the user adds a provider whose capabilities they choose.
DEFAULT_CHOSEN_CAPABILITIES: dict[ProviderKind, tuple[ProviderCapability, ...]] = {
    "anthropic_compatible": ("chat", "tools"),
    "openai_compatible": ("chat", "tools"),
    "openai_responses": ("chat", "tools", "structured"),
    "ollama": ("chat", "tools", "structured", "embedding"),
}


@cache
def _load(name: str) -> dict[str, Any]:
    with (_HERE / name).open("rb") as f:
        return tomllib.load(f)


def _longest_prefix(table: dict[str, Any], model: str) -> Any | None:
    matches = [k for k in table if model.startswith(k)]
    return table[max(matches, key=len)] if matches else None


def default_model(kind: str, purpose: Purpose) -> str | None:
    table: dict[str, str] = _load("defaults.toml").get(kind, {})
    return table.get(purpose)


def context_window(model: str) -> int:
    table: dict[str, int] = dict(_load("defaults.toml")["context_window"])
    default = table.pop("default")
    found = _longest_prefix(table, model.lower())
    return int(found) if found is not None else default


# genai-prices provider ids for the first-party kinds; other kinds are matched by their base URL.
_PRICE_PROVIDERS: dict[str, str] = {
    "anthropic": "anthropic",
    "openai": "openai",
    "openai_responses": "openai",
    "gemini": "google",
}


def estimate_cost(
    kind: str,
    base_url: str | None,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cached_tokens: int | None = None,
    at: datetime | None = None,
) -> float | None:
    """USD estimate from genai-prices (cache reads at their own rate, the price in force at `at`),
    or None when the provider or model has no known price. Local models (ollama) are free."""
    if kind == "ollama":
        return 0.0
    usage = Usage(
        input_tokens=input_tokens,
        cache_read_tokens=min(cached_tokens or 0, input_tokens),
        output_tokens=output_tokens,
    )
    # The endpoint's URL first (it names DeepSeek, OpenRouter and the like), then the kind's own
    # provider for first-party kinds behind a proxy.
    lookups: list[Callable[[], PriceCalculation]] = []
    if base_url:
        lookups.append(
            lambda: calc_price(usage, model, provider_api_url=base_url, genai_request_timestamp=at)
        )
    if provider_id := _PRICE_PROVIDERS.get(kind):
        lookups.append(
            lambda: calc_price(usage, model, provider_id=provider_id, genai_request_timestamp=at)
        )
    for lookup in lookups:
        try:
            return round(float(lookup().total_price), 6)
        # No price for this provider or model, or price data the library rejects: the call still
        # counts, it just has no estimate.
        except LookupError, ValueError:
            continue
    return None
