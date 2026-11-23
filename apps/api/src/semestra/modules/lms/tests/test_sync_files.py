"""The course materials in the sync (M09 §4.2), with the fake provider: files, pages and links
come into the course's files in the folders they are in on the platform without taking storage,
follow the platform, and leave alone what the user moved, renamed or deleted."""

import hashlib
import io
import json
import sqlite3
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import func, select

from semestra.core import jobs
from semestra.core.config import Settings, get_settings
from semestra.core.context import run_as_system
from semestra.core.jobs import BACKGROUND, CoreJob
from semestra.modules.agent import view
from semestra.modules.files import content, pipeline, sources
from semestra.modules.files.models import FilesDocument, FilesDocumentPage, FilesItem
from semestra.modules.files.tests.conftest import FakeAi, make_pdf
from semestra.modules.lms import older_backups, sync_files
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.models import LmsMaterial
from semestra.modules.lms.schemas.dto import (
    FileMeta,
    InternalRef,
    Module,
    ModuleItem,
    PageSummary,
)
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import setup_program
from semestra.testing import API_DIR, Clock

pytestmark = pytest.mark.usefixtures("fake")

JAN, FEB = datetime(2026, 1, 10, tzinfo=UTC), datetime(2026, 2, 10, tzinfo=UTC)
SYLLABUS = "<p>" + "Labs are worth 20% and the midterm 30%. " * 6 + "</p>"


def _file(file_id: str, name: str, folder: str | None = None, **kw: Any) -> FileMeta:
    return FileMeta(
        external_id=file_id, name=name, folder_path=folder, size_bytes=1000, updated_at=JAN,
        web_url=f"https://fake/courses/101/files/{file_id}", **kw,
    )  # fmt: skip


def _materials(fake: FakeProvider) -> None:
    """A course as instructors make them: a module per week with a subheader, files in folders,
    a page that only lists the problem sets, the syllabus as a page, a recording link."""
    fake.module_list = [
        Module(
            external_id="m1",
            name="Week 1",
            items=[
                ModuleItem(external_id="i1", title="Tutorial", kind="subheader", position=1),
                ModuleItem(external_id="i2", title="W1.pdf", kind="file", position=2,
                           target=InternalRef(kind="file", ref="202")),
                ModuleItem(external_id="i3", title="Lecture recording", kind="external_url",
                           position=3, external_url="https://media.example.edu/v/1"),
                ModuleItem(external_id="i4", title="Course syllabus", kind="page", position=4,
                           target=InternalRef(kind="page", ref="syllabus")),
            ],
        )
    ]  # fmt: skip
    fake.course_file_list = [
        _file("201", "Lecture 1.pdf", "Lectures", mime_type="application/pdf"),
        _file("202", "W1.pdf"),
        _file("203", "Midterm 2025.pdf", "Exams"),
        _file("204", "Set 1.pdf"),
        _file("205", "data.zip", "Misc"),
        _file("209", "Lecture 9.pdf", locked=True),  # not open yet
    ]
    fake.page_list = [
        PageSummary(external_id="p1", ref="syllabus", title="Course syllabus", updated_at=JAN),
        PageSummary(external_id="p2", ref="sets", title="Problem sets", updated_at=JAN),
    ]
    fake.page_texts = {
        "syllabus": ("Course syllabus", SYLLABUS),
        "sets": ("Problem sets", '<ul><li><a href="https://fake/courses/101/files/204">Set 1</a>'),
    }


async def _course(api: Api) -> tuple[str, str]:
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    return program_id, course


async def _materials_setting(api: Api, course: str, **values: Any) -> None:
    """The course's own materials settings (M11 namespace `lms.materials`)."""
    body = {"scope_type": "course", "scope_id": course, "values": values}
    await api.call("PATCH", "/me/settings/lms.materials", json=body)


