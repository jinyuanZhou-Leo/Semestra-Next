from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, SecretStr

from semestra.modules.ai.catalog import ProviderKind
from semestra.modules.ai.llm import ProviderCapability, Purpose

# --- providers ------------------------------------------------------------------------------


class Provider(BaseModel):
    id: str
    kind: ProviderKind
    display_name: str
    base_url: str | None
    # Masked key, e.g. "sk-…abcd"; the key itself is never returned.
    key_hint: str | None
    capabilities: list[ProviderCapability]
    # False for kinds whose capabilities are fixed (the user cannot edit them).
    capabilities_editable: bool
    enabled: bool
    last_checked_at: datetime | None
    last_error_code: str | None
    created_at: datetime
    updated_at: datetime


class ProviderList(BaseModel):
    items: list[Provider]


class ProviderCreateInput(BaseModel):
    kind: ProviderKind = Field(description="Provider type.")
    display_name: str | None = Field(
        default=None, max_length=60, description="Name shown in the list; defaults to the type."
    )
    base_url: str | None = Field(
        default=None,
        max_length=500,
        description="API base URL; required for the compatible kinds and ollama.",
    )
    api_key: SecretStr | None = Field(default=None, description="API key (stored encrypted).")
    capabilities: list[ProviderCapability] | None = Field(
        default=None,
        description="What the endpoint supports; only for the compatible kinds and ollama.",
    )


class ProviderUpdateInput(BaseModel):
    id: str = Field(description="Provider id.")
    display_name: str | None = Field(default=None, max_length=60, description="New name.")
    base_url: str | None = Field(default=None, max_length=500, description="New base URL.")
    api_key: SecretStr | None = Field(
        default=None, description="New API key; the provider is checked again before saving."
    )
    capabilities: list[ProviderCapability] | None = Field(
        default=None, description="New capabilities (compatible kinds and ollama only)."
    )
    enabled: bool | None = Field(default=None, description="Turn the provider on or off.")


class ProviderRef(BaseModel):
    id: str = Field(description="Provider id.")


class ProviderDeleted(BaseModel):
    id: str
    # Purposes whose model choice was removed with the provider.
    cleared_purposes: list[Purpose]


class ProviderCheck(BaseModel):
    ok: bool
    error_code: str | None
    checked_at: datetime


class ModelOption(BaseModel):
    id: str
    display_name: str | None = None


class ModelList(BaseModel):
    items: list[ModelOption]
    # True when the endpoint cannot list its models: the user types the model name.
    manual_entry: bool


# --- assignments ----------------------------------------------------------------------------


class ModelParams(BaseModel):
    temperature: float | None = Field(default=None, ge=0, le=2, description="Sampling temperature.")
    max_tokens: int | None = Field(default=None, ge=1, le=200_000, description="Output cap.")
    reasoning_effort: Literal["minimal", "low", "medium", "high"] | None = Field(
        default=None, description="Reasoning effort, for models that support it."
    )


class RecommendedModel(BaseModel):
    provider_id: str
    model: str


class Assignment(BaseModel):
    purpose: Purpose
    provider_id: str | None
    model: str | None
    params: ModelParams
    # What is used when no model is chosen (M06 §4 step 2), if anything.
    recommended: RecommendedModel | None


class AssignmentList(BaseModel):
    items: list[Assignment]


class AssignmentUpdateInput(BaseModel):
    purpose: Purpose = Field(description="Which purpose to configure.")
    provider_id: str | None = Field(
        description="Provider to use; null removes the choice (the recommended default applies), "
        "or, for ocr with a local model name in `model`, picks that local OCR model."
    )
    model: str | None = Field(
        default=None, min_length=1, max_length=200, description="Model name at that provider."
    )
    params: ModelParams = Field(default_factory=ModelParams, description="Model parameters.")


# --- status and usage -----------------------------------------------------------------------

Source = Literal["assignment", "default", "instance", "local"]


class PurposeStatus(BaseModel):
    purpose: Purpose
    available: bool
    # How the model was chosen: the user's choice, a provider default, the instance provider, or
    # (OCR only) the self-hosted install's own OCR engine, which `model` then names.
    source: Source | None
    provider_id: str | None
    provider_kind: ProviderKind | None
    provider_name: str | None
    model: str | None


class AiStatusGet(BaseModel):
    items: list[PurposeStatus]
    # Self-hosted installs with local OCR: the PaddleOCR models a user can pick for OCR, the one
    # used when they pick nothing, the ones already on this server, and the user's unfinished
    # model download (a `core.job`). Empty and null elsewhere.
    local_ocr_models: list[str] = Field(default_factory=list)
    local_ocr_default: str | None = None
    local_ocr_downloaded: list[str] = Field(default_factory=list)
    local_ocr_download_job: str | None = None


class LocalOcrDownloadInput(BaseModel):
    model: str | None = Field(
        default=None,
        description="A local OCR model; defaults to the one that reads this user's scanned pages.",
    )


class LocalOcrDownload(BaseModel):
    # The download's job id; null when the model is already on this server.
    job_id: str | None


class UsageInput(BaseModel):
    days: int | None = Field(
        default=None,
        ge=1,
        le=3660,
        description="How many days back to summarise, today included; omit for all time.",
    )
    start: date | None = Field(
        default=None, description="First local day to summarise; overrides `days`."
    )
    end: date | None = Field(
        default=None, description="Last local day to summarise (inclusive); defaults to today."
    )
    tz: str = Field(default="UTC", max_length=64, description="IANA time zone for day buckets.")


class UsageTotals(BaseModel):
    calls: int
    errors: int
    input_tokens: int
    # The part of `input_tokens` the provider read from its prompt cache.
    cached_tokens: int
    output_tokens: int
    cost_usd: float | None


class UsageDay(BaseModel):
    date: date
    purpose: Purpose
    calls: int
    input_tokens: int
    output_tokens: int
    cost_usd: float | None
    # False when some of these calls used a model without a known price (a lower bound).
    cost_complete: bool


class UsageRow(UsageTotals):
    key: str
    # False when some of these calls used a model without a known price (a lower bound).
    cost_complete: bool


class UsageSummary(BaseModel):
    # Start of the first local day covered (for all time: the day of the first call, else today).
    since: datetime
    # The last local day covered (inclusive).
    until: date
    totals: UsageTotals
    # False when some calls used a model without a known price (the cost is a lower bound).
    cost_complete: bool
    by_day: list[UsageDay]
    by_purpose: list[UsageRow]
    by_module: list[UsageRow]
    by_model: list[UsageRow]
