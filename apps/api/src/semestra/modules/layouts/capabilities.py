"""Page order, boards, default layouts and card settings (M10 §4)."""

from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.modules.layouts import service
from semestra.modules.layouts.schemas import (
    Board,
    BoardCard,
    BoardRef,
    BoardUpdateInput,
    CardAddInput,
    CardInstanceList,
    CardInstanceListInput,
    CardRef,
    CardSettings,
    CardSettingsUpdateInput,
    Nav,
    NavRef,
    NavUpdateInput,
    Removed,
    Template,
    TemplateFromBoardInput,
    TemplateRef,
)

TAGS = ("layouts",)
HTTP_ONLY = ("http",)

# --- page order -----------------------------------------------------------------------------


@capability(
    name="layouts.nav.get",
    summary="Get the order and hidden pages of the tab bar of a scope type.",
    description="Applies to every Program, every term or every course alike.",
    effect="read",
    http=Http("GET", "/layouts/nav/{scope_type}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def nav_get(ctx: Ctx, inp: NavRef) -> Nav:
    return await service.get_nav(ctx, inp.scope_type)


@capability(
    name="layouts.nav.update",
    summary="Set the order and hidden pages of the tab bar of a scope type.",
    description="Applies to every Program, every term or every course alike.",
    effect="write",
    http=Http("PUT", "/layouts/nav/{scope_type}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def nav_update(ctx: Ctx, inp: NavUpdateInput) -> Nav:
    return await service.update_nav(ctx, inp)


# --- boards ---------------------------------------------------------------------------------


@capability(
    name="layouts.board.get",
    summary="Get the cards on a Program, term or course overview, or on the Today page.",
    description="""Use to find card instances (their instance_id and settings), e.g. which
sticky notes or habit trackers a course has, before calling a card-specific tool.""",
    effect="read",
    http=Http("GET", "/layouts/boards/{scope_type}/{scope_id}"),
    tags=TAGS,
)
async def board_get(ctx: Ctx, inp: BoardRef) -> Board:
    return await service.get_board(ctx, inp)


@capability(
    name="layouts.card.list",
    summary="Find cards across a Program's boards: sticky notes, habit trackers and others.",
    description="""Use to get a card's instance_id when the user names a card ("my reading habit",
"the note on APS105") without saying which board it is on. Searches the Program overview, the
Today page, and every term and course board; filter by card_id. Each card comes with its board's
name and a label (a habit's name, a note's first line).""",
    effect="read",
    expose=("agent", "mcp"),
    tags=TAGS,
)
async def card_list(ctx: Ctx, inp: CardInstanceListInput) -> CardInstanceList:
    return await service.list_program_cards(ctx, inp)


@capability(
    name="layouts.board.update",
    summary="Replace the card layout of a board (positions, sizes, added and removed cards).",
    description="Cards left out of the list are deleted together with their data.",
    effect="write",
    http=Http("PUT", "/layouts/boards/{scope_type}/{scope_id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def board_update(ctx: Ctx, inp: BoardUpdateInput) -> Board:
    return await service.update_board(ctx, inp)


@capability(
    name="layouts.card.add",
    summary="Add a card to a board, e.g. a sticky note to a course overview.",
    description="""Use when the user asks to put a card (sticky note, pomodoro timer, habit
tracker, ...) on an overview or the Today page. The card goes to the first free spot. Check
with plugins.catalog.list that its plugin is installed.""",
    effect="write",
    http=Http("POST", "/layouts/boards/{scope_type}/{scope_id}/cards"),
    tags=TAGS,
)
async def card_add(ctx: Ctx, inp: CardAddInput) -> BoardCard:
    return await service.add_card(ctx, inp)


@capability(
    name="layouts.card.remove",
    summary="Remove a card from its board, deleting its data.",
    description="""Use when the user asks to remove a card. Find its instance_id with
layouts.board.get.""",
    effect="destructive",
    http=Http("DELETE", "/layouts/cards/{instance_id}"),
    preview=service.preview_card_remove,
    tags=TAGS,
)
async def card_remove(ctx: Ctx, inp: CardRef) -> Removed:
    return await service.remove_card(ctx, inp.instance_id)


@capability(
    name="layouts.card.get_settings",
    summary="Get the settings of a card instance.",
    description="layouts.board.get already includes every card's settings.",
    effect="read",
    http=Http("GET", "/layouts/cards/{instance_id}/settings"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def card_settings_get(ctx: Ctx, inp: CardRef) -> CardSettings:
    return await service.get_card_settings(ctx, inp.instance_id)


@capability(
    name="layouts.card.update_settings",
    summary="Replace the settings of a card instance.",
    description="The settings are validated against the card's schema.",
    effect="write",
    http=Http("PUT", "/layouts/cards/{instance_id}/settings"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def card_settings_update(ctx: Ctx, inp: CardSettingsUpdateInput) -> CardSettings:
    return await service.update_card_settings(ctx, inp)


# --- default layouts ------------------------------------------------------------------------


@capability(
    name="layouts.template.get",
    summary="Get the default card layout new boards of a scope type start from.",
    description="Either the user's own default or the built-in one.",
    effect="read",
    http=Http("GET", "/layouts/templates/{scope_type}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def template_get(ctx: Ctx, inp: TemplateRef) -> Template:
    return await service.get_template(ctx, inp.scope_type)


@capability(
    name="layouts.template.save_from_board",
    summary="Make a board's layout the default for its scope type.",
    description="Boards that were never changed follow it at once; changed boards keep theirs.",
    effect="write",
    http=Http("POST", "/layouts/templates/{scope_type}:from-board"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def template_save_from_board(ctx: Ctx, inp: TemplateFromBoardInput) -> Template:
    return await service.save_template_from_board(ctx, inp)


@capability(
    name="layouts.template.reset",
    summary="Go back to the built-in default layout of a scope type.",
    description="Boards that were never changed follow it at once.",
    effect="write",
    http=Http("DELETE", "/layouts/templates/{scope_type}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def template_reset(ctx: Ctx, inp: TemplateRef) -> Template:
    return await service.reset_template(ctx, inp.scope_type)
