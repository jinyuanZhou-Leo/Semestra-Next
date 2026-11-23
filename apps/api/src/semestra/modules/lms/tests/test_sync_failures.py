"""A part of the sync failing stops only that part (M09 table 5b): one example per row, then the
matrix of every read of table 5a against every answer the platform can give (M09 §11)."""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

import pytest
from fastapi import FastAPI
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from semestra.core.context import system_ctx
from semestra.modules.files import sources
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.models import (
    LmsAnnouncement,
    LmsAssignment,
    LmsCalendarEvent,
    LmsCourseLink,
    LmsMaterial,
)
from semestra.modules.lms.schemas.dto import Announcement, FileMeta, NavTab, PageSummary
from semestra.modules.lms.schemas.dto import LmsCalendarEvent as Event
from semestra.modules.lms.sync_round import SyncRound
from semestra.modules.lms.tests.conftest import Api, FakeProvider, SyncFailures
from semestra.modules.lms.tests.test_sync import _assessments, _course
from semestra.testing import Clock, collect_events

pytestmark = pytest.mark.usefixtures("fake")

STAGES = ("course", "assignments", "announcements", "calendar", "files")
JAN = datetime(2026, 1, 10, tzinfo=UTC)
# A value a write of the sync cannot take (`poison`): it stands for a bug, or another module
# refusing what the platform has.
POISON = "BOOM"


def _file(file_id: str, name: str) -> FileMeta:
    return FileMeta(external_id=file_id, name=name, size_bytes=10, updated_at=JAN)


def _event(event_id: str, title: str) -> Event:
    return Event(
        external_id=event_id,
        external_course_id="101",
        title=title,
        start_at=datetime(2026, 2, 2, 15, tzinfo=UTC),
    )


def _news(news_id: str, title: str) -> Announcement:
    return Announcement(external_id=news_id, external_course_id="101", title=title)


async def _world(api: Api, fake: FakeProvider) -> tuple[str, str]:
    """A linked course with a bit of everything, synced once: assignment a1 imported (a quiz),
    a2 and a3 only listed; one announcement, one calendar event, one file, one page, the
    default modules."""
    labs = fake.course_assignments["101"]
    labs[0] = labs[0].model_copy(update={"quiz_id": "q1"})
    fake.announcement_list = [_news("n1", "Welcome")]
    fake.events = [_event("e1", "Lecture")]
    fake.course_file_list = [_file("f1", "one.txt")]
    fake.page_list = [PageSummary(external_id="p1", ref="notes", title="Notes")]
    fake.page_texts = {"notes": ("Notes", "<p>" + "Read chapter one with care. " * 20 + "</p>")}
    program_id, course = await _course(api, "a1")
    status = await api.sync(program_id)
    assert status["errors"] == []
    return program_id, course


def _canaries(fake: FakeProvider) -> None:
    """A change on the platform for each stage, to tell which stages wrote this round."""
    labs = fake.course_assignments["101"]
    labs[1] = labs[1].model_copy(update={"name": "Lab 2 (new)"})
    fake.announcement_list = [*(fake.announcement_list or []), _news("n2", "Second")]
    fake.events = [*fake.events, _event("e2", "Tutorial")]
    fake.course_file_list = [*fake.course_file_list, _file("f2", "two.txt")]


@dataclass
class Seen:
    """What the sync keeps of the course, read from its tables."""

    assignments: dict[str, str]  # mirror rows: platform id -> name
    announcements: dict[str, str]
    events: dict[str, str]
    materials: dict[str, str]  # (kind:id) -> state
    link: LmsCourseLink

    def wrote(self, stage: str) -> bool:
        """Whether the stage's canary came in (`_canaries`)."""
        match stage:
            case "assignments":
                return self.assignments.get("a2") == "Lab 2 (new)"
            case "announcements":
                return "n2" in self.announcements
            case "calendar":
                return "e2" in self.events
            case "files":
                return "file:f2" in self.materials
        raise AssertionError(stage)


