"""Page order, card boards, default layouts and card settings (M10 §2, §4).

A scope's board is not stored until it is first changed: until then it is generated from the
user's template for the scope type (or the built-in one assembled from the modules'
`defaultBoard`). Generated cards have stable ids `tpl.<scope_type>.<scope_id>.<n>.<card_id>`
that become their real ids when the board is stored, so a card can be edited before its board
was ever saved without its id changing under the frontend.
"""

import json
import uuid
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy import delete, select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.modules.layouts import grid, jsonschema
from semestra.modules.layouts.grid import Placed
from semestra.modules.layouts.models import (
    LayoutsBoard,
    LayoutsCardSetting,
    LayoutsNav,
    LayoutsTemplate,
)
from semestra.modules.layouts.schemas import (
    SETTINGS_MAX_BYTES,
    Board,
    BoardCard,
    BoardRef,
    BoardScopeType,
    BoardUpdateInput,
    CardAddInput,
    CardInstanceList,
    CardInstanceListInput,
    CardInstanceSummary,
    CardRef,
    CardSettings,
    CardSettingsUpdateInput,
    Nav,
    NavScopeType,
    NavUpdateInput,
    Removed,
    Template,
    TemplateCard,
    TemplateFromBoardInput,
)
from semestra.modules.plugins import catalog
from semestra.modules.plugins.service import installed_ids

TEMPLATE_PREFIX = "tpl."

_settings_models: dict[str, type[BaseModel]] = {}


def register_card_settings(card_id: str, model: type[BaseModel]) -> None:
    """Validate a card's settings with a Pydantic model instead of its exported JSON Schema
    (for rules a JSON Schema cannot express, e.g. min < max)."""
    _settings_models[card_id] = model


@dataclass(frozen=True)
class CardInstance:
    instance_id: str
    card_id: str
    scope_type: str
    scope_id: str
    settings: dict[str, Any]


# --- scopes ---------------------------------------------------------------------------------


async def check_scope(ctx: Ctx, scope_type: str, scope_id: str) -> None:
    """`common.not_found` unless the Program, term or course exists and is the user's."""
    from semestra.modules.academics.scopes import resolve_scope

    await resolve_scope(ctx, "program" if scope_type == "today" else scope_type, scope_id)  # pyright: ignore[reportArgumentType]


def _template_id(scope_type: str, scope_id: str, index: int, card_id: str) -> str:
    return f"{TEMPLATE_PREFIX}{scope_type}.{scope_id}.{index}.{card_id}"


def _parse_template_id(instance_id: str) -> tuple[str, str] | None:
    """(scope_type, scope_id) of a generated card id, else None."""
    if not instance_id.startswith(TEMPLATE_PREFIX):
        return None
    parts = instance_id.removeprefix(TEMPLATE_PREFIX).split(".", 3)
    if len(parts) != 4 or parts[0] not in catalog.BOARD_SCOPES or not parts[2].isdigit():
        return None
    return parts[0], parts[1]


# --- card validation ------------------------------------------------------------------------


def _card_def(card_id: str) -> catalog.CardDef:
    found = catalog.card(card_id)
    if found is None:
        raise AppError("layouts.card_unknown", 422, card_id=card_id)
    return found


def _check_card(
    card: catalog.CardDef, scope_type: str, size: str | None, installed: set[str]
) -> None:
    if card.module_id not in installed:
        raise AppError("plugins.not_installed", 403, plugin_id=card.module_id)
    if scope_type not in card.scopes:
        raise AppError("layouts.scope_mismatch", 422, card_id=card.id, scope_type=scope_type)
    if size is not None and size not in card.sizes:
        raise AppError("layouts.size_unsupported", 422, card_id=card.id, size=size)


def validate_settings(card: catalog.CardDef, settings: dict[str, Any]) -> dict[str, Any]:
    """The settings to store, or `common.validation`."""
    if len(json.dumps(settings)) > SETTINGS_MAX_BYTES:
        raise AppError("common.validation", 422, errors=[{"loc": ["settings"], "code": "too_long"}])
    model = _settings_models.get(card.id)
    if model is not None:
        try:
            return model.model_validate(settings).model_dump(mode="json")
        except ValidationError as exc:
            errs = [{"loc": ["settings", *e["loc"]], "code": e["type"]} for e in exc.errors()]
            raise AppError("common.validation", 422, errors=errs) from exc
    if card.settings_schema is None:
        if settings:
            raise AppError(
                "common.validation", 422, errors=[{"loc": ["settings"], "code": "not_allowed"}]
            )
        return {}
    problems = jsonschema.errors(card.settings_schema, settings)
    if problems:
        errs = [{"loc": ["settings", *p["loc"]], "code": p["code"]} for p in problems]
        raise AppError("common.validation", 422, errors=errs)
    return settings


