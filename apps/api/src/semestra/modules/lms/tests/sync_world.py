"""A small course and every action the platform or the user can take on it, for the exhaustive
tests of the sync (M09 §11): one assignment, one file, one page, one announcement and one
calendar event; `World.step` takes an action, syncs, and checks what must always hold.

`test_sync_sequences.py` runs every sequence of actions up to a length, `test_sync_walk.py`
longer ones Hypothesis picks, `test_state_cells.py` one flow for each cell of tables 4a and 4b.
"""

from collections import Counter
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import select

from semestra.core.context import system_ctx
from semestra.modules.files.models import FilesItem
from semestra.modules.lms import assignment_refs, materials
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.models import (
    LmsAssignment,
    LmsCalendarEvent,
    LmsCourseLink,
    LmsMaterial,
)
from semestra.modules.lms.schemas.dto import (
    Announcement,
    FileMeta,
    NavTab,
    PageSummary,
)
from semestra.modules.lms.schemas.dto import (
    LmsCalendarEvent as Event,
)
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import setup_program
from semestra.testing import Clock

JAN = datetime(2026, 1, 10, tzinfo=UTC)
LONG = "<p>" + "Read chapter one with care before the lab. " * 12 + "</p>"
SHORT = '<p><a href="https://fake/courses/101/files/f1">One</a></p>'  # only lists: a list page
AREAS = ("assignments", "announcements", "files", "pages")


# --- what each event of tables 4a and 4b met ------------------------------------------------


class Cells(Counter[tuple[str, str, str]]):
    """(table, state, event) each time `materials.enter` or `assignment_refs.enter` looked one
    up in its table."""


class _Recording(dict[Any, Any]):
    def __init__(self, table: str, cells: Cells, source: dict[Any, Any]) -> None:
        super().__init__(source)
        self.table, self.cells = table, cells

    def __contains__(self, key: object) -> bool:
        state, event = key  # type: ignore[misc]
        self.cells[self.table, str(state), str(event)] += 1
        return super().__contains__(key)


@contextmanager
def recording(monkeypatch: pytest.MonkeyPatch) -> Iterator[Cells]:
    cells = Cells()
    monkeypatch.setattr(materials, "NEXT", _Recording("4a", cells, materials.NEXT))
    monkeypatch.setattr(assignment_refs, "NEXT", _Recording("4b", cells, assignment_refs.NEXT))
    yield cells


def allowed(table: str) -> set[tuple[str, str, str]]:
    source = materials.NEXT if table == "4a" else assignment_refs.NEXT
    return {(table, str(state), str(event)) for state, event in source}


# --- the world --------------------------------------------------------------------------------


