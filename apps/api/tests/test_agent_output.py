"""Agent/MCP output (M00 §3.6, `core.agent_output`): trimmed, in the Program's time zone, with
LMS HTML as Markdown."""

import typing
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from types import UnionType
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from httpx import AsyncClient
from pydantic import BaseModel, Field

from semestra.core import agent_output
from semestra.core.agent_output import CHANGED, ForAgents
from semestra.core.capability import Registry, capability, registry
from semestra.core.context import Ctx
from semestra.main import create_app
from semestra.modules.lms.markdown import to_markdown
from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


def _models(annotation: Any) -> list[type[BaseModel]]:
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return [annotation]
    return [m for arg in typing.get_args(annotation) for m in _models(arg)]


def _has_path(model: type[BaseModel], path: str) -> bool:
    head, _, rest = path.partition(".")
    info = model.model_fields.get(head)
    if info is None:
        return False
    if not rest:
        return True
    return any(_has_path(m, rest) for m in _models(info.annotation))


def _item_model(model: type[BaseModel]) -> type[BaseModel] | None:
    info = model.model_fields.get("items")
    found = _models(info.annotation) if info is not None else []
    return found[0] if found else None


def test_agent_fields_name_real_output_fields():
    """A misspelt path would silently drop the field from what the model sees."""
    create_app()
    wrong: list[str] = []
    for cap in registry.list():
        for path in cap.agent_output_fields or ():
            if path != CHANGED and not _has_path(cap.output_model, path):
                wrong.append(f"{cap.name}: {path}")
        item = _item_model(cap.output_model) or cap.output_model
        for name in cap.agent_default_fields or ():
            if name not in item.model_fields:
                wrong.append(f"{cap.name}: default {name}")
    assert wrong == []


def test_html_fields_reach_agents_as_markdown():
    html = (
        '<h2>Lab 3</h2><p>Read <a href="https://x/files/9" data-lms-kind="file" '
        'data-lms-ref="9">the handout</a> and <a href="https://example.com">this</a>.</p>'
        "<ul><li>one</li></ul><p>Submit lab_3_report.pdf by 11:59 *sharp*</p>"
    )
    assert to_markdown(html) == (
        "## Lab 3\n\nRead [the handout](lms:file/9) and [this](https://example.com).\n\n- one"
        "\n\nSubmit lab_3_report.pdf by 11:59 *sharp*"  # nothing escaped: the model copies it
    )


class _Inner(BaseModel):
    at: datetime
    body: Annotated[str | None, ForAgents(str.upper, "text")] = None
    data: dict[str, Any] = Field(default_factory=dict)


class _Out(BaseModel):
    id: str
    title: str
    note: str | None
    due_at: datetime | None
    items: list[_Inner]
    secret: str = "x"


class _UpdateInput(BaseModel):
    item_id: str = Field(description="Item")
    note: str | None = Field(default=None, description="Note")