def _visible(placed: list[Placed], scope_type: str, installed: set[str]) -> list[Placed]:
    """Cards the user can see: known, of an installed module, allowed in the scope."""
    out: list[Placed] = []
    for p in placed:
        card = catalog.card(p.card_id)
        if card and card.module_id in installed and scope_type in card.scopes:
            size = p.size if p.size in card.sizes else card.default_size
            out.append(Placed(p.instance_id, p.card_id, size, p.x, p.y))
    return out


def _placed(entries: list[dict[str, Any]]) -> list[Placed]:
    return [Placed(e["instance_id"], e["card_id"], e["size"], e["x"], e["y"]) for e in entries]


def _entries(placed: list[Placed]) -> list[dict[str, Any]]:
    return [
        {"instance_id": p.instance_id, "card_id": p.card_id, "size": p.size, "x": p.x, "y": p.y}
        for p in placed
    ]


# --- templates ------------------------------------------------------------------------------


def builtin_template(scope_type: str) -> list[TemplateCard]:
    """The modules' `defaultBoard` slots for the scope type, in registry order, packed."""
    slots: list[tuple[str, str, catalog.CardSize]] = []
    for m in catalog.modules():
        for slot in m.default_board.get(scope_type, ()):  # pyright: ignore[reportArgumentType, reportCallIssue]
            card = catalog.card(slot.card)
            if card is None:
                continue
            size = slot.size if slot.size in card.sizes else card.default_size
            slots.append((str(len(slots)), card.id, size))
    return [TemplateCard(card_id=p.card_id, size=p.size, x=p.x, y=p.y) for p in grid.pack(slots)]


async def _template_row(ctx: Ctx, scope_type: str) -> LayoutsTemplate | None:
    return await ctx.db.get(LayoutsTemplate, (ctx.user_id, scope_type))


async def _template_cards(ctx: Ctx, scope_type: str) -> list[TemplateCard]:
    row = await _template_row(ctx, scope_type)
    if row is None:
        return builtin_template(scope_type)
    return [TemplateCard.model_validate(c) for c in row.cards]


async def get_template(ctx: Ctx, scope_type: BoardScopeType) -> Template:
    row = await _template_row(ctx, scope_type)
    return Template(
        scope_type=scope_type,
        cards=await _template_cards(ctx, scope_type),
        customized=row is not None,
    )


async def _generated(ctx: Ctx, scope_type: str, scope_id: str, installed: set[str]) -> list[Placed]:
    """The board a scope gets from the template: visible cards only, one of each single card."""
    placed: list[Placed] = []
    seen: set[str] = set()
    for i, c in enumerate(await _template_cards(ctx, scope_type)):
        card = catalog.card(c.card_id)
        if card is None or (not card.multiple and card.id in seen):
            continue
        seen.add(card.id)
        instance = _template_id(scope_type, scope_id, i, c.card_id)
        placed.append(Placed(instance, c.card_id, c.size, c.x, c.y))
    return grid.compact(_visible(placed, scope_type, installed))


async def save_template_from_board(ctx: Ctx, inp: TemplateFromBoardInput) -> Template:
    board = await get_board(ctx, BoardRef(scope_type=inp.scope_type, scope_id=inp.scope_id))
    cards = [{"card_id": c.card_id, "size": c.size, "x": c.x, "y": c.y} for c in board.cards]
    # Cards of uninstalled plugins are not on the visible board; keep the ones the board (or,
    # while it follows the template, the template) holds, so a reinstall brings them back.
    installed = await installed_ids(ctx)
    stored = await _board_row(ctx, inp.scope_type, inp.scope_id)
    source = (
        [{k: e[k] for k in ("card_id", "size", "x", "y")} for e in stored.cards]
        if stored is not None
        else [c.model_dump() for c in await _template_cards(ctx, inp.scope_type)]
    )
    for entry in source:
        card = catalog.card(entry["card_id"])
        if card is not None and card.module_id not in installed:
            cards.append(entry)
    row = await _template_row(ctx, inp.scope_type)
    if row is None:
        ctx.db.add(LayoutsTemplate(user_id=ctx.user_id, scope_type=inp.scope_type, cards=cards))
    else:
        row.cards = cards
    await ctx.db.flush()
    await events.publish(ctx, "layouts.template.updated", {"scope_type": inp.scope_type})
    return await get_template(ctx, inp.scope_type)