@dataclass
class World:
    api: Api
    app: FastAPI
    fake: FakeProvider
    clock: Clock
    user_id: str = ""
    program_id: str = ""
    course: str = ""
    session_id: str | None = None  # an import opened, not committed yet
    tick: int = 0
    # Platform toggles.
    closed: bool = False
    refused: bool = False
    items_refused: bool = False
    side_refused: bool = False
    linked: bool = True
    materials_on: bool = True
    done: list[str] = field(default_factory=lambda: [])

    async def setup(self, before: Callable[[World], None] | None = None) -> None:
        """The course on the platform (`before` changes it), linked and synced once."""
        fake = self.fake
        fake.course_assignments["101"] = fake.course_assignments["101"][:1]  # a1, worth points
        fake.course_file_list = [_file("f1", 10)]
        fake.page_list = [_page(0)]
        fake.page_texts = {"notes": ("Notes", LONG)}
        fake.module_list = []
        fake.announcement_list = [_news("Welcome")]
        fake.events = [_lecture(0)]
        if before is not None:
            before(self)
        self.user_id = (await self.api.call("GET", "/account/me"))["id"]
        self.program_id, term_id, _ = await setup_program(self.api)
        self.course = await self.api.course(self.program_id, term_id)
        await self.api.link(self.course, "101")
        await self.sync()

    async def call(self, method: str, path: str, **kw: Any) -> tuple[int, Any]:
        """A user's request: refused (4xx) is an answer, never a server error."""
        r = await self.api.client.request(method, path, **kw)
        assert r.status_code < 500, f"{self.done}: {method} {path} -> {r.status_code} {r.text}"
        return r.status_code, r.json() if r.content else None

    async def status(self) -> dict[str, Any]:
        return (await self.call("GET", f"/programs/{self.program_id}/lms/sync"))[1]

    async def sync(self) -> dict[str, Any]:
        await self.call(
            "POST",
            f"/programs/{self.program_id}/lms/sync",
            json={"force": True, "course_id": self.course},
        )
        await self.api.run_jobs()
        return await self.status()

    async def step(self, action: str) -> None:
        """Takes an action, then a sync with the calendar event changed on the platform, and
        checks what always holds."""
        self.done.append(action)
        await ACTIONS[action](self)
        await self.api.run_jobs()
        self.tick += 1
        self.fake.events = [_lecture(self.tick)]
        self.clock.advance(minutes=5)
        status = await self.sync()
        await self.check(status)

    async def check(self, status: dict[str, Any]) -> None:
        errors = {e["stage"]: e["code"] for e in status["errors"]}
        # The side read is made only once the list came in.
        side = self.side_refused and self.linked and not (self.closed or self.refused)
        expected = {"assignments": "lms.forbidden"} if side else {}
        assert errors == expected, f"{self.done}: {errors}"
        async with system_ctx(self.app.state, self.user_id) as ctx:
            link = await ctx.db.scalar(
                select(LmsCourseLink).where(LmsCourseLink.course_id == self.course)
            )
            if link is None:
                assert not self.linked, self.done
                return
            # The part no action touches came in: the round went through.
            [event] = await ctx.db.scalars(
                select(LmsCalendarEvent).where(LmsCalendarEvent.link_id == link.id)
            )
            assert event.title == f"Lecture {self.tick}", self.done
            mats = list(
                await ctx.db.scalars(select(LmsMaterial).where(LmsMaterial.link_id == link.id))
            )
            assert all(m.state in ("synced", "list", "dismissed", "absent") for m in mats)
            # Both sides agree (M09 §4.6): every followed item is one synced material's.
            items = {
                i.id
                for i in await ctx.db.scalars(
                    select(FilesItem).where(
                        FilesItem.course_id == self.course, FilesItem.source_kind == "lms"
                    )
                )
            }
            followed = {m.item_id for m in mats if m.state == "synced"}
            assert None not in followed, self.done
            assert followed == items, f"{self.done}: {followed} != {items}"
            rows = await ctx.db.scalars(
                select(LmsAssignment).where(LmsAssignment.link_id == link.id)
            )
            assert len({r.external_id for r in rows}) <= 1

    # --- helpers for the actions -------------------------------------------------------------

    def a1(self) -> Any:
        return next((a for a in self.fake.course_assignments["101"] if a.external_id == "a1"), None)

    async def objects(self) -> list[tuple[str, str]]:
        """The Semestra objects of a1: (kind, id)."""
        _, assessments = await self.call("GET", f"/courses/{self.course}/assessments")
        _, tasks = await self.call("GET", f"/programs/{self.program_id}/tasks")
        out = [("assessment", a["id"]) for a in assessments["items"] if a.get("source_ref")]
        out += [("task", t["id"]) for t in tasks["items"] if t.get("source_ref")]
        return out

    async def mirror_id(self) -> str | None:
        async with system_ctx(self.app.state, self.user_id) as ctx:
            return await ctx.db.scalar(
                select(LmsAssignment.id).where(
                    LmsAssignment.course_id == self.course,
                    LmsAssignment.external_id == "a1",
                    LmsAssignment.link_id.is_not(None),
                )
            )

    async def material_items(self) -> list[str]:
        """The course files of the file and the page."""
        _, got = await self.call("GET", f"/courses/{self.course}/files", params={"recursive": True})
        names = ("one", "Notes")
        return [i["id"] for i in got["items"] if i["display_name"].startswith(names)]

    def apply_toggles(self) -> None:
        fake = self.fake
        fake.assignments_hidden = fake.files_hidden = fake.pages_hidden = self.closed
        fake.faults = {}
        nav = [NavTab(external_id="home", kind="home", label="Home")]
        if self.closed:
            fake.faults["announcements"] = lms_error("lms.forbidden")
        if self.refused:  # refused while the navigation shows the areas: not known why
            nav += [NavTab(external_id=a, kind=a, label=a) for a in AREAS]  # type: ignore[arg-type]
            for read in ("assignments", "announcements", "course_files", "pages"):
                fake.faults[read] = lms_error("lms.forbidden")
        fake.nav = nav
        fake.refused_assignments = {"a1"} if self.items_refused else set()
        fake.refused_files = {"f1"} if self.items_refused else set()
        if self.side_refused:
            fake.faults["submissions"] = lms_error("lms.forbidden")


