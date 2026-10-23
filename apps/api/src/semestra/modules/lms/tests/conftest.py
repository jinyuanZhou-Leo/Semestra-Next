"""A fake provider (module logic without any platform), a fake Canvas API (respx) and HTTP helpers
for the LMS tests (M09 §11)."""

from collections.abc import AsyncIterator, Awaitable, Callable, Iterator, Sequence
from datetime import datetime
from typing import Any, ClassVar, cast

import pytest
import respx
from httpx import AsyncClient, Response
from pydantic import BaseModel, Field, SecretStr

from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.providers import Io, register_lms_provider, unregister_lms_provider
from semestra.modules.lms.schemas.dto import (
    ALL_FEATURES,
    Announcement,
    Assignment,
    ConnectionSummary,
    FileMeta,
    Folder,
    FolderListing,
    GradeItem,
    InternalRef,
    LmsCalendarEvent,
    LmsCourse,
    LmsFeature,
    Module,
    ModuleItem,
    NavTab,
    PageDetail,
    PageSummary,
    Quiz,
    RichText,
    RubricScore,
    SubmissionComment,
    SubmissionDetail,
)
from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]

CANVAS = "https://canvas.example.edu"
TOKEN = "7~SECRETSECRETSECRETtoken"
WINTER = {"name": "Winter 2026", "start_date": "2026-01-05", "end_date": "2026-04-24"}


# --- fake provider --------------------------------------------------------------------------


class FakeConfig(BaseModel):
    base_url: str = Field(description="Address")


class FakeCredentials(BaseModel):
    token: SecretStr = Field(description="Token")


