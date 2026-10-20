"""Attachments read on upload into pages, `attachments.read`, and imports from an attachment."""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from pydantic import BaseModel

from semestra.core.capability import registry
from semestra.core.context import Ctx, system_ctx
from semestra.core.errors import AppError
from semestra.core.jobs import run_periodic
from semestra.modules.agent import service
from semestra.modules.agent.models import AgentMessage, AgentSession
from semestra.modules.files.parse.detect import DOCX
from semestra.modules.files.parse.readers import LOGICAL_PAGE_CHARS
from semestra.modules.files.tests.conftest import make_docx, make_pdf
from semestra.modules.imports.tests.test_imports_rules import ics, vevent
from semestra.testing import Clock, MakeUser, UserHandle

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

    # Text without blank lines is still cut into pages.
    lines = "\n".join(f"Week {n}: lecture notes " + "x" * 60 for n in range(400)).encode()
    long = await chat.attach(session_id, "long.txt", lines, "text/plain")
    read = await chat.tool("attachments.read", {"attachment_id": long["id"]})
    assert read["page_count"] > 10
    assert read["next_page"] == 11
    assert max(len(p["markdown"]) for p in read["pages"]) <= LOGICAL_PAGE_CHARS
    with pytest.raises(AppError) as err:
        await chat.tool(
            "attachments.read", {"attachment_id": long["id"], "page_from": 5, "page_to": 3}
        )
    assert err.value.code == "common.validation"

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
    # The raw calendar is not given to the model; the importer reads it.
    assert (read["type"], read["page_count"], read["pages"]) == ("ics", 0, [])
    assert "imports.session.create" in read["note"]

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
    result = next(i for i in done["session"]["items"] if i["type"] == "meeting")["result"]
    # The reading-week date is not a class day: reported, not silently dropped.
    assert [s["date"] for s in result["skipped_exceptions"]] == ["2026-10-26"]
    course = (await chat.call("GET", f"/programs/{program_id}/courses"))["items"][0]
    meetings = (await chat.call("GET", f"/courses/{course['id']}/meetings"))["items"]
    cancelled = [(e["original_date"], e["kind"]) for e in meetings[0]["exceptions"]]
    assert cancelled == [("2026-10-12", "cancelled")]
    # The attachment stays with the conversation; the import keeps its own copy.
    assert (await chat.tool("attachments.read", {"attachment_id": att["id"]}))["type"] == "ics"


async def test_creating_a_conversation_twice_with_one_key_returns_it(chat: Chat):
    program_id = await chat.program()
    body = {"scope": {"program_id": program_id}, "client_key": "draft-1234"}
    first = await chat.call("POST", "/agent/sessions", json=body)
    again = await chat.call("POST", "/agent/sessions", json=body)
    assert again["id"] == first["id"]
    other = await chat.call("POST", "/agent/sessions", json={**body, "client_key": "draft-5678"})
    assert other["id"] != first["id"]
    listed = await chat.call("GET", "/agent/sessions")
    assert len(listed["items"]) == 2


async def test_unsent_attachments_are_removed_after_a_day(app: FastAPI, chat: Chat, clock: Clock):
    session_id = await session_of(chat, await chat.program())
    sent = await chat.attach(session_id, "sent.txt", b"kept", "text/plain")
    unsent = await chat.attach(session_id, "unsent.txt", b"dropped", "text/plain")
    async with system_ctx(app.state, chat.user_id) as ctx:
        ctx.db.add(
            AgentMessage(
                user_id=chat.user_id,
                session_id=session_id,
                role="user",
                content=[{"type": "file_ref", "attachment_id": sent["id"], "name": "sent.txt"}],
                created_at=clock.now,
            )
        )
        await ctx.db.commit()

    clock.advance(hours=23)
    await run_periodic(app.state, "agent.attachments.cleanup")
    ids = {
        a["id"] for a in (await chat.call("GET", f"/agent/sessions/{session_id}"))["attachments"]
    }
    assert ids == {sent["id"], unsent["id"]}

    clock.advance(hours=2)
    await run_periodic(app.state, "agent.attachments.cleanup")
    ids = {
        a["id"] for a in (await chat.call("GET", f"/agent/sessions/{session_id}"))["attachments"]
    }
    assert ids == {sent["id"]}
    usage = await chat.call("GET", "/storage/usage")
    assert usage["by_module"]["agent"] == len(b"kept")