async def _seen(app: FastAPI, api: Api) -> Seen:
    user_id = (await api.call("GET", "/account/me"))["id"]
    async with system_ctx(app.state, user_id) as ctx:
        link = await ctx.db.scalar(select(LmsCourseLink))
        assert link is not None
        return Seen(
            {
                r.external_id: r.assignment.get("name", "")
                for r in await ctx.db.scalars(
                    select(LmsAssignment).where(LmsAssignment.link_id == link.id)
                )
            },
            {r.external_id: r.title for r in await ctx.db.scalars(select(LmsAnnouncement))},
            {r.external_id: r.title for r in await ctx.db.scalars(select(LmsCalendarEvent))},
            {
                f"{r.kind}:{r.external_id}": r.state
                for r in await ctx.db.scalars(select(LmsMaterial))
            },
            link,
        )


def _errors(status: dict[str, Any]) -> dict[str, str]:
    return {e["stage"]: e["code"] for e in status["errors"]}


@pytest.fixture
def poison() -> Iterator[None]:
    """Any write of a sync row holding `POISON` fails, as a bug in that write would."""

    def check(session: Session, *_: Any) -> None:
        for obj in (*session.new, *session.dirty):
            values = [getattr(obj, name, None) for name in ("title", "external_name")]
            if isinstance(obj, LmsAssignment):
                values.append(obj.assignment.get("name"))
            if POISON in values:
                raise RuntimeError("a write that fails")

    event.listen(Session, "before_flush", check)
    yield
    event.remove(Session, "before_flush", check)


# --- table 5b, one example per row -----------------------------------------------------------


async def test_row1_course_not_read_ends_the_round(api: Api, app: FastAPI, fake: FakeProvider):
    program_id, _ = await _world(api, fake)
    _canaries(fake)
    fake.faults["get_course"] = lms_error("lms.forbidden")
    fake.reads.clear()
    status = await api.sync(program_id)
    assert _errors(status) == {"course": "lms.forbidden"}
    assert fake.reads == ["get_course"]  # nothing under the course is asked
    seen = await _seen(app, api)
    assert not any(seen.wrote(stage) for stage in STAGES[1:])
    for area in ("assignments", "calendar"):
        assert seen.link.area_reads[area]["result"] == "unavailable"
        assert seen.link.area_reads[area]["reason"] == "lms.forbidden"


async def test_row2_an_answer_about_the_connection_ends_the_round(
    api: Api, app: FastAPI, fake: FakeProvider
):
    program_id, _ = await _world(api, fake)
    _canaries(fake)
    fake.faults["announcements"] = lms_error("lms.rate_limited", retry_after=60)
    fake.reads.clear()
    status = await api.sync(program_id)
    assert _errors(status) == {"announcements": "lms.rate_limited"}
    seen = await _seen(app, api)
    assert seen.wrote("assignments")  # committed before
    assert not seen.wrote("announcements")
    assert "calendar_events" not in fake.reads
    assert "course_files" not in fake.reads
    assert seen.link.area_reads["calendar"]["reason"] == "lms.rate_limited"
    assert status["synced_at"] is not None


async def test_row3_a_list_not_given_is_about_that_list(api: Api, app: FastAPI, fake: FakeProvider):
    program_id, _ = await _world(api, fake)
    _canaries(fake)
    fake.faults["pages"] = lms_error("lms.unreachable", upstream_status=502)
    status = await api.sync(program_id)
    assert status["errors"] == []
    seen = await _seen(app, api)
    assert all(seen.wrote(stage) for stage in STAGES[1:])
    assert seen.link.area_reads["pages"]["result"] == "unavailable"
    assert seen.link.area_reads["pages"]["reason"] == "lms.unreachable"
    assert seen.materials["page:notes"] == "synced"  # not judged


async def test_row4_an_item_not_given_is_about_that_item(
    api: Api, app: FastAPI, fake: FakeProvider
):
    program_id, _ = await _world(api, fake)
    _canaries(fake)
    fake.faults["course_files"] = lms_error("lms.forbidden")  # f1 is read on its own
    fake.faults["file"] = lms_error("lms.unreachable")
    fake.reads.clear()
    status = await api.sync(program_id)
    assert "file" in fake.reads
    assert status["errors"] == []
    seen = await _seen(app, api)
    assert seen.materials["file:f1"] == "synced"
    assert all(seen.wrote(stage) for stage in STAGES[1:4])


