"""The materials sync under random steps (M09 §4.2, tables 2, 3c and 4a): the platform deletes
and brings back files, closes and opens its files area, hides single files, throttles reads,
refuses its navigation, stops answering; the user deletes and moves files and switches how the
course keeps them; time passes. The course syncs after each step. Each file is in the files
area, only in a module, or only linked from a page (read on its own). At every step:

- the sync never deletes a file whose copy is kept in Semestra (the user's only copy), and lets
  a copy go only while the platform gives the file;
- a file on the platform is never judged gone, and one the user deleted is not brought back;
- a sync the platform did not answer, or throttled, changes nothing;
- a second sync with nothing changed on the platform writes nothing;

and at the end, once the platform answers and a day has passed, a file deleted on the platform
is no longer followed."""

import itertools
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from sqlalchemy import event, select

from semestra.core.context import system_ctx
from semestra.modules.files.models import FilesItem
from semestra.modules.lms.models import LmsItemCheck, LmsMaterial
from semestra.modules.lms.schemas.dto import (
    FileMeta,
    InternalRef,
    Module,
    ModuleItem,
    NavTab,
    PageSummary,
)
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import setup_program
from semestra.testing import Clock, MakeUser

FILES = ("f1", "f2", "f3")
JAN = datetime(2026, 1, 5, tzinfo=UTC)
PROSE = "<p>" + "Read these before the tutorial and bring your questions. " * 5 + "</p>"
WATCHED = ("lms_materials", "lms_item_checks", "files_items")
_users = itertools.count()
_folders = itertools.count()

Step = tuple[Any, ...]
steps = st.lists(
    st.one_of(
        st.tuples(st.just("delete"), st.sampled_from(FILES)),
        st.tuples(st.just("undelete"), st.sampled_from(FILES)),
        st.tuples(st.just("hide_files"), st.booleans()),
        st.tuples(st.just("refuse"), st.sampled_from(FILES), st.booleans()),
        st.tuples(st.just("down"), st.booleans()),
        st.tuples(st.just("throttle"), st.sampled_from(["navigation", "file", "course_files"])),
        st.tuples(st.just("nav_refused"), st.booleans()),
        st.tuples(st.just("user_delete"), st.sampled_from(FILES)),
        st.tuples(st.just("user_move"), st.sampled_from(FILES)),
        st.tuples(st.just("store"), st.sampled_from(["local", "online"])),
        st.tuples(st.just("later"), st.sampled_from([1, 30])),
    ),
    min_size=1,
    max_size=6,
)


