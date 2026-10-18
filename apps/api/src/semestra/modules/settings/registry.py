"""Settings namespaces and scope resolution hooks (M11 §3).

A module declares its configuration once with `register_settings`; the framework owns storage,
inheritance across scope levels, validation and the generated settings form. M02 plugs in how a
course finds its term and Program through `set_scope_resolver`.
"""

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from semestra.core.context import Ctx
from semestra.core.errors import AppError

ScopeType = Literal["account", "program", "term", "course"]
# Lowest priority first: a deeper level overrides the ones before it.
LEVELS: tuple[ScopeType, ...] = ("account", "program", "term", "course")

_NAMESPACE = re.compile(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*)*")
_RESERVED = {"schemas"}  # would collide with GET /settings/schemas


@dataclass(frozen=True)
class SettingsDef:
    namespace: str
    schema: type[BaseModel]
    levels: tuple[ScopeType, ...]
    plugin_id: str | None


class SettingsRegistry:
    def __init__(self) -> None:
        self._items: dict[str, SettingsDef] = {}

    def register(self, item: SettingsDef) -> None:
        if item.namespace in self._items:
            raise ValueError(f"duplicate settings namespace {item.namespace!r}")
        self._items[item.namespace] = item

    def get(self, namespace: str) -> SettingsDef:
        try:
            return self._items[namespace]
        except KeyError:
            raise AppError("settings.unknown_namespace", 404, namespace=namespace) from None

    def list(self) -> list[SettingsDef]:
        return sorted(self._items.values(), key=lambda d: d.namespace)


settings_registry = SettingsRegistry()


def register_settings(
    *,
    namespace: str,
    schema: type[BaseModel],
    levels: tuple[ScopeType, ...] = ("account",),
    plugin_id: str | None = None,
    target: SettingsRegistry | None = None,
) -> None:
    """Declare a configuration namespace.

    `schema` is a Pydantic model whose fields all have defaults. `levels` are the scope levels
    where a value may be set (a deeper level can always *read* the inherited result). Plugin
    namespaces are `plugin.<plugin_id>` so that uninstalling with purge can find them.
    """
    if not _NAMESPACE.fullmatch(namespace) or namespace in _RESERVED:
        raise ValueError(f"invalid settings namespace {namespace!r}")
    if not levels or any(level not in LEVELS for level in levels):
        raise ValueError(f"{namespace}: levels must be a subset of {LEVELS}")
    if (plugin_id is not None) != namespace.startswith("plugin."):
        raise ValueError(f"{namespace}: plugin namespaces are 'plugin.<id>' and need plugin_id")
    if plugin_id is not None and namespace != f"plugin.{plugin_id}":
        raise ValueError(f"{namespace}: namespace must be 'plugin.{plugin_id}'")
    for name, field in schema.model_fields.items():
        if field.is_required():
            raise ValueError(f"{namespace}.{name}: every settings field needs a default")
    (target or settings_registry).register(
        SettingsDef(namespace, schema, tuple(sorted(set(levels), key=LEVELS.index)), plugin_id)
    )


@dataclass(frozen=True)
class ScopeChain:
    """The ids on the way from a Program down to the requested scope."""

    program_id: str | None = None
    term_id: str | None = None
    course_id: str | None = None

    def id_for(self, level: ScopeType) -> str | None:
        return {
            "account": "",
            "program": self.program_id,
            "term": self.term_id,
            "course": self.course_id,
        }[level]


# Raises `common.not_found` when the scope does not exist or belongs to someone else. For a
# course, M02 returns its Program and its current term (a year-long course: the term containing
# today); a course without a current term has `term_id=None`.
ScopeResolver = Callable[[Ctx, ScopeType, str], Awaitable[ScopeChain]]


async def _unavailable(ctx: Ctx, scope_type: ScopeType, scope_id: str) -> ScopeChain:
    # Until M02 registers the real resolver nothing can vouch that a scope belongs to the user.
    raise AppError("common.not_found", 404)


_resolver: ScopeResolver = _unavailable


def set_scope_resolver(resolver: ScopeResolver) -> None:
    global _resolver
    _resolver = resolver


async def resolve_scope(ctx: Ctx, scope_type: ScopeType, scope_id: str | None) -> ScopeChain:
    if scope_type == "account":
        return ScopeChain()
    if not scope_id:
        raise AppError("common.validation", 422, errors=[{"loc": ["scope_id"], "code": "missing"}])
    return await _resolver(ctx, scope_type, scope_id)
