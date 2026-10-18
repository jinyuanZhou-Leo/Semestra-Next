"""Page order, boards, templates and card settings (M10 §4, §7)."""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from semestra.core.capability import registry
from semestra.core.context import system_ctx
from semestra.core.errors import AppError
from semestra.modules.layouts import get_card_instance, list_card_instances
from semestra.modules.layouts.models import LayoutsBoard
from semestra.testing import MakeUser, UserHandle, collect_events

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


class Api:
    def __init__(self, client: AsyncClient) -> None:
        self.client = client

    async def call(self, method: str, url: str, status: int = 200, **kwargs: Any) -> Any:
        r = await self.client.request(method, url, **kwargs)
        assert r.status_code == status, r.text
        return r.json()

    async def error(self, method: str, url: str, status: int, **kwargs: Any) -> str:
        return (await self.call(method, url, status, **kwargs))["error"]["code"]

    async def scopes(self) -> tuple[str, str, str]:
        program = await self.call(
            "POST", "/programs", json={"name": "BASc", "timezone": "America/Toronto"}
        )
        term = await self.call(
            "POST",
            f"/programs/{program['id']}/terms",
            json={"name": "Fall", "start_date": "2025-09-04", "end_date": "2025-12-20"},
        )
        course = await self.call(
            "POST",
            f"/programs/{program['id']}/courses",
            json={"title": "Course", "term_ids": [term["term"]["id"]]},
        )
        return program["id"], term["term"]["id"], course["id"]

    async def board(self, scope_type: str, scope_id: str) -> dict[str, Any]:
        return await self.call("GET", f"/layouts/boards/{scope_type}/{scope_id}")

    async def put_board(
        self, scope_type: str, scope_id: str, cards: list[dict[str, Any]], status: int = 200
    ) -> Any:
        return await self.call(
            "PUT", f"/layouts/boards/{scope_type}/{scope_id}", status, json={"cards": cards}
        )