class World:
    """The platform's course 101: each file in the files area, only in a module, or only linked
    from a page."""

    def __init__(self, fake: FakeProvider, where: dict[str, str]) -> None:
        self.fake, self.where = fake, where
        self.deleted: set[str] = set()
        fake.deleted_files, fake.refused_files = set(), set()
        fake.files_hidden = fake.materials_down = fake.nav_refused = False
        fake.throttled = set()
        fake.page_list, fake.page_texts = [], {}
        fake.file_bytes = {f: f"bytes of {f}".encode() for f in FILES}
        self.publish()

    def meta(self, f: str) -> FileMeta:
        return FileMeta(external_id=f, name=f"{f}.zip", size_bytes=10, mime_type="application/zip")

    def publish(self) -> None:
        there = [f for f in FILES if f not in self.deleted]
        self.fake.deleted_files = set(self.deleted)
        self.fake.course_file_list = [self.meta(f) for f in there if self.where[f] == "files"]
        self.fake.unlisted_files = [self.meta(f) for f in there if self.where[f] == "module"]
        items = [
            ModuleItem(external_id=f"i{f}", title=f"{f}.zip", kind="file", position=i,
                       target=InternalRef(kind="file", ref=f))
            for i, f in enumerate(there) if self.where[f] == "module"
        ]  # fmt: skip
        self.fake.module_list = [Module(external_id="m1", name="Week 1", items=items)]
        linked = [f for f in there if self.where[f] == "page"]
        # A page with text of its own, kept as a document whatever it links to.
        body = PROSE + "".join(f'<p><a href="https://fake/courses/101/files/{f}">{f}</a></p>'
                               for f in linked)  # fmt: skip
        changed = JAN + timedelta(minutes=sum(1 << FILES.index(f) for f in linked))
        self.fake.page_list = [
            PageSummary(external_id="p1", ref="reading", title="Reading", updated_at=changed)
        ]
        self.fake.page_texts = {"reading": ("Reading", body)}
        tabs = ["home", "modules", "pages", *([] if self.fake.files_hidden else ["files"])]
        self.fake.nav = [NavTab(external_id=t, kind=t, label=t) for t in tabs]  # type: ignore[arg-type]

    def left(self, f: str) -> bool:
        """Gone from the user's view: deleted, or refused while its area shows (table 2, rows 4
        and 5); a refusal in a closed area tells nothing (row 6)."""
        return f in self.deleted or (f in self.fake.refused_files and not self.fake.files_hidden)

    def gives(self, f: str) -> bool:
        """The platform gives the file's contents now."""
        return f not in self.deleted and f not in self.fake.refused_files

    def apply(self, step: Step, clock: Clock) -> None:
        match step:
            case ("delete", f):
                self.deleted.add(f)
            case ("undelete", f):
                self.deleted.discard(f)
            case ("hide_files", hidden):
                self.fake.files_hidden = hidden
            case ("refuse", f, refused):
                (self.fake.refused_files.add if refused else self.fake.refused_files.discard)(f)
            case ("down", down):
                self.fake.materials_down = down
            case ("throttle", read):
                self.fake.throttled = {read}
            case ("nav_refused", refused):
                self.fake.nav_refused = refused
            case ("user_delete" | "user_move" | "store", _):
                pass  # the user's, done through the API (`act`)
            case ("later", hours):
                clock.advance(hours=hours)
                self.fake.throttled = set()
            case _:
                raise AssertionError(step)
        self.publish()


async def _item_of(app: FastAPI, user_id: str, f: str) -> str | None:
    async with system_ctx(app.state) as ctx:
        return await ctx.db.scalar(
            select(FilesItem.id).where(
                FilesItem.user_id == user_id, FilesItem.source_ref == f"lms:file:{f}"
            )
        )


async def act(api: Api, app: FastAPI, user_id: str, course: str, step: Step) -> str | None:
    """The user's step, through the API; the file they deleted, if any."""
    match step:
        case ("user_delete", f):
            if (item := await _item_of(app, user_id, f)) is not None:
                await api.call("DELETE", f"/files/{item}")
                return f
        case ("user_move", f):
            if (item := await _item_of(app, user_id, f)) is not None:
                folder = await api.call(
                    "POST", f"/courses/{course}/folders", json={"name": f"Mine {next(_folders)}"}
                )
                await api.call(
                    "POST",
                    f"/courses/{course}/files:move",
                    json={"item_ids": [item], "to_folder_id": folder["id"]},
                )
        case ("store", store):
            body = {"scope_type": "course", "scope_id": course, "values": {"store": store}}
            await api.call("PATCH", "/me/settings/lms.materials", json=body)
        case _:
            pass
    return None


async def _snapshot(app: FastAPI, user_id: str) -> tuple[Any, ...]:
    async with system_ctx(app.state) as ctx:
        mats = await ctx.db.execute(
            select(LmsMaterial.kind, LmsMaterial.external_id, LmsMaterial.state,
                   LmsMaterial.item_id).where(LmsMaterial.user_id == user_id)
        )  # fmt: skip
        items = await ctx.db.execute(
            select(FilesItem.id, FilesItem.storage_key, FilesItem.source_ref).where(
                FilesItem.user_id == user_id
            )
        )
        return tuple(sorted(tuple(r) for r in mats)), tuple(
            sorted((tuple(r) for r in items), key=str)
        )


