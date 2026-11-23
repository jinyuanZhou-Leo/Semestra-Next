"""Backups made by each release since 2.0 restore into this version (M13 §3.1, M09 §10).
`backups/<version>/` holds a backup each release exported (`manifest.json` and the
`data/<module>.json` files flattened, `data/` being git-ignored; the stored copies in `files/`):
2.0.0 the Canvas tab's display setting and a linked course with a file saved from the Canvas tab;
from 2.1.0 a linked course whose materials were saved in
Semestra (a file, a link with a long title), one renamed by the user and one deleted."""

import io
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from semestra.modules.files.tests.conftest import make_pdf
from semestra.modules.lms.schemas.dto import FileMeta, Module, ModuleItem
from semestra.modules.lms.tests.conftest import Api, FakeProvider

pytestmark = pytest.mark.usefixtures("fake")

BACKUPS = Path(__file__).parent / "backups"
JAN = datetime(2026, 1, 10, tzinfo=UTC)
LONG = "Recording " + "x" * 300


def _archive(version: str, labelled: str | None = None) -> bytes:
    """The release's backup; `labelled` names an older version in its manifest instead."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for path in sorted((BACKUPS / version).rglob("*")):
            if path.is_dir():
                continue
            name = path.relative_to(BACKUPS / version).as_posix()
            if name == "manifest.json" and labelled is not None:
                manifest = {**json.loads(path.read_text()), "app_version": labelled}
                z.writestr(name, json.dumps(manifest))
                continue
            if name.endswith(".json") and name != "manifest.json":
                name = f"data/{name}"
            z.write(path, name)
    return out.getvalue()


def _file(file_id: str, name: str, folder: str | None = None) -> FileMeta:
    return FileMeta(
        external_id=file_id, name=name, folder_path=folder, size_bytes=1000, updated_at=JAN,
        mime_type="application/pdf", web_url=f"https://fake/courses/101/files/{file_id}",
    )  # fmt: skip


def _platform(fake: FakeProvider) -> None:
    """The course on the platform as the backups saw it."""
    fake.module_list = [
        Module(external_id="m1", name="Week 1", items=[
            ModuleItem(external_id="i3", title=LONG, kind="external_url", position=1,
                       external_url="https://media.example.edu/v/1"),
        ])
    ]  # fmt: skip
    fake.course_file_list = [
        _file("201", "Lecture 1.pdf", "Lectures"),
        _file("202", "W1.pdf"),
        _file("203", "Midterm.pdf", "Exams"),
        _file("205", "data.zip", "Misc"),
    ]
    for n in ("201", "202", "203", "205"):
        fake.file_bytes[n] = make_pdf([f"file {n}"])
    fake.page_list = []


async def _restore(api: Api, version: str, labelled: str | None = None) -> tuple[str, str | None]:
    """Replaces the user's data with the release's backup: (Program, its course or None)."""
    uploaded = await api.client.post(
        "/me/imports",
        files={"file": ("backup.zip", _archive(version, labelled), "application/zip")},
    )
    assert uploaded.status_code == 200, uploaded.text
    body = {"mode": "replace", "confirmation": "Replace my data", "include_preferences": True}
    await api.call("POST", f"/me/imports/{uploaded.json()['id']}:start", json=body)
    await api.run_jobs()
    [program] = (await api.call("GET", "/programs"))["items"]
    courses = (await api.call("GET", f"/programs/{program['id']}/courses"))["items"]
    return program["id"], courses[0]["id"] if courses else None


async def _items(api: Api, course: str) -> dict[str, Any]:
    got = await api.call("GET", f"/courses/{course}/files", params={"recursive": True})
    names = [i["display_name"] for i in got["items"]]
    assert len(names) == len(set(names)), names  # nothing came in twice
    return {i["display_name"]: i for i in got["items"]}


async def test_a_2_0_0_backup_keeps_the_display_setting(api: Api):
    await _restore(api, "2.0.0")
    got = await api.call("GET", "/me/settings/lms", params={"scope_type": "account"})
    assert got["values"]["display"] == "original"


async def test_a_file_saved_from_the_canvas_tab_in_2_0_follows_the_platform(
    api: Api, fake: FakeProvider
):
    """2.0 saved a platform file into the course without a material: restored, it is the
    platform file's item, as a file saved there now is: the sync does not bring it in again, it
    follows a rename, and its copy can be let go (read from the platform instead)."""
    _platform(fake)
    program_id, course = await _restore(api, "2.0.0")
    assert course is not None
    [connection] = (await api.call("GET", "/lms/connections"))["items"]
    token = {"credentials": {"token": "good-token-1"}}  # not in backups: typed again
    await api.call("PATCH", f"/lms/connections/{connection['id']}", json=token)
    await api.sync(program_id)
    await api.run_jobs()
    saved = (await _items(api, course))["Lecture 1.pdf"]
    assert (saved["follows_source"], saved["local_copy"]["state"]) == (True, "saved")

    files = fake.course_file_list
    files[0] = files[0].model_copy(update={"name": "Lecture 1 (revised).pdf"})
    await api.sync(program_id)
    await api.run_jobs()
    after = await _items(api, course)
    assert after["Lecture 1 (revised).pdf"]["id"] == saved["id"]
    await api.call("POST", f"/files/{saved['id']}:drop-copy")
    got = await api.call("GET", f"/files/{saved['id']}")
    assert (got["stored"], got["follows_source"]) == (False, True)


@pytest.mark.parametrize("version", ["2.1.0", "2.2.0", "2.3.0", "2.4.0"])
async def test_a_backup_keeps_its_materials_in_step(api: Api, fake: FakeProvider, version: str):
    """Restored, the materials keep following the platform where the user left them alone: a
    rename on the platform is followed (the long-titled link's too), the user's own name stays,
    the deleted one stays deleted, nothing comes twice, and the copies stay saved here."""
    _platform(fake)
    program_id, course = await _restore(api, version)
    assert course is not None
    got = await api.call(
        "GET", "/me/settings/lms.materials", params={"scope_type": "course", "scope_id": course}
    )
    assert got["values"]["store"] == "local"
    [connection] = (await api.call("GET", "/lms/connections"))["items"]
    token = {"credentials": {"token": "good-token-1"}}  # not in backups: typed again
    await api.call("PATCH", f"/lms/connections/{connection['id']}", json=token)
    await api.sync(program_id)
    await api.run_jobs()
    before = await _items(api, course)
    # Names are at most 255 characters now: the long one is cut, as the sync names it.
    assert sorted(before) == sorted(["Lecture 1.pdf", "Week one.pdf", "Midterm.pdf", LONG[:255]])
    assert before["Lecture 1.pdf"]["local_copy"]["state"] == "saved"

    files = fake.course_file_list
    files[0] = files[0].model_copy(update={"name": "Lecture 1 (revised).pdf"})
    files[1] = files[1].model_copy(update={"name": "Week 1.pdf"})
    assert fake.module_list is not None
    [module] = fake.module_list
    assert module.items is not None
    module.items[0] = module.items[0].model_copy(update={"title": "Recording, week 1"})
    await api.sync(program_id)
    await api.run_jobs()
    after = await _items(api, course)
    assert sorted(after) == sorted(
        ["Lecture 1 (revised).pdf", "Week one.pdf", "Midterm.pdf", "Recording, week 1"]
    )


async def test_a_backup_labelled_older_than_it_is_keeps_its_materials_as_they_were(api: Api):
    """A backup a build made before its version was raised (the hosted backend is deployed
    ahead of the release) names an older version than its shape: the steps of migrations it
    already had run again, and leave what they changed before alone: the deleted material
    stays deleted and the stored copies stay current (a name the sync gave may read as the
    user's: there is no telling)."""
    program_id, course = await _restore(api, "2.4.0", labelled="2.0.0")
    assert course is not None
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    assert [m["title"] for m in status["removed_materials"]] == ["data.zip"]
    got = await _items(api, course)
    assert got["Lecture 1.pdf"]["local_copy"]["state"] == "saved"


def test_the_feedback_of_a_backup_up_to_2_4_becomes_the_mirror():
    """`older_backups._0071` reads a backup's kept assignments as migration 0071 moved them: one
    whose object is still imported from the same assignment is its mirror row, the others are
    held for their object; refs kept for new assignments go, ignored ones stay; the courses read
    their assignments from the platform until a sync fills the mirror."""
    from semestra.modules.lms.older_backups import _0071  # pyright: ignore[reportPrivateUsage]

    kept = {
        "course_id": "c1", "provider": "canvas", "points": 10, "score": 9,
        "comments": [{"id": "1", "author": "Prof", "comment": "Good"}],
        "rubric": [], "rubric_scores": [], "details": {"quiz": {"question_count": 3}},
        "work": {"body": "<p>Mine</p>"}, "read_at": "2026-01-10T00:00:00Z",
    }  # fmt: skip
    lms = {
        "links": [{"id": "l1", "area_reads": {"assignments": {"read_at": "2026-01-10"},
                                              "files": {"read_at": "2026-01-10"}}}],
        "refs": [
            {"link_id": "l1", "external_id": "a1", "target_kind": "assessment",
             "target_id": "x1", "snapshot": {"title": "Lab 1", "due_at": "2026-02-01"}},
            {"link_id": "l1", "external_id": "a5", "snapshot": {}},
            {"link_id": "l1", "external_id": "a6", "snapshot": {},
             "dismissed_at": "2026-01-02T00:00:00Z"},
        ],
        "feedback": [
            {**kept, "assessment_id": "x1", "assignment_id": "a1"},
            {**kept, "task_id": "t2", "assignment_id": "a2"},
        ],
    }  # fmt: skip
    out = _0071(lms, None)  # pyright: ignore[reportArgumentType]
    assert "feedback" not in out
    assert [r["external_id"] for r in out["refs"]] == ["a1", "a6"]
    mirror, held = out["assignments"]
    assert (mirror["link_id"], mirror["held_for_id"], mirror["seen_at"]) == (
        "l1",
        None,
        "2026-01-10T00:00:00Z",
    )
    assert mirror["assignment"]["name"] == "Lab 1"
    assert mirror["assignment"]["due_at"] == "2026-02-01"
    # Read from the platform until a sync fills the mirror.
    assert list(out["links"][0]["area_reads"]) == ["files"]
    assert mirror["quiz"] == {"question_count": 3}
    assert mirror["submission"]["body"] == "<p>Mine</p>"
    assert mirror["submission"]["comments"][0]["comment"] == "Good"
    assert (held["link_id"], held["held_for_kind"], held["held_for_id"]) == (None, "task", "t2")
    assert held["seen_at"] == "2026-01-10T00:00:00Z"
