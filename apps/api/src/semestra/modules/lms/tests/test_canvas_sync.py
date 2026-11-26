"""A course sync against a Canvas (respx) through the real provider: what a round asks of the
platform (M09 §4.1, "一轮的读取"), and the connection's limit on requests in flight (`gate.py`)."""

import asyncio
from collections import Counter
from collections.abc import Awaitable, Callable

import respx
from httpx import Request, Response

from semestra.modules.lms.gate import Gate
from semestra.modules.lms.tests.conftest import CANVAS, TOKEN, Api, canvas_api

API = f"{CANVAS}/api/v1"


async def _linked(api: Api) -> tuple[str, str]:
    program = await api.program()
    term = await api.term(program)
    course = await api.course(program, term)
    connection = await api.connection(
        provider="canvas", config={"base_url": CANVAS}, credentials={"access_token": TOKEN}
    )
    await api.bind(program, connection["id"])
    await api.link(course, "101")
    await api.run_jobs()
    return program, course


def _asked(mock: respx.MockRouter) -> Counter[str]:
    return Counter(call.request.url.path for call in mock.calls)


async def test_a_round_asks_for_each_list_and_the_course_once(api: Api, mock: respx.MockRouter):
    canvas_api(mock)
    # Without a syllabus there is nothing for the file processing to read from the course
    # afterwards, so each read of it is the round's.
    mock.get(f"{API}/courses/101").mock(
        return_value=Response(200, json={"id": 101, "name": "Computer Fundamentals",
                                         "course_code": "APS105H1 S",
                                         "apply_assignment_group_weights": True})
    )  # fmt: skip
    program, course = await _linked(api)
    mock.reset()

    await api.sync(program, course)

    asked = _asked(mock)
    for path in (
        "/api/v1/courses/101",
        "/api/v1/courses/101/assignment_groups",
        "/api/v1/courses/101/students/submissions",
        "/api/v1/courses/101/enrollments",
        "/api/v1/announcements",
        "/api/v1/calendar_events",
        "/api/v1/courses/101/modules",
        "/api/v1/courses/101/pages",
        "/api/v1/courses/101/files",
    ):
        assert asked[path] == 1, path


async def test_a_synced_file_is_downloaded_without_reading_it_again(
    api: Api, mock: respx.MockRouter
):
    canvas_api(mock)
    program, course = await _linked(api)
    body = {"scope_type": "course", "scope_id": course, "values": {"store": "local"}}
    await api.call("PATCH", "/me/settings/lms.materials", json=body)
    mock.reset()

    await api.sync(program, course)  # the copy to keep is downloaded

    asked = _asked(mock)
    assert asked["/files/77/download"] >= 1
    assert asked["/api/v1/courses/101/files/77"] == 0


async def test_requests_go_one_at_a_time_while_little_of_the_limit_is_left(
    api: Api, mock: respx.MockRouter
):
    canvas_api(mock)
    program, course = await _linked(api)
    in_flight = most = 0

    def low(answer: Response) -> Callable[[Request], Awaitable[Response]]:
        async def side_effect(request: Request) -> Response:
            nonlocal in_flight, most
            in_flight += 1
            most = max(most, in_flight)
            await asyncio.sleep(0.01)
            in_flight -= 1
            headers = {**answer.headers, "x-rate-limit-remaining": "120.0"}
            return Response(answer.status_code, headers=headers, content=answer.content)

        return side_effect

    # Every answer says little of the limit is left.
    for route in mock.routes:
        if isinstance(route.return_value, Response):
            route.side_effect = low(route.return_value)

    await api.sync(program, course)
    assert most == 1


async def test_the_gate_lets_wide_through_and_narrows_on_a_low_limit():
    gate = Gate(wide=3, low=300)
    running = most = 0

    async def one() -> None:
        nonlocal running, most
        async with gate.slot():
            running += 1
            most = max(most, running)
            await asyncio.sleep(0.01)
            running -= 1

    await asyncio.gather(*(one() for _ in range(8)))
    assert most == 3
    await gate.left(100)
    most = 0
    await asyncio.gather(*(one() for _ in range(4)))
    assert most == 1
    await gate.left(650)
    most = 0
    await asyncio.gather(*(one() for _ in range(8)))
    assert most == 3
