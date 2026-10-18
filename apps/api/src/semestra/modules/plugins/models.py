from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, UTCDateTime, utcnow


class PluginsInstallation(Base):
    """A plugin the user has installed (M10 §2). Core modules are never stored."""

    __tablename__ = "plugins_installations"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), primary_key=True
    )
    plugin_id: Mapped[str] = mapped_column(String, primary_key=True)
    installed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class PluginsDefaultOffer(Base):
    """A `default_installed` plugin that has already been installed for the user once.

    Default plugins are installed the first time the user's plugins are read (and plugins that
    become default later, the next time); this row keeps an uninstalled one from coming back.
    """

    __tablename__ = "plugins_default_offers"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), primary_key=True
    )
    plugin_id: Mapped[str] = mapped_column(String, primary_key=True)
