"""The fake Canvas in `devtools/` (used by `pnpm dev:demo`) stays something the real Canvas provider
can read: the provider contract passes against it, files download through its redirect, and its
injected faults map to the errors a real Canvas causes. Breaks here mean the fake drifted from the
provider, so local debugging would no longer match production."""

from collections.abc import AsyncIterator

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
