"""A fake Canvas LMS: the REST endpoints Semestra's Canvas provider reads, answered from the data in
`world.py`, so LMS work can be reproduced and debugged without a school's Canvas.

Any non-empty access token is accepted. Lists are paginated with `Link: rel="next"` like Canvas
(`per_page`, at most 100; the `large` scenario serves 25 a page). Areas a teacher turned off answer
like Canvas does: pages with 404, files with 401 (no WWW-Authenticate).

File downloads redirect to this same server. Real Canvas redirects to its file store on another
domain, where the provider drops the Authorization header and checks `FILE_CDN_SUFFIXES`; that
cross-domain hop is not covered here and needs a real Canvas to verify.

Besides the shared `/_fake/faults` and `/_fake/requests` (see `devtools/control.py`):

    GET  /_fake/state     the courses (id, code, name) and the base URL
    POST /_fake/reset     rebuild the data (`{"scenario": "large"}` to switch)
    POST /_fake/changes   change something like a teacher would, e.g.
        {"op": "add_assignment", "course": "ECE201H1", "name": "Lab 4", "due_in_days": 9}
        {"op": "change_due", "assignment": 1234, "due_in_days": 3}
        {"op": "delete_assignment", "assignment": 1234}
        {"op": "grade", "assignment": 1234, "score": 8.5, "comment": "Nice work"}
        {"op": "announce", "course": "ECE201H1", "title": "Room change", "message": "<p>…</p>"}
        {"op": "add_file", "course": "ECE201H1", "name": "Notes.pdf", "folder": "Lectures"}
        {"op": "replace_file", "file": 1234}
        {"op": "delete_file", "file": 1234}
"""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import unquote

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, RedirectResponse, Response
from starlette.routing import Route

from devtools.control import Control, ControlMiddleware
from devtools.fake_canvas import content
from devtools.fake_canvas.world import PDF, USER_ID, Course, Json, build, days, iso

Handler = Callable[[Request], Awaitable[Response]]


class CanvasError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


def error_body(status: int, message: str) -> dict[str, Any]:
    return {"errors": [{"message": message}], "status": str(status)}