class FakeProvider:
    """An in-memory LMS. Tests change `courses`, `assignments`, ... and read `calls`."""

    kind: ClassVar[str] = "fake"
    display_name: ClassVar[str] = "Fake LMS"
    config_model: ClassVar[type[BaseModel]] = FakeConfig
    credentials_model: ClassVar[type[BaseModel]] = FakeCredentials
    features: ClassVar[frozenset[LmsFeature]] = ALL_FEATURES

    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.valid_tokens = {"good-token-1", "good-token-2"}
        self.courses = [
            LmsCourse(external_id="101", name="Computer Fundamentals", code="APS105H1 S LEC0101",
                      term="Winter 2026"),
            LmsCourse(external_id="102", name="Calculus I", code="MAT186H1 S", term="Winter 2026"),
            LmsCourse(external_id="90", name="Old course", code="OLD100", term="Fall 2025",
                      is_current=False),
        ]  # fmt: skip
        self.course_assignments: dict[str, list[Assignment]] = {
            "101": [
                Assignment(external_id="a1", name="Lab 1", due_at=datetime.fromisoformat(
                    "2026-02-06T23:59:00-05:00"), points=10, group_id="g1", group_name="Labs",
                    group_weight=20, html="<p onclick='x'>Do it</p>",
                    updated_at=datetime.fromisoformat("2026-01-10T00:00:00+00:00")),
                Assignment(external_id="a2", name="Lab 2", due_at=datetime.fromisoformat(
                    "2026-02-20T23:59:00-05:00"), points=30, group_id="g1", group_name="Labs",
                    group_weight=20),
                Assignment(external_id="a3", name="Midterm", points=100, group_id="g2",
                           group_name="Exams", group_weight=80,
                           due_at=datetime.fromisoformat("2026-03-01T10:00:00-05:00")),
            ]
        }  # fmt: skip
        self.events: list[LmsCalendarEvent] = []

    def normalize_config(self, raw: dict[str, Any], settings: Settings) -> BaseModel:
        url = str(raw.get("base_url") or "").rstrip("/")
        if not url.startswith("https://"):
            raise lms_error("lms.invalid_config", field="base_url", reason="scheme")
        return FakeConfig(base_url=url)

    def normalize_credentials(self, raw: dict[str, Any]) -> BaseModel:
        return FakeCredentials.model_validate({"token": raw.get("token") or ""})

    def mask_credentials(self, creds: BaseModel) -> dict[str, str]:
        token = cast(FakeCredentials, creds).token.get_secret_value()
        return {"token": f"{token[:2]}…"}

    def rewrite_internal_link(self, cfg: BaseModel, url: str) -> InternalRef | None:
        if "/pages/" in url:
            return InternalRef(kind="page", ref=url.rsplit("/", 1)[-1])
        return None

    def _auth(self, creds: BaseModel) -> None:
        if cast(FakeCredentials, creds).token.get_secret_value() not in self.valid_tokens:
            raise lms_error("lms.invalid_credentials")

    async def validate(self, io: Io, cfg: BaseModel, creds: BaseModel) -> ConnectionSummary:
        self.calls.append(("validate", None))
        self._auth(creds)
        return ConnectionSummary(account_name="Ada Student", instance_name="fake.example.edu")

    async def list_courses(
        self, io: Io, cfg: BaseModel, creds: BaseModel, *, include_past: bool
    ) -> list[LmsCourse]:
        self.calls.append(("list_courses", include_past))
        self._auth(creds)
        return [c for c in self.courses if include_past or c.is_current]

    async def get_course(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> LmsCourse:
        self.calls.append(("get_course", course_id))
        self._auth(creds)
        for c in self.courses:
            if c.external_id == course_id:
                return c.model_copy(update={"web_url": f"https://fake/courses/{course_id}"})
        raise lms_error("lms.forbidden")

    async def navigation(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[NavTab]:
        return [NavTab(external_id="home", kind="home", label="Home")]

    async def announcements(
        self,
        io: Io,
        cfg: BaseModel,
        creds: BaseModel,
        course_ids: Sequence[str],
        *,
        since: datetime | None = None,
    ) -> list[Announcement]:
        self.calls.append(("announcements", list(course_ids)))
        return [
            Announcement(
                external_id=f"n{course_id}", external_course_id=course_id, title="Welcome",
                html='<p>Hi <script>alert(1)</script><a href="https://fake/courses/1/pages/intro">'
                     "intro</a></p>",
            )
            for course_id in course_ids
        ]  # fmt: skip

    async def assignments(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[Assignment]:
        self.calls.append(("assignments", course_id))
        return [a.model_copy() for a in self.course_assignments.get(course_id, [])]

    async def grade_totals(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[GradeItem]:
        self.calls.append(("grade_totals", course_id))
        return [GradeItem(external_id="t", name="total", score=91.5, kind="total")]

    async def modules(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[Module]:
        self.calls.append(("modules", course_id))
        intro = ModuleItem(external_id="i1", title="Intro", kind="page",
                           lock_explanation="<p>Opens <b>Monday</b></p>")  # fmt: skip
        return [
            Module(external_id="m1", name="Week 1", item_count=1, items=[intro]),
            Module(external_id="m2", name="Week 2", item_count=40),  # too many to send along
        ]

    async def module_items(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, module_id: str
    ) -> list[ModuleItem]:
        return [ModuleItem(external_id="i1", title="Intro", kind="page",
                           target=InternalRef(kind="page", ref="intro"))]  # fmt: skip

    async def pages(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[PageSummary]:
        return [PageSummary(external_id="p1", ref="intro", title="Intro")]

    async def page(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, page_ref: str
    ) -> PageDetail:
        return PageDetail(external_id="p1", ref=page_ref, title="Intro",
                          html="<h1 style='x'>Intro</h1><iframe src='x'></iframe>")  # fmt: skip

    async def quizzes(self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str) -> list[Quiz]:
        return [Quiz(external_id="q1", title="Quiz 1")]

    async def syllabus(self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str) -> RichText:
        return RichText(html="<p>Labs 20%, midterm 80%</p>")

    async def file(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, file_id: str
    ) -> FileMeta:
        self.calls.append(("file", file_id))
        return FileMeta(external_id=file_id, name="notes.txt", mime_type="text/plain", size_bytes=5)

    async def open_file(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, file: FileMeta
    ) -> AsyncIterator[bytes]:
        yield b"he"
        yield b"llo"

    async def submission(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, assignment_id: str
    ) -> SubmissionDetail:
        self.calls.append(("submission", assignment_id))
        return SubmissionDetail(
            external_id=f"s-{assignment_id}", assignment_id=assignment_id, score=8, attempt=1,
            comments=[SubmissionComment(author="Prof", comment="Good work")],
            rubric_scores=[RubricScore(criterion_id="c1", points=8)],
        )  # fmt: skip

    async def folder(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, folder_id: str | None
    ) -> FolderListing:
        self.calls.append(("folder", folder_id))
        root = Folder(external_id="f0", name="course files", path="", folders_count=1)
        sub = Folder(external_id="f1", name="Lectures", path="Lectures", parent_id="f0")
        if folder_id in (None, "f0"):
            return FolderListing(folder=root, trail=[root], folders=[sub], files=[])
        if folder_id == "f1":
            notes = FileMeta(external_id="9", name="notes.txt", mime_type="text/plain")
            return FolderListing(folder=sub, trail=[root, sub], folders=[], files=[notes])
        raise AppError("common.not_found", 404)

    async def search_files(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, term: str
    ) -> list[FileMeta]:
        return [FileMeta(external_id="9", name="notes.txt")] if term in "notes.txt" else []

    async def mark_announcement_read(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, announcement_id: str
    ) -> None:
        self.calls.append(("mark_read", announcement_id))

    async def calendar_events(
        self,
        io: Io,
        cfg: BaseModel,
        creds: BaseModel,
        course_ids: Sequence[str],
        start: datetime,
        end: datetime,
    ) -> list[LmsCalendarEvent]:
        self.calls.append(("calendar_events", sorted(course_ids)))
        return [e for e in self.events if e.external_course_id in course_ids]


@pytest.fixture
def fake() -> Iterator[FakeProvider]:
    provider = FakeProvider()
    register_lms_provider(provider)
    yield provider
    unregister_lms_provider("fake")


# --- HTTP helpers ---------------------------------------------------------------------------


class Api:
    def __init__(self, client: AsyncClient) -> None:
        self.client = client

    async def call(self, method: str, url: str, status: int = 200, **kwargs: Any) -> Any:
        r = await self.client.request(method, url, **kwargs)
        assert r.status_code == status, r.text
        return r.json()

    async def program(self) -> str:
        body = {"name": "BASc", "timezone": "America/Toronto"}
        return (await self.call("POST", "/programs", json=body))["id"]

    async def term(self, program_id: str) -> str:
        return (await self.call("POST", f"/programs/{program_id}/terms", json=WINTER))["term"]["id"]

    async def course(self, program_id: str, term_id: str, **body: Any) -> str:
        payload = {"title": "Computer Fundamentals", "code": "APS105H1", "term_ids": [term_id]}
        out = await self.call("POST", f"/programs/{program_id}/courses", json={**payload, **body})
        return out["id"]

    async def connection(self, token: str = "good-token-1", **body: Any) -> dict[str, Any]:  # noqa: S107
        payload = {
            "provider": "fake",
            "config": {"base_url": "https://fake.example.edu"},
            "credentials": {"token": token},
        }
        return await self.call("POST", "/lms/connections", json={**payload, **body})

    async def bind(self, program_id: str, connection_id: str, status: int = 200) -> Any:
        return await self.call(
            "PUT", f"/programs/{program_id}/lms-binding", status,
            json={"connection_id": connection_id},
        )  # fmt: skip

    async def link(self, course_id: str, external_id: str, status: int = 200, **body: Any) -> Any:
        return await self.call(
            "PUT", f"/courses/{course_id}/lms-link", status,
            json={"external_course_id": external_id, **body},
        )  # fmt: skip

    async def commit(self, session_id: str, status: int = 200, **body: Any) -> Any:
        return await self.call("POST", f"/imports/{session_id}:commit", status, json=body)


@pytest.fixture
async def api(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> Api:
    await login_as(client, await make_user())
    return Api(client)


@pytest.fixture
def mock() -> Iterator[respx.MockRouter]:
    with respx.mock(assert_all_called=False, assert_all_mocked=True) as router:
        yield router  # pyright: ignore[reportReturnType]


def canvas_api(router: respx.MockRouter) -> None:
    """A small Canvas instance: one user, course 101 with a bit of everything."""
    api = f"{CANVAS}/api/v1"
    ok = lambda payload, **kw: Response(200, json=payload, **kw)  # noqa: E731
    router.get(f"{api}/users/self/profile").mock(
        return_value=ok({"id": 1, "name": "Ada Student", "avatar_url": "https://x/a.png"})
    )
    router.get(f"{api}/courses").mock(
        return_value=ok([
            {"id": 101, "name": "Computer Fundamentals", "course_code": "APS105H1 S",
             "term": {"name": "Winter 2026"}, "workflow_state": "available"},
        ])
    )  # fmt: skip
    router.get(f"{api}/courses/101").mock(
        return_value=ok({"id": 101, "name": "Computer Fundamentals", "course_code": "APS105H1 S",
                         "default_view": "modules", "apply_assignment_group_weights": True,
                         "syllabus_body": "<p>Syllabus</p>"})
    )  # fmt: skip
    router.get(f"{api}/courses/101/tabs").mock(
        return_value=ok([
            {"id": "home", "label": "Home", "position": 1, "type": "internal"},
            {"id": "context_external_tool_9", "label": "Zoom", "position": 3, "type": "external"},
            {"id": "people", "label": "People", "position": 2, "type": "internal"},
        ])
    )  # fmt: skip
    router.get(f"{api}/announcements").mock(
        return_value=ok([{"id": 5, "title": "Hello", "message": "<p>Hi</p>",
                          "posted_at": "2026-01-10T12:00:00Z", "html_url": f"{CANVAS}/a/5"}])
    )  # fmt: skip
    router.get(f"{api}/courses/101/assignment_groups").mock(
        return_value=ok([
            {"id": 1, "name": "Labs", "group_weight": 20, "assignments": [
                {"id": 11, "name": "Lab 1", "due_at": "2026-02-07T04:59:00Z",
                 "points_possible": 10, "html_url": f"{CANVAS}/courses/101/assignments/11",
                 "submission": {"workflow_state": "graded", "score": 9,
                                "graded_at": "2026-02-10T12:00:00Z"}},
            ]},
        ])
    )  # fmt: skip
    router.get(f"{api}/courses/101/enrollments").mock(
        return_value=ok([{"id": 7, "type": "StudentEnrollment",
                          "grades": {"current_score": 90, "current_grade": "A"}}])
    )  # fmt: skip
    router.get(f"{api}/courses/101/modules").mock(
        return_value=ok([{"id": 3, "name": "Week 1", "position": 1, "items_count": 2}])
    )
    router.get(f"{api}/courses/101/modules/3/items").mock(
        return_value=ok([
            {"id": 30, "title": "Intro", "type": "Page", "page_url": "intro", "position": 1},
            {"id": 31, "title": "Slides", "type": "File", "content_id": 77, "position": 2},
        ])
    )  # fmt: skip
    router.get(f"{api}/courses/101/pages").mock(
        return_value=ok([{"page_id": 4, "url": "intro", "title": "Intro"}])
    )
    router.get(f"{api}/courses/101/pages/intro").mock(
        return_value=ok({"page_id": 4, "url": "intro", "title": "Intro", "body": "<p>Body</p>"})
    )
    router.get(f"{api}/courses/101/quizzes").mock(
        return_value=ok([{"id": 8, "title": "Quiz 1", "points_possible": 5}])
    )
    router.get(f"{api}/courses/101/files/77").mock(
        return_value=ok({"id": 77, "display_name": "slides.pdf", "content-type": "application/pdf",
                         "size": 4, "url": f"{CANVAS}/files/77/download?verifier=v"})
    )  # fmt: skip
    router.get(f"{CANVAS}/files/77/download").mock(
        return_value=Response(302, headers={"location": "https://cdn.inscloudgate.net/f/77"})
    )
    router.get("https://cdn.inscloudgate.net/f/77").mock(
        return_value=Response(200, content=b"%PDF")
    )
    router.get(f"{api}/courses/101/assignments/11/submissions/self").mock(
        return_value=ok({"id": 70, "score": 9, "workflow_state": "graded"})
    )
    root = {"id": 50, "name": "course files", "full_name": "course files"}
    router.get(f"{api}/courses/101/folders/root").mock(return_value=ok(root))
    router.get(f"{api}/folders/50/folders").mock(return_value=ok([]))
    router.get(f"{api}/folders/50/files").mock(
        return_value=ok([{"id": 77, "display_name": "slides.pdf"}])
    )
    router.get(f"{api}/calendar_events").mock(
        return_value=ok([
            {"id": 900, "title": "Lecture", "start_at": "2026-01-12T14:00:00Z",
             "end_at": "2026-01-12T15:00:00Z", "context_code": "course_101"},
        ])
    )  # fmt: skip
