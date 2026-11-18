"""The course materials in the sync (M09 §4.2), with the fake provider: files, pages and links
come into the course's files in the folders they are in on the platform without taking storage,
follow the platform, and leave alone what the user moved, renamed or deleted."""

import io
import json
import zipfile
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import func, select

from semestra.core import jobs
from semestra.core.config import Settings
from semestra.core.jobs import BACKGROUND, CoreJob
from semestra.modules.files.models import FilesItem
from semestra.modules.files.tests.conftest import FakeAi, make_pdf
from semestra.modules.lms.schemas.dto import FileMeta, InternalRef, Module, ModuleItem, PageSummary
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import setup_program
from semestra.testing import Clock

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
    assert (kept["stored"], kept["follows_source"], kept["source_ref"]) == (True, False, None)


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

    # Removed: read online again, its storage freed, and the course's setting does not store it
    # again.
    await _materials_setting(api, course, store="local")
    await api.call("POST", f"/files/{lecture['id']}:drop-copy")
    await api.sync(program_id)
    await api.run_jobs()
    assert (await api.call("GET", f"/files/{lecture['id']}"))["stored"] is False


async def test_making_a_file_ones_own(api: Api, fake: FakeProvider, clock: Clock):
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    _, items = await _files(api, course)
    lecture, midterm = items["Lecture 1.pdf"], items["Midterm 2025.pdf"]

    # Read online: its bytes are fetched first; while the platform can't be reached it stays
    # as it was and the job says why.
    fake.fail_downloads = True
    await api.call("POST", f"/files/{lecture['id']}:make-own")
    await api.run_jobs()
    after = await api.call("GET", f"/files/{lecture['id']}")
    assert (after["stored"], after["follows_source"]) == (False, True)
    fake.fail_downloads = False
    await api.call("POST", f"/files/{lecture['id']}:make-own")
    await api.run_jobs()
    after = await api.call("GET", f"/files/{lecture['id']}")
    assert (after["stored"], after["follows_source"], after["source_name"]) == (True, False, None)

    # With a local copy: at once.
    await api.call("POST", f"/files/{midterm['id']}:keep-copy")
    await api.run_jobs()
    own = await api.call("POST", f"/files/{midterm['id']}:make-own")
    assert (own["stored"], own["follows_source"]) == (True, False)

    # No longer followed: a change on the platform does not reach them, nor is either brought in
    # again.
    files = fake.course_file_list
    files[0] = files[0].model_copy(update={"name": "Lecture 1 v2.pdf", "updated_at": FEB})
    clock.advance(minutes=1)
    await api.sync(program_id)
    _, items = await _files(api, course)
    assert "Lecture 1 v2.pdf" not in items
    assert [n for n in items if n.startswith("Midterm")] == ["Midterm 2025.pdf"]


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
    # Too large to store: left read from the platform, the rest stored all the same.
    assert items["Huge recording.pdf"]["stored"] is False
    lecture, midterm = items["Lecture 1.pdf"], items["Midterm 2025.pdf"]
    assert (lecture["stored"], lecture["follows_source"]) == (True, True)
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
    assert items["Lecture 1.pdf"]["sha256"] != lecture["sha256"]
    assert items["W1.pdf"]["stored"] is False
    for name in ("Midterm 2025.pdf", "Set 1.pdf"):
        assert (items[name]["stored"], items[name]["follows_source"]) == (True, False)
    assert items["Midterm 2025.pdf"]["folder_id"] == midterm["folder_id"]
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    handed = {m["title"]: m for m in status["materials"] if m["change"] == "handed_over"}
    assert set(handed) == {"Midterm 2025.pdf", "Set 1.pdf"}
    assert handed["Midterm 2025.pdf"]["item_id"] == midterm["id"]

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
    assert (await _files(api, course))[1]["Lecture 11.pdf"]["stored"] is False
    assert await storing_jobs() == before


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
    await api.call("POST", f"/files/{midterm['id']}:drop-copy")  # read online: the new one
    fake.fail_downloads = False
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


def _as_2_0_0(archive: bytes) -> bytes:
    """The backup as 2.0.0 (and the betas before it) wrote it, before `lms_materials`, at lms
    version 2: the materials among the refs, their state in `snapshot`."""
    source = zipfile.ZipFile(io.BytesIO(archive))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name in source.namelist():
            data = source.read(name)
            if name == "manifest.json":
                manifest = json.loads(data)
                manifest["modules"]["lms"] = 2
                data = json.dumps(manifest).encode()
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
        "/me/imports", files={"file": ("backup.zip", _as_2_0_0(archive), "application/zip")}
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
            if name == "data/lms.json":
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


async def _pending(app: FastAPI, kind: str) -> int:
    async with app.state.session_factory() as db:
        query = select(func.count()).where(CoreJob.kind == kind, CoreJob.status == "pending")
        return await db.scalar(query) or 0
