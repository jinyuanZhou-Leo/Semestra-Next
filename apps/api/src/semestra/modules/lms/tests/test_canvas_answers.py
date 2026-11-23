"""Every read the Canvas provider makes for the sync, by every HTTP answer Canvas can give, to the
code of M09 table 2 (M09 §11). An answer the provider cannot make sense of may raise anything
but an `AppError` other than `lms.unreachable`: `service.call` makes it `lms.unreachable`
(table 2, row 19)."""

from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
import respx
from httpx import Response

from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.core.http import safe_client
from semestra.modules.lms.providers import Io
from semestra.modules.lms.providers.canvas import CanvasProvider
from semestra.modules.lms.tests.conftest import CANVAS, TOKEN

API = f"{CANVAS}/api/v1"
SINCE = datetime(2026, 1, 1, tzinfo=UTC)

Read = Callable[[CanvasProvider, Io, Any, Any], Awaitable[Any]]
READS: dict[str, Read] = {
    "get_course": lambda p, io, cfg, creds: p.get_course(io, cfg, creds, "101"),
    "navigation": lambda p, io, cfg, creds: p.navigation(io, cfg, creds, "101"),
    "assignments": lambda p, io, cfg, creds: p.assignments(io, cfg, creds, "101"),
    "assignment": lambda p, io, cfg, creds: p.assignment(io, cfg, creds, "101", "11"),
    "submissions": lambda p, io, cfg, creds: p.submissions(io, cfg, creds, "101"),
    "course_total": lambda p, io, cfg, creds: p.course_total(io, cfg, creds, "101"),
    "quizzes": lambda p, io, cfg, creds: p.quizzes(io, cfg, creds, "101"),
    "announcements": lambda p, io, cfg, creds: p.announcements(
        io, cfg, creds, ["101"], since=SINCE
    ),
    "discussion": lambda p, io, cfg, creds: p.discussion(io, cfg, creds, "101", "5"),
    "calendar_events": lambda p, io, cfg, creds: p.calendar_events(io, cfg, creds, ["101"]),
    "course_files": lambda p, io, cfg, creds: p.course_files(io, cfg, creds, "101"),
    "pages": lambda p, io, cfg, creds: p.pages(io, cfg, creds, "101"),
    "page": lambda p, io, cfg, creds: p.page(io, cfg, creds, "101", "intro"),
    "modules": lambda p, io, cfg, creds: p.modules(io, cfg, creds, "101"),
    "module_items": lambda p, io, cfg, creds: p.module_items(io, cfg, creds, "101", "3"),
    "file": lambda p, io, cfg, creds: p.file(io, cfg, creds, "101", "77"),
}

PAYLOAD = "payload"  # not understood: `lms.unreachable` once `service.call` has it
ANSWERS: dict[str, tuple[Response | Exception, str]] = {
    "401-bearer": (
        Response(401, headers={"www-authenticate": 'Bearer realm="canvas-lms"'}),
        "lms.invalid_credentials",
    ),
    "401": (Response(401, text='{"status":"unauthorized"}'), "lms.forbidden"),
    "403": (Response(403, headers={"x-rate-limit-remaining": "500"}), "lms.forbidden"),
    "403-throttled": (
        Response(403, text="403 Forbidden (Rate Limit Exceeded)"),
        "lms.rate_limited",
    ),
    "429": (Response(429, headers={"retry-after": "30"}), "lms.rate_limited"),
    "404": (Response(404), "lms.not_found"),
    "500": (Response(500), "lms.unreachable"),
    "503": (Response(503), "lms.unreachable"),
    "timeout": (httpx.ReadTimeout("timed out"), "lms.unreachable"),
    "disconnect": (httpx.RemoteProtocolError("closed"), "lms.unreachable"),
    "302": (Response(302, headers={"location": "/login"}), "lms.invalid_config"),
    "not-json": (Response(200, text="<html>Maintenance</html>"), PAYLOAD),
    "wrong-shape": (Response(200, json={"unexpected": True}), PAYLOAD),
    "wrong-items": (Response(200, json=[{"unexpected": True}, 7]), PAYLOAD),
}


@pytest.fixture
async def io(settings: Settings) -> AsyncIterator[Io]:
    async with safe_client(settings) as client:
        yield Io(client=client, settings=settings)


@pytest.mark.parametrize("answer", list(ANSWERS))
@pytest.mark.parametrize("read", list(READS))
async def test_canvas_answer(
    settings: Settings, io: Io, mock: respx.MockRouter, read: str, answer: str
):
    response, code = ANSWERS[answer]
    route = mock.route(url__startswith=API)
    if isinstance(response, Exception):
        route.mock(side_effect=response)
    else:
        route.mock(return_value=response)
    p = CanvasProvider()
    cfg = p.normalize_config({"base_url": CANVAS}, settings)
    creds = p.normalize_credentials({"access_token": TOKEN})
    with pytest.raises(Exception) as raised:  # noqa: PT011 (which one is asserted below)
        await READS[read](p, io, cfg, creds)
    error = raised.value
    if code == PAYLOAD:
        # Anything but a refusal or an answer about the account: never read as "none there".
        assert not isinstance(error, AppError) or error.code == "lms.unreachable", error
    else:
        assert isinstance(error, AppError), error
        assert error.code == code
