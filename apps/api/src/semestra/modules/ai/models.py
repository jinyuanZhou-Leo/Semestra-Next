from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, TimestampMixin, new_id


class AiProvider(Base, OwnedMixin, TimestampMixin):
    """A model provider the user connected with their own key (M06 §3).

    The instance-wide provider of a self-hosted deployment is not stored: it is built from the
    `SEMESTRA_INSTANCE_AI_*` environment variables (see `resolve.instance_provider`).
    """

    __tablename__ = "ai_providers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String)
    display_name: Mapped[str] = mapped_column(String)
    base_url: Mapped[str | None] = mapped_column(String, default=None)
    api_key_encrypted: Mapped[str | None] = mapped_column(String, default=None)
    key_hint: Mapped[str | None] = mapped_column(String, default=None)
    capabilities: Mapped[list[str]] = mapped_column(JSON, default=list)
    enabled: Mapped[bool] = mapped_column(default=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(default=None)
    last_error_code: Mapped[str | None] = mapped_column(String, default=None)


class AiModelAssignment(Base):
    """Which model serves a purpose for a user. Deleting the provider deletes the row."""

    __tablename__ = "ai_model_assignments"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), primary_key=True
    )
    purpose: Mapped[str] = mapped_column(String, primary_key=True)
    provider_id: Mapped[str] = mapped_column(
        String, ForeignKey("ai_providers.id", ondelete="CASCADE"), index=True
    )
    model: Mapped[str] = mapped_column(String)
    # {temperature?, max_tokens?, reasoning_effort?}, validated by `schemas.ModelParams`.
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class AiUsageEvent(Base, OwnedMixin):
    """One model call: tokens and an estimated cost (M06 §3). Never the prompt or output."""

    __tablename__ = "ai_usage_events"
    __table_args__ = (Index("ix_ai_usage_events_user_created", "user_id", "created_at"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    purpose: Mapped[str] = mapped_column(String)
    provider_kind: Mapped[str] = mapped_column(String)
    model: Mapped[str] = mapped_column(String)
    source_module: Mapped[str] = mapped_column(String)
    source_ref: Mapped[str | None] = mapped_column(String, default=None)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cached_tokens: Mapped[int | None] = mapped_column(Integer, default=None)
    cost_usd_estimate: Mapped[float | None] = mapped_column(Float, default=None)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String)  # 'ok' | 'error'
    error_code: Mapped[str | None] = mapped_column(String, default=None)
    created_at: Mapped[datetime] = mapped_column()