async def reset_template(ctx: Ctx, scope_type: BoardScopeType) -> Template:
    await ctx.db.execute(
        delete(LayoutsTemplate).where(
            LayoutsTemplate.user_id == ctx.user_id, LayoutsTemplate.scope_type == scope_type
        )
    )
    await events.publish(ctx, "layouts.template.updated", {"scope_type": scope_type})
    return await get_template(ctx, scope_type)


# --- boards ---------------------------------------------------------------------------------


async def _board_row(ctx: Ctx, scope_type: str, scope_id: str) -> LayoutsBoard | None:
    return await ctx.db.scalar(
        select(LayoutsBoard).where(
            LayoutsBoard.user_id == ctx.user_id,
            LayoutsBoard.scope_type == scope_type,
            LayoutsBoard.scope_id == scope_id,
        )
    )


async def _ensure_board(ctx: Ctx, scope_type: str, scope_id: str) -> LayoutsBoard:
    """The stored board, created from the template (keeping the generated ids) if needed."""
    row = await _board_row(ctx, scope_type, scope_id)
    if row is not None:
        return row
    # Every module counts here: cards of plugins uninstalled meanwhile are stored too (hidden
    # until reinstalled), as they would be on a board stored before the uninstall.
    every_module = {m.id for m in catalog.modules()}
    placed = await _generated(ctx, scope_type, scope_id, every_module)
    row = LayoutsBoard(
        user_id=ctx.user_id, scope_type=scope_type, scope_id=scope_id, cards=_entries(placed)
    )
    ctx.db.add(row)
    for p in placed:
        ctx.db.add(
            LayoutsCardSetting(
                instance_id=p.instance_id,
                user_id=ctx.user_id,
                card_id=p.card_id,
                scope_type=scope_type,
                scope_id=scope_id,
                settings={},
            )
        )
    await ctx.db.flush()
    return row


async def _settings_by_instance(
    ctx: Ctx, scope_type: str, scope_id: str
) -> dict[str, LayoutsCardSetting]:
    rows = await ctx.db.scalars(
        select(LayoutsCardSetting).where(
            LayoutsCardSetting.user_id == ctx.user_id,
            LayoutsCardSetting.scope_type == scope_type,
            LayoutsCardSetting.scope_id == scope_id,
        )
    )
    return {r.instance_id: r for r in rows}


async def get_board(ctx: Ctx, ref: BoardRef) -> Board:
    await check_scope(ctx, ref.scope_type, ref.scope_id)
    installed = await installed_ids(ctx)
    row = await _board_row(ctx, ref.scope_type, ref.scope_id)
    if row is None:
        placed = await _generated(ctx, ref.scope_type, ref.scope_id, installed)
        settings: dict[str, LayoutsCardSetting] = {}
    else:
        placed = grid.compact(_visible(_placed(row.cards), ref.scope_type, installed))
        settings = await _settings_by_instance(ctx, ref.scope_type, ref.scope_id)
    return Board(
        scope_type=ref.scope_type,
        scope_id=ref.scope_id,
        cards=[
            BoardCard(
                instance_id=p.instance_id,
                card_id=p.card_id,
                size=p.size,
                x=p.x,
                y=p.y,
                settings=settings[p.instance_id].settings if p.instance_id in settings else {},
            )
            for p in placed
        ],
        customized=row is not None,
        updated_at=row.updated_at if row else None,
    )


async def _publish_card_deleted(ctx: Ctx, rows: list[LayoutsCardSetting]) -> None:
    for r in rows:
        await events.publish(
            ctx,
            "layouts.card.deleted",
            {
                "instance_id": r.instance_id,
                "card_id": r.card_id,
                "scope_type": r.scope_type,
                "scope_id": r.scope_id,
            },
        )


async def _delete_instances(ctx: Ctx, rows: list[LayoutsCardSetting]) -> None:
    for r in rows:
        await ctx.db.delete(r)
    await ctx.db.flush()
    await _publish_card_deleted(ctx, rows)