async def test_row5_a_side_read_keeps_what_was_read_before(
    api: Api, app: FastAPI, fake: FakeProvider
):
    program_id, course = await _world(api, fake)
    _canaries(fake)
    fake.faults["submissions"] = lms_error("lms.forbidden")
    status = await api.sync(program_id)
    assert _errors(status) == {"assignments": "lms.forbidden"}
    seen = await _seen(app, api)
    assert all(seen.wrote(stage) for stage in STAGES[1:])
    assert (await _assessments(api, course))["a1"]["title"] == "Lab 1"


async def test_row6_shared_work_fails_only_what_uses_it(
    api: Api,
    app: FastAPI,
    fake: FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
    expect_sync_failures: SyncFailures,
):
    """The course's own files (to tell a duplicate) are read only for a new file: one that
    fails fails each new file, once; the files followed already go on."""
    program_id, _ = await _world(api, fake)
    _canaries(fake)
    fake.course_file_list = [
        fake.course_file_list[0].model_copy(update={"name": "one (v2).txt"}),
        _file("f2", "two.txt"),
        _file("f3", "three.txt"),
    ]
    asked: list[str] = []

    async def broken(*_: Any) -> Any:
        asked.append("own_files")
        raise RuntimeError("cannot read the course's files")

    monkeypatch.setattr(sources, "own_files", broken)
    status = await api.sync(program_id)
    assert _errors(status) == {"files": "common.internal"}
    assert asked == ["own_files"]
    assert sorted(expect_sync_failures.items()) == [
        ("file", "f2", "common.internal"),
        ("file", "f3", "common.internal"),
    ]
    seen = await _seen(app, api)
    assert "file:f2" not in seen.materials
    assert "file:f3" not in seen.materials
    assert seen.materials["file:f1"] == "synced"
    _, items = await _files(api, seen.link.course_id)
    assert "one (v2).txt" in items  # followed
    assert all(seen.wrote(stage) for stage in STAGES[1:4])


async def _files(api: Api, course: str) -> tuple[dict[str, Any], dict[str, Any]]:
    got = await api.call("GET", f"/courses/{course}/files", params={"recursive": True})
    return {f["id"]: f for f in got["folders"]}, {i["display_name"]: i for i in got["items"]}


@pytest.mark.usefixtures("poison")
@pytest.mark.parametrize("stage", STAGES)
async def test_row7_an_item_that_fails_is_left_as_it_was(
    api: Api,
    app: FastAPI,
    fake: FakeProvider,
    clock: Clock,
    stage: str,
    expect_sync_failures: SyncFailures,
):
    """One item's write fails: that item stays as it was, with nothing it queued pushed; the
    other items of its stage and the other stages are written."""
    program_id, course = await _world(api, fake)
    _canaries(fake)
    expected: tuple[str, str]
    match stage:
        case "course":
            fake.courses[0] = fake.courses[0].model_copy(update={"name": POISON})
            expected = ("course", "101")
        case "assignments":
            labs = fake.course_assignments["101"]
            labs[0] = labs[0].model_copy(update={"name": POISON})  # imported: followed
            expected = ("assignment", "a1")
        case "announcements":
            fake.announcement_list = [_news("n1", POISON), _news("n2", "Second")]
            expected = ("announcement", "n1")
        case "calendar":
            fake.events = [_event("e1", POISON), _event("e2", "Tutorial")]
            expected = ("calendar_event", "e1")
        case _:
            fake.course_file_list = [
                _file("f1", "one.txt"),
                _file("f2", "two.txt"),
                _file("f3", POISON),
            ]
            expected = ("file", "f3")
    user_id = (await api.call("GET", "/account/me"))["id"]
    with collect_events(app, user_id) as pushed:
        status = await api.sync(program_id)
    assert _errors(status) == {stage: "common.internal"}
    assert expect_sync_failures.items() == [(*expected, "common.internal")]
    seen = await _seen(app, api)
    assert all(seen.wrote(s) for s in STAGES[1:])  # the rest of its stage too
    match stage:
        case "course":
            assert seen.link.external_name == "Computer Fundamentals"
        case "assignments":
            assert seen.assignments["a1"] == "Lab 1"
            assert (await _assessments(api, course))["a1"]["title"] == "Lab 1"
            assert not any(m["type"] == "grading.assessment.updated" for m in pushed)
        case "announcements":
            assert seen.announcements["n1"] == "Welcome"
        case "calendar":
            assert seen.events["e1"] == "Lecture"
        case _:
            assert "file:f3" not in seen.materials
            _, items = await _files(api, course)
            assert POISON not in items
            created = {m["data"]["item_id"] for m in pushed if m["type"] == "files.item.created"}
            assert created <= {i["id"] for i in items.values()}  # none for what went back
    # Tried again next round, written once it can be.
    fake.courses[0] = fake.courses[0].model_copy(update={"name": "Computer Fundamentals"})
    labs = fake.course_assignments["101"]
    labs[0] = labs[0].model_copy(update={"name": "Lab 1"})
    fake.announcement_list = [_news("n1", "Welcome"), _news("n2", "Second")]
    fake.events = [_event("e1", "Lecture"), _event("e2", "Tutorial")]
    fake.course_file_list = [_file("f1", "one.txt"), _file("f2", "two.txt"), _file("f3", "x.txt")]
    clock.advance(minutes=1)
    status = await api.sync(program_id)
    assert status["errors"] == []