async def test_shape_trims_localizes_and_echoes_changes(app: FastAPI, client: AsyncClient):
    del client  # starts the app
    reg = Registry()

    @capability(
        name="test.item.update",
        summary="s",
        description="d",
        effect="write",
        public=True,
        agent_output_fields=("id", "title", "due_at", "items", CHANGED),
        target=reg,
    )
    async def update(ctx: Ctx, inp: _UpdateInput) -> _Out:  # pyright: ignore[reportUnusedFunction]
        del ctx
        return _Out(
            id=inp.item_id,
            title="Lab",
            note=inp.note,
            due_at=datetime(2026, 1, 15, 4, 59, tzinfo=UTC),
            items=[
                _Inner(at=datetime(2026, 7, 1, 12, tzinfo=UTC), body="<p>hi</p>"),
                _Inner(at=datetime(2026, 7, 2, 12, tzinfo=UTC), data={"room": None}),
            ],
        )

    async def toronto(ctx: Ctx, inp: BaseModel, out: BaseModel) -> Any:
        del ctx, inp, out
        return ZoneInfo("America/Toronto")

    class _ListInput(BaseModel):
        fields: list[str] | None = Field(default=None, description="Fields")

    @capability(
        name="test.item.list", summary="s", description="d", effect="read", public=True, target=reg
    )
    async def listing(ctx: Ctx, inp: _ListInput) -> _Out:  # pyright: ignore[reportUnusedFunction]
        return await update(ctx, _UpdateInput(item_id="a"))

    from semestra.core.context import system_ctx

    before = agent_output._zone_resolver  # pyright: ignore[reportPrivateUsage]
    agent_output.set_zone_resolver(toronto)
    try:
        async with system_ctx(app.state) as ctx:
            args = {"item_id": "a", "note": None}
            out = await reg.invoke(ctx, "test.item.update", args, "agent")
            listed = await reg.invoke(ctx, "test.item.list", {"fields": ["text"]}, "mcp")
            http = await reg.invoke(ctx, "test.item.update", args, "http")
    finally:
        agent_output.set_zone_resolver(before)
    assert out == {
        "id": "a",
        "title": "Lab",
        "note": None,  # set by the call (cleared), so it is echoed
        "due_at": "2026-01-14T23:59:00-05:00",
        "items": [
            {"at": "2026-07-01T08:00:00-04:00", "text": "<P>HI</P>", "data": {}},
            # No body: its null is left out of the list item; free-form data keeps its nulls.
            {"at": "2026-07-02T08:00:00-04:00", "data": {"room": None}},
        ],
    }
    # `fields` may name a field by what agents see (`text` for `body`).
    assert listed["items"] == [{"text": "<P>HI</P>"}, {}]  # pyright: ignore[reportArgumentType, reportCallIssue, reportIndexIssue]
    assert isinstance(http, _Out)
    assert http.due_at is not None
    assert http.due_at.tzinfo == UTC


def test_union_annotations_are_walked():
    # `X | None` fields (UnionType) lead to their model.
    assert _models(_Inner | None) == [_Inner]
    assert isinstance(_Inner | None, UnionType)


class _Ids(BaseModel):
    program_id: str | None = None
    course_id: str | None = None
    term_id: str | None = None


async def test_output_zone_prefers_what_the_call_names(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    from semestra.core.context import ScopeRef, system_ctx
    from semestra.modules.academics.zone import output_zone

    user = await make_user()
    await login_as(client, user)

    async def program(zone: str) -> str:
        r = await client.post("/programs", json={"name": zone, "timezone": zone})
        return r.json()["id"]

    toronto = await program("America/Toronto")
    async with system_ctx(app.state, user.id) as ctx:
        # One Program: it is the answer even when nothing names it.
        assert await output_zone(ctx, _Ids(), _Ids()) == ZoneInfo("America/Toronto")
    shanghai = await program("Asia/Shanghai")
    term = {"name": "Fall", "start_date": "2026-09-07", "end_date": "2026-12-18"}
    term_id = (await client.post(f"/programs/{shanghai}/terms", json=term)).json()["term"]["id"]
    body = {"title": "C", "code": "C1", "term_ids": [term_id]}
    course = (await client.post(f"/programs/{shanghai}/courses", json=body)).json()["id"]
    async with system_ctx(app.state, user.id) as ctx:
        ctx.scope = ScopeRef(toronto)
        # The call's course beats the page the user is on.
        assert await output_zone(ctx, _Ids(course_id=course), _Ids()) == ZoneInfo("Asia/Shanghai")
        assert await output_zone(ctx, _Ids(program_id=shanghai), _Ids()) == ZoneInfo(
            "Asia/Shanghai"
        )
        # A call by some other id: the conversation's Program.
        assert await output_zone(ctx, _Ids(), _Ids(program_id=shanghai)) == ZoneInfo(
            "America/Toronto"
        )
        ctx.scope = None
        # No scope (MCP): the Program the output names, else UTC with several Programs.
        assert await output_zone(ctx, _Ids(), _Ids(course_id=course)) == ZoneInfo("Asia/Shanghai")
        assert await output_zone(ctx, _Ids(), _Ids()) is None
        assert await output_zone(ctx, _Ids(course_id="nope"), _Ids()) is None
