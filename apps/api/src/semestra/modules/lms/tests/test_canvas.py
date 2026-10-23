"""The Canvas provider against a fake Canvas API (M09 §2.3, §11)."""

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import pytest
import respx
from httpx import Response

from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.core.http import safe_client
from semestra.modules.lms.providers import Io
from semestra.modules.lms.providers.canvas import CanvasProvider
from semestra.modules.lms.providers.canvas import provider as canvas_module
from semestra.modules.lms.providers.canvas.config import mask_token, normalize_base_url
from semestra.modules.lms.schemas.dto import FRONT_PAGE_REF
from semestra.modules.lms.tests.conftest import CANVAS, TOKEN, canvas_api
from semestra.modules.lms.tests.provider_contract import check_provider

API = f"{CANVAS}/api/v1"


@pytest.fixture(autouse=True)
def _dns(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every host name resolves to a public address (no DNS in tests)."""

    async def resolve(host: str, port: int) -> list[str]:
        return ["93.184.216.34"]

    monkeypatch.setattr(canvas_module, "_resolve", resolve)


@pytest.fixture
async def io(settings: Settings) -> AsyncIterator[Io]:
    async with safe_client(settings) as client:
        yield Io(client=client, settings=settings)


def _cfg(settings: Settings):
    p = CanvasProvider()
    return (
        p,
        p.normalize_config({"base_url": CANVAS}, settings),
        p.normalize_credentials({"access_token": TOKEN}),
    )


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("canvas.example.edu", "https://canvas.example.edu"),
        ("https://canvas.example.edu/", "https://canvas.example.edu"),
        ("  HTTPS://Canvas.Example.edu  ", "https://canvas.example.edu"),
        ("https://canvas.example.edu:8443/", "https://canvas.example.edu:8443"),
        ("https://example.edu/canvas/", "https://example.edu/canvas"),
    ],
)
def test_base_url_normalized(settings: Settings, raw: str, expected: str):
    assert normalize_base_url(raw, settings) == expected


@pytest.mark.parametrize(
    ("raw", "reason"),
    [
        ("", "missing"),
        ("ftp://canvas.example.edu", "scheme"),
        ("https://canvas.example.edu/?x=1", "query"),
        ("https://canvas.example.edu/#top", "query"),
        ("https://canvas.example.edu/api/v1", "api_path"),
        ("https://canvas.example.edu/api/v1/", "api_path"),
        ("https://user:pw@canvas.example.edu", "url"),
        ("https://canvas.example.edu:notaport", "url"),
        ("https://canvas.example.edu:99999", "url"),
    ],
)
def test_base_url_rejected(settings: Settings, raw: str, reason: str):
    with pytest.raises(AppError) as exc:
        normalize_base_url(raw, settings)
    assert exc.value.code == "lms.invalid_config"
    assert exc.value.params["reason"] == reason


def test_hosted_needs_https(settings: Settings):
    hosted = settings.model_copy(update={"env": "prod"})
    with pytest.raises(AppError):
        normalize_base_url("http://canvas.example.edu", hosted)
    assert normalize_base_url("http://canvas.example.edu", settings) == "http://canvas.example.edu"


def test_token_rules_and_mask():
    p = CanvasProvider()
    for bad in ("short", "has space token", "me@example.edu-token"):
        with pytest.raises(AppError) as exc:
            p.normalize_credentials({"access_token": bad})
        assert exc.value.code == "lms.invalid_credentials"
    assert mask_token("7~abcdefghijklmnxy") == "7~ab…xy"
    assert mask_token("7~abcdefgh") == "…"


async def test_contract(settings: Settings, io: Io, mock: respx.MockRouter):
    canvas_api(mock)
    await check_provider(
        CanvasProvider(), io, settings, {"base_url": CANVAS}, {"access_token": TOKEN}, "101"
    )


async def test_reads_map_canvas_payloads(settings: Settings, io: Io, mock: respx.MockRouter):
    canvas_api(mock)
    p, cfg, creds = _cfg(settings)
    tabs = await p.navigation(io, cfg, creds, "101")
    assert [(t.kind, t.label) for t in tabs] == [
        ("home", "Home"),
        ("unknown", "People"),
        ("external", "Zoom"),
    ]
    [a] = await p.assignments(io, cfg, creds, "101")
    assert (a.name, a.points, a.group_name, a.group_weight) == ("Lab 1", 10, "Labs", 20)
    assert a.submission is not None
    assert a.submission.score == 9
    assert a.due_at == datetime(2026, 2, 7, 4, 59, tzinfo=UTC)
    items = await p.module_items(io, cfg, creds, "101", "3")
    assert [i.target.model_dump() if i.target else None for i in items] == [
        {"kind": "page", "ref": "intro"},
        {"kind": "file", "ref": "77"},
    ]
    [total] = await p.grade_totals(io, cfg, creds, "101")
    assert (total.kind, total.name, total.score) == ("total", "Course total", 90)
    assert a.submission.graded_at == datetime(2026, 2, 10, 12, tzinfo=UTC)
    # The bearer token goes to Canvas, and only there.
    sent = mock.calls[0].request
    assert sent.headers["authorization"] == f"Bearer {TOKEN}"


async def test_pagination_follows_link_and_truncates(
    settings: Settings, io: Io, mock: respx.MockRouter, monkeypatch: pytest.MonkeyPatch
):
    p, cfg, creds = _cfg(settings)
    pages = [
        Response(200, json=[{"page_id": i, "url": f"p{i}", "title": f"P{i}"}],
                 headers={"link": f'<{API}/courses/1/pages?page={i + 1}&per_page=100>; rel="next"'})
        for i in range(5)
    ]  # fmt: skip
    route = mock.get(f"{API}/courses/1/pages").mock(side_effect=pages)
    monkeypatch.setattr(canvas_module, "MAX_PAGES", 3)
    out = await p.pages(io, cfg, creds, "1")
    assert [x.ref for x in out] == ["p0", "p1", "p2"]
    assert route.call_count == 3
    assert io.truncated
    # A next link to another host is not followed (the token would go there).
    io.truncated = False
    mock.get(f"{API}/courses/2/pages").mock(
        return_value=Response(200, json=[{"url": "a", "title": "A"}],
                              headers={"link": '<https://evil.example/x>; rel="next"'})
    )  # fmt: skip
    assert len(await p.pages(io, cfg, creds, "2")) == 1
    assert not io.truncated


BEARER = {"www-authenticate": 'Bearer realm="canvas-lms"'}


@pytest.mark.parametrize(
    ("status", "headers", "body", "code"),
    [
        (401, BEARER, "", "lms.invalid_credentials"),
        # A signed-in user refused one resource (a locked page): not a bad token.
        (401, {}, '{"status":"unauthorized"}', "lms.forbidden"),
        (403, {"x-rate-limit-remaining": "512.3"}, "", "lms.forbidden"),
        # Canvas throttles with 403 by default and 429 only when the site opts in.
        (403, {"x-rate-limit-remaining": "0.0"}, "403 Forbidden (Rate Limit Exceeded)",
         "lms.rate_limited"),
        (403, {}, "403 Forbidden (Rate Limit Exceeded)", "lms.rate_limited"),
        (404, {}, "", "common.not_found"),
        (429, {"retry-after": "30"}, "", "lms.rate_limited"),
        (500, {}, "", "lms.unreachable"),
        (302, {"location": "/login"}, "", "lms.invalid_config"),
    ],
)  # fmt: skip
async def test_errors_are_mapped(
    settings: Settings,
    io: Io,
    mock: respx.MockRouter,
    status: int,
    headers: dict[str, str],
    body: str,
    code: str,
):
    p, cfg, creds = _cfg(settings)
    mock.get(f"{API}/users/self/profile").mock(
        return_value=Response(status, headers=headers, text=body)
    )
    with pytest.raises(AppError) as exc:
        await p.validate(io, cfg, creds)
    assert exc.value.code == code
    if code == "lms.rate_limited":
        assert exc.value.params == {"retry_after": 30 if status == 429 else 60}


async def test_past_courses_include_completed_enrollments(
    settings: Settings, io: Io, mock: respx.MockRouter
):
    p, cfg, creds = _cfg(settings)
    current = {"id": 1, "name": "Now", "workflow_state": "available"}
    done = {"id": 2, "name": "Last year", "workflow_state": "completed"}

    def courses(request: Any) -> Response:
        if request.url.params.get("enrollment_state") == "completed":
            return Response(200, json=[done, current])
        return Response(200, json=[current])

    route = mock.get(f"{API}/courses").mock(side_effect=courses)
    listed = await p.list_courses(io, cfg, creds, include_past=True)
    assert [(c.external_id, c.is_current) for c in listed] == [("1", True), ("2", False)]
    assert route.call_count == 2
    current_only = await p.list_courses(io, cfg, creds, include_past=False)
    assert [c.external_id for c in current_only] == ["1"]
    assert route.call_count == 3


async def test_network_error_is_unreachable(settings: Settings, io: Io, mock: respx.MockRouter):
    import httpx

    p, cfg, creds = _cfg(settings)
    mock.get(f"{API}/users/self/profile").mock(side_effect=httpx.ConnectTimeout("slow"))
    with pytest.raises(AppError) as exc:
        await p.validate(io, cfg, creds)
    assert exc.value.code == "lms.unreachable"


async def test_file_download_follows_cdn_redirect(
    settings: Settings, io: Io, mock: respx.MockRouter
):
    canvas_api(mock)
    p, cfg, creds = _cfg(settings)
    body = b"".join(
        [
            c
            async for c in p.open_file(
                io, cfg, creds, "101", await p.file(io, cfg, creds, "101", "77")
            )
        ]
    )
    assert body == b"%PDF"
    cdn = next(c.request for c in mock.calls if c.request.url.host == "cdn.inscloudgate.net")
    assert "authorization" not in cdn.headers  # the token stays with Canvas


async def test_file_redirect_to_private_address_is_refused(
    settings: Settings, io: Io, mock: respx.MockRouter
):
    canvas_api(mock)
    mock.get(f"{CANVAS}/files/77/download").mock(
        return_value=Response(302, headers={"location": "https://10.0.0.5/x"})
    )
    p, cfg, creds = _cfg(settings)
    with pytest.raises(AppError) as exc:
        _ = [
            c
            async for c in p.open_file(
                io, cfg, creds, "101", await p.file(io, cfg, creds, "101", "77")
            )
        ]
    assert exc.value.code == "lms.blocked_address"


async def test_file_redirect_with_a_bad_port_is_refused(
    settings: Settings, io: Io, mock: respx.MockRouter
):
    canvas_api(mock)
    mock.get(f"{CANVAS}/files/77/download").mock(
        return_value=Response(
            302, headers={"location": "https://instructure-uploads.s3.amazonaws.com:99999/f"}
        )
    )
    p, cfg, creds = _cfg(settings)
    with pytest.raises(AppError) as exc:
        _ = [
            c
            async for c in p.open_file(
                io, cfg, creds, "101", await p.file(io, cfg, creds, "101", "77")
            )
        ]
    assert exc.value.code == "lms.blocked_address"


async def test_file_redirect_elsewhere_is_refused(
    settings: Settings, io: Io, mock: respx.MockRouter
):
    canvas_api(mock)
    mock.get(f"{CANVAS}/files/77/download").mock(
        return_value=Response(302, headers={"location": "https://evil.example/steal"})
    )
    p, cfg, creds = _cfg(settings)
    with pytest.raises(AppError) as exc:
        _ = [
            c
            async for c in p.open_file(
                io, cfg, creds, "101", await p.file(io, cfg, creds, "101", "77")
            )
        ]
    assert exc.value.code == "lms.blocked_address"


async def test_calendar_batches_context_codes(settings: Settings, io: Io, mock: respx.MockRouter):
    p, cfg, creds = _cfg(settings)
    route = mock.get(f"{API}/calendar_events").mock(return_value=Response(200, json=[]))
    ids = [str(i) for i in range(12)]
    start, end = datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 2, 1, tzinfo=UTC)
    await p.calendar_events(io, cfg, creds, ids, start, end)
    # 12 courses → 2 batches x (events + assignments).
    assert route.call_count == 4
    first = route.calls[0].request.url
    assert first.params.get_list("context_codes[]")[:2] == ["course_0", "course_1"]
    assert len(first.params.get_list("context_codes[]")) == 10
    assert {c.request.url.params["type"] for c in route.calls} == {"event", "assignment"}


@pytest.mark.parametrize(
    ("url", "kept"),
    [
        ("https://canvas.example.edu/courses/1", True),
        (" HTTP://canvas.example.edu/x", True),
        ("javascript:alert(1)", False),
        ("data:text/html,x", False),
        ("canvas-student://open", False),
    ],
)
def test_platform_links_must_be_web_links(url: str, kept: bool):
    from semestra.modules.lms.schemas.dto import LmsCalendarEvent, RichText

    event = LmsCalendarEvent.model_validate(
        {"external_id": "e1", "external_course_id": "1", "kind": "event", "title": "T",
         "start_at": datetime(2026, 1, 1, tzinfo=UTC), "web_url": url}
    )  # fmt: skip
    assert (event.web_url is not None) is kept
    assert (RichText(web_url=url).web_url is not None) is kept


def test_internal_links_are_rewritten(settings: Settings):
    p, cfg, _ = _cfg(settings)
    page = p.rewrite_internal_link(cfg, f"{CANVAS}/courses/101/pages/week-1")
    assert page is not None
    assert (page.kind, page.ref) == ("page", "week-1")
    rel = p.rewrite_internal_link(cfg, "/courses/101/assignments/11")
    assert rel is not None
    assert (rel.kind, rel.ref) == ("assignment", "11")
    assert p.rewrite_internal_link(cfg, "https://other.example/courses/1/pages/x") is None


async def test_default_ports_are_the_same_origin(
    settings: Settings, io: Io, mock: respx.MockRouter
):
    p, cfg, creds = _cfg(settings)
    mock.get(f"{API}/courses/3/pages").mock(
        side_effect=lambda request: Response(200, json=[{"url": "b", "title": "B"}])
        if request.url.params.get("page") == "2"
        else Response(200, json=[{"url": "a", "title": "A"}],
                      headers={"link": f'<{CANVAS}:443/api/v1/courses/3/pages?page=2>; rel="next"'})
    )  # fmt: skip
    assert [page.ref for page in await p.pages(io, cfg, creds, "3")] == ["a", "b"]


def test_links_with_bad_ports_are_not_internal(settings: Settings):
    p, cfg, _ = _cfg(settings)
    assert p.rewrite_internal_link(cfg, "https://example.edu:notaport/courses/1/pages/a") is None
    assert p.rewrite_internal_link(cfg, f"{CANVAS}:99999/courses/1/pages/a") is None


def test_file_cdn_hosts_match_whole_labels():
    p = CanvasProvider()
    base = "https://canvas.example.edu"
    assert p._allowed_hop(base, "https://instructure-uploads.s3.amazonaws.com/f")
    assert p._allowed_hop(base, "https://a.instructure-uploads.s3.amazonaws.com/f")
    assert not p._allowed_hop(base, "https://evilinstructure-uploads.s3.amazonaws.com/f")
    assert not p._allowed_hop(base, "https://evilinstructure.com/f")


async def test_tab_links_read_state_and_front_page(
    settings: Settings, io: Io, mock: respx.MockRouter
):
    """Fields the Canvas tab relies on, as the Canvas API docs describe them."""
    p, cfg, creds = _cfg(settings)
    mock.get(f"{API}/courses/1/tabs").mock(
        return_value=Response(200, json=[
            {"id": "context_external_tool_4", "label": "Zoom", "type": "external",
             "html_url": "/courses/1/external_tools/4", "position": 1},
        ])
    )  # fmt: skip
    mock.get(f"{API}/announcements").mock(
        return_value=Response(200, json=[
            {"id": 1, "title": "New", "read_state": "unread", "posted_at": "2026-01-02T00:00:00Z"},
            {"id": 2, "title": "Old", "read_state": "read", "posted_at": "2026-01-01T00:00:00Z"},
        ])
    )  # fmt: skip
    front = mock.get(f"{API}/courses/1/front_page").mock(
        return_value=Response(200, json={"url": "welcome", "title": "Welcome", "front_page": True,
                                         "body": "<p>Hi</p>"})
    )  # fmt: skip
    [tab] = await p.navigation(io, cfg, creds, "1")
    assert tab.web_url == f"{CANVAS}/courses/1/external_tools/4"
    news = await p.announcements(io, cfg, creds, "1")
    assert [(a.title, a.unread) for a in news] == [("New", True), ("Old", False)]
    page = await p.page(io, cfg, creds, "1", FRONT_PAGE_REF)
    assert (page.ref, page.front_page, page.html) == ("welcome", True, "<p>Hi</p>")
    assert front.called


async def test_student_details_are_mapped(settings: Settings, io: Io, mock: respx.MockRouter):
    """Locks, rubrics, attempts, module progress, quiz limits and feedback (M16 第二轮)."""
    canvas_api(mock)
    ok = lambda payload: Response(200, json=payload)  # noqa: E731
    mock.get(f"{API}/courses/101/assignment_groups").mock(
        return_value=ok([{"id": 1, "name": "Labs", "assignments": [
            {"id": 11, "name": "Lab 1", "points_possible": 10, "locked_for_user": True,
             "lock_explanation": "Locked until <b>Feb 1</b>.", "allowed_attempts": -1,
             "rubric": [{"id": "_1", "description": "Code", "points": 10,
                         "ratings": [{"id": "r1", "description": "Full", "points": 10}]}],
             "submission": {"workflow_state": "graded", "score": 8, "attempt": 2}},
        ]}])
    )  # fmt: skip
    mock.get(f"{API}/courses/101/modules").mock(
        return_value=ok([{"id": 3, "name": "Week 2", "state": "locked",
                          "prerequisite_module_ids": [2], "require_sequential_progress": True}])
    )  # fmt: skip
    mock.get(f"{API}/courses/101/modules/3/items").mock(
        return_value=ok([{"id": 30, "title": "Lab 1", "type": "Assignment", "content_id": 11,
                          "completion_requirement": {"type": "must_submit", "completed": False},
                          "content_details": {"points_possible": 10, "locked_for_user": True,
                                              "due_at": "2026-02-07T04:59:00Z",
                                              "lock_explanation": "Finish Week 1 first."}}])
    )  # fmt: skip
    mock.get(f"{API}/courses/101/quizzes").mock(
        return_value=ok([{"id": 8, "title": "Quiz 1", "time_limit": 30, "allowed_attempts": 2,
                          "assignment_id": 12}])
    )  # fmt: skip
    route = mock.get(f"{API}/courses/101/assignments/11/submissions/self").mock(
        return_value=ok({"id": 70, "score": 8, "grade": "8", "attempt": 2,
                         "workflow_state": "graded",
                         "submission_comments": [{"author_name": "Prof", "comment": "Nice",
                                                  "created_at": "2026-02-10T12:00:00Z"}],
                         "rubric_assessment": {"_1": {"points": 8, "rating_id": None,
                                                      "comments": "Tidy"}}})
    )  # fmt: skip
    p, cfg, creds = _cfg(settings)

    [a] = await p.assignments(io, cfg, creds, "101")
    assert (a.locked, a.lock_explanation, a.allowed_attempts) == (
        True, "Locked until <b>Feb 1</b>.", -1
    )  # fmt: skip
    assert a.submission is not None
    assert a.submission.attempt == 2
    assert [(c.id, c.points, [r.id for r in c.ratings]) for c in a.rubric] == [("_1", 10, ["r1"])]

    [module] = await p.modules(io, cfg, creds, "101")
    assert (module.state, module.prerequisite_module_ids, module.require_sequential_progress) == (
        "locked", ["2"], True
    )  # fmt: skip
    [item] = await p.module_items(io, cfg, creds, "101", "3")
    assert item.completion is not None
    assert (item.completion.type, item.completion.completed) == ("must_submit", False)
    assert (item.locked, item.points, item.lock_explanation) == (True, 10, "Finish Week 1 first.")

    [quiz] = await p.quizzes(io, cfg, creds, "101")
    assert (quiz.time_limit, quiz.allowed_attempts, quiz.assignment_id) == (30, 2, "12")

    detail = await p.submission(io, cfg, creds, "101", "11")
    assert (detail.score, detail.attempt, detail.assignment_id) == (8, 2, "11")
    assert [(c.author, c.comment) for c in detail.comments] == [("Prof", "Nice")]
    assert [(r.criterion_id, r.points, r.comments) for r in detail.rubric_scores] == [
        ("_1", 8, "Tidy")
    ]
    query = route.calls[0].request.url.params.get_list("include[]")
    assert set(query) == {"submission_comments", "rubric_assessment"}


async def test_folders_stay_in_the_course(settings: Settings, io: Io, mock: respx.MockRouter):
    canvas_api(mock)
    ok = lambda payload: Response(200, json=payload)  # noqa: E731
    root = {"id": 50, "name": "course files", "full_name": "course files", "folders_count": 1}
    lectures = {"id": 51, "name": "Lectures", "full_name": "course files/Lectures",
                "parent_folder_id": 50, "files_count": 1}  # fmt: skip
    mock.get(f"{API}/courses/101/folders/root").mock(return_value=ok(root))
    mock.get(f"{API}/courses/101/folders/51").mock(return_value=ok(lectures))
    mock.get(f"{API}/courses/101/folders/99").mock(return_value=Response(404, json={}))
    mock.get(f"{API}/folders/50/folders").mock(
        return_value=ok([lectures, {**lectures, "id": 52, "hidden_for_user": True}])
    )
    mock.get(f"{API}/folders/50/files").mock(return_value=ok([]))
    mock.get(f"{API}/folders/51/folders").mock(return_value=ok([]))
    mock.get(f"{API}/folders/51/files").mock(
        return_value=ok([{"id": 77, "display_name": "Week 1.pptx", "size": 10,
                          "content-type": "application/vnd.ms-powerpoint"}])
    )  # fmt: skip
    mock.get(f"{API}/courses/101/folders/by_path/Lectures").mock(return_value=ok([root, lectures]))
    mock.get(f"{API}/courses/101/files").mock(
        return_value=ok([{"id": 77, "display_name": "Week 1.pptx"}])
    )
    p, cfg, creds = _cfg(settings)

    top = await p.folder(io, cfg, creds, "101", None)
    assert (top.folder.name, top.folder.path) == ("course files", "")
    assert [f.name for f in top.folders] == ["Lectures"]  # hidden folders are left out
    inner = await p.folder(io, cfg, creds, "101", "51")
    assert [f.name for f in inner.trail] == ["course files", "Lectures"]
    assert [(f.external_id, f.name) for f in inner.files] == [("77", "Week 1.pptx")]
    assert inner.folder.web_url == f"{CANVAS}/courses/101/files/folder/Lectures"
    # A folder of another course is not found under this one.
    with pytest.raises(AppError) as exc:
        await p.folder(io, cfg, creds, "101", "99")
    assert exc.value.code == "common.not_found"
    [found] = await p.search_files(io, cfg, creds, "101", "week")
    assert found.name == "Week 1.pptx"


async def test_mark_read_puts(settings: Settings, io: Io, mock: respx.MockRouter):
    route = mock.put(f"{API}/courses/101/discussion_topics/5/read").mock(return_value=Response(204))
    p, cfg, creds = _cfg(settings)
    await p.mark_announcement_read(io, cfg, creds, "101", "5")
    assert route.calls[0].request.headers["authorization"] == f"Bearer {TOKEN}"