async def test_row8_the_stage_s_own_record_failing_fails_the_stage(
    api: Api,
    app: FastAPI,
    fake: FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
    expect_sync_failures: SyncFailures,
):
    program_id, _ = await _world(api, fake)
    _canaries(fake)
    save = SyncRound.save

    async def broken(self: SyncRound, ctx: Any, link: Any, readable: Any = ()) -> None:
        if "page" in readable:
            raise RuntimeError("the database is full")
        await save(self, ctx, link, readable)

    monkeypatch.setattr(SyncRound, "save", broken)
    status = await api.sync(program_id)
    assert _errors(status) == {"files": "common.internal"}
    assert expect_sync_failures.events() == ["lms.sync_stage_failed"]
    seen = await _seen(app, api)
    assert all(seen.wrote(stage) for stage in STAGES[1:4])
    assert not seen.wrote("files")


# --- the matrix: each read of table 5a by each answer ----------------------------------------

ReadKind = Literal["course", "area", "item", "side", "nav"]


@dataclass(frozen=True)
class Read:
    stage: str
    method: str  # the provider's
    kind: ReadKind
    area: str | None = None  # the area it lists or its item is in
    # The lists refused (as closed) so that it happens: an item read on its own, the
    # navigation read when a list is refused.
    needs: tuple[str, ...] = ()


READS = [
    Read("course", "get_course", "course"),
    Read("assignments", "assignments", "area", "assignments"),
    Read("assignments", "assignment", "item", "assignments", needs=("assignments",)),
    Read("assignments", "submissions", "side"),
    Read("assignments", "quizzes", "side", "quizzes"),
    Read("assignments", "course_total", "side"),
    Read("announcements", "announcements", "area", "announcements"),
    Read("announcements", "discussion", "item", "announcements", needs=("announcements",)),
    Read("calendar", "calendar_events", "area", "calendar"),
    Read("files", "course_files", "area", "files"),
    Read("files", "pages", "area", "pages"),
    Read("files", "modules", "area", "modules"),
    Read("files", "module_items", "area", "modules"),
    Read("files", "file", "item", "files", needs=("course_files",)),
    Read("files", "page", "item", "pages", needs=("pages", "modules")),
    Read("files", "navigation", "nav", "pages", needs=("pages",)),
]
# The list each stage's canary comes in by.
CANARY = {
    "assignments": "assignments",
    "announcements": "announcements",
    "calendar": "calendar_events",
    "files": "course_files",
}
# What the round makes of each answer of table 2: the error code it records.
ANSWERS: dict[str, str | None] = {
    "ok": None,
    "closed": "lms.forbidden",  # refused, the navigation leaves the area out
    "refused_nav_open": "lms.forbidden",
    "refused_nav_unread": "lms.forbidden",
    "not_found": "lms.not_found",
    "rate_limited": "lms.rate_limited",
    "unreachable": "lms.unreachable",
    "invalid_credentials": "lms.invalid_credentials",
    "invalid_config": "lms.invalid_config",
    "payload": "lms.unreachable",  # an answer not understood
}
STOPPING = {"rate_limited", "invalid_credentials", "invalid_config"}
# The item each single read is about, still there.
ITEM_KEPT = {
    "assignment": lambda seen: "a1" in seen.assignments,
    "discussion": lambda seen: "n1" in seen.announcements,
    "file": lambda seen: seen.materials["file:f1"] == "synced",
    "page": lambda seen: seen.materials["page:notes"] == "synced",
}


