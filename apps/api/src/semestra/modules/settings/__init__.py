"""M11 设置与偏好: preferences, scoped module settings with inheritance, UI state."""

from fastapi import FastAPI

from semestra.modules.settings import capabilities, models, portability, subscribers  # noqa: F401
from semestra.modules.settings.registry import (
    ScopeChain,
    register_settings,
    set_scope_resolver,
)

__all__ = ["ScopeChain", "register", "register_settings", "set_scope_resolver"]


def register(app: FastAPI) -> None:
    del app  # capabilities are mounted by the core; nothing else to wire up
