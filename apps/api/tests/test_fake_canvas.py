"""The fake Canvas in `devtools/` (used by `pnpm dev:demo`) stays something the real Canvas provider
can read: the provider contract passes against it, files download through its redirect, and its
injected faults map to the errors a real Canvas causes. Breaks here mean the fake drifted from the
provider, so local debugging would no longer match production."""

import json
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest

from devtools.fake_canvas.app import FakeCanvas
from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.modules.lms.providers import Io
from semestra.modules.lms.providers.canvas import CanvasProvider
from semestra.modules.lms.tests.provider_contract import check_provider

BASE = "http://127.0.0.1:8090"
TOKEN = "7~fake-canvas-token-0000"


@pytest.fixture
def private(settings: Settings) -> Settings:
    return settings.model_copy(update={"allow_private_egress": True})


async def _io(fake: FakeCanvas, settings: Settings) -> AsyncIterator[Io]:
    transport = httpx.ASGITransport(app=fake.app())
    async with httpx.AsyncClient(transport=transport) as client:
        yield Io(client=client, settings=settings)


def _setup(fake: FakeCanvas, settings: Settings):
    p = CanvasProvider()
    return (
        p,
        p.normalize_config({"base_url": BASE}, settings),
        p.normalize_credentials({"access_token": TOKEN}),
    )


@pytest.mark.parametrize(("scenario", "code"), [("default", "ECE201H1"), ("large", "APS360H1")])
async def test_contract(private: Settings, scenario: str, code: str):
    fake = FakeCanvas(BASE, scenario)
    course = str(fake.world.course(code).id)
    async for io in _io(fake, private):
        await check_provider(
            CanvasProvider(), io, private, {"base_url": BASE}, {"access_token": TOKEN}, course
        )
        if scenario == "large":
            p, cfg, creds = _setup(fake, private)
            assert len(await p.course_files(io, cfg, creds, course)) == 12 * (6 * 3 + 7) + 1
            assert len(await p.assignments(io, cfg, creds, course)) == 120


async def test_files_download(private: Settings):
    fake = FakeCanvas(BASE)
    course = str(fake.world.course("ECE201H1").id)
    async for io in _io(fake, private):
        p, cfg, creds = _setup(fake, private)
        files = await p.course_files(io, cfg, creds, course)
        lecture = next(f for f in files if f.folder_path == "Lectures")
        data = b"".join([chunk async for chunk in p.open_file(io, cfg, creds, course, lecture)])
        assert data.startswith(b"%PDF")
        # The folder hidden from students and its file are left out.
        assert not any(f.folder_path == "Instructor only" for f in files)


@pytest.mark.parametrize(
    ("fault", "code"),
    [
        ({"kind": "rate_limit"}, "lms.rate_limited"),
        ({"kind": "rate_limit", "style": "403"}, "lms.rate_limited"),
        ({"kind": "unauthorized"}, "lms.invalid_credentials"),
        ({"kind": "drop"}, "lms.unreachable"),
    ],
)
async def test_faults(private: Settings, fault: dict[str, object], code: str):
    fake = FakeCanvas(BASE)
    fake.control.add(fault)
    async for io in _io(fake, private):
        p, cfg, creds = _setup(fake, private)
        with pytest.raises(AppError) as exc:
            await p.validate(io, cfg, creds)
        assert exc.value.code == code


RECORDED = Path(__file__).parents[1] / "src/semestra/modules/lms/tests/fixtures/canvas"
# Areas a recording shows closed by leaving them out of the menu.
GATED = ("files", "pages", "assignments", "quizzes")
# Recorded requests the provider makes another way: the fake serves the provider's.
READS = {"area-assignments": "/api/v1/courses/{course}/assignment_groups"}
# Recorded requests the provider never makes, so the fake does not serve them.
UNREAD = {"missing-module", "missing-quiz"}


@pytest.mark.parametrize("recording", ["course-a", "course-b"])
async def test_answers_like_the_recorded_canvas(recording: str):
    """For a course with the same areas closed, the fake answers each recorded request with the
    status the real Canvas did (M09 table 2), so the fake cannot drift from the recordings."""
    cases = {
        p.stem: json.loads(p.read_text()) for p in sorted((RECORDED / recording).glob("*.json"))
    }
    fake = FakeCanvas(BASE)
    course = fake.world.course("ECE201H1")
    tabs = {t["id"] for t in cases["area-navigation"]["body"]}
    for area in GATED:
        op = "show_area" if area in tabs else "hide_area"
        fake.change({"op": op, "course": course.code, "area": area})
    file = next(f for f in course.files if not f["locked_for_user"])
    items = {
        "file": str(file["id"]),
        "page": course.pages[0]["url"],
        "assignment": str(course.assignments[0]["id"]),
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=fake.app()), base_url=BASE
    ) as client:
        for name, case in cases.items():
            if name in UNREAD:
                continue
            request = case["request"]
            if request["path"] == "[the file's url]":
                path = file["url"]
            else:
                kind = name.removeprefix("missing-").split("-")[0]
                path = (READS.get(name) or request["path"]).replace("{course}", str(course.id))
                path = path.replace("{item}", items.get(kind, ""))
            params = {
                k: [x.replace("{course}", str(course.id)) for x in v] if isinstance(v, list) else v
                for k, v in request["params"].items()
            }
            token = "" if name == "bad-token" else TOKEN
            answer = await client.get(
                path, params=params, headers={"Authorization": f"Bearer {token}"}
            )
            assert answer.status_code == case["status"], name
            assert ("www-authenticate" in answer.headers) == (
                "www-authenticate" in case["headers"]
            ), name
