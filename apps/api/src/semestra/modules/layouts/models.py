from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, UTCDateTime, new_id, utcnow


class LayoutsNav(Base):
    """Order and hidden pages of a scope type's tab bar; shared by all its scopes (M10 §2)."""

    __tablename__ = "layouts_nav"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), primary_key=True
    )
    scope_type: Mapped[str] = mapped_column(String, primary_key=True)  # program | term | course
    order: Mapped[list[str]] = mapped_column(JSON, default=list)
    hidden: Mapped[list[str]] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class LayoutsBoard(Base, OwnedMixin):
    """The card layout of one scope; absent until the first change (the template applies)."""

    __tablename__ = "layouts_boards"
    __table_args__ = (UniqueConstraint("user_id", "scope_type", "scope_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    # program | term | course | today (scope_id = the Program)
    scope_type: Mapped[str] = mapped_column(String)
    scope_id: Mapped[str] = mapped_column(String)
    # [{instance_id, card_id, size, x, y}]; cards of uninstalled plugins stay (hidden).
    cards: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class LayoutsTemplate(Base):
    """The user's default layout of a scope type: [{card_id, size, x, y}]."""

    __tablename__ = "layouts_templates"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), primary_key=True
    )
    scope_type: Mapped[str] = mapped_column(String, primary_key=True)
    cards: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class LayoutsCardSetting(Base, OwnedMixin):
    """One card instance: its scope and settings. Every card on a stored board has a row."""

    __tablename__ = "layouts_card_settings"
    __table_args__ = (Index("ix_layouts_card_settings_scope", "user_id", "scope_type", "scope_id"),)

    instance_id: Mapped[str] = mapped_column(String, primary_key=True)
    card_id: Mapped[str] = mapped_column(String, index=True)
    scope_type: Mapped[str] = mapped_column(String)
    scope_id: Mapped[str] = mapped_column(String)
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