def _not_multiple(placed: list[Placed]) -> None:
    seen: set[str] = set()
    for p in placed:
        card = _card_def(p.card_id)
        if not card.multiple and p.card_id in seen:
            raise AppError("layouts.card_not_multiple", 422, card_id=p.card_id)
        seen.add(p.card_id)


async def update_board(ctx: Ctx, inp: BoardUpdateInput) -> Board:
    """Replaces the visible layout. Cards of uninstalled plugins are kept as they are."""
    await check_scope(ctx, inp.scope_type, inp.scope_id)
    installed = await installed_ids(ctx)
    row = await _ensure_board(ctx, inp.scope_type, inp.scope_id)
    existing = {e["instance_id"]: e for e in row.cards}
    settings = await _settings_by_instance(ctx, inp.scope_type, inp.scope_id)
    visible = {p.instance_id for p in _visible(_placed(row.cards), inp.scope_type, installed)}

    placed: list[Placed] = []
    new_rows: list[LayoutsCardSetting] = []
    for c in inp.cards:
        card = _card_def(c.card_id)
        _check_card(card, inp.scope_type, c.size, installed)
        if c.instance_id is None:
            instance_id = str(uuid.uuid7())
            new_rows.append(
                LayoutsCardSetting(
                    instance_id=instance_id,
                    user_id=ctx.user_id,
                    card_id=card.id,
                    scope_type=inp.scope_type,
                    scope_id=inp.scope_id,
                    settings=validate_settings(card, dict(c.settings or {})),
                )
            )
        else:
            instance_id = c.instance_id
            if instance_id not in visible or existing[instance_id]["card_id"] != c.card_id:
                raise AppError("common.not_found", 404)
        placed.append(Placed(instance_id, card.id, c.size, c.x, c.y))
    if len({p.instance_id for p in placed}) != len(placed):
        raise AppError(
            "common.validation", 422, errors=[{"loc": ["cards"], "code": "duplicate_instance"}]
        )
    _not_multiple(placed)
    if not grid.valid(placed):
        raise AppError("common.validation", 422, errors=[{"loc": ["cards"], "code": "overlap"}])

    kept = {p.instance_id for p in placed}
    removed = [settings[i] for i in visible - kept if i in settings]
    hidden = [e for e in row.cards if e["instance_id"] not in visible]
    row.cards = _entries(placed) + hidden
    row.updated_at = ctx.now
    ctx.db.add_all(new_rows)
    await _delete_instances(ctx, removed)
    await events.publish(
        ctx, "layouts.board.updated", {"scope_type": inp.scope_type, "scope_id": inp.scope_id}
    )
    return await get_board(ctx, BoardRef(scope_type=inp.scope_type, scope_id=inp.scope_id))


async def add_card(ctx: Ctx, inp: CardAddInput) -> BoardCard:
    await check_scope(ctx, inp.scope_type, inp.scope_id)
    installed = await installed_ids(ctx)
    card = _card_def(inp.card_id)
    _check_card(card, inp.scope_type, inp.size, installed)
    row = await _ensure_board(ctx, inp.scope_type, inp.scope_id)
    visible = grid.compact(_visible(_placed(row.cards), inp.scope_type, installed))
    if not card.multiple and any(p.card_id == card.id for p in visible):
        raise AppError("layouts.card_not_multiple", 422, card_id=card.id)
    size = inp.size or card.default_size
    settings = validate_settings(card, dict(inp.settings or {}))
    x, y = grid.first_free(visible, size)
    instance_id = str(uuid.uuid7())
    row.cards = [*row.cards, *_entries([Placed(instance_id, card.id, size, x, y)])]
    row.updated_at = ctx.now
    ctx.db.add(
        LayoutsCardSetting(
            instance_id=instance_id,
            user_id=ctx.user_id,
            card_id=card.id,
            scope_type=inp.scope_type,
            scope_id=inp.scope_id,
            settings=settings,
        )
    )
    await ctx.db.flush()
    await events.publish(
        ctx, "layouts.board.updated", {"scope_type": inp.scope_type, "scope_id": inp.scope_id}
    )
    return BoardCard(
        instance_id=instance_id, card_id=card.id, size=size, x=x, y=y, settings=settings
    )


