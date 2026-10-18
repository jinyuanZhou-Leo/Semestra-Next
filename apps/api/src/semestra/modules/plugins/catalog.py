"""The plugin catalog (M10 §3): every frontend module, what it provides, and plugin metadata.

Two sources are merged:

- `web_manifest.json`, exported from the frontend manifests (`pnpm --filter @semestra/web
  manifest:export`; a frontend test fails when it is stale). It lists every module with its
  kind, pages, cards (scopes, sizes, settings JSON Schema) and default board layout, so the
  backend can validate layouts without duplicating the card list.
- `PluginInfo` entries that backend packages register with `register_plugin`. Every module of
  kind 'plugin' needs one (it carries `default_installed`); core modules may register one but
  do not have to. A test checks that both sides agree.
"""

import json
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Any, Literal

from semestra.core.capability import registry

Kind = Literal["core", "plugin"]
BoardScope = Literal["program", "term", "course", "today"]
PageScope = Literal["program", "term", "course"]
CardSize = Literal["s", "m", "l", "xl"]

BOARD_SCOPES: tuple[BoardScope, ...] = ("program", "term", "course", "today")
# (columns, rows) on the 4-column board.
SIZE_SPANS: dict[CardSize, tuple[int, int]] = {"s": (1, 1), "m": (2, 1), "l": (2, 2), "xl": (4, 2)}

WEB_MANIFEST_DEFAULT = Path(__file__).with_name("web_manifest.json")
# Tests point this at their own file.
WEB_MANIFEST = WEB_MANIFEST_DEFAULT


@dataclass(frozen=True)
class PluginInfo:
    id: str
    kind: Kind = "plugin"
    # Message keys of the frontend; default `<id>_name` / `<id>_description` (dashes → _).
    name_key: str | None = None
    description_key: str | None = None
    version: str = "1.0.0"
    author: str = "Semestra"
    default_installed: bool = False
    # One English sentence for agents listing plugins.
    summary: str = ""


@dataclass(frozen=True)
class PageDef:
    id: str
    module_id: str
    scopes: tuple[PageScope, ...]


@dataclass(frozen=True)
class CardDef:
    id: str
    module_id: str
    scopes: tuple[BoardScope, ...]
    sizes: tuple[CardSize, ...]
    default_size: CardSize
    multiple: bool
    # JSON Schema of the card's settings (from its zod schema); None = no settings.
    settings_schema: dict[str, Any] | None


@dataclass(frozen=True)
class BoardSlot:
    card: str
    size: CardSize | None


@dataclass(frozen=True)
class ModuleDef:
    info: PluginInfo
    pages: tuple[PageDef, ...] = ()
    cards: tuple[CardDef, ...] = ()
    default_board: dict[BoardScope, tuple[BoardSlot, ...]] = field(
        default_factory=lambda: dict[BoardScope, tuple[BoardSlot, ...]]()
    )

    @property
    def id(self) -> str:
        return self.info.id

    @property
    def capabilities(self) -> list[str]:
        return [c.name for c in registry.list() if c.plugin_id == self.id]


_plugins: dict[str, PluginInfo] = {}


def register_plugin(info: PluginInfo) -> None:
    """Declare a plugin (or a core module) in the catalog; ids match the frontend manifests."""
    if info.id in _plugins and _plugins[info.id] != info:
        raise ValueError(f"plugin {info.id!r} registered twice with different info")
    _plugins[info.id] = info
    _modules.cache_clear()


def registered_plugins() -> dict[str, PluginInfo]:
    return dict(_plugins)


def message_key(module_id: str, suffix: str) -> str:
    return f"{module_id.replace('-', '_').replace('.', '_')}_{suffix}"


def load_web_manifest(path: Path | None = None) -> list[dict[str, Any]]:
    path = path or WEB_MANIFEST
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))["modules"]


def _module_from_web(raw: dict[str, Any]) -> ModuleDef:
    module_id: str = raw["id"]
    registered = _plugins.get(module_id)
    info = registered or PluginInfo(id=module_id, kind=raw["kind"])
    pages = tuple(PageDef(p["id"], module_id, tuple(p["scopes"])) for p in raw.get("pages", []))
    cards = tuple(
        CardDef(
            id=c["id"],
            module_id=module_id,
            scopes=tuple(c["scopes"]),
            sizes=tuple(c["sizes"]),
            default_size=c["default_size"],
            multiple=c["multiple"],
            settings_schema=c.get("settings_schema"),
        )
        for c in raw.get("cards", [])
    )
    board: dict[BoardScope, tuple[BoardSlot, ...]] = {
        scope: tuple(BoardSlot(s["card"], s.get("size")) for s in slots)
        for scope, slots in raw.get("default_board", {}).items()
    }
    return ModuleDef(info=info, pages=pages, cards=cards, default_board=board)


@cache
def _modules() -> tuple[ModuleDef, ...]:
    web = load_web_manifest()
    seen = {raw["id"] for raw in web}
    # Plugins registered only on the backend still show up (without pages or cards).
    extra = [ModuleDef(info=info) for pid, info in sorted(_plugins.items()) if pid not in seen]
    return (*(_module_from_web(raw) for raw in web), *extra)


def modules() -> tuple[ModuleDef, ...]:
    """Every module in frontend registry order."""
    return _modules()


def module(module_id: str) -> ModuleDef | None:
    return next((m for m in _modules() if m.id == module_id), None)


def card(card_id: str) -> CardDef | None:
    for m in _modules():
        for c in m.cards:
            if c.id == card_id:
                return c
    return None


def reload() -> None:
    """Forget the cached catalog (tests that swap `web_manifest.json`)."""
    _modules.cache_clear()