def _answer(fake: FakeProvider, read: Read, answer: str) -> None:
    code = ANSWERS[answer]
    if code is None:
        return
    match answer:
        case "payload":
            fake.faults[read.method] = RuntimeError("not understood")
        case "rate_limited":
            fake.faults[read.method] = lms_error(code, retry_after=60)
        case "invalid_config":
            fake.faults[read.method] = lms_error(code, field="base_url", reason="redirect")
        case _:
            fake.faults[read.method] = lms_error(code)
    if read.kind not in ("area", "side") or read.area in (None, "calendar"):
        return  # what the navigation says is only asked of a list refused (table 2, rows 7-8)
    if answer == "refused_nav_open":
        tab = NavTab(external_id=read.area or "", kind=read.area, label="Tab")  # type: ignore[arg-type]
        fake.nav = [*fake.nav, tab]
    if answer == "refused_nav_unread":
        fake.nav_refused = True


@pytest.mark.parametrize("answer", list(ANSWERS))
@pytest.mark.parametrize("read", READS, ids=lambda r: f"{r.stage}-{r.method}")
async def test_matrix(
    api: Api,
    app: FastAPI,
    fake: FakeProvider,
    clock: Clock,
    read: Read,
    answer: str,
    expect_sync_failures: SyncFailures,
):
    program_id, _ = await _world(api, fake)
    _canaries(fake)
    for needed in read.needs:
        fake.faults[needed] = lms_error("lms.forbidden")  # closed: the default navigation
    if read.method == "page":
        clock.advance(days=2)  # the page's text read last round is not read again for a day
    _answer(fake, read, answer)
    fake.reads.clear()
    status = await api.sync(program_id)
    assert read.method in fake.reads  # the read this case is about did happen

    code = ANSWERS[answer]
    failed = code is not None
    ended = failed and (read.kind == "course" or answer in STOPPING)
    # A side read that fails is the stage's error (table 5b, row 5); a closed quiz list is how
    # the course is set up (#436).
    side_error = (
        failed
        and read.kind == "side"
        and not (read.method == "quizzes" and answer in ("closed", "not_found"))
    )
    expected = {read.stage: code} if ended or side_error else {}
    assert _errors(status) == expected

    seen = await _seen(app, api)
    end = STAGES.index(read.stage) if ended else len(STAGES)
    for stage in STAGES[1:]:
        listed_by = CANARY[stage]
        unread = (failed and read.method == listed_by) or listed_by in read.needs
        assert seen.wrote(stage) == (STAGES.index(stage) < end and not unread), stage
    if ended:  # what the round never reached was not read
        assert not any(m in fake.reads for s in STAGES[end + 1 :] for m in [CANARY.get(s)])
    elif read.kind == "item" and failed and answer != "not_found":
        assert ITEM_KEPT[read.method](seen)  # not judged: kept as it was (table 2, rows 6-6b)
    elif read.kind == "nav":
        # The list refused is closed only when the navigation says so (table 2, rows 7-8).
        entry = seen.link.area_reads["pages"]
        assert entry["result"] == ("unavailable" if failed else "hidden")
    elif failed and read.kind == "area" and read.area:
        entry = seen.link.area_reads[read.area]
        hidden = answer in ("closed", "not_found") and read.area != "calendar"
        assert entry["result"] == ("hidden" if hidden else "unavailable")
        if not hidden:
            assert entry["reason"] == code
    # An answer not understood is logged each time (the navigation is read for the round and
    # for the course's overview).
    logged = set(expect_sync_failures.events())
    assert logged == ({"lms.provider_payload"} if answer == "payload" else set())