async def _instance_row(ctx: Ctx, instance_id: str) -> LayoutsCardSetting:
    """The stored instance; a generated id stores its board first."""
    generated = _parse_template_id(instance_id)
    if generated is not None:
        await check_scope(ctx, *generated)
        await _ensure_board(ctx, *generated)
    row = await ctx.db.get(LayoutsCardSetting, instance_id)
    if row is None or row.user_id != ctx.user_id:
        raise AppError("common.not_found", 404)
    return row


async def get_card_instance(ctx: Ctx, instance_id: str) -> CardInstance:
    """A card instance of the ctx user, for modules keeping data per card (M14).

    Raises `common.not_found` for unknown ids and other users' cards. A card that its board
    still generates from the template gets stored on the way.
    """
    row = await _instance_row(ctx, instance_id)
    return CardInstance(row.instance_id, row.card_id, row.scope_type, row.scope_id, row.settings)


async def preview_card_remove(ctx: Ctx, inp: CardRef) -> dict[str, Any]:
    """The assistant's confirmation card (M12 §3.5): the card by its id in the catalog."""
    row = await _instance_row(ctx, inp.instance_id)
    return {"target": row.card_id, "changes": []}


async def list_card_instances(
    ctx: Ctx, card_id: str, scope_type: str | None = None, scope_id: str | None = None
) -> list[CardInstance]:
    """Stored instances of a card (boards still following the template have none)."""
    query = select(LayoutsCardSetting).where(
        LayoutsCardSetting.user_id == ctx.user_id, LayoutsCardSetting.card_id == card_id
    )
    if scope_type is not None:
        query = query.where(LayoutsCardSetting.scope_type == scope_type)
    if scope_id is not None:
        query = query.where(LayoutsCardSetting.scope_id == scope_id)
    rows = await ctx.db.scalars(query.order_by(LayoutsCardSetting.instance_id))
    return [
        CardInstance(r.instance_id, r.card_id, r.scope_type, r.scope_id, r.settings) for r in rows
    ]


LABEL_CHARS = 80


def _label(settings: dict[str, Any]) -> str | None:
    """How the user tells cards of one kind apart: a name, else the first line of the text."""
    for key in ("name", "title", "label"):
        value = settings.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:LABEL_CHARS]
    content = settings.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip().split("\n", 1)[0][:LABEL_CHARS]
    return None


async def list_program_cards(ctx: Ctx, inp: CardInstanceListInput) -> CardInstanceList:
    """Every card on the boards of a Program (its overview, Today, its terms and courses), so
    the assistant finds a card without guessing its board. Generated boards are read, not
    stored. Courses have no archived state, so every course of every term is searched: one board
    read each (a few queries), fine for a Program's tens of courses; past terms are kept because
    the user may name a card on one."""
    from semestra.modules.academics import service as academics
    from semestra.modules.academics.schemas import CourseListInput

    program = await academics.get_program_row(ctx, inp.program_id)
    boards: list[tuple[str, str, str]] = [
        ("program", program.id, program.name),
        ("today", program.id, program.name),
    ]
    boards += [("term", t.id, t.name) for t in await academics.program_terms(ctx, program.id)]
    cursor: str | None = None
    while True:
        page = await academics.list_courses(
            ctx, CourseListInput(program_id=program.id, cursor=cursor, limit=500)
        )
        boards += [("course", c.id, c.code or c.title) for c in page.items]
        cursor = page.next_cursor
        if cursor is None:
            break
    items: list[CardInstanceSummary] = []
    for scope_type, scope_id, name in boards:
        board = await get_board(ctx, BoardRef(scope_type=scope_type, scope_id=scope_id))  # pyright: ignore[reportArgumentType]
        items += [
            CardInstanceSummary(
                instance_id=card.instance_id,
                card_id=card.card_id,
                scope_type=board.scope_type,
                scope_id=scope_id,
                board_name=name,
                label=_label(card.settings),
            )
            for card in board.cards
            if inp.card_id is None or card.card_id == inp.card_id
        ]
    return CardInstanceList(items=items)


async def remove_card(ctx: Ctx, instance_id: str) -> Removed:
    row = await _instance_row(ctx, instance_id)
    # A hidden card of an uninstalled plugin stays as it is, so a reinstall brings it back.
    card = catalog.card(row.card_id)
    if card is not None and card.module_id not in await installed_ids(ctx):
        raise AppError("plugins.not_installed", 403, plugin_id=card.module_id)
    board = await _ensure_board(ctx, row.scope_type, row.scope_id)
    board.cards = [e for e in board.cards if e["instance_id"] != instance_id]
    board.updated_at = ctx.now
    await _delete_instances(ctx, [row])
    await events.publish(
        ctx, "layouts.board.updated", {"scope_type": row.scope_type, "scope_id": row.scope_id}
    )
    return Removed(instance_id=instance_id)


