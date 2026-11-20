"""Backups made by each release since 2.0 restore into this version (M13 §3.1, M09 §10).
`backups/<version>/` holds a backup each release exported (`manifest.json` and the
`data/<module>.json` files flattened, `data/` being git-ignored; the stored copies in `files/`):
2.0.0 the Canvas tab's display setting; from 2.1.0 a linked course whose materials were saved in
Semestra (a file, a link with a long title), one renamed by the user and one deleted."""

import io
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


def _archive(version: str) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for path in sorted((BACKUPS / version).rglob("*")):
            if path.is_dir():
                continue
            name = path.relative_to(BACKUPS / version).as_posix()
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


async def _restore(api: Api, version: str) -> tuple[str, str | None]:
    """Replaces the user's data with the release's backup: (Program, its course or None)."""
    uploaded = await api.client.post(
        "/me/imports", files={"file": ("backup.zip", _archive(version), "application/zip")}
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
