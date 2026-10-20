"""Agent/MCP output (M00 §3.6, `core.agent_output`): trimmed, in the Program's time zone, with
LMS HTML as Markdown."""

import typing
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
        "<ul><li>one</li></ul>"
    )
    assert to_markdown(html) == (
        "## Lab 3\n\nRead [the handout](lms:file/9) and [this](https://example.com).\n\n- one"
    )


class _Inner(BaseModel):
    at: datetime
    body: Annotated[str | None, ForAgents(str.upper, "text")] = None


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
            items=[_Inner(at=datetime(2026, 7, 1, 12, tzinfo=UTC), body="<p>hi</p>")],
        )

    async def toronto(ctx: Ctx, inp: BaseModel) -> Any:
        del ctx, inp
        return ZoneInfo("America/Toronto")

    from semestra.core.context import system_ctx

    before = agent_output._zone_resolver  # pyright: ignore[reportPrivateUsage]
    agent_output.set_zone_resolver(toronto)
    try:
        async with system_ctx(app.state) as ctx:
            args = {"item_id": "a", "note": None}
            out = await reg.invoke(ctx, "test.item.update", args, "agent")
            http = await reg.invoke(ctx, "test.item.update", args, "http")
    finally:
        agent_output.set_zone_resolver(before)
    assert out == {
        "id": "a",
        "title": "Lab",
        "note": None,  # set by the call (cleared), so it is echoed
        "due_at": "2026-01-14T23:59:00-05:00",
        "items": [{"at": "2026-07-01T08:00:00-04:00", "text": "<P>HI</P>"}],
    }
    assert isinstance(http, _Out)
    assert http.due_at is not None
    assert http.due_at.tzinfo == UTC


def test_union_annotations_are_walked():
    # `X | None` fields (UnionType) lead to their model.
    assert _models(_Inner | None) == [_Inner]
    assert isinstance(_Inner | None, UnionType)