def _file(file_id: str, size: int) -> FileMeta:
    return FileMeta(external_id=file_id, name="one.txt", size_bytes=size, updated_at=JAN)


def _page(tick: int) -> PageSummary:
    return PageSummary(
        external_id="p1", ref="notes", title="Notes", updated_at=JAN + timedelta(days=tick + 1)
    )


def _news(title: str) -> Announcement:
    return Announcement(external_id="n1", external_course_id="101", title=title)


def _lecture(n: int) -> Event:
    return Event(
        external_id="e1",
        external_course_id="101",
        title=f"Lecture {n}",
        start_at=datetime(2026, 2, 2, 15, tzinfo=UTC),
    )


# --- the actions ----------------------------------------------------------------------------

Action = Callable[[World], Awaitable[None]]
ACTIONS: dict[str, Action] = {}


def action(fn: Action) -> Action:
    ACTIONS[fn.__name__] = fn
    return fn


# The platform.


@action
async def assignment_changed(w: World) -> None:
    if (a := w.a1()) is not None:
        labs = w.fake.course_assignments["101"]
        labs[0] = a.model_copy(
            update={"name": f"Lab 1 v{w.tick}", "due_at": a.due_at + timedelta(days=1)}
        )


@action
async def assignment_deleted(w: World) -> None:
    w.fake.course_assignments["101"] = []


@action
async def assignment_back(w: World) -> None:
    if w.a1() is None:
        w.fake.course_assignments["101"] = [FakeProvider().course_assignments["101"][0]]


@action
async def file_changed(w: World) -> None:
    w.fake.course_file_list = [_file("f1", 10 + w.tick) for _ in w.fake.course_file_list]


@action
async def materials_deleted(w: World) -> None:
    """The file and the page deleted on the platform."""
    w.fake.course_file_list = []
    w.fake.deleted_files = {"f1"}
    w.fake.page_list = []


@action
async def materials_back(w: World) -> None:
    w.fake.course_file_list = [_file("f1", 10)]
    w.fake.deleted_files = set()
    w.fake.page_list = [_page(w.tick + 1)]


@action
async def days_passed(w: World) -> None:
    """Long enough that what was read on its own is read again (M09 table 3c)."""
    w.clock.advance(days=2)


@action
async def page_becomes_list(w: World) -> None:
    """The page's text cut to links only (a list page), or back."""
    title, body = w.fake.page_texts["notes"]
    w.fake.page_texts["notes"] = (title, SHORT if body == LONG else LONG)
    if w.fake.page_list:
        w.fake.page_list = [_page(w.tick + 1)]  # edited: a newer version


@action
async def announcement_changed(w: World) -> None:
    w.fake.announcement_list = [_news(f"Welcome v{w.tick}") for _ in w.fake.announcement_list or []]


@action
async def announcement_deleted(w: World) -> None:
    w.fake.announcement_list = []


@action
async def announcement_back(w: World) -> None:
    if not w.fake.announcement_list:
        w.fake.announcement_list = [_news("Welcome")]


@action
async def areas_closed(w: World) -> None:
    w.closed = not w.closed
    w.apply_toggles()


@action
async def lists_refused(w: World) -> None:
    w.refused = not w.refused
    w.apply_toggles()


@action
async def items_refused(w: World) -> None:
    w.items_refused = not w.items_refused
    w.apply_toggles()


@action
async def side_read_refused(w: World) -> None:
    w.side_refused = not w.side_refused
    w.apply_toggles()


# The user.


async def _open(w: World, as_task: bool) -> None:
    code, started = await w.call(
        "POST", f"/courses/{w.course}/lms/imports:assignments", json={"external_ids": ["a1"]}
    )
    if code != 200:
        return
    w.session_id = started["session_id"]
    if as_task:
        _, session = await w.call("GET", f"/imports/{w.session_id}")
        for item in session["items"]:
            if item["type"] == "assessment":
                await w.call(
                    "PATCH", f"/imports/{w.session_id}/items/{item['id']}", json={"type": "task"}
                )


