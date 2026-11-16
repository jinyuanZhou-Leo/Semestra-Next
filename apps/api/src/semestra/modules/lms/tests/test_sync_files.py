"""The course materials in the sync (M09 §4.2), with the fake provider: files, pages and links
come into the course's files in type folders without taking storage, follow the platform, and
leave alone what the user moved, renamed or deleted."""

from datetime import UTC, datetime
from typing import Any

import pytest

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
    assert b"midterm 30%" in page.content
    assert (await api.call("GET", "/files-usage"))["files_bytes"] == 0
    assert items["data.zip"]["doc_status"] == "unsupported"  # never read for its text

    # Nothing changed: nothing new.
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
    # where they put the others.
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
    assert _where(folders, items["Lecture 3.pdf"]) == "Mine"


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

    # Unlinked: what was only read from the platform goes, the saved copy and folders stay.
    await api.call("DELETE", f"/courses/{course}/lms-link")
    folders, items = await _files(api, course)
    assert list(items) == ["Lecture 1.pdf"]
    assert "Tutorials and labs" in {f["name"] for f in folders.values()}