@pytest.fixture
async def user(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> UserHandle:
    handle = await make_user()
    await login_as(client, handle)
    return handle


@pytest.fixture
def api(client: AsyncClient, user: UserHandle) -> Api:
    del user
    return Api(client)


def layout(board: dict[str, Any]) -> list[tuple[str, str, int, int]]:
    return [(c["card_id"], c["size"], c["x"], c["y"]) for c in board["cards"]]


async def stored_boards(app: FastAPI) -> int:
    async with system_ctx(app.state) as ctx:
        return len((await ctx.db.scalars(LayoutsBoard.__table__.select())).all())


async def test_template_board_is_not_stored_until_changed(app: FastAPI, api: Api):
    _, term_id, course_id = await api.scopes()
    board = await api.board("course", course_id)
    assert not board["customized"]
    assert layout(board) == [("academics.courseInfo", "l", 0, 0), ("notes.note", "m", 2, 0)]
    assert layout(await api.board("term", term_id)) == [("academics.termCourses", "xl", 0, 0)]
    assert await stored_boards(app) == 0

    # The first change stores it; the generated instance ids stay the same.
    ids = [c["instance_id"] for c in board["cards"]]
    note = board["cards"][1]
    saved = await api.call(
        "PUT",
        f"/layouts/cards/{note['instance_id']}/settings",
        json={"settings": {"content": "midterm"}},
    )
    assert saved["settings"] == {"content": "midterm"}
    board = await api.board("course", course_id)
    assert board["customized"]
    assert [c["instance_id"] for c in board["cards"]] == ids
    assert board["cards"][1]["settings"] == {"content": "midterm"}
    assert await stored_boards(app) == 1


async def test_update_moves_resizes_adds_and_removes(app: FastAPI, api: Api, user: UserHandle):
    _, _, course_id = await api.scopes()
    board = await api.board("course", course_id)
    info, note = board["cards"]
    cards = [
        {**info, "size": "m", "x": 0, "y": 1},
        {"card_id": "notes.note", "size": "s", "x": 2, "y": 1, "settings": {"content": "new"}},
    ]
    with collect_events(app, user.id) as seen:
        board = await api.put_board("course", course_id, cards)
    assert layout(board) == [("academics.courseInfo", "m", 0, 0), ("notes.note", "s", 2, 0)]
    assert board["cards"][1]["settings"] == {"content": "new"}
    deleted = [e for e in seen if e["type"] == "layouts.card.deleted"]
    assert [e["data"]["instance_id"] for e in deleted] == [note["instance_id"]]
    assert {
        "type": "layouts.board.updated",
        "data": {"scope_type": "course", "scope_id": course_id},
    } in seen


@pytest.mark.parametrize(
    ("card", "status", "code"),
    [
        ({"card_id": "academics.courseInfo", "size": "xl"}, 422, "layouts.size_unsupported"),
        ({"card_id": "nope.card", "size": "s"}, 422, "layouts.card_unknown"),
        ({"card_id": "academics.termCourses", "size": "xl"}, 422, "layouts.scope_mismatch"),
        ({"card_id": "solo.card", "size": "m"}, 403, "plugins.not_installed"),
        (
            {"card_id": "notes.note", "size": "s", "settings": {"content": 1}},
            422,
            "common.validation",
        ),
    ],
)
async def test_update_rejects_invalid_cards(api: Api, card: dict[str, Any], status: int, code: str):
    _, _, course_id = await api.scopes()
    entry = {"x": 0, "y": 3, **card}
    r = await api.put_board("course", course_id, [entry], status)
    assert r["error"]["code"] == code


async def test_update_rejects_overlap_duplicates_and_foreign_instances(api: Api):
    _, term_id, course_id = await api.scopes()
    info = (await api.board("course", course_id))["cards"][0]
    overlap = [info, {"card_id": "notes.note", "size": "s", "x": 1, "y": 1}]
    r = await api.put_board("course", course_id, overlap, 422)
    assert r["error"]["params"]["errors"] == [{"loc": ["cards"], "code": "overlap"}]
    twice = [info, {**info, "instance_id": None, "x": 2}]
    r = await api.put_board("course", course_id, twice, 422)
    assert r["error"]["code"] == "layouts.card_not_multiple"
    # An instance of another board is not this board's.
    term_card = (await api.board("term", term_id))["cards"][0]
    foreign = {**term_card, "card_id": "academics.courseInfo", "size": "l"}
    r = await api.put_board("course", course_id, [foreign], 404)
    assert r["error"]["code"] == "common.not_found"


async def test_add_and_remove_cards(app: FastAPI, api: Api, user: UserHandle):
    program_id, _, _ = await api.scopes()
    added = await api.call(
        "POST",
        f"/layouts/boards/today/{program_id}/cards",
        json={"card_id": "notes.note", "settings": {"color": "blue"}},
    )
    assert (added["size"], added["x"], added["y"]) == ("s", 0, 0)
    second = await api.call(
        "POST", f"/layouts/boards/today/{program_id}/cards", json={"card_id": "notes.note"}
    )
    assert (second["x"], second["y"]) == (1, 0)
    code = await api.error(
        "POST", f"/layouts/boards/today/{program_id}/cards", 403, json={"card_id": "solo.card"}
    )
    assert code == "plugins.not_installed"
    with collect_events(app, user.id) as seen:
        await api.call("DELETE", f"/layouts/cards/{added['instance_id']}")
    assert [e["type"] for e in seen] == ["layouts.card.deleted", "layouts.board.updated"]
    board = await api.board("today", program_id)
    assert [c["instance_id"] for c in board["cards"]] == [second["instance_id"]]
    assert layout(board) == [("notes.note", "s", 1, 0)]  # x is kept


async def test_single_cards_and_settings_validation(api: Api):
    program_id, _, _ = await api.scopes()
    await api.call("PUT", "/plugins/solo/installation")
    url = f"/layouts/boards/today/{program_id}/cards"
    solo = await api.call("POST", url, json={"card_id": "solo.card"})
    assert await api.error("POST", url, 422, json={"card_id": "solo.card"}) == (
        "layouts.card_not_multiple"
    )
    code = await api.error(
        "PUT", f"/layouts/cards/{solo['instance_id']}/settings", 422, json={"settings": {"a": 1}}
    )
    assert code == "common.validation"
    note = await api.call("POST", url, json={"card_id": "notes.note"})
    bad = {"settings": {"content": "x" * 51, "extra": True}}
    r = await api.call("PUT", f"/layouts/cards/{note['instance_id']}/settings", 422, json=bad)
    assert r["error"]["params"]["errors"] == [
        {"loc": ["settings", "content"], "code": "max_length"},
        {"loc": ["settings", "extra"], "code": "not_allowed"},
    ]


async def test_uninstall_hides_cards_and_reinstall_restores_them(app: FastAPI, api: Api):
    _, _, course_id = await api.scopes()
    note = (await api.board("course", course_id))["cards"][1]
    url = f"/layouts/cards/{note['instance_id']}/settings"
    await api.call("PUT", url, json={"settings": {"content": "keep me"}})
    await api.call("DELETE", "/plugins/notes/installation")
    board = await api.board("course", course_id)
    assert [c["card_id"] for c in board["cards"]] == ["academics.courseInfo"]
    # Saving the layout meanwhile keeps the hidden card.
    await api.put_board("course", course_id, [{**board["cards"][0], "size": "m"}])
    assert await api.error("PUT", url, 403, json={"settings": {}}) == "plugins.not_installed"
    await api.call("PUT", "/plugins/notes/installation")
    board = await api.board("course", course_id)
    assert board["cards"][1]["settings"] == {"content": "keep me"}


async def test_purge_removes_cards_for_good(app: FastAPI, api: Api, user: UserHandle):
    program_id, _, course_id = await api.scopes()
    await api.call(
        "POST", f"/layouts/boards/today/{program_id}/cards", json={"card_id": "notes.note"}
    )
    await api.put_board("course", course_id, (await api.board("course", course_id))["cards"])
    with collect_events(app, user.id) as seen:
        await api.call("DELETE", "/plugins/notes/installation", params={"purge_data": True})
    assert len([e for e in seen if e["type"] == "layouts.card.deleted"]) == 2
    await api.call("PUT", "/plugins/notes/installation")
    assert [c["card_id"] for c in (await api.board("course", course_id))["cards"]] == [
        "academics.courseInfo"
    ]
    assert (await api.board("today", program_id))["cards"] == []


async def test_deleting_scopes_deletes_their_boards(app: FastAPI, api: Api, user: UserHandle):
    program_id, term_id, course_id = await api.scopes()
    await api.put_board("course", course_id, (await api.board("course", course_id))["cards"])
    await api.call(
        "POST", f"/layouts/boards/today/{program_id}/cards", json={"card_id": "notes.note"}
    )
    with collect_events(app, user.id) as seen:
        await api.call("DELETE", f"/courses/{course_id}")
    assert len([e for e in seen if e["type"] == "layouts.card.deleted"]) == 2
    assert await stored_boards(app) == 1
    with collect_events(app, user.id) as seen:
        await api.call("DELETE", f"/programs/{program_id}")
    assert [e["data"]["scope_type"] for e in seen if e["type"] == "layouts.card.deleted"] == [
        "today"
    ]
    assert await stored_boards(app) == 0
    del term_id


async def test_templates_apply_to_boards_that_follow_them(api: Api, client: AsyncClient):
    program_id, term_id, course_id = await api.scopes()
    board = await api.board("course", course_id)
    info, _ = board["cards"]
    await api.put_board("course", course_id, [{**info, "size": "m"}])
    template = await api.call(
        "POST",
        "/layouts/templates/course:from-board",
        json={"scope_id": course_id},
    )
    assert template["customized"]
    assert template["cards"] == [{"card_id": "academics.courseInfo", "size": "m", "x": 0, "y": 0}]
    other = await api.call(
        "POST",
        f"/programs/{program_id}/courses",
        json={"title": "Other", "term_ids": [term_id]},
    )
    assert layout(await api.board("course", other["id"])) == [("academics.courseInfo", "m", 0, 0)]
    template = await api.call("DELETE", "/layouts/templates/course")
    assert not template["customized"]
    assert len((await api.board("course", other["id"]))["cards"]) == 2
    assert (await api.call("GET", "/layouts/templates/today"))["cards"] == []
    del client


async def test_nav_order_and_hidden_pages(api: Api):
    assert await api.call("GET", "/layouts/nav/course") == {
        "scope_type": "course",
        "order": [],
        "hidden": [],
    }
    nav = await api.call(
        "PUT",
        "/layouts/nav/course",
        json={"order": ["notes", "overview", "notes"], "hidden": ["files"]},
    )
    assert nav == {"scope_type": "course", "order": ["notes", "overview"], "hidden": ["files"]}
    assert (await api.call("GET", "/layouts/nav/course"))["hidden"] == ["files"]
    assert (await api.call("GET", "/layouts/nav/term"))["order"] == []
    await api.call("GET", "/layouts/nav/today", 422)


async def test_other_users_boards_and_cards_are_not_found(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, api: Api
):
    _, _, course_id = await api.scopes()
    note = (await api.board("course", course_id))["cards"][1]
    other = await make_user(email="other@example.com")
    await login_as(client, other)
    assert await api.error("GET", f"/layouts/boards/course/{course_id}", 404) == "common.not_found"
    url = f"/layouts/cards/{note['instance_id']}/settings"
    assert await api.error("GET", url, 404) == "common.not_found"
    await api.call("GET", "/layouts/boards/course/tpl.course.x.0.notes.note", 404)
    assert await stored_boards(app) == 0


async def test_card_instances_for_other_modules(app: FastAPI, api: Api, user: UserHandle):
    _, _, course_id = await api.scopes()
    note = (await api.board("course", course_id))["cards"][1]
    async with system_ctx(app.state, user.id) as ctx:
        found = await get_card_instance(ctx, note["instance_id"])
        assert (found.card_id, found.scope_type, found.scope_id) == (
            "notes.note",
            "course",
            course_id,
        )
        assert [i.instance_id for i in await list_card_instances(ctx, "notes.note")] == [
            note["instance_id"]
        ]
        with pytest.raises(AppError):
            await get_card_instance(ctx, "missing")


async def test_agent_surface(app: FastAPI, user: UserHandle):
    async with system_ctx(app.state, user.id) as ctx:
        names = {c.name for c in await registry.available(ctx, "agent")}
    assert {"layouts.board.get", "layouts.card.add", "layouts.card.remove"} <= names
    assert {"plugins.catalog.list"} <= names
    assert not {"layouts.board.update", "plugins.install", "layouts.nav.update"} & names
