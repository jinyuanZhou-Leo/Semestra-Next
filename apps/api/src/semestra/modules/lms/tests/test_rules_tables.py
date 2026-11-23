"""One test per row of M09's tables 2 (the platform's answers, normalized) and 3c (gone from the
platform, `rules.presence`). Change a row, change its test."""

from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any, cast

import pytest
import respx
from httpx import Response

from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.core.http import safe_client
from semestra.modules.lms.answers import AREA_HIDDEN, Gone, ItemAnswer, Present, Unavailable
from semestra.modules.lms.providers import Io
from semestra.modules.lms.providers.canvas import CanvasProvider
from semestra.modules.lms.rules import CHECK_EVERY, Check, presence
from semestra.modules.lms.sync_round import SyncRound
from semestra.modules.lms.tests.conftest import CANVAS, TOKEN

API = f"{CANVAS}/api/v1"
NOW = datetime(2026, 3, 1, 12, tzinfo=UTC)
BEARER = {"www-authenticate": 'Bearer realm="canvas-lms"'}
REFUSED = (
    Response(404),
    Response(401, text='{"status":"unauthorized"}'),
    Response(403, headers={"x-rate-limit-remaining": "500"}),
)


@pytest.fixture
async def io(settings: Settings) -> AsyncIterator[Io]:
    async with safe_client(settings) as client:
        yield Io(client=client, settings=settings)


def _canvas(settings: Settings) -> tuple[CanvasProvider, Any, Any]:
    p = CanvasProvider()
    return (
        p,
        p.normalize_config({"base_url": CANVAS}, settings),
        p.normalize_credentials({"access_token": TOKEN}),
    )


def _round(p: CanvasProvider, nav: list[Any] | None = None) -> tuple[SyncRound, Any, Any, Any]:
    """A round with the bare context its reads use: the time, the provider and the course's
    navigation (closed areas: left out of it)."""
    ctx = cast(Any, SimpleNamespace(now=NOW))
    b = cast(Any, SimpleNamespace(provider=p, cfg=None, creds=None))
    link = cast(Any, SimpleNamespace(external_course_id="101"))
    sync_round = SyncRound()
    sync_round._nav = nav  # pyright: ignore[reportPrivateUsage]
    return sync_round, ctx, b, link


def _open(*kinds: str) -> list[Any]:
    return [SimpleNamespace(kind=k, hidden=False) for k in kinds]


async def _item(
    settings: Settings,
    io: Io,
    mock: respx.MockRouter,
    response: Response,
    *,
    hidden: bool = False,
) -> ItemAnswer | None:
    """One file read on its own, the files area closed this round or not."""
    p, cfg, creds = _canvas(settings)
    mock.get(f"{API}/courses/101/files/7").mock(return_value=response)
    sync_round, ctx, b, _ = _round(p)
    if hidden:
        sync_round.areas["files"] = "hidden"
    return await sync_round.read(ctx, b, "file", "7", lambda: p.file(io, cfg, creds, "101", "7"))


async def _area(
    settings: Settings,
    io: Io,
    mock: respx.MockRouter,
    response: Response | list[Response],
    nav: list[Any] | None,
) -> str:
    """The pages area's list, with this round's navigation."""
    p, cfg, creds = _canvas(settings)
    mock.get(f"{API}/courses/101/pages").mock(
        side_effect=response if isinstance(response, list) else None,
        return_value=None if isinstance(response, list) else response,
    )
    sync_round, ctx, b, link = _round(p, nav)
    read: Callable[[], Awaitable[Any]] = lambda: p.pages(io, cfg, creds, "101")  # noqa: E731
    await sync_round.area(ctx, link, b, "pages", read, truncated=lambda _: io.truncated)
    return sync_round.areas["pages"]


# --- table 2 --------------------------------------------------------------------------------


async def test_t2_row1_course_read(settings: Settings, io: Io, mock: respx.MockRouter):
    p, cfg, creds = _canvas(settings)
    mock.get(f"{API}/courses/101").mock(
        return_value=Response(200, json={"id": 101, "name": "Course", "course_code": "C101"})
    )
    assert (await p.get_course(io, cfg, creds, "101")).external_id == "101"


@pytest.mark.parametrize("response", REFUSED)
async def test_t2_row2_course_refused_ends_the_round(
    settings: Settings, io: Io, mock: respx.MockRouter, response: Response
):
    """The course stage raises: the round ends there (`sync.sync_course`) and judges nothing."""
    p, cfg, creds = _canvas(settings)
    mock.get(f"{API}/courses/101").mock(return_value=response)
    with pytest.raises(AppError):
        await p.get_course(io, cfg, creds, "101")


@pytest.mark.parametrize("locked", [False, True])
async def test_t2_row3_item_there(settings: Settings, io: Io, mock: respx.MockRouter, locked: bool):
    body = {"id": 7, "display_name": "a.pdf", "size": 1, "locked_for_user": locked}
    answer = await _item(settings, io, mock, Response(200, json=body))
    assert isinstance(answer, Present)
    assert answer.data.locked is locked


async def test_t2_row4_item_not_found(settings: Settings, io: Io, mock: respx.MockRouter):
    assert await _item(settings, io, mock, Response(404)) == Gone()


@pytest.mark.parametrize("response", REFUSED[1:])
async def test_t2_row5_item_refused_area_open(
    settings: Settings, io: Io, mock: respx.MockRouter, response: Response
):
    assert await _item(settings, io, mock, response) == Gone()


@pytest.mark.parametrize("response", REFUSED[1:])
async def test_t2_row6_item_refused_area_closed(
    settings: Settings, io: Io, mock: respx.MockRouter, response: Response
):
    assert await _item(settings, io, mock, response, hidden=True) == Unavailable(AREA_HIDDEN)