async def _files(api: Api, course: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """(folder by id, item by name) of the whole course."""
    got = await api.call("GET", f"/courses/{course}/files", params={"recursive": True})
    folders = {f["id"]: f for f in got["folders"]}
    return folders, {i["display_name"]: i for i in got["items"]}


def _where(folders: dict[str, Any], item: dict[str, Any]) -> str | None:
    return folders[item["folder_id"]]["name"] if item["folder_id"] else None


async def test_materials_come_into_their_platform_folders(api: Api, fake: FakeProvider):
    _materials(fake)
    program_id, course = await _course(api)
    status = await api.sync(program_id)
    assert status["errors"] == []
    folders, items = await _files(api, course)
    assert {name: _where(folders, item) for name, item in items.items()} == {
        "Lecture 1.pdf": "Lectures",
        "W1.pdf": "Week 1",  # its module, before its folder in the files area
        "Midterm 2025.pdf": "Exams",
        "Set 1.pdf": "Problem sets",  # the page that lists it
        "data.zip": "Misc",
        "Lecture recording": "Week 1",
        "Course syllabus": "Week 1",
    }
    assert items["Lecture recording"]["kind"] == "link"
    assert items["Lecture recording"]["url"] == "https://media.example.edu/v/1"
    # Read from the platform when opened: nothing stored, no storage used.
    lecture = items["Lecture 1.pdf"]
    assert (lecture["kind"], lecture["size_bytes"]) == ("file", 1000)
    assert lecture["url"] == "https://fake/courses/101/files/201"
    r = await api.client.get(f"/files/{lecture['id']}/content")
    assert (r.status_code, r.content) == (200, b"hello")
    page = await api.client.get(f"/files/{items['Course syllabus']['id']}/content")
    assert b"<h1>Course syllabus</h1>" in page.content
    assert 'filename="Course syllabus.html"' in page.headers["content-disposition"]
    assert b"midterm 30%" in page.content
    assert (await api.call("GET", "/files-usage"))["files_bytes"] == 0
    assert items["data.zip"]["doc_status"] == "unsupported"  # never read for its text
    assert (lecture["source_name"], lecture["modified_at"]) == (
        "Fake LMS",
        JAN.isoformat().replace("+00:00", "Z"),
    )
    # What a newly linked course brings in is not news.
    assert not any(item["unseen"] for item in items.values())
    assert (status["materials"], status["removed_materials"]) == ([], [])

    # Nothing changed: nothing new.
    await api.sync(program_id)
    assert len((await _files(api, course))[1]) == len(items)

    # A local copy, in place: the same item, now stored and counted (from the files or from the
    # platform's file, as the Canvas tab saves it); it still follows the platform.
    assert (lecture["stored"], lecture["follows_source"]) == (False, True)
    await api.call("POST", f"/files/{lecture['id']}:keep-copy")
    saved = await api.call("POST", f"/courses/{course}/lms/files/202:save", json={})
    assert (saved["file_item_id"], saved["stored"]) == (items["W1.pdf"]["id"], False)
    await api.run_jobs()
    kept = await api.call("GET", f"/files/{lecture['id']}")
    assert (kept["stored"], kept["follows_source"]) == (True, True)
    assert kept["folder_id"] == lecture["folder_id"]
    assert (await api.call("GET", "/files-usage"))["files_bytes"] == 2 * len(b"hello")
    r = await api.client.get(f"/files/{lecture['id']}/content")
    assert (r.status_code, r.content) == (200, b"hello")
    await api.sync(program_id)
    assert len((await _files(api, course))[1]) == len(items)


async def test_an_archive_of_platform_files_reads_each_once_and_lets_go(
    api: Api, fake: FakeProvider, monkeypatch: pytest.MonkeyPatch
):
    """A zip of files read from the platform (M07 §5): each is downloaded once, and one opened
    for an archive that is never fetched is let go, its connection closed, when it expires."""
    import asyncio

    from semestra.core import http
    from semestra.modules.files import downloads

    clients: list[Any] = []
    make_client = http.safe_client

    def safe_client(*args: Any, **kwargs: Any) -> Any:
        clients.append(make_client(*args, **kwargs))
        return clients[-1]

    monkeypatch.setattr(http, "safe_client", safe_client)

    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    items = (await _files(api, course))[1]
    ids = [items["Lecture 1.pdf"]["id"], items["W1.pdf"]["id"]]

    async def ask() -> str:
        r = await api.call("POST", f"/courses/{course}/files:download", json={"item_ids": ids})
        return r["download_id"]

    fake.downloads_open.clear()
    r = await api.client.get(f"/file-downloads/{await ask()}")
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        assert sorted(zf.namelist()) == ["Lecture 1.pdf", "W1.pdf"]
    assert sorted(fake.downloads_open) == ["201", "202"]
    assert sorted(fake.downloads_closed[-2:]) == ["201", "202"]

    monkeypatch.setattr(downloads, "TTL_SECONDS", 0.01)
    fake.downloads_open.clear()
    fake.downloads_closed.clear()
    clients.clear()
    await ask()
    assert fake.downloads_open == ["201"]  # the first file, opened when asked for
    assert [c.is_closed for c in clients] == [False]
    await asyncio.sleep(0.05)
    assert fake.downloads_closed == ["201"]
    assert [c.is_closed for c in clients] == [True]


async def test_platform_names_and_addresses_files_cannot_take_as_they_are(
    api: Api, fake: FakeProvider, app: FastAPI, clock: Clock
):
    """Titles with slashes and links to addresses the files can't open come in all the same: a
    slash reads as a dash wherever a platform name becomes a name here, and a link opens through
    the platform's own view of it. One sync failing on them would bring in nothing at all."""
    module = "Week 1/2: Intro"
    fake.module_list = [
        Module(
            external_id="m1",
            name=module,
            items=[
                ModuleItem(external_id="i1", title="Zoom / Piazza", kind="external_url",
                           position=1, external_url="https://zoom.example.edu/j/1"),
                ModuleItem(external_id="i2", title="Email the TA", kind="external_url",
                           position=2, external_url="mailto:ta@example.edu",
                           web_url="https://fake/courses/101/modules/items/i2"),
                ModuleItem(external_id="i3", title="Notes", kind="page", position=3,
                           target=InternalRef(kind="page", ref="notes")),
            ],
        )
    ]  # fmt: skip
    fake.course_file_list = [_file("201", "Lecture 1/2 notes.pdf", "Lectures")]
    fake.page_list = [
        PageSummary(external_id="p1", ref="notes", title="Week 1\\2 notes", updated_at=JAN)
    ]
    fake.page_texts = {"notes": ("Week 1\\2 notes", SYLLABUS)}
    program_id, course = await _course(api)
    status = await api.sync(program_id)
    assert status["errors"] == []
    folders, items = await _files(api, course)
    assert {name: _where(folders, item) for name, item in items.items()} == {
        "Zoom - Piazza": "Week 1-2: Intro",
        "Email the TA": "Week 1-2: Intro",
        "Week 1-2 notes": "Week 1-2: Intro",
        "Lecture 1-2 notes.pdf": "Lectures",
    }
    assert items["Email the TA"]["url"] == "https://fake/courses/101/modules/items/i2"

    # Renamed on the platform: followed under the same rule.
    fake.module_list[0].items[0].title = "Zoom / Piazza / Ed"  # type: ignore[index]
    clock.advance(minutes=1)
    assert (await api.sync(program_id))["errors"] == []
    assert (await api.call("GET", f"/files/{items['Zoom - Piazza']['id']}"))[
        "display_name"
    ] == "Zoom - Piazza - Ed"


async def test_a_name_an_older_sync_cut_short_is_mended(
    api: Api, fake: FakeProvider, app: FastAPI, clock: Clock
):
    """Up to 2.4 a file or page title with a slash kept only what followed it ("2 notes.pdf"):
    the next sync names it in full, unless the user renamed it."""
    fake.course_file_list = [
        _file("201", "Lecture 1/2 notes.pdf"),
        _file("202", "Lab 1/2.pdf"),
    ]
    program_id, course = await _course(api)
    await api.sync(program_id)
    items = (await _files(api, course))[1]
    lecture, lab = items["Lecture 1-2 notes.pdf"]["id"], items["Lab 1-2.pdf"]["id"]
    async with app.state.session_factory() as db:  # as 2.4 named them
        for item_id, short in ((lecture, "2 notes.pdf"), (lab, "2.pdf")):
            row = await db.get(FilesItem, item_id)
            assert row is not None
            row.display_name = row.original_name = short
            mat = await db.scalar(select(LmsMaterial).where(LmsMaterial.item_id == item_id))
            assert mat is not None
            mat.name = short
        await db.commit()
    await api.call("PATCH", f"/files/{lab}", json={"display_name": "Lab handout.pdf"})

    clock.advance(minutes=1)
    await api.sync(program_id)
    assert sorted((await _files(api, course))[1]) == ["Lab handout.pdf", "Lecture 1-2 notes.pdf"]


async def test_the_users_changes_win(api: Api, fake: FakeProvider, clock: Clock):
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    folders, items = await _files(api, course)
    lectures = next(f["id"] for f in folders.values() if f["name"] == "Lectures")
    # The user moves a lecture out, renames the tutorial, deletes the midterm, renames a folder.
    await api.call("PATCH", f"/files/{items['Lecture 1.pdf']['id']}", json={"folder_id": None})
    await api.call("PATCH", f"/files/{items['W1.pdf']['id']}", json={"display_name": "Tut 1"})
    await api.call("DELETE", f"/files/{items['Midterm 2025.pdf']['id']}")
    await api.call("PATCH", f"/folders/{lectures}", json={"name": "Slides"})
    # Listed as removed at once, before any sync.
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    [removed] = status["removed_materials"]
    assert (removed["title"], removed["course_id"]) == ("Midterm 2025.pdf", course)
    assert status["removed_count"] == 1

    files = fake.course_file_list
    files[0] = files[0].model_copy(update={"name": "Lecture 1 (v2).pdf", "updated_at": FEB})
    files[1] = files[1].model_copy(update={"name": "W1 (fixed).pdf", "updated_at": FEB,
                                           "size_bytes": 2000})  # fmt: skip
    files.append(_file("206", "Lecture 2.pdf", "Lectures"))
    clock.advance(minutes=1)
    await api.sync(program_id)
    folders, items = await _files(api, course)
    assert "Midterm 2025.pdf" not in items  # deleted: not brought back
    assert _where(folders, items["Lecture 1 (v2).pdf"]) is None  # renamed there, still moved
    assert (items["Tut 1"]["size_bytes"], _where(folders, items["Tut 1"])) == (
        2000,
        "Week 1",
    )  # the user's name kept, the new version taken
    assert _where(folders, items["Lecture 2.pdf"]) == "Slides"  # the renamed folder

    # The user files their lectures in a folder of their own and deletes "Slides": new ones go
    # to the folder above, here the top level (nothing guessed from where they put the others),
    # and it is not made again.
    mine = await api.call("POST", f"/courses/{course}/folders", json={"name": "Mine"})
    await api.call(
        "POST",
        f"/courses/{course}/files:move",
        json={"item_ids": [items["Lecture 2.pdf"]["id"], items["Lecture 1 (v2).pdf"]["id"]],
              "folder_ids": [], "to_folder_id": mine["id"]},
    )  # fmt: skip
    slides = next(f["id"] for f in folders.values() if f["name"] == "Slides")
    await api.call("DELETE", f"/folders/{slides}")
    files.append(_file("207", "Lecture 3.pdf", "Lectures"))
    clock.advance(minutes=1)
    await api.sync(program_id)
    folders, items = await _files(api, course)
    assert _where(folders, items["Lecture 3.pdf"]) is None
    assert "Slides" not in {f["name"] for f in folders.values()}
    assert "Lectures" not in {f["name"] for f in folders.values()}

    # With the course's materials sync off nothing could bring a removed one back: none is
    # listed or restored. Turned on again, what came meanwhile is not told as new.
    await _materials_setting(api, course, sync=False)
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    assert (status["removed_materials"], status["removed_count"]) == ([], 0)
    r = await api.client.post(f"/lms/sync/materials/{removed['id']}:restore")
    assert r.json()["error"]["code"] == "lms.sync_nothing_to_resolve"
    files.append(_file("212", "Lecture 4.pdf"))
    await _materials_setting(api, course, sync=True)
    clock.advance(minutes=1)
    await api.run_jobs()  # turning it on queued the sync
    assert (await _files(api, course))[1]["Lecture 4.pdf"]["unseen"] is False
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    assert "Lecture 4.pdf" not in {m["title"] for m in status["materials"]}

    # Restored: back with the sync queued at once, quietly (the user asked for it).
    status = await api.call("POST", f"/lms/sync/materials/{removed['id']}:restore")
    assert status["removed_materials"] == []
    await api.run_jobs()
    folders, items = await _files(api, course)
    assert items["Midterm 2025.pdf"]["unseen"] is False
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    assert "Midterm 2025.pdf" not in {m["title"] for m in status["materials"]}


async def test_a_restored_page_comes_back_and_one_gone_meanwhile_says_so(
    api: Api, fake: FakeProvider, clock: Clock
):
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    _, items = await _files(api, course)
    await api.call("DELETE", f"/files/{items['Course syllabus']['id']}")
    await api.call("DELETE", f"/files/{items['data.zip']['id']}")
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    removed = {r["title"]: r["id"] for r in status["removed_materials"]}

    # The page has not changed on the platform since it was deleted: restored, it comes back
    # all the same.
    clock.advance(minutes=1)
    await api.call("POST", f"/lms/sync/materials/{removed['Course syllabus']}:restore")
    await api.run_jobs()
    folders, items = await _files(api, course)
    assert _where(folders, items["Course syllabus"]) == "Week 1"

    # Restored after it left the platform: listed as gone, not waiting for good.
    fake.course_file_list = [f for f in fake.course_file_list if f.external_id != "205"]
    clock.advance(minutes=1)
    await api.call("POST", f"/lms/sync/materials/{removed['data.zip']}:restore")
    await api.run_jobs()
    assert "data.zip" not in (await _files(api, course))[1]
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    assert {m["title"]: m["change"] for m in status["materials"]}["data.zip"] == "gone"
    assert status["removed_materials"] == []


async def test_restore_all_and_a_restore_while_the_course_syncs(
    api: Api, fake: FakeProvider, clock: Clock, monkeypatch: pytest.MonkeyPatch
):
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    _, items = await _files(api, course)
    for name in ("Course syllabus", "data.zip", "Lecture 1.pdf"):
        await api.call("DELETE", f"/files/{items[name]['id']}")

    # Everything at once: one sync of the course brings all back.
    clock.advance(minutes=1)
    status = await api.call("POST", f"/programs/{program_id}/lms/sync/materials:restore")
    assert (status["removed_materials"], status["removed_count"]) == ([], 0)
    await api.run_jobs()
    _, items = await _files(api, course)
    assert {"Course syllabus", "data.zip", "Lecture 1.pdf"} <= set(items)

    # Restored while a sync of the course reads it (its own queued sync merged into that one):
    # the course syncs again once that one ends.
    await api.call("DELETE", f"/files/{items['Course syllabus']['id']}")
    [removed] = (await api.call("GET", f"/programs/{program_id}/lms/sync"))["removed_materials"]
    read_pages = fake.pages
    restored_meanwhile = False

    async def pages(*args: Any) -> list[PageSummary]:
        nonlocal restored_meanwhile
        if not restored_meanwhile:
            restored_meanwhile = True
            clock.advance(seconds=1)  # after the run started reading
            await api.call("POST", f"/lms/sync/materials/{removed['id']}:restore")
        return await read_pages(*args)

    monkeypatch.setattr(fake, "pages", pages)
    clock.advance(minutes=1)
    await api.sync(program_id)
    assert restored_meanwhile
    # Back, and as restored: not marked new, nor listed as gone or added.
    assert (await _files(api, course))[1]["Course syllabus"]["unseen"] is False
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    assert "Course syllabus" not in {m["title"] for m in status["materials"]}


async def test_turning_materials_off_and_unlinking(api: Api, fake: FakeProvider, clock: Clock):
    _materials(fake)
    program_id, course = await _course(api)
    # A file saved by hand before the sync brought anything in: once, and kept as a copy.
    saved = await api.call("POST", f"/courses/{course}/lms/files/201:save", json={})
    again = await api.call("POST", f"/courses/{course}/lms/files/201:save", json={})
    assert again["file_item_id"] == saved["file_item_id"]

    await _materials_setting(api, course, sync=False)
    await api.sync(program_id)
    assert list((await _files(api, course))[1]) == ["Lecture 1.pdf"]

    await _materials_setting(api, course, sync=True)
    clock.advance(minutes=1)
    await api.run_jobs()  # turning it on queued the sync
    listed = await api.call("GET", f"/courses/{course}/files", params={"recursive": True})
    names = [i["display_name"] for i in listed["items"]]
    assert names.count("Lecture 1.pdf") == 1  # the saved copy is that file
    assert "W1.pdf" in names

    # Turned off again: what came in stays (no longer following the platform).
    await _materials_setting(api, course, sync=False)
    fake.course_file_list[1] = fake.course_file_list[1].model_copy(update={"name": "W1 v2.pdf"})
    clock.advance(minutes=1)
    await api.sync(program_id)
    assert set((await _files(api, course))[1]) == set(names)

    # Unlinked: what was only read from the platform goes, the saved copy and folders stay; the
    # confirmation says so in numbers.
    state = await api.call("GET", f"/courses/{course}/lms-link")
    assert state["materials"] == {"local": 1, "online": len(names) - 1}
    await api.call("DELETE", f"/courses/{course}/lms-link")
    folders, items = await _files(api, course)
    assert list(items) == ["Lecture 1.pdf"]
    assert "Week 1" in {f["name"] for f in folders.values()}
    # The copy is now a plain file of the user's: nothing left to read it from (a backup
    # without files leaves it out, as any file of theirs).
    kept = items["Lecture 1.pdf"]
    assert (kept["stored"], kept["follows_source"]) == (True, False)
    # Nothing ties it to the platform any more: no source, no platform name or address.
    assert (kept["source_kind"], kept["source_name"], kept["url"]) == (None, None, None)
    # So saving it in Semestra (or not) means nothing for it any more, and is refused before
    # Sem's card would offer it.
    for action in ("keep-copy", "drop-copy"):
        r = await api.client.post(f"/files/{kept['id']}:{action}")
        assert (r.status_code, r.json()["error"]["code"]) == (409, "files.not_from_source")


async def test_removing_what_turning_materials_off_left(api: Api, fake: FakeProvider, clock: Clock):
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    brought = set((await _files(api, course))[1])
    # One the user chose to keep: theirs, neither counted nor removed.
    lecture = (await _files(api, course))[1]["Lecture 1.pdf"]
    await api.call("POST", f"/files/{lecture['id']}:keep-copy")
    await api.run_jobs()
    held = "/me/lms/materials/held"
    # Syncing: nothing is left over, and there is nothing to remove.
    assert await api.call("GET", held) == {"courses": 0, "local": 0, "online": 0}
    r = await api.client.post("/me/lms/materials:remove", json={})
    assert r.json()["error"]["code"] == "lms.sync_nothing_to_resolve"

    # Turned off: what came in stays, counted for the account and for the course.
    await _materials_setting(api, course, sync=False)
    want = {"courses": 1, "local": 0, "online": len(brought) - 1}
    assert await api.call("GET", held) == want
    assert await api.call("GET", held, params={"course_id": course}) == want

    # Removed: gone from the files, and not as the user's deletes (nothing to restore).
    left = await api.call("POST", "/me/lms/materials:remove", json={"course_id": course})
    assert left == {"courses": 0, "local": 0, "online": 0}
    assert set((await _files(api, course))[1]) == {"Lecture 1.pdf"}
    assert (await api.sync(program_id))["removed_count"] == 0

    # Turned on again: they all come back.
    await _materials_setting(api, course, sync=True)
    clock.advance(minutes=1)
    await api.run_jobs()
    assert set((await _files(api, course))[1]) == brought


async def test_turned_off_while_the_platform_is_read(
    api: Api, fake: FakeProvider, clock: Clock, monkeypatch: pytest.MonkeyPatch
):
    """The user turns the sync off and removes what it left while a sync is reading the
    platform: that sync does not bring it all back once it gets the write lock."""
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    assert (await _files(api, course))[1]

    real = sync_files.hold

    async def user_answers_first(ctx: Any, link: Any) -> None:
        if link.course_id == course and not answered:
            answered.append(True)
            await _materials_setting(api, course, sync=False)
            await api.call("POST", "/me/lms/materials:remove", json={"course_id": course})
        await real(ctx, link)

    answered: list[bool] = []
    monkeypatch.setattr(sync_files, "hold", user_answers_first)
    clock.advance(minutes=1)
    status = await api.sync(program_id)
    assert answered
    assert (await _files(api, course))[1] == {}
    assert status["materials"] == []


async def test_following_the_platform(api: Api, fake: FakeProvider, clock: Clock):
    _materials(fake)
    fake.course_file_list[0] = fake.course_file_list[0].model_copy(update={"content_at": JAN})
    program_id, course = await _course(api)
    await api.sync(program_id)
    await api.run_jobs()
    _, items = await _files(api, course)
    lecture = items["Lecture 1.pdf"]
    assert lecture["doc_status"] == "ready"

    files = fake.course_file_list
    # Renamed on the platform (its `updated_at` moves, its bytes don't): renamed, not read again.
    files[0] = files[0].model_copy(update={"name": "Lecture 1 - Intro.pdf", "updated_at": FEB})
    # Gone from the platform: the midterm; and a file only a page links to (the files area
    # hidden in this course's later life).
    del files[2]
    # The page also still links to a file deleted long ago: that says nothing of the rest.
    fake.page_texts["syllabus"] = (
        "Course syllabus",
        SYLLABUS + '<a href="https://fake/courses/101/files/208">Rubric</a>'
        '<a href="https://fake/courses/101/files/207">Old rubric</a>',
    )
    assert fake.page_list is not None
    fake.page_list[0] = fake.page_list[0].model_copy(update={"updated_at": FEB})
    files.append(_file("208", "Rubric.pdf"))
    fake.deleted_files.add("207")
    clock.advance(minutes=1)
    await api.sync(program_id)
    _, items = await _files(api, course)
    assert items["Lecture 1 - Intro.pdf"]["id"] == lecture["id"]
    assert items["Lecture 1 - Intro.pdf"]["doc_status"] == "ready"
    assert "Midterm 2025.pdf" not in items
    assert "Rubric.pdf" in items
    # New, changed and gone show in the panel; the new file is new until opened. A rename is not
    # news.
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    changes = {m["title"]: m for m in status["materials"]}
    assert {t: m["change"] for t, m in changes.items()} == {
        "Midterm 2025.pdf": "gone",
        "Rubric.pdf": "added",
        "Course syllabus": "updated",
    }
    assert changes["Midterm 2025.pdf"]["item_id"] is None
    rubric = items["Rubric.pdf"]
    assert (changes["Rubric.pdf"]["item_id"], changes["Rubric.pdf"]["folder"]) == (
        rubric["id"],
        "Course syllabus",  # the page that links it, in that page's module
    )
    assert (rubric["unseen"], items["Lecture 1 - Intro.pdf"]["unseen"]) == (True, False)
    seen = await api.call("POST", f"/files/{rubric['id']}:seen")
    assert seen["unseen"] is False
    # Sem reads the same news among the course's activity, with the course file to read, also
    # while the platform can't be reached.

    async def unreachable(*_: Any, **__: Any) -> Any:
        raise lms_error("lms.unreachable")

    assignments, fake.assignments = fake.assignments, unreachable  # type: ignore[method-assign]
    params = {"course_id": course, "since": "2026-01-01T00:00:00", "refresh": True}
    activity = await api.call("GET", "/me/lms/activity", params=params)
    news = {i["title"]: i for i in activity["items"] if i["kind"] == "material"}
    assert {t: (i["change"], i["item_id"], i["ref"]) for t, i in news.items()} == {
        "Midterm 2025.pdf": ("gone", None, None),
        "Rubric.pdf": ("added", rubric["id"], "file:208"),
        "Course syllabus": ("updated", items["Course syllabus"]["id"], "page:syllabus"),
    }
    assert [s["reason"] for s in activity["skipped"]] == ["lms.unreachable"]
    fake.assignments = assignments  # type: ignore[method-assign]

    # Back on the platform: back in the files.
    files.append(_file("203", "Midterm 2025.pdf", "Exams"))
    clock.advance(minutes=1)
    await api.sync(program_id)
    assert "Midterm 2025.pdf" in (await _files(api, course))[1]

    # An area that could not be read: nothing is taken for gone.
    fake.files_hidden = True
    clock.advance(minutes=1)
    status = await api.sync(program_id)
    assert status["errors"] == []
    assert "data.zip" in (await _files(api, course))[1]


async def test_a_hidden_area_still_tells_what_left(api: Api, fake: FakeProvider, clock: Clock):
    """A course that hides its pages or its files (common on the platform) still notices what
    left: each item missing from the run is read on its own, and only one the platform says it
    no longer has is gone."""
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)

    # The pages hidden, the files area shown: the files list alone tells the midterm left.
    fake.pages_hidden = True
    del fake.course_file_list[2]
    fake.deleted_files.add("203")
    clock.advance(minutes=1)
    await api.sync(program_id)
    _, items = await _files(api, course)
    assert "Midterm 2025.pdf" not in items
    assert "Course syllabus" in items  # still there, only its list is hidden

    # The files area hidden too: the archive left the platform; the data file is only hidden.
    fake.files_hidden = True
    fake.deleted_files.add("205")
    clock.advance(minutes=1)
    await api.sync(program_id)
    _, items = await _files(api, course)
    assert "data.zip" not in items
    assert "Lecture 1.pdf" in items
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    gone = {m["title"] for m in status["materials"] if m["change"] == "gone"}
    assert gone == {"Midterm 2025.pdf", "data.zip"}

    # Read on its own once, an item is not read again every run.
    fake.calls.clear()
    clock.advance(hours=1)
    await api.sync(program_id)
    assert ("file", "201") not in fake.calls


