"""The course materials in the sync (M09 §4.2), with the fake provider: files, pages and links
come into the course's files in type folders without taking storage, follow the platform, and
leave alone what the user moved, renamed or deleted."""

import io
import json
import zipfile
from datetime import UTC, datetime
from typing import Any

import pytest
import respx
from fastapi import FastAPI
from sqlalchemy import func, select

from semestra.core import jobs
from semestra.core.config import Settings
from semestra.core.jobs import BACKGROUND, CoreJob
from semestra.modules.files.models import FilesItem
from semestra.modules.files.tests.conftest import FakeAi, make_pdf, model_sorts, sorting_model
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


async def _files(api: Api, course: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """(folder by id, item by name) of the whole course."""
    got = await api.call("GET", f"/courses/{course}/files", params={"recursive": True})
    folders = {f["id"]: f for f in got["folders"]}
    return folders, {i["display_name"]: i for i in got["items"]}


def _where(folders: dict[str, Any], item: dict[str, Any]) -> str | None:
    return folders[item["folder_id"]]["name"] if item["folder_id"] else None


async def test_materials_come_into_type_folders(api: Api, fake: FakeProvider):
    _materials(fake)
    program_id, course = await _course(api)
    status = await api.sync(program_id)
    assert status["errors"] == []
    folders, items = await _files(api, course)
    assert {name: _where(folders, item) for name, item in items.items()} == {
        "Lecture 1.pdf": "Lectures",
        "W1.pdf": "Tutorials and labs",  # the subheader above it
        "Midterm 2025.pdf": "Past exams",
        "Set 1.pdf": "Problem sets and solutions",  # the page that lists it
        "data.zip": "Course materials",
        "Lecture recording": "Recordings",
        "Course syllabus": None,
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

    # Nothing changed: nothing new.
    await api.sync(program_id)
    assert len((await _files(api, course))[1]) == len(items)

    # Kept offline, in place: the same item, now stored and counted (from the files or from
    # the platform's file, as the Canvas tab saves it).
    assert (lecture["stored"], lecture["follows_source"]) == (False, True)
    await api.call("POST", f"/files/{lecture['id']}:keep-offline")
    saved = await api.call("POST", f"/courses/{course}/lms/files/202:save", json={})
    assert (saved["file_item_id"], saved["stored"]) == (items["W1.pdf"]["id"], False)
    await api.run_jobs()
    kept = await api.call("GET", f"/files/{lecture['id']}")
    assert (kept["stored"], kept["follows_source"]) == (True, False)
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

    files = fake.course_file_list
    files[0] = files[0].model_copy(update={"name": "Lecture 1 (v2).pdf", "updated_at": FEB})
    files[1] = files[1].model_copy(update={"name": "W1 (fixed).pdf", "updated_at": FEB,
                                           "size_bytes": 2000})  # fmt: skip
    files.append(_file("206", "Lecture 2.pdf"))
    clock.advance(minutes=1)
    await api.sync(program_id)
    folders, items = await _files(api, course)
    assert "Midterm 2025.pdf" not in items  # deleted: not brought back
    assert _where(folders, items["Lecture 1 (v2).pdf"]) is None  # renamed there, still moved
    assert (items["Tut 1"]["size_bytes"], _where(folders, items["Tut 1"])) == (
        2000,
        "Tutorials and labs",
    )  # the user's name kept, the new version taken
    assert _where(folders, items["Lecture 2.pdf"]) == "Slides"  # the renamed folder

    # The user files their lectures in a folder of their own and deletes "Slides": new ones go
    # to the top level (nothing guessed from where they put the others), and it is not made
    # again.
    mine = await api.call("POST", f"/courses/{course}/folders", json={"name": "Mine"})
    await api.call(
        "POST",
        f"/courses/{course}/files:move",
        json={"item_ids": [items["Lecture 2.pdf"]["id"], items["Lecture 1 (v2).pdf"]["id"]],
              "folder_ids": [], "to_folder_id": mine["id"]},
    )  # fmt: skip
    slides = next(f["id"] for f in folders.values() if f["name"] == "Slides")
    await api.call("DELETE", f"/folders/{slides}")
    files.append(_file("207", "Lecture 3.pdf"))
    clock.advance(minutes=1)
    await api.sync(program_id)
    folders, items = await _files(api, course)
    assert _where(folders, items["Lecture 3.pdf"]) is None
    assert "Slides" not in {f["name"] for f in folders.values()}
    assert "Lectures" not in {f["name"] for f in folders.values()}


async def test_turning_materials_off_and_unlinking(api: Api, fake: FakeProvider, clock: Clock):
    _materials(fake)
    program_id, course = await _course(api)
    # A file saved by hand before the sync brought anything in: once, and kept as a copy.
    saved = await api.call("POST", f"/courses/{course}/lms/files/201:save", json={})
    again = await api.call("POST", f"/courses/{course}/lms/files/201:save", json={})
    assert again["file_item_id"] == saved["file_item_id"]

    link = await api.call("PATCH", f"/courses/{course}/lms-link", json={"files_sync": False})
    assert link["link"]["files_sync"] is False
    await api.sync(program_id)
    assert list((await _files(api, course))[1]) == ["Lecture 1.pdf"]

    await api.call("PATCH", f"/courses/{course}/lms-link", json={"files_sync": True})
    clock.advance(minutes=1)
    await api.sync(program_id)
    listed = await api.call("GET", f"/courses/{course}/files", params={"recursive": True})
    names = [i["display_name"] for i in listed["items"]]
    assert names.count("Lecture 1.pdf") == 1  # the saved copy is that file
    assert "W1.pdf" in names

    # Turned off again: what came in stays (no longer following the platform).
    await api.call("PATCH", f"/courses/{course}/lms-link", json={"files_sync": False})
    fake.course_file_list[1] = fake.course_file_list[1].model_copy(update={"name": "W1 v2.pdf"})
    clock.advance(minutes=1)
    await api.sync(program_id)
    assert set((await _files(api, course))[1]) == set(names)

    # Unlinked: what was only read from the platform goes, the saved copy and folders stay.
    await api.call("DELETE", f"/courses/{course}/lms-link")
    folders, items = await _files(api, course)
    assert list(items) == ["Lecture 1.pdf"]
    assert "Tutorials and labs" in {f["name"] for f in folders.values()}
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
    await api.call("PATCH", f"/courses/{course}/lms-link", json={"files_offline": True})
    await api.sync(program_id)
    await api.run_jobs()
    _, items = await _files(api, course)
    stored = {name for name, item in items.items() if item.get("stored")}
    assert {"Lecture 1.pdf", "Course syllabus"} <= stored
    assert (await api.call("GET", "/files-usage"))["files_bytes"] > 0

    # A file the platform failed to give is read again by a later sync.
    await api.call("PATCH", f"/courses/{course}/lms-link", json={"files_offline": False})
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


async def test_an_offline_copy_the_user_asks_for(api: Api, fake: FakeProvider, settings: Settings):
    _materials(fake)
    program_id, course = await _course(api)
    await api.sync(program_id)
    lecture = (await _files(api, course))[1]["Lecture 1.pdf"]  # 1000 bytes on the platform

    # What can be told at once is refused at once.
    settings.files_max_upload_bytes = 999
    r = await api.client.post(f"/files/{lecture['id']}:keep-offline")
    assert (r.status_code, r.json()["error"]["code"]) == (413, "files.too_large")
    settings.files_max_upload_bytes = 10_000_000
    settings.user_storage_quota_bytes = 999
    r = await api.client.post(f"/files/{lecture['id']}:keep-offline")
    assert (r.status_code, r.json()["error"]["code"]) == (413, "common.quota_exceeded")
    settings.user_storage_quota_bytes = 0

    # A failure while storing fails the job the user sees; asking twice queues one job.
    fake.fail_downloads = True
    await api.call("POST", f"/files/{lecture['id']}:keep-offline")
    await api.call("POST", f"/files/{lecture['id']}:keep-offline")
    await api.run_jobs()
    jobs = [
        j for j in (await api.call("GET", "/jobs"))["items"] if j["kind"] == "files.keep_offline"
    ]
    assert [(j["status"], j["error_code"]) for j in jobs] == [("failed", "lms.unreachable")]
    # Still the platform's: it can be asked for again.
    after = await api.call("GET", f"/files/{lecture['id']}")
    assert (after["stored"], after["follows_source"]) == (False, True)
    fake.fail_downloads = False
    await api.call("POST", f"/files/{lecture['id']}:keep-offline")
    await api.run_jobs()
    after = await api.call("GET", f"/files/{lecture['id']}")
    assert (after["stored"], after["follows_source"]) == (True, False)


async def test_stored_here_still_follows_the_platform(
    api: Api, fake: FakeProvider, settings: Settings, clock: Clock
):
    _materials(fake)
    fake.course_file_list[0] = fake.course_file_list[0].model_copy(update={"content_at": JAN})
    fake.course_file_list.append(
        _file("206", "Huge recording.pdf").model_copy(update={"size_bytes": 10**8})
    )
    program_id, course = await _course(api)
    await api.call("PATCH", f"/courses/{course}/lms-link", json={"files_offline": True})
    settings.files_max_upload_bytes = 10**7
    await api.sync(program_id)
    await api.run_jobs()
    _, items = await _files(api, course)
    # Too large to store: left read from the platform, the rest stored all the same.
    assert items["Huge recording.pdf"]["stored"] is False
    lecture, midterm = items["Lecture 1.pdf"], items["Midterm 2025.pdf"]
    assert (lecture["stored"], lecture["follows_source"]) == (True, True)
    # The user keeps the midterm as their own copy.
    await api.call("POST", f"/files/{midterm['id']}:keep-offline")

    # New bytes on the platform: the stored copy follows; gone from the platform: removed,
    # except the copy the user keeps.
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
    assert "Set 1.pdf" not in items
    assert items["Midterm 2025.pdf"]["follows_source"] is False

    # A full quota: nothing more is downloaded to be stored.
    async def storing_jobs() -> int:
        got = await api.call("GET", "/jobs", params={"kind": "files.keep_offline_synced"})
        return len(got["items"])

    settings.user_storage_quota_bytes = 1
    files.append(_file("211", "Lecture 11.pdf"))
    before = await storing_jobs()
    clock.advance(minutes=1)
    await api.sync(program_id)
    await api.run_jobs()
    assert (await _files(api, course))[1]["Lecture 11.pdf"]["stored"] is False
    assert await storing_jobs() == before


async def test_a_backup_without_files(api: Api, fake: FakeProvider, app: FastAPI):
    _materials(fake)
    program_id, course = await _course(api)
    await api.call("PATCH", f"/courses/{course}/lms-link", json={"files_offline": True})
    await api.sync(program_id)
    await api.run_jobs()
    midterm = (await _files(api, course))[1]["Midterm 2025.pdf"]
    await api.call("POST", f"/files/{midterm['id']}:keep-offline")  # the user's own now

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
    # Stored for the sync: still the platform's, read (and stored) again once it answers.
    lecture = rows["Lecture 1.pdf"]
    assert (lecture.storage_key, lecture.kept_offline) == (None, False)
    assert lecture.doc_error_code == "files.source_unread"
    # The user's own copy, without its bytes in the backup: its source's again, not lost.
    midterm_row = rows["Midterm 2025.pdf"]
    assert (midterm_row.kept_offline, midterm_row.doc_error_code) == (False, "files.source_unread")


def _as_version_2(archive: bytes) -> bytes:
    """The backup as 2.0.0 (and the betas before it) wrote it, before `lms_materials`: the
    materials among the refs, their state in `snapshot`."""
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
                    snap = {"links": m["links"], "title": m["title"], "version": m["version"]}
                    snap |= {"name": m["name"], "type": m["type"]} if m["name"] else {}
                    refs.append({
                        "link_id": m["link_id"], "external_kind": m["kind"],
                        "external_id": m["external_id"],
                        "target_kind": "file_item" if m["item_id"] else None,
                        "target_id": m["item_id"], "snapshot": snap,
                        "imported_at": m["imported_at"], "dismissed_at": m["deleted_at"],
                    })  # fmt: skip
                data = json.dumps({**payload, "schema_version": 2, "refs": refs}).encode()
            z.writestr(name, data)
    return out.getvalue()


async def test_a_version_2_backup_keeps_the_materials_in_step(api: Api, fake: FakeProvider):
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
        "/me/imports", files={"file": ("backup.zip", _as_version_2(archive), "application/zip")}
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


async def test_a_restored_copy_stored_for_the_sync_is_read_as_the_sync_reads_it(
    api: Api, fake: FakeProvider, app: FastAPI
):
    """With its bytes in the backup, it is read again in the background, like a synced file
    (so its scanned pages follow the course's setting), not as a file the user is waiting on."""
    _materials(fake)
    program_id, course = await _course(api)
    await api.call("PATCH", f"/courses/{course}/lms-link", json={"files_offline": True})
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


# --- what the rules leave in "general" ------------------------------------------------------


async def test_the_model_sorts_what_the_rules_cannot(
    api: Api, fake: FakeProvider, clock: Clock, monkeypatch: pytest.MonkeyPatch
):
    fake.course_file_list = [
        _file("201", "Lecture 1.pdf"),
        _file("202", "ECE241_W3.pdf"),
        _file("203", "data.zip"),
    ]
    program_id, course = await _course(api)
    # No model yet: the leftovers stay in "Course materials", left to the user's organizing.
    await api.sync(program_id)
    folders, items = await _files(api, course)
    assert _where(folders, items["ECE241_W3.pdf"]) == "Course materials"
    assert _where(folders, items["data.zip"]) == "Course materials"

    with respx.mock(assert_all_called=False) as mock:
        # The provider fails: a new leftover stays in "Course materials" too.
        route = await sorting_model(api.client, mock, monkeypatch)
        fake.course_file_list.append(_file("206", "misc_2.pdf"))
        clock.advance(minutes=1)
        await api.sync(program_id)
        assert route.called
        folders, items = await _files(api, course)
        assert _where(folders, items["misc_2.pdf"]) == "Course materials"

        # It answers: a new leftover goes straight to its folder; one the rules place, and those
        # placed before, are not asked about.
        model_sorts(
            route,
            {"ECE241_W3.pdf": "lectures", "misc_2.pdf": "lectures", "Crib sheet.pdf": "exams"},
        )
        fake.course_file_list.append(_file("204", "Crib sheet.pdf"))
        fake.course_file_list.append(_file("205", "Lecture 2.pdf"))
        clock.advance(minutes=1)
        await api.sync(program_id)
        folders, items = await _files(api, course)
        assert {name: _where(folders, item) for name, item in items.items()} == {
            "Lecture 1.pdf": "Lectures",
            "Lecture 2.pdf": "Lectures",
            "ECE241_W3.pdf": "Course materials",
            "data.zip": "Course materials",
            "misc_2.pdf": "Course materials",
            "Crib sheet.pdf": "Past exams",
        }
        assert route.call_count == 1
        shown = route.calls[0].request.content.decode()
        assert "Crib sheet.pdf" in shown
        assert "Lecture 2.pdf" not in shown
        assert "ECE241_W3.pdf" not in shown

        # Sorted once: never asked again, and the user's moves stay.
        await api.call("PATCH", f"/files/{items['Crib sheet.pdf']['id']}", json={"folder_id": None})
        clock.advance(minutes=1)
        await api.sync(program_id)
        folders, items = await _files(api, course)
        assert route.call_count == 1
        assert _where(folders, items["Crib sheet.pdf"]) is None


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


async def test_scanned_pages_of_synced_files_wait_for_the_user_or_the_setting(
    api: Api, fake: FakeProvider, fake_ai: FakeAi, clock: Clock
):
    """The provider reads the scanned pages of a synced file only when the user asks (processing
    it again) or the course's setting says so; hundreds come at once, and nobody asked."""
    fake_ai.enabled.add("ocr")
    pdf = "application/pdf"
    fake.course_file_list = [
        _file(n, f"Scan {n}.pdf", "Lectures", mime_type=pdf) for n in ("201", "202")
    ]
    for n in ("201", "202", "203"):
        fake.file_bytes[n] = make_pdf(["scan"], scanned={0})
    program_id, course = await _course(api)
    await api.sync(program_id)
    items = (await _files(api, course))[1]
    assert {(i["doc_status"], i["ocr_skipped_pages"]) for i in items.values()} == {("ready", 1)}
    assert fake_ai.ocr_calls == 0

    first, second = items["Scan 201.pdf"]["id"], items["Scan 202.pdf"]["id"]
    await api.call("POST", f"/files/{first}:reprocess")
    await api.run_jobs()
    assert (await api.call("GET", f"/files/{first}"))["ocr_skipped_pages"] == 0
    assert fake_ai.ocr_calls == 1

    # Turned on: what was skipped is read now, and what comes next as it comes.
    await api.call(
        "PATCH",
        "/me/settings/files",
        json={"scope_type": "program", "scope_id": program_id, "values": {"synced_scans": True}},
    )
    await api.run_jobs()
    assert (await api.call("GET", f"/files/{second}"))["ocr_skipped_pages"] == 0
    assert fake_ai.ocr_calls == 2
    fake.course_file_list.append(_file("203", "Scan 203.pdf", "Lectures", mime_type=pdf))
    clock.advance(minutes=1)
    await api.sync(program_id)
    assert (await _files(api, course))[1]["Scan 203.pdf"]["ocr_skipped_pages"] == 0
    assert fake_ai.ocr_calls == 3


async def _pending(app: FastAPI, kind: str) -> int:
    async with app.state.session_factory() as db:
        query = select(func.count()).where(CoreJob.kind == kind, CoreJob.status == "pending")
        return await db.scalar(query) or 0