async def get_card_settings(ctx: Ctx, instance_id: str) -> CardSettings:
    row = await _instance_row(ctx, instance_id)
    card = catalog.card(row.card_id)
    if card is not None and card.module_id not in await installed_ids(ctx):
        raise AppError("plugins.not_installed", 403, plugin_id=card.module_id)
    return CardSettings(instance_id=row.instance_id, card_id=row.card_id, settings=row.settings)


async def update_card_settings(ctx: Ctx, inp: CardSettingsUpdateInput) -> CardSettings:
    row = await _instance_row(ctx, inp.instance_id)
    card = _card_def(row.card_id)
    if card.module_id not in await installed_ids(ctx):
        raise AppError("plugins.not_installed", 403, plugin_id=card.module_id)
    row.settings = validate_settings(card, dict(inp.settings))
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(
        ctx,
        "layouts.card.settings_updated",
        {"instance_id": row.instance_id, "scope_type": row.scope_type, "scope_id": row.scope_id},
    )
    return CardSettings(instance_id=row.instance_id, card_id=row.card_id, settings=row.settings)


# --- page order -----------------------------------------------------------------------------


def _unique(ids: list[str]) -> list[str]:
    return list(dict.fromkeys(ids))


async def get_nav(ctx: Ctx, scope_type: NavScopeType) -> Nav:
    row = await ctx.db.get(LayoutsNav, (ctx.user_id, scope_type))
    if row is None:
        return Nav(scope_type=scope_type, order=[], hidden=[])
    return Nav(scope_type=scope_type, order=row.order, hidden=row.hidden)


async def update_nav(ctx: Ctx, inp: NavUpdateInput) -> Nav:
    """Unknown page ids are kept: they may belong to a plugin that is not installed now."""
    row = await ctx.db.get(LayoutsNav, (ctx.user_id, inp.scope_type))
    if row is None:
        row = LayoutsNav(user_id=ctx.user_id, scope_type=inp.scope_type)
        ctx.db.add(row)
    row.order = _unique(inp.order)
    row.hidden = _unique(inp.hidden)
    await ctx.db.flush()
    await events.publish(ctx, "layouts.nav.updated", {"scope_type": inp.scope_type})
    return Nav(scope_type=inp.scope_type, order=row.order, hidden=row.hidden)


# --- cleanup --------------------------------------------------------------------------------


async def delete_scope(ctx: Ctx, scope_type: str, scope_id: str) -> None:
    """Deletes a scope's boards and card instances (a Program also takes its Today board)."""
    scope_types = ["program", "today"] if scope_type == "program" else [scope_type]
    for st in scope_types:
        rows = list((await _settings_by_instance(ctx, st, scope_id)).values())
        await ctx.db.execute(
            delete(LayoutsBoard).where(
                LayoutsBoard.user_id == ctx.user_id,
                LayoutsBoard.scope_type == st,
                LayoutsBoard.scope_id == scope_id,
            )
        )
        await _delete_instances(ctx, rows)


async def purge_plugin(ctx: Ctx, plugin_id: str) -> None:
    """Removes a plugin's cards from every board and template of the user, for good."""
    module = catalog.module(plugin_id)
    card_ids = {c.id for c in module.cards} if module else set[str]()
    if not card_ids:
        return
    boards = await ctx.db.scalars(select(LayoutsBoard).where(LayoutsBoard.user_id == ctx.user_id))
    for board in boards:
        kept = [e for e in board.cards if e["card_id"] not in card_ids]
        if len(kept) != len(board.cards):
            board.cards = kept
    templates = await ctx.db.scalars(
        select(LayoutsTemplate).where(LayoutsTemplate.user_id == ctx.user_id)
    )
    for template in templates:
        kept = [c for c in template.cards if c["card_id"] not in card_ids]
        if len(kept) != len(template.cards):
            template.cards = kept
    rows = list(
        await ctx.db.scalars(
            select(LayoutsCardSetting).where(
                LayoutsCardSetting.user_id == ctx.user_id,
                LayoutsCardSetting.card_id.in_(card_ids),
            )
        )
    )
    await _delete_instances(ctx, rows)