class Writes:
    """Statements that write the materials, their checks or the course files."""

    def __init__(self, app: FastAPI) -> None:
        self.engine = app.state.engine.sync_engine
        self.seen: list[str] = []

    def __call__(self, conn: Any, cursor: Any, statement: str, *args: Any) -> None:
        head = statement.lstrip().split(None, 1)[0].upper()
        if head in ("INSERT", "UPDATE", "DELETE") and any(t in statement for t in WATCHED):
            self.seen.append(statement)

    def __enter__(self) -> Writes:
        event.listen(self.engine, "before_cursor_execute", self)
        return self

    def __exit__(self, *exc: object) -> None:
        event.remove(self.engine, "before_cursor_execute", self)


@settings(
    max_examples=12,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
)
@given(
    where=st.fixed_dictionaries({f: st.sampled_from(["files", "module", "page"]) for f in FILES}),
    store=st.sampled_from(["local", "online"]),
    steps=steps,
)
async def test_material_sync_steps(
    where: dict[str, str],
    store: str,
    steps: list[Step],
    app: FastAPI,
    client: AsyncClient,
    make_user: MakeUser,
    login_as: Callable[[AsyncClient, Any], Awaitable[str]],
    run_jobs: Callable[[], Awaitable[None]],
    clock: Clock,
    fake: FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
):
    from semestra.modules.lms import sync

    monkeypatch.setattr(sync, "COOLDOWN", timedelta(0))
    user = await make_user(email=f"steps{next(_users)}@example.com")
    client.cookies.clear()  # each example signs in as a user of its own
    await login_as(client, user)
    api = Api(client, run_jobs)
    world = World(fake, where)
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    body = {"scope_type": "course", "scope_id": course, "values": {"store": store}}
    await api.call("PATCH", "/me/settings/lms.materials", json=body)
    await api.sync(program_id)

    dismissed: set[str] = set()
    for step in steps:
        world.apply(step, clock)
        start = await _snapshot(app, user.id)
        if (f := await act(api, app, user.id, course, step)) is not None:
            dismissed.add(f)
        await run_jobs()  # what the user's step did by itself (a copy stored at once)
        before = await _snapshot(app, user.id)
        fake.throttle_hits = 0
        await api.sync(program_id)
        after = await _snapshot(app, user.id)
        kept = {i for i, key, _ in after[1]}
        copies = {i for i, key, _ in before[1] if key}
        assert copies <= kept, f"{step}: a kept copy was deleted"
        # Also what the user's step had the sync do (a new storage setting syncs the course).
        now_kept = {i for i, key, _ in after[1] if key}
        for i, key, ref in start[1]:
            if key and i in kept - now_kept and ref and not world.gives(ref.rsplit(":", 1)[-1]):
                raise AssertionError(f"{step}: the copy of {ref} let go, the platform refuses it")
        was = {m[1]: m[2] for m in before[0]}
        for f, state in ((m[1], m[2]) for m in after[0]):
            if not world.left(f) and state == "absent" and was.get(f) != "absent":
                raise AssertionError(f"{step}: {f} is on the platform, judged gone")
            if f in dismissed and state == "synced":
                raise AssertionError(f"{step}: {f} the user deleted was brought back")
        if fake.materials_down or fake.throttle_hits:
            assert after == before, f"{step}: a sync the platform did not answer changed things"
        with Writes(app) as writes:
            await api.sync(program_id)
        assert writes.seen == [], f"{step}: a sync with nothing new wrote {writes.seen}"

    world.apply(("down", False), clock)
    world.apply(("nav_refused", False), clock)
    fake.throttled = set()
    clock.advance(hours=25)
    await api.sync(program_id)
    await api.sync(program_id)
    async with system_ctx(app.state) as ctx:
        states = {
            m.external_id: m.state
            for m in await ctx.db.scalars(select(LmsMaterial).where(LmsMaterial.user_id == user.id))
        }
        checks = list(
            await ctx.db.scalars(select(LmsItemCheck).where(LmsItemCheck.user_id == user.id))
        )
    for f in world.deleted:
        assert states.get(f, "absent") != "synced", f"{f} deleted on the platform, still followed"
    assert all(c.result in ("present", "gone", "unavailable") for c in checks)