async def test_an_item_deleted_where_its_area_is_hidden_is_handed_over(
    api: Api, fake: FakeProvider, clock: Clock
):
    """Read on its own and not on the platform any more while its area is closed (table 3c,
    row 10): gone like one missing from an area read whole, so a saved copy is handed over, not
    dropped with the storage setting. (A refusal there can't be told apart from the area's, so
    it judges nothing: table 2, row 6.)"""
    _materials(fake)
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    await api.run_jobs()

    fake.files_hidden = True
    fake.deleted_files.add("201")
    await _materials_setting(api, course, store="online")
    clock.advance(minutes=1)
    await api.sync(program_id)
    await api.run_jobs()
    _, items = await _files(api, course)
    assert items["Lecture 1.pdf"]["stored"]
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    assert "Lecture 1.pdf" in {
        m["title"] for m in status["materials"] if m["change"] == "handed_over"
    }


async def test_a_large_course_comes_in_whole_in_one_run(
    api: Api, fake: FakeProvider, monkeypatch: pytest.MonkeyPatch, clock: Clock
):
    """More new items than one transaction writes come in together, a batch at a time, and
    the course settles: what the platform adds later is news."""
    monkeypatch.setattr(sync_files, "BATCH", 3)
    fake.module_list = []
    fake.page_list = []
    fake.course_file_list = [_file(str(300 + n), f"Notes {n}.pdf") for n in range(8)]
    program_id, course = await _course(api)
    await api.sync(program_id)
    _, items = await _files(api, course)
    assert len([n for n in items if n.startswith("Notes ")]) == 8
    assert all(not item["unseen"] for item in items.values())

    fake.course_file_list.append(_file("399", "Notes 99.pdf"))
    clock.advance(minutes=1)
    await api.sync(program_id)
    assert (await _files(api, course))[1]["Notes 99.pdf"]["unseen"] is True


async def test_a_file_kept_here_is_downloaded_once(api: Api, fake: FakeProvider):
    """A file the course keeps a local copy of is downloaded for the copy, and its text read
    from that copy: not downloaded a second time to be read."""
    _materials(fake)
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    await api.run_jobs()
    _, items = await _files(api, course)
    assert items["Lecture 1.pdf"]["stored"] is True
    assert fake.downloads_open.count("201") == 1


async def test_a_copy_the_platform_refuses_is_not_asked_for_every_run(
    api: Api, fake: FakeProvider, app: FastAPI, clock: Clock
):
    _materials(fake)
    program_id, course = await _course(api)
    original = fake.open_file

    async def refused(io: Any, cfg: Any, creds: Any, course_id: str, file: FileMeta) -> Any:
        if file.external_id == "201":
            raise lms_error("lms.forbidden")
        async for chunk in original(io, cfg, creds, course_id, file):
            yield chunk

    fake.open_file = refused  # type: ignore[method-assign]
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    _, items = await _files(api, course)
    assert items["Lecture 1.pdf"]["local_copy"]["error_code"] == "lms.forbidden"
    clock.advance(minutes=10)
    await api.call("POST", f"/programs/{program_id}/lms/sync", json={"force": True})
    assert await app.state.jobs.run_one(BACKGROUND) is True  # the sync
    assert await _pending(app, "files.store_synced_copies") == 0


async def test_the_canvas_tab_opens_a_file_from_the_course_files(api: Api, fake: FakeProvider):
    """A file the course files keep a copy of and have read opens, previews and checks there,
    without asking the platform again."""
    _materials(fake)
    fake.course_file_list[1] = fake.course_file_list[1].model_copy(
        update={"name": "W1.txt", "mime_type": "text/plain", "size_bytes": 11}
    )
    fake.file_bytes["202"] = b"week 1 plan"
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    await api.run_jobs()
    assert (await _files(api, course))[1]["W1.txt"]["stored"] is True
    fake.calls.clear()
    downloads = len(fake.downloads_open)

    base = f"/courses/{course}/lms/files/202"
    preview = await api.call("GET", f"{base}/preview")
    assert (preview["kind"], preview["pages"]) == ("text", ["week 1 plan"])
    got = await api.client.get(f"{base}/content")
    assert (got.status_code, got.content) == (200, b"week 1 plan")
    assert (await api.client.get(f"{base}/content", params={"check": True})).status_code == 204
    assert (fake.calls, len(fake.downloads_open)) == ([], downloads)


async def test_a_file_the_user_had_put_there_is_pointed_out(api: Api, fake: FakeProvider):
    _materials(fake)
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    # Uploaded by hand before the course was linked: same name, same size as the platform's.
    upload = ("lecture 1.pdf", b"x" * 1000, "application/pdf")
    await api.call("POST", f"/courses/{course}/files", files={"files": upload})
    await api.link(course, "101")
    await api.sync(program_id)
    # Both stay (nothing of the user's is touched); the panel says which one is like theirs,
    # even on the first sync, whose new materials are otherwise not news.
    _, items = await _files(api, course)
    assert {"lecture 1.pdf", "Lecture 1.pdf"} <= set(items)
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    assert [(m["title"], m["change"]) for m in status["materials"]] == [
        ("Lecture 1.pdf", "duplicate")
    ]


async def test_stored_here_and_read_again(api: Api, fake: FakeProvider, clock: Clock):
    _materials(fake)
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    await api.run_jobs()
    _, items = await _files(api, course)
    stored = {name for name, item in items.items() if item.get("stored")}
    assert {"Lecture 1.pdf", "Course syllabus"} <= stored
    assert (await api.call("GET", "/files-usage"))["files_bytes"] > 0

    # Read online again: the copies go at once. A file the platform failed to give is read
    # again by a later sync.
    await _materials_setting(api, course, store="online")
    await api.run_jobs()
    assert (await api.call("GET", "/files-usage"))["files_bytes"] == 0
    fake.course_file_list.append(_file("210", "Lecture 10.pdf", mime_type="application/pdf"))
    fake.fail_downloads = True
    clock.advance(minutes=1)
    await api.sync(program_id)
    await api.run_jobs()
    new = (await _files(api, course))[1]["Lecture 10.pdf"]
    assert (new["doc_status"], new["doc_error_code"]) == ("failed", "lms.unreachable")
    fake.fail_downloads = False
    clock.advance(hours=2)
    await api.sync(program_id)
    await api.run_jobs()
    assert (await _files(api, course))[1]["Lecture 10.pdf"]["doc_status"] == "ready"


async def test_copies_stay_while_the_course_cannot_be_read_whole(
    api: Api, fake: FakeProvider, clock: Clock, settings: Settings
):
    _materials(fake)
    fake.course_file_list.append(
        _file("206", "Huge recording.pdf").model_copy(update={"size_bytes": 10**8})
    )
    settings.files_max_upload_bytes = 10**7
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    await api.run_jobs()
    _, items = await _files(api, course)
    assert items["Lecture 1.pdf"]["stored"] is True
    assert items["Huge recording.pdf"]["local_copy"]["state"] == "failed"

    # Read from the platform again while the course is closed there: the copies may be the only
    # ones left, so they stay until a run finds the files on the platform again.
    fake.closed = True
    await _materials_setting(api, course, store="online")
    await api.run_jobs()
    _, items = await _files(api, course)
    assert items["Lecture 1.pdf"]["stored"] is True
    # No copy is wanted any more, so none failed.
    assert items["Huge recording.pdf"]["local_copy"]["state"] == "online"
    fake.closed = False
    clock.advance(hours=2)
    await api.sync(program_id)
    await api.run_jobs()
    assert (await _files(api, course))[1]["Lecture 1.pdf"]["stored"] is False