@action
async def import_opened(w: World) -> None:
    await _open(w, as_task=False)


@action
async def import_opened_as_task(w: World) -> None:
    await _open(w, as_task=True)


@action
async def added_to_gradebook(w: World) -> None:
    """ "Add to gradebook" for the assignment imported as a to-do."""
    code, started = await w.call(
        "POST", f"/courses/{w.course}/lms/imports:gradebook", json={"external_ids": ["a1"]}
    )
    if code == 200:
        w.session_id = started["session_id"]


@action
async def import_committed(w: World) -> None:
    if w.session_id is not None:
        await w.call("POST", f"/imports/{w.session_id}:commit", json={})
        w.session_id = None


@action
async def ignored(w: World) -> None:
    if (row := await w.mirror_id()) is not None:
        await w.call(
            "POST", f"/programs/{w.program_id}/lms/sync:dismiss", json={"assignment_ids": [row]}
        )


@action
async def reminded(w: World) -> None:
    if (row := await w.mirror_id()) is not None:
        await w.call(
            "POST",
            f"/programs/{w.program_id}/lms/sync:dismiss",
            json={"assignment_ids": [row], "dismissed": False},
        )


@action
async def object_deleted(w: World) -> None:
    for kind, object_id in await w.objects():
        await w.call("DELETE", f"/{'assessments' if kind == 'assessment' else 'tasks'}/{object_id}")


@action
async def unbound(w: World) -> None:
    for kind, object_id in await w.objects():
        if kind == "assessment":
            await w.call("DELETE", f"/assessments/{object_id}/lms-assignment")


@action
async def bound(w: World) -> None:
    code, made = await w.call(
        "POST", f"/courses/{w.course}/assessments", json={"title": "Lab (mine)", "weight": 5}
    )
    if code == 200:
        await w.call(
            "PUT", f"/assessments/{made['id']}/lms-assignment", json={"assignment_id": "a1"}
        )


async def _resolve(w: World, choice: str) -> None:
    for item in (await w.status())["pending"]:
        if item["kind"] == "removed":
            await w.call("POST", f"/lms/sync/items/{item['id']}:resolve", json={"choice": choice})


@action
async def removed_kept(w: World) -> None:
    await _resolve(w, "keep")


@action
async def removed_deleted(w: World) -> None:
    await _resolve(w, "delete")


@action
async def change_reverted(w: World) -> None:
    for change in (await w.status())["recent"][:1]:
        await w.call("POST", f"/lms/sync/changes/{change['id']}:revert")


@action
async def change_reapplied(w: World) -> None:
    for change in (await w.status())["recent"][:1]:
        await w.call("POST", f"/lms/sync/changes/{change['id']}:reapply")


@action
async def material_items_deleted(w: World) -> None:
    """The user deletes the file's and the page's items in the course files."""
    for item in await w.material_items():
        await w.call("DELETE", f"/files/{item}")


@action
async def file_saved(w: World) -> None:
    await w.call("POST", f"/courses/{w.course}/lms/files/f1:save", json={})


@action
async def material_restored(w: World) -> None:
    for mat in (await w.status())["removed_materials"]:
        await w.call("POST", f"/lms/sync/materials/{mat['id']}:restore")


@action
async def unreadable_removed(w: World) -> None:
    for mat in (await w.status())["unreadable"]:
        await w.call("POST", f"/lms/sync/materials/{mat['id']}:remove")


@action
async def materials_off_and_removed(w: World) -> None:
    body = {"scope_type": "course", "scope_id": w.course, "values": {"sync": False}}
    await w.call("PATCH", "/me/settings/lms.materials", json=body)
    await w.call("POST", "/me/lms/materials:remove", json={"course_id": w.course})
    w.materials_on = False


@action
async def materials_back_on(w: World) -> None:
    body = {"scope_type": "course", "scope_id": w.course, "values": {"sync": True}}
    await w.call("PATCH", "/me/settings/lms.materials", json=body)
    w.materials_on = True


@action
async def unlinked(w: World) -> None:
    await w.call("DELETE", f"/courses/{w.course}/lms-link")
    w.linked = False


@action
async def relinked(w: World) -> None:
    code, _ = await w.call(
        "PUT", f"/courses/{w.course}/lms-link", json={"external_course_id": "101"}
    )
    w.linked = w.linked or code == 200