def _since(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


class FakeCanvas:
    def __init__(self, base: str, scenario: str = "default"):
        self.base = base.rstrip("/")
        self.scenario = scenario
        self.world = build(self.base, scenario)
        self.control = Control()

    # --- helpers ------------------------------------------------------------------------------

    def course(self, request: Request, area: str | None = None) -> Course:
        try:
            course = self.world.course(request.path_params["cid"])
        except KeyError:
            raise CanvasError(404, "The specified resource does not exist.") from None
        if area in course.hidden:
            if area == "files":
                raise CanvasError(401, "user not authorized to perform that action")
            raise CanvasError(404, "That page has been disabled for this course")
        return course

    def page(self, request: Request, rows: list[Json]) -> Response:
        size = min(int(request.query_params.get("per_page") or 10), 100, self.world.page_size)
        number = max(int(request.query_params.get("page") or 1), 1)
        chunk = rows[(number - 1) * size : number * size]
        headers = {}
        links = [
            f'<{request.url.include_query_params(page=number, per_page=size)}>; rel="current"',
            f'<{request.url.include_query_params(page=1, per_page=size)}>; rel="first"',
        ]
        if number * size < len(rows):
            links.append(
                f'<{request.url.include_query_params(page=number + 1, per_page=size)}>; rel="next"'
            )
        headers["Link"] = ",".join(links)
        return JSONResponse(chunk, headers=headers)

    def endpoint(self, fn: Callable[[Request], Any]) -> Handler:
        async def handler(request: Request) -> Response:
            if not request.headers.get("authorization", "").removeprefix("Bearer ").strip():
                return JSONResponse(
                    error_body(401, "Invalid access token."),
                    401,
                    headers={"WWW-Authenticate": 'Bearer realm="canvas-lms"'},
                )
            try:
                result = fn(request)
                if isinstance(result, Awaitable):
                    result = await result
            except CanvasError as exc:
                return JSONResponse(error_body(exc.status, exc.message), exc.status)
            if isinstance(result, Response):
                return result
            if isinstance(result, list):
                return self.page(request, result)
            return JSONResponse(result)

        return handler

    # --- the Canvas API -----------------------------------------------------------------------

    def profile(self, request: Request) -> Json:
        return {
            "id": USER_ID,
            "name": "Demo Student",
            "short_name": "Demo",
            "primary_email": "student@example.edu",
            "avatar_url": None,
            "time_zone": "America/Toronto",
        }

    def courses(self, request: Request) -> list[Json]:
        state = request.query_params.get("enrollment_state")
        rows = []
        for c in self.world.courses.values():
            done = c.workflow_state == "completed"
            if (state == "completed" and not done) or (state in (None, "active") and done):
                continue
            rows.append(
                c.summary()
                | {
                    "enrollments": [
                        {"type": "student", "enrollment_state": "completed" if done else "active"}
                    ]
                }
            )
        return rows

    def course_detail(self, request: Request) -> Json:
        course = self.course(request)
        out = course.summary()
        if "syllabus_body" in request.query_params.getlist("include[]"):
            out["syllabus_body"] = course.syllabus
        return out

    def tabs(self, request: Request) -> list[Json]:
        return self.course(request).tabs

    def announcements(self, request: Request) -> list[Json]:
        codes = set(request.query_params.getlist("context_codes[]"))
        start, end = (
            _since(request.query_params.get("start_date")),
            _since(request.query_params.get("end_date")),
        )
        rows = []
        for a in self.world.announcements:
            posted = _since(a["posted_at"])
            if a["context_code"] not in codes or not posted:
                continue
            if (start and posted < start) or (end and posted > end):
                continue
            rows.append(
                a | {"read_state": "read" if a["id"] in self.world.read else a["read_state"]}
            )
        return sorted(rows, key=lambda a: a["posted_at"], reverse=True)

    def assignment_groups(self, request: Request) -> list[Json]:
        course = self.course(request, "assignments")
        include = request.query_params.getlist("include[]")
        out = []
        for g in course.groups:
            group = dict(g)
            if "assignments" in include:
                group["assignments"] = [
                    a
                    | (
                        {"submission": course.submissions[a["id"]]}
                        if "submission" in include
                        else {}
                    )
                    for a in course.assignments
                    if a["assignment_group_id"] == g["id"]
                ]
                if "score_statistics" not in include:
                    for a in group["assignments"]:
                        a.pop("score_statistics", None)
            out.append(group)
        return out

    def enrollments(self, request: Request) -> list[Json]:
        course = self.course(request)
        return [
            {
                "id": course.id * 10,
                "user_id": USER_ID,
                "type": "StudentEnrollment",
                "enrollment_state": "active",
                "course_id": course.id,
                "grades": {
                    "current_score": course.score,
                    "current_grade": course.grade,
                    "html_url": self.world.url(f"/courses/{course.id}/grades/{USER_ID}"),
                },
            }
        ]

    def modules(self, request: Request) -> list[Json]:
        course = self.course(request, "modules")
        include = request.query_params.getlist("include[]")
        return [
            m if "items" in include else {k: v for k, v in m.items() if k != "items"}
            for m in course.modules
        ]

    def module_items(self, request: Request) -> list[Json]:
        course = self.course(request, "modules")
        for m in course.modules:
            if str(m["id"]) == request.path_params["mid"]:
                return m["items"]
        raise CanvasError(404, "The specified resource does not exist.")

    def pages(self, request: Request) -> list[Json]:
        course = self.course(request, "pages")
        return [
            {k: v for k, v in p.items() if k != "body"}
            for p in sorted(course.pages, key=lambda p: p["title"])
        ]

    def page_detail(self, request: Request) -> Json:
        course = self.course(request, "pages")
        ref = unquote(request.path_params.get("ref", ""))
        for p in course.pages:
            if (p["front_page"] and not ref) or p["url"] == ref or str(p["page_id"]) == ref:
                return p
        raise CanvasError(404, "The specified resource does not exist.")

    def discussion_topics(self, request: Request) -> list[Json]:
        course = self.course(request, "discussions")
        return [
            {k: v for k, v in d.items() if k not in ("view", "participants")}
            for d in course.discussions
        ]

    def _topic(self, request: Request) -> Json:
        course = self.course(request)
        tid = request.path_params["tid"]
        for d in course.discussions:
            if str(d["id"]) == tid:
                return d
        for a in self.world.announcements:
            if str(a["id"]) == tid and a["context_code"] == f"course_{course.id}":
                return a
        raise CanvasError(404, "The specified resource does not exist.")

    def discussion(self, request: Request) -> Json:
        return {k: v for k, v in self._topic(request).items() if k not in ("view", "participants")}

    def discussion_view(self, request: Request) -> Json:
        topic = self._topic(request)
        return {
            "view": topic.get("view", []),
            "participants": topic.get("participants", []),
            "unread_entries": [],
            "new_entries": [],
        }

    def mark_read(self, request: Request) -> Response:
        self.world.read.add(int(self._topic(request)["id"]))
        return Response(status_code=204)

    def quizzes(self, request: Request) -> list[Json]:
        return self.course(request, "quizzes").quizzes

    def files(self, request: Request) -> list[Json]:
        course = self.course(request, "files")
        rows = course.files
        if term := request.query_params.get("search_term"):
            rows = [f for f in rows if term.lower() in f["display_name"].lower()]
        if folder := request.query_params.get("folder_id"):
            rows = [f for f in rows if str(f["folder_id"]) == folder]
        return sorted(rows, key=lambda f: f["display_name"].lower())

    def file_detail(self, request: Request) -> Json:
        course = self.course(request, "files")
        for f in course.files:
            if str(f["id"]) == request.path_params["fid"]:
                return f
        raise CanvasError(404, "The specified resource does not exist.")

    def folders(self, request: Request) -> list[Json]:
        return self.course(request, "files").folders

    def folder(self, request: Request) -> Json:
        course = self.course(request, "files")
        ref = request.path_params["fid"]
        for f in course.folders:
            if (ref == "root" and f["parent_folder_id"] is None) or str(f["id"]) == ref:
                return f
        raise CanvasError(404, "The specified resource does not exist.")

    def folder_by_path(self, request: Request) -> list[Json]:
        course = self.course(request, "files")
        parts = [unquote(p) for p in request.path_params.get("path", "").split("/") if p]
        trail = [next(f for f in course.folders if f["parent_folder_id"] is None)]
        for name in parts:
            child = next(
                (
                    f
                    for f in course.folders
                    if f["parent_folder_id"] == trail[-1]["id"] and f["name"] == name
                ),
                None,
            )
            if child is None:
                raise CanvasError(404, "The specified resource does not exist.")
            trail.append(child)
        return trail

    def _folder_anywhere(self, request: Request) -> tuple[Course, Json]:
        for c in self.world.courses.values():
            for f in c.folders:
                if str(f["id"]) == request.path_params["fid"]:
                    if "files" in c.hidden:
                        raise CanvasError(401, "user not authorized to perform that action")
                    return c, f
        raise CanvasError(404, "The specified resource does not exist.")

    def subfolders(self, request: Request) -> list[Json]:
        course, folder = self._folder_anywhere(request)
        return sorted(
            (f for f in course.folders if f["parent_folder_id"] == folder["id"]),
            key=lambda f: f["name"],
        )

    def folder_files(self, request: Request) -> list[Json]:
        course, folder = self._folder_anywhere(request)
        return sorted(
            (f for f in course.files if f["folder_id"] == folder["id"]),
            key=lambda f: f["display_name"].lower(),
        )

    def _submission(self, course: Course, aid: int, include: list[str]) -> Json:
        sub = dict(course.submissions[aid])
        if "submission_comments" not in include:
            sub.pop("submission_comments", None)
        if "rubric_assessment" not in include:
            sub.pop("rubric_assessment", None)
        return sub

    def my_submission(self, request: Request) -> Json:
        course = self.course(request, "assignments")
        aid = int(request.path_params["aid"])
        if aid not in course.submissions:
            raise CanvasError(404, "The specified resource does not exist.")
        return self._submission(course, aid, request.query_params.getlist("include[]"))

    def my_submissions(self, request: Request) -> list[Json]:
        course = self.course(request, "assignments")
        include = request.query_params.getlist("include[]")
        return [self._submission(course, a["id"], include) for a in course.assignments]

    def calendar_events(self, request: Request) -> list[Json]:
        codes = set(request.query_params.getlist("context_codes[]"))
        start, end = (
            _since(request.query_params.get("start_date")),
            _since(request.query_params.get("end_date")),
        )
        rows = []
        for e in self.world.events:
            at = _since(e["start_at"])
            if (
                e["context_code"] in codes
                and at
                and not (start and at < start)
                and not (end and at > end)
            ):
                rows.append(e | {"type": "event", "all_day": False})
        return sorted(rows, key=lambda e: e["start_at"])

    # --- file downloads (Canvas redirects to its file store) ------------------------------------

    async def download(self, request: Request) -> Response:
        fid = int(request.path_params["fid"])
        if fid not in self.world.blobs:
            return PlainTextResponse("not found", 404)
        return RedirectResponse(f"/files/{fid}/blob?verifier=v{fid}", 302)

    async def blob(self, request: Request) -> Response:
        fid = int(request.path_params["fid"])
        if fid not in self.world.blobs:
            return PlainTextResponse("not found", 404)
        data, mime = self.world.blobs[fid]()
        return Response(data, media_type=mime)

    # --- controls -----------------------------------------------------------------------------

    async def state(self, request: Request) -> Response:
        return JSONResponse(
            {
                "base_url": self.base,
                "scenario": self.scenario,
                "courses": [
                    {"id": c.id, "code": c.code, "name": c.name, "state": c.workflow_state}
                    for c in self.world.courses.values()
                ],
            }
        )

    async def reset(self, request: Request) -> Response:
        body = await request.json() if await request.body() else {}
        self.scenario = body.get("scenario", self.scenario)
        self.world = build(self.base, self.scenario)
        return await self.state(request)

    async def changes(self, request: Request) -> Response:
        body = await request.json()
        try:
            result = self.change(body)
        except (KeyError, ValueError, StopIteration) as exc:
            return JSONResponse({"error": f"{type(exc).__name__}: {exc}"}, 400)
        return JSONResponse(result)

    def change(self, body: Json) -> Json:
        w = self.world
        now = iso(datetime.now(UTC))
        match body.get("op"):
            case "add_assignment":
                course = w.course(body["course"])
                group = next(
                    (g for g in course.groups if g["name"] == body.get("group")), course.groups[0]
                )
                return w.add_assignment(
                    course,
                    group,
                    body["name"],
                    float(body.get("due_in_days", 7)),
                    float(body.get("points", 10)),
                    updated_at=now,
                )
            case "change_due":
                _, a = w.find_assignment(body["assignment"])
                a.update(due_at=days(float(body["due_in_days"]), 23), updated_at=now)
                return a
            case "delete_assignment":
                course, a = w.find_assignment(body["assignment"])
                course.assignments.remove(a)
                return {"deleted": a["id"]}
            case "grade":
                course, a = w.find_assignment(body["assignment"])
                sub = course.submissions[a["id"]]
                score = float(body["score"])
                sub.update(
                    workflow_state="graded",
                    score=score,
                    grade=str(score),
                    graded_at=now,
                    submitted_at=sub.get("submitted_at") or now,
                )
                if body.get("comment"):
                    sub.setdefault("submission_comments", []).append(
                        {
                            "id": w.next_id(),
                            "author_id": 99,
                            "author_name": "TA Jordan",
                            "comment": body["comment"],
                            "created_at": now,
                        }
                    )
                return sub
            case "announce":
                course = w.course(body["course"])
                return w.announce(
                    course, body["title"], body.get("message") or f"<p>{body['title']}</p>", 0
                )
            case "add_file":
                course = w.course(body["course"])
                folder = next(
                    f for f in course.folders if f["name"] == body.get("folder", "course files")
                )
                name = body["name"]
                return w.add_file(
                    course,
                    folder,
                    name,
                    lambda: (content.pdf(name, "new material"), PDF),
                    updated=0,
                )
            case "replace_file":
                _, f = w.find_file(body["file"])
                version = f.get("version", 1) + 1
                title = f"{f['display_name']} (v{version})"
                w.blobs[f["id"]] = lambda: (content.pdf(title, "revised material"), PDF)
                f.update(
                    version=version,
                    updated_at=now,
                    modified_at=now,
                    size=len(w.blobs[f["id"]]()[0]),
                )
                return f
            case "delete_file":
                course, f = w.find_file(body["file"])
                course.files.remove(f)
                w.blobs.pop(f["id"], None)
                return {"deleted": f["id"]}
        raise ValueError(f"unknown op {body.get('op')!r}")

    # --- the app ------------------------------------------------------------------------------

    def app(self) -> ControlMiddleware:
        e = self.endpoint
        api = "/api/v1"
        course = f"{api}/courses/{{cid}}"
        routes = [
            Route(f"{api}/users/self/profile", e(self.profile)),
            Route(f"{api}/courses", e(self.courses)),
            Route(course, e(self.course_detail)),
            Route(f"{course}/tabs", e(self.tabs)),
            Route(f"{api}/announcements", e(self.announcements)),
            Route(f"{course}/assignment_groups", e(self.assignment_groups)),
            Route(f"{course}/enrollments", e(self.enrollments)),
            Route(f"{course}/modules", e(self.modules)),
            Route(f"{course}/modules/{{mid}}/items", e(self.module_items)),
            Route(f"{course}/pages", e(self.pages)),
            Route(f"{course}/front_page", e(self.page_detail)),
            Route(f"{course}/pages/{{ref}}", e(self.page_detail)),
            Route(f"{course}/discussion_topics", e(self.discussion_topics)),
            Route(f"{course}/discussion_topics/{{tid}}", e(self.discussion)),
            Route(f"{course}/discussion_topics/{{tid}}/view", e(self.discussion_view)),
            Route(f"{course}/discussion_topics/{{tid}}/read", e(self.mark_read), methods=["PUT"]),
            Route(f"{course}/quizzes", e(self.quizzes)),
            Route(f"{course}/files", e(self.files)),
            Route(f"{course}/files/{{fid}}", e(self.file_detail)),
            Route(f"{course}/folders", e(self.folders)),
            Route(f"{course}/folders/by_path/{{path:path}}", e(self.folder_by_path)),
            Route(f"{course}/folders/by_path", e(self.folder_by_path)),
            Route(f"{course}/folders/{{fid}}", e(self.folder)),
            Route(f"{api}/folders/{{fid}}/folders", e(self.subfolders)),
            Route(f"{api}/folders/{{fid}}/files", e(self.folder_files)),
            Route(f"{course}/assignments/{{aid}}/submissions/self", e(self.my_submission)),
            Route(f"{course}/students/submissions", e(self.my_submissions)),
            Route(f"{api}/calendar_events", e(self.calendar_events)),
            Route("/files/{fid}/download", self.download),
            Route("/files/{fid}/blob", self.blob),
            Route("/_fake/state", self.state),
            Route("/_fake/reset", self.reset, methods=["POST"]),
            Route("/_fake/changes", self.changes, methods=["POST"]),
        ]
        return ControlMiddleware(Starlette(routes=routes), self.control, error_body, canvas=True)


def create_app(base: str, scenario: str = "default") -> ControlMiddleware:
    return FakeCanvas(base, scenario).app()