async def test_a_local_copy_the_user_asks_for(api: Api, fake: FakeProvider, settings: Settings):
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    lecture = (await _files(api, course))[1]["Lecture 1.pdf"]  # 1000 bytes on the platform

    # What can be told at once is refused at once.
    settings.files_max_upload_bytes = 999
    r = await api.client.post(f"/files/{lecture['id']}:keep-copy")
    assert (r.status_code, r.json()["error"]["code"]) == (413, "files.too_large")
    settings.files_max_upload_bytes = 10_000_000
    settings.user_storage_quota_bytes = 999
    r = await api.client.post(f"/files/{lecture['id']}:keep-copy")
    assert (r.status_code, r.json()["error"]["code"]) == (413, "common.quota_exceeded")
    settings.user_storage_quota_bytes = 0

    # A failure while storing fails the job the user sees; asking twice queues one job.
    fake.fail_downloads = True
    await api.call("POST", f"/files/{lecture['id']}:keep-copy")
    await api.call("POST", f"/files/{lecture['id']}:keep-copy")
    await api.run_jobs()
    jobs = [j for j in (await api.call("GET", "/jobs"))["items"] if j["kind"] == "files.store_copy"]
    assert [(j["status"], j["error_code"]) for j in jobs] == [("failed", "lms.unreachable")]
    after = await api.call("GET", f"/files/{lecture['id']}")
    assert (after["stored"], after["follows_source"]) == (False, True)
    fake.fail_downloads = False
    await api.call("POST", f"/files/{lecture['id']}:keep-copy")
    await api.run_jobs()
    after = await api.call("GET", f"/files/{lecture['id']}")
    assert (after["stored"], after["follows_source"]) == (True, True)

    # Not let go while the platform can't give the file: the copy may be the only one left.
    fake.fail_downloads = True
    r = await api.client.post(f"/files/{lecture['id']}:drop-copy")
    assert (r.status_code, r.json()["error"]["code"]) == (409, "files.source_unreachable")
    assert (await api.call("GET", f"/files/{lecture['id']}"))["stored"] is True
    fake.fail_downloads = False

    # Removed: read online again, its storage freed, and the course's setting does not store it
    # again.
    await _materials_setting(api, course, store="local")
    await api.call("POST", f"/files/{lecture['id']}:drop-copy")
    await api.sync(program_id)
    await api.run_jobs()
    assert (await api.call("GET", f"/files/{lecture['id']}"))["stored"] is False


def test_migration_dismisses_materials_whose_file_was_made_the_users_own(tmp_path: Path):
    """A file made the user's own in 2.1.0 (no `source_ref`) is theirs: its material is
    `dismissed`, so the platform's is not brought in beside it and it can be restored."""
    path = tmp_path / "m.db"
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.attributes["database_url"] = f"sqlite+aiosqlite:///{path}"
    command.upgrade(cfg, "0062")
    db = sqlite3.connect(path)  # foreign keys are off: no user, course or link rows needed
    for iid, ref in (("own", None), ("followed", "lms:file:2")):
        db.execute(
            "INSERT INTO files_items (id, user_id, course_id, kind, display_name, mime_type,"
            " size_bytes, storage_key, source_ref, pinned, unseen, doc_status, created_at,"
            " updated_at) VALUES (?, 'u1', 'c1', 'file', ?, 'application/pdf', 5, 'k', ?, 0, 0,"
            " 'none', '2026-01-10 00:00:00', '2026-01-12 00:00:00')",
            (iid, iid, ref),
        )
        db.execute(
            "INSERT INTO lms_materials (id, user_id, link_id, kind, external_id, state, quiet,"
            " item_id, links) VALUES (?, 'u1', 'l1', 'file', ?, 'synced', 0, ?, '[]')",
            (f"m-{iid}", iid, iid),
        )
    db.commit()
    db.close()
    command.upgrade(cfg, "0063")
    db = sqlite3.connect(path)
    got = db.execute(
        "SELECT id, state, item_id, state_at FROM lms_materials ORDER BY id"
    ).fetchall()
    db.close()
    assert got == [
        ("m-followed", "synced", "followed", None),
        ("m-own", "dismissed", None, "2026-01-12 00:00:00"),
    ]


def test_migration_makes_files_saved_in_2_0_materials_or_the_users_own(tmp_path: Path):
    """2.0's Canvas tab saved files with a `source_ref` of its own and no material: on the
    course still linked through the same connection the file becomes its material's item (as
    if saved now), unless the material has one already; elsewhere it is the user's own."""
    path = tmp_path / "m.db"
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.attributes["database_url"] = f"sqlite+aiosqlite:///{path}"
    command.upgrade(cfg, "0065")
    db = sqlite3.connect(path)  # foreign keys are off: no user, course or connection rows needed
    db.execute(
        "INSERT INTO lms_course_links (id, user_id, course_id, program_id, connection_id,"
        " external_course_id, sync_enabled, created_at, updated_at) VALUES ('l1', 'u1', 'c1',"
        " 'p1', 'k1', '101', 1, '2026-01-10 00:00:00', '2026-01-10 00:00:00')"
    )
    db.execute(
        "INSERT INTO lms_materials (id, user_id, link_id, kind, external_id, state, quiet,"
        " links, version, name) VALUES ('m-202', 'u1', 'l1', 'file', '202', 'dismissed', 0,"
        " '[]', 'v1', 'W1.pdf')"
    )
    rows = [  # as migrations 0057 and 0062 left them: the copy's hash in both versions
        ("1", "c1", "lms:canvas:k1:file:201", "2026-01-10"),  # linked: followed
        ("2", "c1", "lms:canvas:k1:file:201", "2026-01-11"),  # saved again: the user's
        ("3", "c1", "lms:canvas:k1:file:202", "2026-01-10"),  # its material deleted: followed
        ("4", "c1", "lms:canvas:k9:file:203", "2026-01-10"),  # another connection's
        ("5", "c2", "lms:canvas:k1:file:204", "2026-01-10"),  # course unlinked since
    ]
    for iid, course, ref, day in rows:
        db.execute(
            "INSERT INTO files_items (id, user_id, course_id, kind, display_name, mime_type,"
            " size_bytes, storage_key, source_kind, source_ref, source_version, copy_version,"
            " source_mime, source_size, pinned, unseen, doc_status, created_at, updated_at)"
            " VALUES (?, 'u1', ?, 'file', ?, 'application/pdf', 5, 'k', 'lms', ?, ?, ?,"
            " 'application/pdf', 5, 0, 0, 'ready', ?, ?)",
            (iid, course, f"f{iid}.pdf", ref, f"h{iid}", f"h{iid}", day, day),
        )
    db.commit()
    db.close()
    command.upgrade(cfg, "0066")
    db = sqlite3.connect(path)
    items = db.execute(
        "SELECT id, source_ref, source_name, keep_copy, sha256, source_version, copy_version"
        " FROM files_items ORDER BY id"
    ).fetchall()
    materials = db.execute(
        "SELECT link_id, external_id, state, item_id, name, version, state_at IS NOT NULL"
        " FROM lms_materials ORDER BY external_id"
    ).fetchall()
    db.close()
    assert items == [
        ("1", "lms:file:201", "Canvas", 1, None, "h1", "h1"),
        ("2", None, None, None, "h2", None, None),
        ("3", "lms:file:202", "Canvas", 1, None, "h3", "h3"),
        ("4", None, None, None, "h4", None, None),
        ("5", None, None, None, "h5", None, None),
    ]
    assert materials == [  # read whole at the next sync (no version yet)
        ("l1", "201", "synced", "1", "f1.pdf", None, 1),
        ("l1", "202", "synced", "3", "f3.pdf", None, 1),
    ]


async def test_a_renamed_item_keeps_its_name_and_a_locked_one_stays(
    api: Api, fake: FakeProvider, clock: Clock
):
    _materials(fake)
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    await api.run_jobs()
    _, items = await _files(api, course)
    lecture = items["Lecture 1.pdf"]
    await api.call("PATCH", f"/files/{lecture['id']}", json={"display_name": "Week 1 slides"})

    # A sync with nothing new, then new contents: the user's name stays all along.
    clock.advance(minutes=1)
    await api.sync(program_id)
    files = fake.course_file_list
    files[0] = files[0].model_copy(update={"name": "Lecture 1 v2.pdf", "updated_at": FEB})
    clock.advance(minutes=1)
    await api.sync(program_id)
    after = await api.call("GET", f"/files/{lecture['id']}")
    assert after["display_name"] == "Week 1 slides"
    assert after["modified_at"] == FEB.isoformat().replace("+00:00", "Z")

    # Locked on the platform, then open again: still there and still followed throughout.
    files[1] = files[1].model_copy(update={"locked": True})
    clock.advance(minutes=1)
    await api.sync(program_id)
    w1 = (await _files(api, course))[1]["W1.pdf"]
    assert (w1["id"], w1["follows_source"]) == (items["W1.pdf"]["id"], True)
    files[1] = files[1].model_copy(update={"locked": False, "updated_at": FEB})
    clock.advance(minutes=1)
    await api.sync(program_id)
    w1 = await api.call("GET", f"/files/{items['W1.pdf']['id']}")
    assert (w1["follows_source"], w1["modified_at"]) == (True, after["modified_at"])


async def test_stored_here_still_follows_the_platform(
    api: Api, fake: FakeProvider, settings: Settings, clock: Clock
):
    _materials(fake)
    fake.course_file_list[0] = fake.course_file_list[0].model_copy(update={"content_at": JAN})
    fake.course_file_list.append(
        _file("206", "Huge recording.pdf").model_copy(update={"size_bytes": 10**8})
    )
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    settings.files_max_upload_bytes = 10**7
    await api.sync(program_id)
    await api.run_jobs()
    _, items = await _files(api, course)
    # Too large to store: left read from the platform, saying why; the rest stored all the same.
    assert items["Huge recording.pdf"]["stored"] is False
    assert items["Huge recording.pdf"]["local_copy"] == {
        "state": "failed", "error_code": "files.too_large", "saved_version_at": None,
    }  # fmt: skip
    lecture, midterm = items["Lecture 1.pdf"], items["Midterm 2025.pdf"]
    assert (lecture["stored"], lecture["follows_source"]) == (True, True)
    assert lecture["local_copy"]["state"] == "saved"
    # The user's choice for one file wins over the course's: read online.
    await api.call("POST", f"/files/{items['W1.pdf']['id']}:drop-copy")

    # New bytes on the platform: the stored copy follows; gone from the platform with a local
    # copy: the user's own file now, still where it was.
    files = fake.course_file_list
    files[0] = files[0].model_copy(update={"content_at": FEB, "size_bytes": 2000})
    files[:] = [f for f in files if f.external_id not in ("203", "204")]
    fake.page_texts["sets"] = ("Problem sets", "<ul><li>None this term</li></ul>")
    assert fake.page_list is not None
    fake.page_list[1] = fake.page_list[1].model_copy(update={"updated_at": FEB})
    clock.advance(minutes=1)
    await api.sync(program_id)
    await api.run_jobs()
    _, items = await _files(api, course)
    assert (items["Lecture 1.pdf"]["stored"], items["Lecture 1.pdf"]["size_bytes"]) == (True, 5)
    assert items["Lecture 1.pdf"]["modified_at"] != lecture["modified_at"]
    assert items["W1.pdf"]["stored"] is False
    for name in ("Midterm 2025.pdf", "Set 1.pdf"):
        assert (items[name]["stored"], items[name]["follows_source"]) == (True, False)
    assert items["Midterm 2025.pdf"]["folder_id"] == midterm["folder_id"]
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    handed = {m["title"]: m for m in status["materials"] if m["change"] == "handed_over"}
    assert set(handed) == {"Midterm 2025.pdf", "Set 1.pdf"}
    assert handed["Midterm 2025.pdf"]["item_id"] == midterm["id"]

    # Back on the platform (published again): it comes in beside the user's own, told as a
    # likely duplicate so they can keep just one.
    files.append(_file("203", "Midterm 2025.pdf", "Exams").model_copy(update={"size_bytes": 5}))
    clock.advance(minutes=1)
    await api.sync(program_id)
    got = await api.call("GET", f"/courses/{course}/files", params={"recursive": True})
    midterms = [i for i in got["items"] if i["display_name"].startswith("Midterm 2025")]
    assert sorted(i["follows_source"] for i in midterms) == [False, True]
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    assert {m["title"]: m["change"] for m in status["materials"]}["Midterm 2025.pdf"] == (
        "duplicate"
    )

    # A full quota: nothing more is downloaded to be stored.
    async def storing_jobs() -> int:
        got = await api.call("GET", "/jobs", params={"kind": "files.store_synced_copies"})
        return len(got["items"])

    settings.user_storage_quota_bytes = 1
    files.append(_file("211", "Lecture 11.pdf"))
    before = await storing_jobs()
    clock.advance(minutes=1)
    await api.sync(program_id)
    await api.run_jobs()
    eleven = (await _files(api, course))[1]["Lecture 11.pdf"]
    assert eleven["stored"] is False
    assert eleven["local_copy"]["state"] == "failed"
    assert eleven["local_copy"]["error_code"] == "common.quota_exceeded"
    assert await storing_jobs() == before

    # The course's setting changed again: the choices made for single files are cleared, and
    # every file follows it (owner 2026-11-19), the one read online included.
    settings.user_storage_quota_bytes = 10**9
    await _materials_setting(api, course, store="online")
    await _materials_setting(api, course, store="local")
    await api.run_jobs()
    w1 = (await _files(api, course))[1]["W1.pdf"]
    assert (w1["stored"], w1["local_copy"]["state"]) == (True, "saved")


