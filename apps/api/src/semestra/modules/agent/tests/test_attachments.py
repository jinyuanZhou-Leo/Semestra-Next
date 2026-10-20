"""Attachments read on upload into pages, `attachments.read`, and imports from an attachment."""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from pydantic import BaseModel

from semestra.core.capability import registry
from semestra.core.context import system_ctx
from semestra.core.errors import AppError
from semestra.modules.files.tests.conftest import make_pdf
from semestra.modules.imports.tests.test_imports_rules import ics, vevent
from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


class Chat:
    def __init__(self, app: FastAPI, client: AsyncClient, user_id: str) -> None:
        self.app, self.client, self.user_id = app, client, user_id

    async def call(self, method: str, url: str, status: int = 200, **kwargs: Any) -> Any:
        r = await self.client.request(method, url, **kwargs)
        assert r.status_code == status, r.text
        return r.json()

    async def program(self) -> str:
        body = {"name": "BASc", "timezone": "America/Toronto"}
        return (await self.call("POST", "/programs", json=body))["id"]

    async def attach(self, session_id: str, name: str, data: bytes, mime: str) -> dict[str, Any]:
        return await self.call(
            "POST",
            "/agent/attachments",
            data={"session_id": session_id},
            files={"file": (name, data, mime)},
        )

    async def tool(self, name: str, args: dict[str, Any]) -> Any:
        async with system_ctx(self.app.state, self.user_id) as ctx:
            ctx.actor = "agent"
            out = await registry.invoke(ctx, name, args, "agent")
            await ctx.db.commit()
        assert isinstance(out, BaseModel)
        return out.model_dump(mode="json")


@pytest.fixture
async def chat(app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> Chat:
    user = await make_user()
    await login_as(client, user)
    me = (await client.get("/account/me")).json()
    return Chat(app, client, me["id"])


async def session_of(chat: Chat, program_id: str) -> str:
    body = {"scope": {"program_id": program_id}}
    return (await chat.call("POST", "/agent/sessions", json=body))["id"]


async def test_uploads_are_read_into_pages(chat: Chat):
    session_id = await session_of(chat, await chat.program())
    pages = [f"# Week {n}\nTopic {n}: " + "lorem ipsum " * 40 for n in range(1, 14)]
    pdf = await chat.attach(session_id, "notes.pdf", make_pdf(pages), "application/pdf")

    first = await chat.tool("attachments.read", {"attachment_id": pdf["id"]})
    assert (first["type"], first["page_count"], first["error_code"]) == ("pdf", 13, None)
    assert [p["page_no"] for p in first["pages"]] == list(range(1, 11))
    assert "Topic 1" in first["pages"][0]["markdown"]
    assert first["next_page"] == 11
    rest = await chat.tool("attachments.read", {"attachment_id": pdf["id"], "page_from": 11})
    assert [p["page_no"] for p in rest["pages"]] == [11, 12, 13]
    assert rest["next_page"] is None

    # A file the parser cannot read is kept, with the reason.
    broken = await chat.attach(session_id, "broken.pdf", b"%PDF-1.4 fake", "application/pdf")
    read = await chat.tool("attachments.read", {"attachment_id": broken["id"]})
    assert (read["page_count"], read["pages"]) == (0, [])
    assert read["error_code"] in ("files.parse_failed", "files.too_complex")

    note = await chat.attach(session_id, "notes.txt", b"Office hours: Tuesday 3pm", "text/plain")
    read = await chat.tool("attachments.read", {"attachment_id": note["id"]})
    assert (read["type"], read["pages"][0]["markdown"]) == ("text", "Office hours: Tuesday 3pm")

    # Pages go with the attachment.
    await chat.call("DELETE", f"/agent/attachments/{note['id']}")
    with pytest.raises(AppError) as err:
        await chat.tool("attachments.read", {"attachment_id": note["id"]})
    assert err.value.code == "common.not_found"


async def test_attachments_of_other_users_cannot_be_read(
    chat: Chat, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    session_id = await session_of(chat, await chat.program())
    note = await chat.attach(session_id, "notes.txt", b"secret", "text/plain")
    await login_as(client, await make_user(email="other@example.com"))
    me = (await client.get("/account/me")).json()
    other = Chat(chat.app, client, me["id"])
    with pytest.raises(AppError) as err:
        await other.tool("attachments.read", {"attachment_id": note["id"]})
    assert err.value.code == "common.not_found"
    with pytest.raises(AppError):
        await other.tool(
            "imports.session.create",
            {"program_id": await other.program(), "source_kind": "ics",
             "target": {"kind": "term_wizard"}, "attachment_ids": [note["id"]]},
        )  # fmt: skip


THANKSGIVING = ics(
    vevent(
        uid=":m1",
        summary=":ECE201H1 LEC0101",
        dtstart=";TZID=America/Toronto:20260914T100000",
        dtend=";TZID=America/Toronto:20260914T110000",
        rrule=":FREQ=WEEKLY;UNTIL=20261207T235959Z;BYDAY=MO",
        # Thanksgiving, and a Monday of the reading week (skipped by the term anyway).
        exdate=";TZID=America/Toronto:20261012T100000,20261026T100000",
    ),
)
FALL = {
    "name": "Fall 2026",
    "start_date": "2026-09-14",
    "end_date": "2026-12-11",
    "breaks": [{"name": "Reading week", "start_date": "2026-10-24", "end_date": "2026-11-01"}],
}


async def test_imports_take_an_ics_attachment_with_its_cancelled_dates(chat: Chat):
    program_id = await chat.program()
    term = await chat.call("POST", f"/programs/{program_id}/terms", json=FALL)
    term_id = term["term"]["id"]
    session_id = await session_of(chat, program_id)
    att = await chat.attach(session_id, "coursesCalendar.ics", THANKSGIVING, "text/calendar")
    read = await chat.tool("attachments.read", {"attachment_id": att["id"]})
    assert read["type"] == "ics"

    created = await chat.tool(
        "imports.session.create",
        {"program_id": program_id, "source_kind": "ics",
         "target": {"kind": "term", "term_id": term_id}, "attachment_ids": [att["id"]]},
    )  # fmt: skip
    assert created["status"] == "ready"
    assert created["source_refs"][0]["filename"] == "coursesCalendar.ics"
    meeting = next(i for i in created["items"] if i["type"] == "meeting")
    assert meeting["data"]["exceptions"] == ["2026-10-12", "2026-10-26"]

    done = await chat.call("POST", f"/imports/{created['id']}:commit", json={})
    assert done["failed"] == 0
    course = (await chat.call("GET", f"/programs/{program_id}/courses"))["items"][0]
    meetings = (await chat.call("GET", f"/courses/{course['id']}/meetings"))["items"]
    cancelled = [(e["original_date"], e["kind"]) for e in meetings[0]["exceptions"]]
    assert cancelled == [("2026-10-12", "cancelled")]
    # The attachment stays with the conversation; the import keeps its own copy.
    assert (await chat.tool("attachments.read", {"attachment_id": att["id"]}))["page_count"] == 1
