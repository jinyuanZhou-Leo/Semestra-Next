"""The Canvas provider against what a real Canvas answered a student (M09 §4.1, table 2).

`fixtures/canvas/` holds two courses recorded read-only with `python -m devtools record-canvas`
(people, titles, addresses and ids replaced): course A hides Files, Pages, Assignments and
Quizzes from its menu, course B hides Files and Pages; published files and pages linked from
their modules are read on their own. Each test replays a course's answers through the provider
and checks what table 2 makes of them.
"""

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
import respx
from httpx import Response

from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.core.http import safe_client
from semestra.modules.lms.answers import Gone, nav_closed
from semestra.modules.lms.providers import Io
from semestra.modules.lms.providers.canvas import CanvasProvider, answers
from semestra.modules.lms.tests.conftest import CANVAS, TOKEN

FIXTURES = Path(__file__).parent / "fixtures" / "canvas"
COURSE = "101"
# The item each recorded case asked for, by the id the replay asks with.
ITEMS = {
    "file-in-hidden-area": "1",
    "file-in-hidden-area-2": "2",
    "page-in-hidden-area": "p1",
    "page-in-hidden-area-2": "p2",
    "assignment-locked": "11",
    "assignment-visible": "12",
}


def _recorded(course: str) -> dict[str, dict[str, Any]]:
    return {p.stem: json.loads(p.read_text()) for p in sorted((FIXTURES / course).glob("*.json"))}


def _replay(mock: respx.MockRouter, cases: dict[str, dict[str, Any]]) -> None:
    """Every recorded answer at the address the provider asks for it (downloads and the wrong
    token are replayed on their own)."""
    for name, case in cases.items():
        path = case["request"]["path"]
        if name == "bad-token" or not path.startswith("/api/"):
            continue
        path = path.replace("{course}", COURSE).replace("{item}", ITEMS.get(name, ""))
        mock.get(f"{CANVAS}{path}").mock(
            return_value=Response(case["status"], headers=case["headers"], json=case["body"])
        )


@pytest.fixture
async def io(settings: Settings) -> AsyncIterator[Io]:
    async with safe_client(settings) as client:
        yield Io(client=client, settings=settings)


def _provider(settings: Settings) -> tuple[CanvasProvider, Any, Any]:
    p = CanvasProvider()
    return (
        p,
        p.normalize_config({"base_url": CANVAS}, settings),
        p.normalize_credentials({"access_token": TOKEN}),
    )


@pytest.mark.parametrize(
    ("course", "closed", "open_"),
    [
        ("course-a", {"files", "pages", "assignments", "quizzes"}, {"modules", "announcements"}),
        ("course-b", {"files", "pages"}, {"modules", "assignments", "quizzes", "syllabus"}),
    ],
)
async def test_a_closed_area_and_what_is_read_in_it(
    settings: Settings,
    io: Io,
    mock: respx.MockRouter,
    course: str,
    closed: set[str],
    open_: set[str],
):
    cases = _recorded(course)
    _replay(mock, cases)
    p, cfg, creds = _provider(settings)
    tabs = await p.navigation(io, cfg, creds, COURSE)
    for area in closed:
        assert nav_closed(tabs, area) is True, area
    for area in open_:
        assert nav_closed(tabs, area) is False, area

    # Table 2, row 7: a refused list of an area the menu leaves out is the area closed. Files
    # answer 403, pages and quizzes 404.
    refused = [p.pages(io, cfg, creds, COURSE), p.course_files(io, cfg, creds, COURSE)]
    if "quizzes" in closed:
        refused.append(p.quizzes(io, cfg, creds, COURSE))
    for read, area in zip(refused, ("pages", "files", "quizzes"), strict=False):
        with pytest.raises(AppError) as exc:
            await read
        assert exc.value.code in answers.REFUSALS
        assert p.area_answer(exc.value, nav_closed=nav_closed(tabs, area)) == "hidden"

    # Row 3: a published file or page linked from a module is read on its own, its area closed.
    for name in ("file-in-hidden-area", "file-in-hidden-area-2"):
        meta = await p.file(io, cfg, creds, COURSE, ITEMS[name])
        assert (meta.locked, meta.download_url is not None) == (False, True)
    if "page-in-hidden-area" in cases:
        for name in ("page-in-hidden-area", "page-in-hidden-area-2"):
            assert not (await p.page(io, cfg, creds, COURSE, ITEMS[name])).locked
    # The modules that link them read as they are.
    assert await p.modules(io, cfg, creds, COURSE)

    # Row 4: an id the course does not have is 404: gone. (Pages are left out: with the area closed
    # in both courses, a missing page's 404 is also the closed area's.)
    for read in (
        p.file(io, cfg, creds, COURSE, "999999999"),
        p.assignment(io, cfg, creds, COURSE, "999999999"),
        p.discussion(io, cfg, creds, COURSE, "999999999"),
        p.folder(io, cfg, creds, COURSE, "999999999"),
    ):
        with pytest.raises(AppError) as exc:
            await read
        assert isinstance(p.item_answer(exc.value, area="whole"), Gone)


async def test_a_locked_assignment_is_there(settings: Settings, io: Io, mock: respx.MockRouter):
    """Row 3: an assignment locked for the student is read (200) and present, marked locked."""
    _replay(mock, _recorded("course-b"))
    p, cfg, creds = _provider(settings)
    locked = await p.assignment(io, cfg, creds, COURSE, ITEMS["assignment-locked"])
    visible = await p.assignment(io, cfg, creds, COURSE, ITEMS["assignment-visible"])
    assert (locked.locked, visible.locked) == (True, False)


async def test_a_wrong_token_is_the_credentials(settings: Settings, io: Io, mock: respx.MockRouter):
    """Row 12: Canvas answers a token it does not take with 401 and `WWW-Authenticate`."""
    case = _recorded("course-a")["bad-token"]
    assert "www-authenticate" in case["headers"]
    mock.get(f"{CANVAS}/api/v1/courses/{COURSE}").mock(
        return_value=Response(case["status"], headers=case["headers"], json=case["body"])
    )
    p, cfg, creds = _provider(settings)
    with pytest.raises(AppError) as exc:
        await p.get_course(io, cfg, creds, COURSE)
    assert exc.value.code == "lms.invalid_credentials"