async def test_a_local_copy_outlasts_a_new_version_it_could_not_get(
    api: Api, fake: FakeProvider, clock: Clock
):
    """The local copy is read until the new version's bytes replace it; one the platform then
    deletes is still the user's."""
    _materials(fake)
    fake.file_bytes["201"] = make_pdf(["Lecture 1"])
    fake.course_file_list[0] = fake.course_file_list[0].model_copy(update={"content_at": JAN})
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    await api.run_jobs()
    lecture = (await _files(api, course))[1]["Lecture 1.pdf"]
    assert lecture["stored"] is True
    old = (await api.client.get(f"/files/{lecture['id']}/content")).content

    files = fake.course_file_list
    files[0] = files[0].model_copy(
        update={"content_at": FEB, "size_bytes": 2000, "mime_type": "text/plain"}
    )
    fake.fail_downloads = True
    clock.advance(minutes=1)
    await api.sync(program_id)
    await api.run_jobs()
    after = await api.call("GET", f"/files/{lecture['id']}")
    assert (after["stored"], after["size_bytes"], after["mime_type"]) == (
        True,
        lecture["size_bytes"],
        "application/pdf",
    )  # the copy's, not the new version's
    # Told as older than the platform's, with why the new one is not here, and its own time.
    assert after["local_copy"]["state"] == "outdated"
    assert after["local_copy"]["error_code"] is not None
    assert after["modified_at"] == after["local_copy"]["saved_version_at"] == lecture["modified_at"]
    assert (await api.client.get(f"/files/{lecture['id']}/content")).content == old

    files[:] = [f for f in files if f.external_id != "201"]
    clock.advance(minutes=1)
    await api.sync(program_id)
    kept = (await _files(api, course))[1]["Lecture 1.pdf"]
    assert (kept["stored"], kept["follows_source"], kept["sha256"]) == (
        True,
        False,
        lecture["sha256"],
    )
    assert (await api.client.get(f"/files/{lecture['id']}/content")).content == old


async def test_a_new_version_needs_room_only_for_what_it_adds(
    api: Api, fake: FakeProvider, app: FastAPI, settings: Settings, clock: Clock
):
    """With the quota full, a new version no larger than the copy still replaces it; and a copy
    stored before copies kept their hash gets one when it becomes the user's own file."""
    fake.course_file_list = [
        _file("201", "Lecture 1.pdf", content_at=JAN).model_copy(update={"size_bytes": 5})
    ]
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    await api.run_jobs()
    lecture = (await _files(api, course))[1]["Lecture 1.pdf"]
    assert lecture["local_copy"]["state"] == "saved"
    settings.user_storage_quota_bytes = (await api.call("GET", "/files-usage"))["used_bytes"]

    fake.course_file_list[0] = fake.course_file_list[0].model_copy(update={"content_at": FEB})
    clock.advance(minutes=1)
    await api.sync(program_id)
    await api.run_jobs()
    newer = await api.call("GET", f"/files/{lecture['id']}")
    assert newer["local_copy"]["state"] == "saved"
    assert newer["modified_at"] != lecture["modified_at"]

    async with app.state.session_factory() as db:  # as migration 0062 leaves an older copy
        row = await db.get(FilesItem, lecture["id"])
        assert row is not None
        row.sha256 = None
        await db.commit()
    fake.course_file_list = []
    clock.advance(minutes=1)
    await api.sync(program_id)
    own = await api.call("GET", f"/files/{lecture['id']}")
    assert (own["follows_source"], own["local_copy"]) == (False, None)
    assert (
        own["sha256"]
        == hashlib.sha256(
            (await api.client.get(f"/files/{lecture['id']}/content")).content
        ).hexdigest()
    )


async def test_a_new_version_of_another_type_replaces_the_copy(
    api: Api, fake: FakeProvider, clock: Clock
):
    """The new bytes bring the new version's type with them, stored or read online again."""
    _materials(fake)
    for n in ("201", "203"):
        fake.file_bytes[n] = make_pdf([n])
    fake.course_file_list[0] = fake.course_file_list[0].model_copy(update={"content_at": JAN})
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    await api.run_jobs()
    lecture = (await _files(api, course))[1]["Lecture 1.pdf"]
    midterm = (await _files(api, course))[1]["Midterm 2025.pdf"]

    files = fake.course_file_list
    for i, n in ((0, "201"), (2, "203")):
        files[i] = files[i].model_copy(update={"content_at": FEB, "mime_type": "text/plain"})
        fake.file_bytes[n] = b"notes in plain text"
    fake.fail_downloads = True
    clock.advance(minutes=1)
    await api.sync(program_id)
    await api.run_jobs()
    fake.fail_downloads = False
    await api.call("POST", f"/files/{midterm['id']}:drop-copy")  # read online: the new one
    clock.advance(minutes=1)
    await api.sync(program_id)
    await api.run_jobs()
    for item, stored in ((lecture, True), (midterm, False)):
        got = await api.call("GET", f"/files/{item['id']}")
        assert (got["stored"], got["mime_type"]) == (stored, "text/plain")


async def test_a_backup_without_files(api: Api, fake: FakeProvider, app: FastAPI):
    _materials(fake)
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    await api.run_jobs()
    midterm = (await _files(api, course))[1]["Midterm 2025.pdf"]
    await api.call("POST", f"/files/{midterm['id']}:keep-copy")  # the user's choice

    started = await api.call("POST", "/me/exports", json={"include_files": False})
    await api.run_jobs()
    archive = (await api.client.get(f"/me/exports/{started['id']}/download")).content
    uploaded = await api.client.post(
        "/me/imports", files={"file": ("backup.zip", archive, "application/zip")}
    )
    body = {"mode": "replace", "confirmation": "Replace my data"}
    await api.call("POST", f"/me/imports/{uploaded.json()['id']}:start", json=body)
    await api.run_jobs()

    async with app.state.session_factory() as db:
        rows = {r.display_name: r for r in (await db.scalars(select(FilesItem))).all()}
    # Without their bytes, the copies are read (and stored) again once the platform answers;
    # the user's choice for the midterm comes along.
    lecture = rows["Lecture 1.pdf"]
    assert (lecture.storage_key, lecture.keep_copy) == (None, None)
    assert lecture.doc_error_code == "files.source_unread"
    midterm_row = rows["Midterm 2025.pdf"]
    assert (midterm_row.keep_copy, midterm_row.doc_error_code) == (True, "files.source_unread")


async def _restore(api: Api, archive: bytes) -> tuple[str, str]:
    """Replaces the user's data with the backup and types the token again: (Program, course)."""
    uploaded = await api.client.post(
        "/me/imports", files={"file": ("backup.zip", archive, "application/zip")}
    )
    body = {"mode": "replace", "confirmation": "Replace my data"}
    await api.call("POST", f"/me/imports/{uploaded.json()['id']}:start", json=body)
    await api.run_jobs()
    [connection] = (await api.call("GET", "/lms/connections"))["items"]
    token = {"credentials": {"token": "good-token-1"}}  # not in backups: typed again
    await api.call("PATCH", f"/lms/connections/{connection['id']}", json=token)
    [program] = (await api.call("GET", "/programs"))["items"]
    [course] = (await api.call("GET", f"/programs/{program['id']}/courses"))["items"]
    return program["id"], course["id"]


async def _backup(api: Api) -> bytes:
    started = await api.call("POST", "/me/exports", json={"include_files": False})
    await api.run_jobs()
    return (await api.client.get(f"/me/exports/{started['id']}/download")).content


async def test_restored_names_with_slashes_keep_following(
    api: Api, fake: FakeProvider, app: FastAPI, clock: Clock
):
    """Restored, an item named from a title with a slash still follows the platform (its name
    is the sync's, whichever way the sync of its time spelled it), and one the user renamed
    keeps their name."""
    fake.course_file_list = [
        _file("201", "Lecture 1/2 notes.pdf"),
        _file("202", "Lab 1/2.pdf"),
        _file("203", "Quiz 1/2.pdf"),
    ]
    program_id, course = await _course(api)
    await api.sync(program_id)
    items = (await _files(api, course))[1]
    async with app.state.session_factory() as db:  # the quiz as 2.4 named it
        quiz = items["Quiz 1-2.pdf"]["id"]
        row = await db.get(FilesItem, quiz)
        assert row is not None
        row.display_name = row.original_name = "2.pdf"
        mat = await db.scalar(select(LmsMaterial).where(LmsMaterial.item_id == quiz))
        assert mat is not None
        mat.name = "2.pdf"
        await db.commit()
    await api.call("PATCH", f"/files/{items['Lab 1-2.pdf']['id']}", json={"display_name": "Lab"})

    program_id, course = await _restore(api, await _backup(api))
    files = fake.course_file_list
    for i, name in enumerate(("Lecture 1/2 notes v2.pdf", "Lab 1/2 v2.pdf", "Quiz 1/2 v2.pdf")):
        files[i] = files[i].model_copy(update={"name": name})
    clock.advance(minutes=1)
    await api.sync(program_id)
    assert sorted((await _files(api, course))[1]) == [
        "Lab",
        "Lecture 1-2 notes v2.pdf",
        "Quiz 1-2 v2.pdf",
    ]


def made_by(manifest: bytes, version: str, revision: str | None = None) -> bytes:
    """The manifest of a backup made by `version`: up to 2.4 manifests named no migration
    (`db_revision`); a build between releases is told by `revision`."""
    out = {k: v for k, v in json.loads(manifest).items() if k != "db_revision"}
    out["app_version"] = version
    if revision is not None:
        out["db_revision"] = revision
    return json.dumps(out).encode()


def _files_before_0070(payload: dict[str, Any]) -> None:
    """The files as backups made before migration 0070 had them: a followed item named by its
    `source_ref`, with the platform's name."""
    for row in payload["items"]:
        if row["source_kind"] == "lms":
            row |= {"source_ref": f"lms:{row['kind']}:{row['id']}", "source_name": "Canvas"}


def _files_before_0062(payload: dict[str, Any]) -> None:
    """The files as backups made before migration 0062 had them: a followed file's platform
    version in `sha256`, no source version or copy columns."""
    _files_before_0070(payload)
    for row in payload["items"]:
        version = row.pop("source_version")
        del row["copy_modified_at"], row["copy_error_code"]
        if version is not None:
            row["sha256"] = version


def _as_before_materials_table(archive: bytes) -> bytes:
    """The backup as a build between 2.0.0 and 2.1.0 wrote it (2.0.0 itself synced no
    materials), before `lms_materials`: the materials among the refs, their state in
    `snapshot`."""
    source = zipfile.ZipFile(io.BytesIO(archive))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name in source.namelist():
            data = source.read(name)
            if name == "manifest.json":
                data = made_by(data, "2.0.0", "0055")
            elif name == "data/files.json":
                payload = json.loads(data)
                _files_before_0062(payload)
                data = json.dumps(payload).encode()
            elif name == "data/lms.json":
                payload = json.loads(data)
                refs = [{**r, "external_kind": "assignment"} for r in payload["refs"]]
                for m in payload.pop("materials"):
                    deleted = m["state_at"] if m["state"] == "dismissed" else None
                    snap = {"links": m["links"], "title": m["title"], "version": m["version"]}
                    snap |= {"name": m["name"], "type": "general"} if m["name"] else {}
                    refs.append({
                        "link_id": m["link_id"], "external_kind": m["kind"],
                        "external_id": m["external_id"],
                        "target_kind": "file_item" if m["item_id"] else None,
                        "target_id": m["item_id"], "snapshot": snap,
                        "imported_at": m["imported_at"], "dismissed_at": deleted,
                    })  # fmt: skip
                data = json.dumps({**payload, "schema_version": 2, "refs": refs}).encode()
            z.writestr(name, data)
    return out.getvalue()


async def test_a_2_0_0_backup_keeps_the_materials_in_step(api: Api, fake: FakeProvider):
    """Restored from a backup made before the materials had a table of their own, the items
    still follow the platform's: none comes twice, and one the user deleted stays deleted."""
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    items = (await _files(api, course))[1]
    await api.call("DELETE", f"/files/{items['data.zip']['id']}")
    await api.sync(program_id)  # which tells the deletion

    started = await api.call("POST", "/me/exports", json={"include_files": False})
    await api.run_jobs()
    archive = (await api.client.get(f"/me/exports/{started['id']}/download")).content
    uploaded = await api.client.post(
        "/me/imports",
        files={"file": ("backup.zip", _as_before_materials_table(archive), "application/zip")},
    )
    body = {"mode": "replace", "confirmation": "Replace my data"}
    await api.call("POST", f"/me/imports/{uploaded.json()['id']}:start", json=body)
    await api.run_jobs()

    [connection] = (await api.call("GET", "/lms/connections"))["items"]
    token = {"credentials": {"token": "good-token-1"}}  # not in backups: typed again
    await api.call("PATCH", f"/lms/connections/{connection['id']}", json=token)
    [program] = (await api.call("GET", "/programs"))["items"]
    [course] = [
        c["id"] for c in (await api.call("GET", f"/programs/{program['id']}/courses"))["items"]
    ]
    before = sorted((await _files(api, course))[1])
    assert "data.zip" not in before
    await api.sync(program["id"])
    assert sorted((await _files(api, course))[1]) == before