async def test_an_attachment_can_be_saved_to_a_course(chat: Chat):
    program_id = await chat.program()
    term = await chat.call("POST", f"/programs/{program_id}/terms", json=FALL)
    course = await chat.call(
        "POST",
        f"/programs/{program_id}/courses",
        json={"title": "Circuits", "code": "ECE201H1", "term_ids": [term["term"]["id"]]},
    )
    session_id = await session_of(chat, program_id)
    att = await chat.attach(session_id, "syllabus.txt", b"Midterm 30%", "text/plain")
    saved = await chat.call(
        "POST", f"/agent/attachments/{att['id']}:save", json={"course_id": course["id"]}
    )
    assert (saved["course_id"], saved["display_name"]) == (course["id"], "syllabus.txt")
    again = await chat.call(
        "POST", f"/agent/attachments/{att['id']}:save", json={"course_id": course["id"]}
    )
    assert again["id"] == saved["id"]
    detail = await chat.call("GET", f"/agent/sessions/{session_id}")
    assert detail["attachments"][0]["file_item_id"] == saved["id"]


async def test_uploads_are_typed_by_their_content(chat: Chat):
    session_id = await session_of(chat, await chat.program())
    docx = make_docx([("Heading 1", "Grading"), ("Normal", "Midterm 30%, final 50%")])
    att = await chat.attach(session_id, "syllabus.docx", docx, "application/octet-stream")
    assert (att["kind"], att["mime"]) == ("file", DOCX)
    read = await chat.tool("attachments.read", {"attachment_id": att["id"]})
    assert read["type"] == "docx"
    assert "Midterm 30%" in read["pages"][0]["markdown"]
    # A calendar sent as octet-stream (some Windows browsers) is still taken.
    cal = await chat.attach(session_id, "cal.ics", THANKSGIVING, "application/octet-stream")
    assert cal["mime"] == "text/calendar"
    # A GIF is a picture, not an unreadable document.
    gif = await chat.attach(session_id, "wave.gif", b"GIF89a" + b"\x00" * 20, "image/gif")
    assert (gif["kind"], gif["mime"]) == ("image", "image/gif")
    read = await chat.tool("attachments.read", {"attachment_id": gif["id"]})
    assert (read["type"], read["error_code"]) == ("image", None)
    # Binary content is refused whatever the browser claims.
    await chat.call(
        "POST",
        "/agent/attachments",
        415,
        data={"session_id": session_id},
        files={"file": ("x.txt", b"\x00\x01\x02binary", "text/plain")},
    )


async def test_a_lost_race_on_the_client_key_returns_the_winner(
    chat: Chat, monkeypatch: pytest.MonkeyPatch
):
    program_id = await chat.program()
    body = {"scope": {"program_id": program_id}, "client_key": "draft-race1"}
    first = await chat.call("POST", "/agent/sessions", json=body)
    real = service._session_by_key
    calls = 0

    async def miss_once(ctx: Ctx, key: str) -> AgentSession | None:
        nonlocal calls
        calls += 1
        return None if calls == 1 else await real(ctx, key)

    # The lookup misses (the other request had not committed yet); the insert then hits the
    # unique index and the winner's session is returned.
    monkeypatch.setattr(service, "_session_by_key", miss_once)
    again = await chat.call("POST", "/agent/sessions", json=body)
    assert again["id"] == first["id"]
