"""The materials sync under random steps (M09 §4.2, tables 3c and 4a): the platform deletes and
brings back files, closes and opens its files area, hides single files, stops answering, and
time passes; the course syncs after each step. At every step:

- the sync never deletes a file whose copy is kept in Semestra (the user's only copy);
- a sync the platform did not answer changes nothing;
- a second sync with nothing changed on the platform writes nothing;

and at the end, once the platform answers and a day has passed, a file deleted on the platform
is no longer followed."""

import itertools
from collections.abc import Awaitable, Callable
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
from semestra.modules.lms.schemas.dto import FileMeta, InternalRef, Module, ModuleItem
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import setup_program
from semestra.testing import Clock, MakeUser

FILES = ("f1", "f2", "f3")
WATCHED = ("lms_materials", "lms_item_checks", "files_items")
_users = itertools.count()

Step = tuple[Any, ...]
steps = st.lists(
    st.one_of(
        st.tuples(st.just("delete"), st.sampled_from(FILES)),
        st.tuples(st.just("undelete"), st.sampled_from(FILES)),
        st.tuples(st.just("hide_files"), st.booleans()),
        st.tuples(st.just("refuse"), st.sampled_from(FILES), st.booleans()),
        st.tuples(st.just("down"), st.booleans()),
        st.tuples(st.just("later"), st.sampled_from([1, 30])),
    ),
    min_size=1,
    max_size=6,
)


class World:
    """The platform's course 101: each file in the files area or only in a module."""

    def __init__(self, fake: FakeProvider, where: dict[str, str]) -> None:
        self.fake, self.where = fake, where
        self.deleted: set[str] = set()
        fake.deleted_files, fake.refused_files = set(), set()
        fake.files_hidden = fake.materials_down = False
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
            case ("later", hours):
                clock.advance(hours=hours)
            case _:
                raise AssertionError(step)
        self.publish()


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
    where=st.fixed_dictionaries({f: st.sampled_from(["files", "module"]) for f in FILES}),
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
    from datetime import timedelta

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

    for step in steps:
        world.apply(step, clock)
        before = await _snapshot(app, user.id)
        await api.sync(program_id)
        after = await _snapshot(app, user.id)
        kept = {i for i, key, _ in after[1]}
        copies = {i for i, key, _ in before[1] if key}
        assert copies <= kept, f"{step}: a kept copy was deleted"
        was = {m[1]: m[2] for m in before[0]}
        for f, state in ((m[1], m[2]) for m in after[0]):
            if f not in world.deleted and state == "absent" and was.get(f) != "absent":
                raise AssertionError(f"{step}: {f} is on the platform, judged gone")
        if fake.materials_down:
            assert after == before, f"{step}: a sync the platform did not answer changed things"
        with Writes(app) as writes:
            await api.sync(program_id)
        assert writes.seen == [], f"{step}: a sync with nothing new wrote {writes.seen}"

    world.apply(("down", False), clock)
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