def _as_2_1(archive: bytes, program_id: str, folder_id: str) -> bytes:
    """The backup as 2.1 wrote it: materials filed by type (`type`, the files' `type_folders`),
    no places, and the materials settings per Program."""
    source = zipfile.ZipFile(io.BytesIO(archive))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name in source.namelist():
            data = source.read(name)
            payload: dict[str, Any] = json.loads(data) if name.startswith("data/") else {}
            if name == "manifest.json":
                data = made_by(data, "2.1.0")
            elif name == "data/lms.json":
                for m in payload["materials"]:
                    del m["path"], m["placed_folder_id"]
                    m["type"] = "lecture" if m["title"] == "Lecture 1.pdf" else "other"
                [link] = payload["links"]
                course = link["course_id"]
            elif name == "data/files.json":
                continue  # below, with the type folders
            elif name == "data/settings.json":
                for row in payload["values"]:
                    if row["namespace"] == "lms.materials":
                        row |= {"scope_type": "program", "scope_id": program_id}
            if payload:
                data = json.dumps(payload).encode()
            z.writestr(name, data)
        files = json.loads(source.read("data/files.json"))
        files.pop("source_folders")
        _files_before_0062(files)
        files["type_folders"] = [{"course_id": course, "type": "lecture", "folder_id": folder_id}]
        z.writestr("data/files.json", json.dumps(files))
    return out.getvalue()


async def test_a_2_1_backup_keeps_where_the_sync_filed_and_its_settings(
    api: Api, fake: FakeProvider
):
    """Restored from a backup of 2.1, a material the sync had filed by type is offered back to
    its platform folder, as after the upgrade, and the Program's materials settings hold."""
    _materials(fake)
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    _, items = await _files(api, course)
    old = await api.call("POST", f"/courses/{course}/folders", json={"name": "Lecture notes"})
    lecture = items["Lecture 1.pdf"]["id"]
    await api.call("PATCH", f"/files/{lecture}", json={"folder_id": old["id"]})

    started = await api.call("POST", "/me/exports", json={"include_files": False})
    await api.run_jobs()
    archive = (await api.client.get(f"/me/exports/{started['id']}/download")).content
    backup = _as_2_1(archive, program_id, old["id"])
    uploaded = await api.client.post(
        "/me/imports", files={"file": ("backup.zip", backup, "application/zip")}
    )
    body = {"mode": "replace", "confirmation": "Replace my data", "include_preferences": True}
    await api.call("POST", f"/me/imports/{uploaded.json()['id']}:start", json=body)
    await api.run_jobs()

    settings = await api.call("GET", "/me/settings/lms.materials", params={"scope_type": "account"})
    assert settings["values"]["store"] == "local"
    [connection] = (await api.call("GET", "/lms/connections"))["items"]
    token = {"credentials": {"token": "good-token-1"}}
    await api.call("PATCH", f"/lms/connections/{connection['id']}", json=token)
    [program] = (await api.call("GET", "/programs"))["items"]
    [course] = [
        c["id"] for c in (await api.call("GET", f"/programs/{program['id']}/courses"))["items"]
    ]
    await api.sync(program["id"])
    plan = await _organize(api, course)
    assert [(m["name"], m["folder_name"]) for m in plan["moves"]] == [("Lecture 1.pdf", "Lectures")]


def _files_as_2_1(archive: bytes, own_id: str, made_own_id: str) -> bytes:
    """The files as 2.1 wrote them: a followed file's platform version in `sha256`, no source
    version or copy columns; one of the user's own files saved by Sem from a chat (its
    attachment as `source_ref`); and a material made the user's own (no `source_ref`)."""
    source = zipfile.ZipFile(io.BytesIO(archive))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name in source.namelist():
            data = source.read(name)
            if name == "manifest.json":
                data = made_by(data, "2.1.0")
            elif name == "data/files.json":
                payload = json.loads(data)
                _files_before_0062(payload)
                for row in payload["items"]:
                    if row["id"] == own_id:
                        row |= {"source_kind": "agent", "source_ref": "att-1"}
                    elif row["id"] == made_own_id:  # made the user's own in 2.1.0
                        row |= {"source_ref": None, "source_name": None}
                data = json.dumps(payload).encode()
            z.writestr(name, data)
    return out.getvalue()


async def test_a_2_1_backup_restores_saved_copies_and_own_files(api: Api, fake: FakeProvider):
    _materials(fake)
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    upload = ("notes.txt", b"my notes", "text/plain")
    [own] = (await api.call("POST", f"/courses/{course}/files", files={"files": upload}))["items"]
    await api.run_jobs()
    _, items = await _files(api, course)

    started = await api.call("POST", "/me/exports", json={"include_files": True})
    await api.run_jobs()
    archive = (await api.client.get(f"/me/exports/{started['id']}/download")).content
    backup = _files_as_2_1(archive, own["id"], items["W1.pdf"]["id"])
    uploaded = await api.client.post(
        "/me/imports",
        files={"file": ("backup.zip", backup, "application/zip")},
    )
    body = {"mode": "replace", "confirmation": "Replace my data"}
    await api.call("POST", f"/me/imports/{uploaded.json()['id']}:start", json=body)
    await api.run_jobs()

    [program] = (await api.call("GET", "/programs"))["items"]
    [course] = [
        c["id"] for c in (await api.call("GET", f"/programs/{program['id']}/courses"))["items"]
    ]
    _, items = await _files(api, course)
    # The saved copy is the platform's current version; the user's file keeps its hash.
    assert items["Lecture 1.pdf"]["local_copy"]["state"] == "saved"
    assert (items["notes.txt"]["sha256"], items["notes.txt"]["local_copy"]) == (own["sha256"], None)
    # The material made the user's own: theirs, and the platform's not brought in beside it.
    assert items["W1.pdf"]["follows_source"] is False
    [connection] = (await api.call("GET", "/lms/connections"))["items"]
    token = {"credentials": {"token": "good-token-1"}}
    await api.call("PATCH", f"/lms/connections/{connection['id']}", json=token)
    files = fake.course_file_list
    files[1] = files[1].model_copy(update={"name": "W1 v2.pdf", "updated_at": FEB})
    await api.sync(program["id"])
    names = [
        i["display_name"]
        for i in (await api.call("GET", f"/courses/{course}/files", params={"recursive": True}))[
            "items"
        ]
    ]
    assert names.count("W1.pdf") == 1
    assert "W1 v2.pdf" not in names


async def test_a_restored_copy_stored_for_the_sync_is_read_as_the_sync_reads_it(
    api: Api, fake: FakeProvider, app: FastAPI
):
    """With its bytes in the backup, it is read again in the background, like a synced file,
    not as a file the user is waiting on."""
    _materials(fake)
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    await api.run_jobs()

    started = await api.call("POST", "/me/exports", json={"include_files": True})
    await api.run_jobs()
    archive = (await api.client.get(f"/me/exports/{started['id']}/download")).content
    uploaded = await api.client.post(
        "/me/imports", files={"file": ("backup.zip", archive, "application/zip")}
    )
    body = {"mode": "replace", "confirmation": "Replace my data"}
    await api.call("POST", f"/me/imports/{uploaded.json()['id']}:start", json=body)
    while await app.state.jobs.run_one(jobs.FOREGROUND):
        pass  # the restore, but not what it queued in the background

    async with app.state.session_factory() as db:
        lecture = await db.scalar(
            select(FilesItem).where(FilesItem.display_name == "Lecture 1.pdf")
        )
        assert lecture is not None
        assert lecture.storage_key is not None
        kinds = set(
            await db.scalars(
                select(CoreJob.kind).where(
                    CoreJob.status == "pending", CoreJob.dedupe_key.startswith(lecture.id)
                )
            )
        )
    assert kinds == {"files.process_synced"}


# --- moving back what moved on the platform --------------------------------------------------


async def _organize(api: Api, course: str) -> dict[str, Any]:
    await api.call("POST", f"/courses/{course}/files:organize")
    await api.run_jobs()
    plan = (await api.call("GET", f"/courses/{course}/files:organize"))["plan"]
    assert plan is not None
    return plan


async def test_organize_moves_back_what_moved_on_the_platform(
    api: Api, fake: FakeProvider, clock: Clock
):
    """An item is placed once; moved on the platform later, it stays where it is until the
    user's "Organize" (no model needed) offers to move it to its new place. One the user moved
    themselves is not offered."""
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    _, items = await _files(api, course)
    await api.call("PATCH", f"/files/{items['data.zip']['id']}", json={"folder_id": None})

    files = fake.course_file_list
    files[0] = files[0].model_copy(update={"folder_path": "Slides/Week 1", "updated_at": FEB})
    files[4] = files[4].model_copy(update={"folder_path": "Data", "updated_at": FEB})
    clock.advance(minutes=1)
    await api.sync(program_id)
    folders, items = await _files(api, course)
    assert _where(folders, items["Lecture 1.pdf"]) == "Lectures"

    plan = await _organize(api, course)
    assert [(m["name"], m["folder_name"], m["new_folder"], m["back"]) for m in plan["moves"]] == [
        ("Lecture 1.pdf", "Slides / Week 1", True, "Fake LMS")
    ]
    assert plan["left"] == 0
    lecture = items["Lecture 1.pdf"]["id"]
    applied = await api.call(
        "POST", f"/courses/{course}/files:organize-apply", json={"item_ids": [lecture]}
    )
    assert applied == {"moved": 1}
    folders, items = await _files(api, course)
    week = folders[items["Lecture 1.pdf"]["folder_id"]]
    assert (week["name"], folders[week["parent_id"]]["name"]) == ("Week 1", "Slides")
    assert week["source_name"] == "Fake LMS"

    # Moved on the platform again: offered again, to the folder already there.
    files[0] = files[0].model_copy(update={"folder_path": "Lectures"})
    clock.advance(minutes=1)
    await api.sync(program_id)
    plan = await _organize(api, course)
    assert [(m["name"], m["folder_name"], m["new_folder"]) for m in plan["moves"]] == [
        ("Lecture 1.pdf", "Lectures", False)
    ]


async def test_a_folder_renamed_on_the_platform_keeps_its_folder(
    api: Api, fake: FakeProvider, clock: Clock
):
    """Folders follow the platform's ids: renamed there, a module or a folder of the files area
    keeps its folder, which takes the new name unless the user renamed it."""
    _materials(fake)
    fake.course_file_list[0] = fake.course_file_list[0].model_copy(update={"folder_ids": ["f1"]})
    fake.course_file_list[2] = fake.course_file_list[2].model_copy(update={"folder_ids": ["f3"]})
    program_id, course = await _course(api)
    await api.sync(program_id)
    folders, items = await _files(api, course)
    exams = items["Midterm 2025.pdf"]["folder_id"]
    await api.call("PATCH", f"/folders/{exams}", json={"name": "Old exams"})

    modules = fake.module_list
    assert modules is not None
    modules[0] = modules[0].model_copy(update={"name": "Week 1: Intro"})
    files = fake.course_file_list
    files[0] = files[0].model_copy(update={"folder_path": "Slides", "updated_at": FEB})
    files[2] = files[2].model_copy(update={"folder_path": "Past exams", "updated_at": FEB})
    files.append(_file("206", "Midterm 2024.pdf", "Past exams", folder_ids=["f3"]))
    clock.advance(minutes=1)
    await api.sync(program_id)
    folders, items = await _files(api, course)
    names = sorted(f["name"] for f in folders.values() if f["parent_id"] is None)
    assert names == ["Misc", "Old exams", "Problem sets", "Slides", "Week 1: Intro"]
    assert _where(folders, items["Midterm 2024.pdf"]) == "Old exams"
    assert (await _organize(api, course))["moves"] == []


async def test_organize_moves_back_to_the_top_level(api: Api, fake: FakeProvider, clock: Clock):
    """A file whose place on the platform is the top of its files area goes back there."""
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    files = fake.course_file_list
    files[4] = files[4].model_copy(update={"folder_path": None, "updated_at": FEB})
    clock.advance(minutes=1)
    await api.sync(program_id)
    plan = await _organize(api, course)
    assert [
        (m["name"], m["folder_id"], m["folder_name"], m["new_folder"]) for m in plan["moves"]
    ] == [("data.zip", None, "", False)]