@pytest.mark.parametrize("response", REFUSED)
async def test_t2_row7_area_refused_and_closed(
    settings: Settings, io: Io, mock: respx.MockRouter, response: Response
):
    assert await _area(settings, io, mock, response, _open("home", "files")) == "hidden"


@pytest.mark.parametrize("nav", [_open("home", "pages"), None])
@pytest.mark.parametrize("response", REFUSED)
async def test_t2_row8_area_refused_not_closed(
    settings: Settings, io: Io, mock: respx.MockRouter, response: Response, nav: list[Any] | None
):
    assert await _area(settings, io, mock, response, nav) == "unavailable"


async def test_t2_row9_area_read_whole(settings: Settings, io: Io, mock: respx.MockRouter):
    page = Response(200, json=[{"page_id": 1, "url": "p", "title": "P"}])
    assert await _area(settings, io, mock, page, None) == "whole"


async def test_t2_row10_area_cut_short(
    settings: Settings, io: Io, mock: respx.MockRouter, monkeypatch: pytest.MonkeyPatch
):
    from semestra.modules.lms.providers.canvas import provider as canvas_module

    monkeypatch.setattr(canvas_module, "MAX_PAGES", 1)
    nxt = {"link": f'<{API}/courses/101/pages?page=2&per_page=100>; rel="next"'}
    page = Response(200, json=[{"page_id": 1, "url": "p", "title": "P"}], headers=nxt)
    assert await _area(settings, io, mock, page, None) == "partial"


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (Response(403, text="403 Forbidden (Rate Limit Exceeded)"), "lms.rate_limited"),
        (Response(429, headers={"retry-after": "30"}), "lms.rate_limited"),
        (Response(401, headers=BEARER), "lms.invalid_credentials"),
        (Response(500), "lms.unreachable"),
        (Response(302, headers={"location": "/login"}), "lms.invalid_config"),
    ],
    ids=["row11-throttled-403", "row11-throttled-429", "row12", "row13", "row14"],
)
async def test_t2_rows11_14_stop_the_stage(
    settings: Settings, io: Io, mock: respx.MockRouter, response: Response, code: str
):
    """Throttled, the token, the platform down, not the API: neither an item nor an area is
    judged; the stage stops and the next round reads again."""
    with pytest.raises(AppError) as exc:
        await _item(settings, io, mock, response)
    assert exc.value.code == code
    with pytest.raises(AppError) as exc:
        await _area(settings, io, mock, response, _open("home"))
    assert exc.value.code == code


def test_t2_row15_area_not_offered(settings: Settings):
    sync_round, *_ = _round(CanvasProvider())
    sync_round.unsupported("syllabus")
    assert sync_round.areas["syllabus"] == "unsupported"
    assert presence(listed=False, areas=["unsupported", "whole"], now=NOW) == "gone"


# --- table 3c -------------------------------------------------------------------------------

RECENT = NOW - timedelta(hours=1)
OLD = NOW - CHECK_EVERY - timedelta(minutes=1)


def test_t3c_row1_course_unread_judges_nothing():
    """The course stage raised: no stage runs, so `presence` is never asked (`sync_course`)."""
    from semestra.modules.lms import sync

    assert sync.stages()[0].name == "course"


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        pytest.param(
            {"before_lookback": True, "listed": False, "areas": ["whole"]}, "unknown", id="row2"
        ),
        pytest.param({"listed": True, "areas": ["hidden"]}, "present", id="row3"),
        pytest.param(
            {"listed": False, "areas": ["hidden"], "read": Present()}, "present", id="row4"
        ),
        pytest.param({"listed": False, "areas": ["hidden"], "read": Gone()}, "gone", id="row5"),
        pytest.param(
            {"listed": False, "areas": ["whole"], "read": Unavailable("lms.unreachable")},
            "unknown",
            id="row6",
        ),
        pytest.param(
            {"listed": False, "areas": ["whole"], "last": Check("present", RECENT)},
            "present",
            id="row7",
        ),
        pytest.param(
            {
                "listed": False,
                "areas": ["whole"],
                "last": Check("unavailable", RECENT, AREA_HIDDEN),
            },
            "unknown",
            id="row8",
        ),
        pytest.param(
            {"listed": False, "areas": ["whole", "whole", "unsupported"]}, "gone", id="row9"
        ),
        pytest.param({"listed": False, "areas": ["whole", "hidden"]}, "check", id="row10"),
        pytest.param(
            {"listed": False, "areas": ["whole", "partial"]}, "unknown", id="row11-partial"
        ),
        pytest.param(
            {"listed": False, "areas": ["hidden", "unavailable"]}, "unknown", id="row11-unavailable"
        ),
    ],
)
def test_t3c_rows(kwargs: dict[str, Any], expected: str):
    assert presence(now=NOW, **kwargs) == expected


@pytest.mark.parametrize(
    "last",
    [
        pytest.param(Check("present", OLD), id="present-older-than-a-day"),
        pytest.param(Check("unavailable", RECENT, "lms.unreachable"), id="other-reason"),
        pytest.param(Check("gone", RECENT), id="gone"),
    ],
)
def test_t3c_note_only_the_last_recent_check_counts(last: Check):
    """Rows 7-8 hold only for a check within a day and, for row 8, only a closed area: anything
    else falls through to rows 9-11."""
    assert presence(listed=False, areas=["whole"], now=NOW, last=last) == "gone"
    assert presence(listed=False, areas=["hidden"], now=NOW, last=last) == "check"