async def test_reading_the_files_waits_for_a_course_sync_queued_since(
    api: Api, fake: FakeProvider, app: FastAPI, clock: Clock
):
    """One worker for the whole background queue (as on a small server): the files the first
    sync brings are read after a "Sync now" the user asks for meanwhile."""
    _materials(fake)
    program_id, _ = await _course(api)
    await api.call("POST", f"/programs/{program_id}/lms/sync", json={"force": True})
    assert await app.state.jobs.run_one(BACKGROUND) is True  # the first sync
    assert await _pending(app, "files.process_synced") > 0

    clock.advance(minutes=1)
    await api.call("POST", f"/programs/{program_id}/lms/sync", json={"force": True})
    assert await _pending(app, "lms.course.sync") == 1
    assert await app.state.jobs.run_one(BACKGROUND) is True
    assert await _pending(app, "lms.course.sync") == 0
    assert await _pending(app, "files.process_synced") > 0


async def test_local_copies_are_stored_one_file_at_a_time(
    api: Api, fake: FakeProvider, app: FastAPI, clock: Clock
):
    """One worker for the whole background queue (as on a small server): the copies a course
    keeps are stored a file per job, so a sync asked for meanwhile runs between two of them,
    and a file the platform added while copies wait is stored with them."""
    _materials(fake)
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.call("POST", f"/programs/{program_id}/lms/sync", json={"force": True})
    assert await app.state.jobs.run_one(BACKGROUND) is True  # the sync
    waiting = await _pending(app, "files.store_synced_copies")
    assert waiting > 1

    fake.course_file_list.append(_file("210", "Lecture 10.pdf", mime_type="application/pdf"))
    clock.advance(minutes=1)
    await api.call("POST", f"/programs/{program_id}/lms/sync", json={"force": True})
    assert await app.state.jobs.run_one(BACKGROUND) is True  # the sync goes first
    assert await _pending(app, "lms.course.sync") == 0
    assert await _pending(app, "files.store_synced_copies") == waiting + 1

    while await _pending(app, "files.store_synced_copies") == waiting + 1:
        assert await app.state.jobs.run_one(BACKGROUND) is True  # a read, or one copy
    _, items = await _files(api, course)
    assert sum(1 for item in items.values() if item.get("stored")) == 1
    await api.call("POST", f"/programs/{program_id}/lms/sync", json={"force": True})
    assert await app.state.jobs.run_one(BACKGROUND) is True
    assert await _pending(app, "lms.course.sync") == 0

    await api.run_jobs()
    assert (await _files(api, course))[1]["Lecture 10.pdf"]["stored"] is True


async def test_copies_still_waiting_are_dropped_when_the_course_reads_online_again(
    api: Api, fake: FakeProvider, app: FastAPI
):
    """The user switches back to reading from the platform before the copies are stored: none
    is stored afterwards."""
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    await _materials_setting(api, course, store="local")
    assert await _pending(app, "files.store_synced_copies") > 0
    await _materials_setting(api, course, store="online")
    await api.run_jobs()
    _, items = await _files(api, course)
    assert not [name for name, item in items.items() if item.get("stored")]
    assert await _pending(app, "files.store_synced_copies") == 0


async def test_sem_looks_at_a_platform_file_through_the_course_files(
    api: Api, fake: FakeProvider, app: FastAPI
):
    """An LMS file the course's files have is looked at there: its local copy, without
    downloading it from the platform again."""
    fake.course_file_list = [_file("201", "Lecture 1.pdf", mime_type="application/pdf")]
    fake.file_bytes["201"] = make_pdf(["one", "two"])
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    assert (await _files(api, course))[1]["Lecture 1.pdf"]["stored"] is True

    fake.fail_downloads = True
    me = await api.call("GET", "/account/me")
    args = {"course_id": course, "ref": "file:201", "page_from": 2}
    shown = await view.view_pages(app.state, me["id"], None, args)
    assert isinstance(shown.return_value, list)
    assert str(shown.return_value[0]).startswith('Page 2 of "Lecture 1.pdf" (2 in all)')


async def test_a_file_is_read_once_for_its_latest_version(
    api: Api, fake: FakeProvider, app: FastAPI, clock: Clock
):
    """A new version before the file is read replaces the read queued for the old one; the
    user asking for it moves it ahead of the synced files."""
    fake.course_file_list = [_file("201", "Lecture 1.pdf", mime_type="application/pdf")]
    program_id, course = await _course(api)

    async def sync() -> None:
        clock.advance(minutes=1)
        await api.call("POST", f"/programs/{program_id}/lms/sync", json={"force": True})
        assert await app.state.jobs.run_one(BACKGROUND) is True  # the sync, not the reading

    async def reads() -> list[tuple[str, str | None]]:
        async with app.state.session_factory() as db:
            query = select(CoreJob.kind, CoreJob.dedupe_key).where(
                CoreJob.kind.in_(("files.process", "files.process_synced")),
                CoreJob.status == "pending",
            )
            return [(kind, key) for kind, key in (await db.execute(query)).all()]

    await sync()
    item = (await _files(api, course))[1]["Lecture 1.pdf"]
    first = await _version(app, item["id"])
    assert await reads() == [("files.process_synced", f"{item['id']}:{first}")]

    files = fake.course_file_list
    files[0] = files[0].model_copy(update={"updated_at": FEB, "content_at": FEB})
    await sync()
    newer = await _version(app, item["id"])
    assert newer != first
    assert await reads() == [("files.process_synced", f"{item['id']}:{newer}")]

    await api.call("POST", f"/files/{item['id']}:reprocess")
    assert await reads() == [("files.process", f"{item['id']}:{newer}")]


async def test_a_read_of_an_older_version_never_becomes_its_text(
    api: Api, fake: FakeProvider, app: FastAPI, monkeypatch: pytest.MonkeyPatch
):
    """The platform has a new version while the old one is being read: the old read's text is
    dropped (the file waits for the new version's read), and the new version is read once."""
    fake.course_file_list = [_file("201", "Lecture 1.pdf", mime_type="application/pdf")]
    fake.file_bytes["201"] = make_pdf(["Week one covers recursion and induction proofs."])
    program_id, course = await _course(api)
    embed = pipeline._embed  # pyright: ignore[reportPrivateUsage]
    reads: list[str | None] = []

    async def newer_meanwhile(ctx: Any, work: Any, refs: Any) -> Any:
        if not reads:
            fake.file_bytes["201"] = make_pdf(["Week one now covers sorting and searching."])

            async def update(sctx: Any) -> None:
                row = await sctx.db.get(FilesItem, work.item_id)
                await sources.update_remote_file(
                    sctx, row, name=None, mime="application/pdf", size=1000, version="v2",
                    url=row.url, modified_at=FEB,
                )  # fmt: skip

            await run_as_system(app.state, work.user_id, update)
        reads.append(work.version)
        return await embed(ctx, work, refs)

    async def text(item_id: str) -> str | None:
        async with app.state.session_factory() as db:
            item = await db.get(FilesItem, item_id)
            assert item is not None
            if item.active_document_id is None:
                return None
            pages = select(FilesDocumentPage.markdown).where(
                FilesDocumentPage.document_id == item.active_document_id
            )
            return " ".join(await db.scalars(pages))

    monkeypatch.setattr(pipeline, "_embed", newer_meanwhile)
    await api.call("POST", f"/programs/{program_id}/lms/sync", json={"force": True})
    assert await app.state.jobs.run_one(BACKGROUND) is True  # the sync
    assert await app.state.jobs.run_one(BACKGROUND) is True  # the read of the first version
    item = (await _files(api, course))[1]["Lecture 1.pdf"]
    assert item["doc_status"] == "pending"
    assert await text(item["id"]) is None

    await api.run_jobs()
    item = (await _files(api, course))[1]["Lecture 1.pdf"]
    assert item["doc_status"] == "ready"
    assert await text(item["id"]) == "Week one now covers sorting and searching."
    assert reads[1:] == [await _version(app, item["id"])]  # once more, for the new version
    async with app.state.session_factory() as db:
        documents = select(func.count()).where(FilesDocument.item_id == item["id"])
        assert await db.scalar(documents) == 1


async def test_scanned_pages_of_synced_files_are_read_like_any_file(
    api: Api, fake: FakeProvider, fake_ai: FakeAi
):
    """Synced files follow the course's `auto_index` like any other, scanned pages included."""
    fake_ai.enabled.add("ocr")
    fake.course_file_list = [_file("201", "Scan 201.pdf", "Lectures", mime_type="application/pdf")]
    fake.file_bytes["201"] = make_pdf(["scan"], scanned={0})
    program_id, course = await _course(api)
    await api.sync(program_id)
    items = (await _files(api, course))[1]
    assert items["Scan 201.pdf"]["doc_status"] == "ready"
    assert items["Scan 201.pdf"]["ocr_skipped_pages"] == 0
    assert fake_ai.ocr_calls == 1


async def _version(app: FastAPI, item_id: str) -> str | None:
    """The version the item's text is read for (`content.version`)."""
    async with app.state.session_factory() as db:
        row = await db.get(FilesItem, item_id)
        assert row is not None
        return content.version(row)


async def _pending(app: FastAPI, kind: str) -> int:
    async with app.state.session_factory() as db:
        query = select(func.count()).where(CoreJob.kind == kind, CoreJob.status == "pending")
        return await db.scalar(query) or 0


def test_migration_to_four_states_and_names_the_sync_gave(tmp_path: Path):
    path = tmp_path / "m.db"
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.attributes["database_url"] = f"sqlite+aiosqlite:///{path}"
    command.upgrade(cfg, "0060")
    db = sqlite3.connect(path)  # foreign keys are off: no user or link rows needed
    rows = [
        # Renamed by the user, the sync having written that name back: theirs again.
        ("1", "synced", "i1", "Lecture 1.pdf", "Week 1 slides", "v1"),
        ("2", "synced", "i2", "Notes/a.pdf", "a.pdf", "v1"),  # the name the sync gave it
        ("3", "restored", None, "Syllabus", None, "v1"),
        ("4", "handed_over", "i4", "Midterm.pdf", "Midterm.pdf", "v1"),
        ("5", "gone", None, "Old.pdf", None, None),
        # A link was named in full, its title uncut.
        ("6", "synced", "i6", "Recording " + "x" * 300, "Recording " + "x" * 300, "v1"),
    ]
    for mid, state, item, title, name, version in rows:
        kind = "link" if mid == "6" else "file"
        db.execute(
            "INSERT INTO lms_materials (id, user_id, link_id, kind, external_id, state, item_id,"
            " title, name, version, links) VALUES (?, 'u1', 'l1', ?, ?, ?, ?, ?, ?, ?, '[]')",
            (mid, kind, mid, state, item, title, name, version),
        )
    db.commit()
    db.close()
    command.upgrade(cfg, "0061")
    db = sqlite3.connect(path)
    got = db.execute(
        "SELECT state, quiet, item_id, name, version FROM lms_materials ORDER BY id"
    ).fetchall()
    db.close()
    assert got == [
        ("synced", 0, "i1", "Lecture 1.pdf", "v1"),
        ("synced", 0, "i2", "a.pdf", "v1"),
        ("absent", 1, None, None, None),  # read whole when it comes in
        ("absent", 0, "i4", None, None),  # still names the user's own file
        ("absent", 0, None, None, None),
        ("synced", 0, "i6", "Recording " + "x" * 300, "v1"),
    ]


def test_migration_to_a_source_side_and_a_copy_side(tmp_path: Path):
    path = tmp_path / "m.db"
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.attributes["database_url"] = f"sqlite+aiosqlite:///{path}"
    command.upgrade(cfg, "0061")
    db = sqlite3.connect(path)  # foreign keys are off: no user or course rows needed
    rows = [
        # Read online: `sha256` held the platform's version.
        ("1", "lms:file:1", None, "v1", None, None, None),
        # A copy of the current version.
        ("2", "lms:file:2", "k2", "v2", "v2", None, None),
        # A copy older than the platform's version (`source_mime` and size while it is).
        ("3", "lms:file:3", "k3", "v3b", "v3a", "text/plain", 9),
        # Saved from the platform and never changed there: its own hash in both.
        ("4", "lms:file:4", "k4", "h4", "h4", None, None),
        ("5", None, "k5", "h5", None, None, None),  # the user's own
        ("6", "att-1", "k6", "h6", None, None, None),  # the user's, saved by Sem from a chat
    ]
    for iid, ref, key, sha, copy, smime, ssize in rows:
        db.execute(
            "INSERT INTO files_items (id, user_id, course_id, kind, display_name, mime_type,"
            " size_bytes, sha256, storage_key, source_ref, copy_version, source_mime, source_size,"
            " source_modified_at, pinned, unseen, doc_status, created_at, updated_at)"
            " VALUES (?, 'u1', 'c1', 'file', ?, 'application/pdf', 5, ?, ?, ?, ?, ?, ?,"
            " '2026-01-10 00:00:00', 0, 0, 'none', '2026-01-10 00:00:00',"
            " '2026-01-10 00:00:00')",
            (iid, iid, sha, key, ref, copy, smime, ssize),
        )
    db.commit()
    db.close()
    command.upgrade(cfg, "0062")
    db = sqlite3.connect(path)
    got = db.execute(
        "SELECT sha256, source_version, copy_version, source_mime, source_size,"
        " copy_modified_at IS NOT NULL FROM files_items ORDER BY id"
    ).fetchall()
    db.close()
    pdf = "application/pdf"
    assert got == [
        (None, "v1", None, pdf, 5, 0),
        (None, "v2", "v2", pdf, 5, 1),  # current
        (None, "v3b", "v3a", "text/plain", 9, 0),  # older: shown as such
        (None, "h4", "h4", pdf, 5, 1),  # current until the platform changes it
        ("h5", None, None, None, None, 0),
        ("h6", None, None, None, None, 0),
    ]


async def test_what_a_closed_area_hides_is_listed_until_it_opens(
    api: Api, fake: FakeProvider, clock: Clock
):
    """The files area closed and a file refused on its own (M09 table 3c, rows 6, 8, 10 and its
    note): it stays as it was, listed in the panel; a saved copy can't be removed from there; a
    material restored meanwhile is listed too; all leave the list once the platform shows them."""
    _materials(fake)
    program_id, course = await _course(api)
    await _materials_setting(api, course, store="local")
    await api.sync(program_id)
    await api.run_jobs()
    fake.files_hidden = True
    fake.refused_files = {"201", "203", "205"}
    clock.advance(days=2)
    status = await api.sync(program_id)
    rows = {u["title"]: u for u in status["unreadable"]}
    assert set(rows) == {"Lecture 1.pdf", "Midterm 2025.pdf", "data.zip"}
    assert {(u["kind"], u["area"], u["removable"]) for u in rows.values()} == {
        ("material", "files", False)
    }
    _, items = await _files(api, course)
    assert {"Lecture 1.pdf", "Midterm 2025.pdf"} <= set(items)  # kept as they were
    # Not read again within a day: the area is closed, reading again tells nothing new.
    fake.calls.clear()
    clock.advance(hours=1)
    await api.sync(program_id)
    assert ("file", "201") not in fake.calls
    # A round that can't tell the area closed (its navigation refused) tells nothing new.
    fake.nav_refused = True
    clock.advance(hours=1)
    status = await api.sync(program_id)
    assert {u["title"] for u in status["unreadable"]} == set(rows)
    fake.nav_refused = False

    # The copy may be the user's only one: not removed from here.
    lecture_id = rows["Lecture 1.pdf"]["id"]
    error = await api.call("POST", f"/lms/sync/materials/{lecture_id}:remove", status=409)
    assert error["error"]["code"] == "lms.sync_nothing_to_resolve"

    # Deleted by the user, then restored while the area is closed: listed, waiting.
    await api.call("DELETE", f"/files/{items['Midterm 2025.pdf']['id']}")
    midterm_id = rows["Midterm 2025.pdf"]["id"]
    await api.call("POST", f"/lms/sync/materials/{midterm_id}:restore")
    status = await api.sync(program_id)
    waiting = {u["title"]: u for u in status["unreadable"]}
    assert set(waiting) == set(rows)
    assert waiting["Midterm 2025.pdf"]["removable"] is False

    # The area opens again: listed, so there; gone from the panel by itself.
    fake.files_hidden = False
    fake.refused_files = set()
    clock.advance(minutes=1)
    status = await api.sync(program_id)
    assert status["unreadable"] == []


async def test_what_a_closed_area_hides_read_online_is_removed(
    api: Api, fake: FakeProvider, clock: Clock
):
    """Read from the platform, it can't open while the area is closed: removed one by one or all
    at once (M09 table 3c, note; table 4a), and not brought back until restored."""
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    await api.run_jobs()
    fake.files_hidden = True
    fake.refused_files = {"201", "203", "205"}
    clock.advance(days=2)
    status = await api.sync(program_id)
    rows = {u["title"]: u for u in status["unreadable"]}
    assert len(rows) == 3
    assert all(u["removable"] for u in rows.values())

    midterm_id = rows["Midterm 2025.pdf"]["id"]
    status = await api.call("POST", f"/lms/sync/materials/{midterm_id}:remove")
    assert {u["title"] for u in status["unreadable"]} == set(rows) - {"Midterm 2025.pdf"}
    assert [r["title"] for r in status["removed_materials"]] == ["Midterm 2025.pdf"]

    url = f"/programs/{program_id}/lms/sync/materials:remove"
    status = await api.call("POST", url)
    assert status["unreadable"] == []
    assert {r["title"] for r in status["removed_materials"]} == set(rows)
    assert not set(rows) & set((await _files(api, course))[1])
    error = await api.call("POST", url, status=409)
    assert error["error"]["code"] == "lms.sync_nothing_to_resolve"


# Items and materials before 0070 (id, source_kind, source_ref, stored, kind, url) and (id,
# item_id, kind, state_at, version); what each case is is said where it is checked.
_ITEMS_0069 = [
    ("followed", "lms", "lms:file:1", False, "file", "https://lms/1"),
    ("link", "lms", "lms:link:2", False, "link", "https://lms/2"),
    ("handed", "lms", None, True, "file", "https://lms/3"),
    ("upload", "upload", None, True, "file", None),
    ("agent", "agent", "att-1", True, "file", None),
    ("shared", "lms", "lms:file:4", False, "file", None),
    ("orphan", "lms", "lms:file:5", False, "file", None),
    ("orphan-kept", "lms", "lms:file:6", True, "file", "https://lms/6"),
    ("orphan-link", "lms", "lms:link:7", False, "link", "https://example.com/7"),
]
_MATERIALS_0069 = [
    ("m-followed", "followed", "file", "2026-01-10 00:00:00", "v1"),
    ("m-link", "link", "link", "2026-01-10 00:00:00", "https://lms/2"),
    ("m-handed", "handed", "file", "2026-01-10 00:00:00", "v3"),
    ("m-gone", "deleted", "file", "2026-01-10 00:00:00", "v7"),
    ("m-shared-new", "shared", "file", "2026-01-12 00:00:00", "v4"),
    ("m-shared-old", "shared", "file", "2026-01-11 00:00:00", "v4"),
]
_LINK_VERSION = hashlib.sha256(b"https://lms/2").hexdigest()


def test_migration_keeps_following_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """0070: `source_kind` alone says the LMS keeps an item, a followed link's version moves to
    it, each followed item is one `synced` material's (what broke that is mended), and a file
    handed over loses the platform's address."""
    path = tmp_path / "m.db"
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.attributes["database_url"] = f"sqlite+aiosqlite:///{path}"
    command.upgrade(cfg, "0068")
    root = tmp_path / "storage"
    image = root / "pages" / "orphan-1.png"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"png")
    monkeypatch.setenv("SEMESTRA_STORAGE_LOCAL_ROOT", str(root))
    get_settings.cache_clear()
    db = sqlite3.connect(path)  # foreign keys are off: no user, course or link rows needed
    db.execute(
        "INSERT INTO files_documents (id, user_id, item_id, parser_fingerprint, page_count,"
        " char_count, status, ocr_skipped_pages, created_at) VALUES ('d1', 'u1', 'orphan', 'p',"
        " 1, 0, 'ready', 0, '2026-01-10 00:00:00')"
    )
    db.execute(
        "INSERT INTO files_document_pages (id, user_id, document_id, page_no, markdown,"
        " ocr_used, image_storage_key) VALUES ('p1', 'u1', 'd1', 1, '', 0,"
        " 'pages/orphan-1.png')"
    )
    for iid, kind, ref, stored, item_kind, url in _ITEMS_0069:
        db.execute(
            "INSERT INTO files_items (id, user_id, course_id, kind, display_name, size_bytes,"
            " storage_key, url, source_kind, source_ref, source_name, keep_copy, pinned, unseen,"
            " doc_status, created_at, updated_at) VALUES (?, 'u1', 'c1', ?, ?, 5, ?, ?, ?, ?,"
            " 'Canvas', ?, 0, 0, 'none', '2026-01-10 00:00:00', '2026-01-10 00:00:00')",
            (iid, item_kind, iid, "k" if stored else None, url, kind, ref, 1 if stored else None),
        )
    for mid, item, kind, at, version in _MATERIALS_0069:
        db.execute(
            "INSERT INTO lms_materials (id, user_id, link_id, kind, external_id, state, state_at,"
            " quiet, item_id, version, name, links) VALUES (?, 'u1', 'l1', ?, ?, 'synced', ?, 0,"
            " ?, ?, ?, '[]')",
            (mid, kind, mid, at, item, version, item),
        )
    db.commit()
    db.close()
    command.upgrade(cfg, "0070")
    get_settings.cache_clear()
    assert not image.exists()  # the gone file's page image went with it
    db = sqlite3.connect(path)
    assert db.execute("SELECT count(*) FROM files_document_pages").fetchone() == (0,)
    items = db.execute(
        "SELECT id, source_kind, source_version, url, keep_copy FROM files_items ORDER BY id"
    ).fetchall()
    materials = db.execute(
        "SELECT id, state, item_id, version, name FROM lms_materials ORDER BY id"
    ).fetchall()
    with pytest.raises(sqlite3.IntegrityError):  # one synced material per item from now on
        db.execute(
            "INSERT INTO lms_materials (id, user_id, link_id, kind, external_id, state, quiet,"
            " item_id, links) VALUES ('m-again', 'u1', 'l1', 'file', 'x', 'synced', 0,"
            " 'followed', '[]')"
        )
    db.close()
    assert items == [
        ("agent", None, None, None, 1),  # the user's (Sem saved it)
        ("followed", "lms", None, "https://lms/1", None),
        ("handed", None, None, None, 1),  # handed over: no platform address
        ("link", "lms", _LINK_VERSION, "https://lms/2", None),
        ("orphan-kept", None, None, None, None),  # no material follows it: handed over
        ("orphan-link", None, None, "https://example.com/7", None),  # the user's link now
        ("shared", "lms", None, None, None),
        ("upload", None, None, None, 1),
    ]  # the orphan read online is gone
    assert materials == [
        ("m-followed", "synced", "followed", None, "followed"),  # its version is its item's
        ("m-gone", "dismissed", None, None, "deleted"),  # its item deleted: the user's delete
        ("m-handed", "absent", "handed", None, None),  # its item handed over
        ("m-link", "synced", "link", None, "link"),
        ("m-shared-new", "synced", "shared", None, "shared"),  # the latest keeps the item
        ("m-shared-old", "absent", None, None, None),  # brought in again by the next sync
    ]


def test_a_backup_before_0070_keeps_following_once():
    """The backup step does what migration 0070 does."""
    items = [
        {"id": iid, "source_kind": kind, "source_ref": ref, "source_name": "Canvas",
         "storage_key": "k" if stored else None, "kind": item_kind, "url": url,
         "keep_copy": True if stored else None, "source_version": None}
        for iid, kind, ref, stored, item_kind, url in _ITEMS_0069
    ]  # fmt: skip
    materials = [
        {"item_id": item, "kind": kind, "state": "synced", "state_at": at, "version": version,
         "name": item, "quiet": False, "links": []}
        for _, item, kind, at, version in _MATERIALS_0069
    ]  # fmt: skip
    got_items, got_materials = older_backups.follow_once_0070(items, materials)
    assert [
        (i["id"], i["source_kind"], i["source_version"], i["url"], i["keep_copy"])
        for i in sorted(got_items, key=lambda i: i["id"])
    ] == [
        ("agent", None, None, None, True),
        ("followed", "lms", None, "https://lms/1", None),
        ("handed", None, None, None, True),
        ("link", "lms", _LINK_VERSION, "https://lms/2", None),
        ("orphan-kept", None, None, None, None),
        ("orphan-link", None, None, "https://example.com/7", None),
        ("shared", "lms", None, None, None),
        ("upload", None, None, None, True),
    ]
    assert all("source_ref" not in i and "source_name" not in i for i in got_items)
    assert [(m["state"], m["item_id"], m["version"], m["name"]) for m in got_materials] == [
        ("synced", "followed", None, "followed"),
        ("synced", "link", None, "link"),
        ("absent", "handed", None, None),
        ("dismissed", None, None, "deleted"),
        ("synced", "shared", None, "shared"),
        ("absent", None, None, None),
    ]
