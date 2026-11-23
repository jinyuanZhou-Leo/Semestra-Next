"""The Canvas recording (devtools/record_canvas.py) only reads, and keeps no token, person or
school address in what it saves."""

import json
from pathlib import Path

import httpx

from devtools.record_canvas import TIME, Item, record

TOKEN = "7~secret-token-value"


def _canvas(request: httpx.Request) -> httpx.Response:
    assert request.method == "GET"
    path = request.url.path
    if request.headers["authorization"] != f"Bearer {TOKEN}":
        return httpx.Response(401, headers={"WWW-Authenticate": "Bearer"}, json={"errors": []})
    if path.endswith("/students/submissions"):
        return httpx.Response(
            200,
            json=[
                {
                    "id": 5,
                    "user_id": 4242,
                    "assignment_id": 7,
                    "sis_user_id": "smithj",
                    "cached_due_date": "2026-02-08T04:59:59Z",
                    "workflow_state": "graded",
                    "score": 87.5,
                    "attempt": 3,
                    "seconds_late": 0,
                    "body": "<p>My essay, Grace Hopper</p>",
                    "preview_url": "https://school.instructure.com/courses/12/assignments/7/submissions/4242?preview=1",
                    "submission_comments": [
                        {"author_id": 99, "author_name": "Ada Lovelace", "comment": "Good",
                         "author": {"id": 99, "display_name": "Ada Lovelace"}}
                    ],
                }
            ],
        )  # fmt: skip
    if path.endswith("/pages"):
        return httpx.Response(
            200,
            json=[{"url": "week-1", "last_edited_by": {"id": 31337, "display_name": "Prof X"},
                   "editor": {"id": 31338, "avatar_image_url": "https://a.example/p.png"}}],
        )  # fmt: skip
    if path.endswith("/tabs"):
        return httpx.Response(
            200,
            json=[{"id": t, "label": "Ada's tab", "type": "internal"}
                  for t in ("home", "modules", "assignments", "grades", "context_external_tool_9")],
        )  # fmt: skip
    if path.endswith("/modules"):
        return httpx.Response(
            200,
            json=[{"id": 3, "items": [{"id": 4, "type": "File", "content_id": 678,
                                      "title": "Notes by Ada"}]}],
        )  # fmt: skip
    if path == "/api/v1/calendar_events":
        assert request.url.params.get_list("context_codes[]") == ["course_12"]
        assert "/" not in request.url.params.get_list("context_codes[]")[0]
        return httpx.Response(200, json=[])
    if path.endswith("/assignments/7"):
        return httpx.Response(200, json={"id": 7, "locked_for_user": True})
    if path.endswith("/pages/week-1"):
        return httpx.Response(200, json={"url": "week-1", "page_id": 70})
    if path.endswith("/courses/12/files/678"):
        return httpx.Response(
            200,
            json={
                "id": 678,
                "size": 734521,
                "content-type": "application/pdf",
                "url": "https://school.instructure.com/files/678/download?verifier=v",
            },
        )
    if path == "/files/678/download":
        return httpx.Response(
            302, headers={"Location": "https://cdn.example/files/7/token-in-path/notes.pdf"}
        )
    if path.endswith("/files"):
        return httpx.Response(
            200,
            json=[
                {"id": i, "display_name": f"notes{i}.pdf", "hidden_for_user": False,
                 "updated_at": "2026-02-01T10:00:00Z",
                 "url": f"https://school.instructure.com/files/{i}/download?verifier=v{i}"}
                for i in range(5)
            ],
            headers={"Link": '<https://school.instructure.com/x?page=2>; rel="next"'},
        )  # fmt: skip
    return httpx.Response(404, json={"errors": [{"message": "does not exist"}]})


def test_recording_reads_only_and_hides_people_school_and_token(tmp_path: Path):
    written = record(
        "https://school.instructure.com",
        TOKEN,
        "12",
        [
            Item.parse("file:678:in-hidden-area"),
            Item.parse("page:week-1:in-hidden-area"),
            Item.parse("assignment:7:locked"),
        ],
        tmp_path,
        transport=httpx.MockTransport(_canvas),
        say=lambda _: None,
    )
    saved = "".join(p.read_text() for p in written)
    for secret in (
        TOKEN, "Ada Lovelace", "Grace Hopper", "4242", "31337", "31338", "Prof X", "87.5",
        "school.instructure.com", "verifier", "token-in-path", "notes0.pdf", "week-1", "678",
        "734521", "smithj",
    ):  # fmt: skip
        assert secret not in saved

    def case(name: str) -> dict:
        return json.loads((tmp_path / f"{name}.json").read_text())

    files = case("area-files")
    # The shape and flags stay; what people wrote and when do not. A list keeps its first items.
    # Ids are renumbered, the same id the same number in every file.
    assert files["body"][0] == {
        "id": 1001, "display_name": "[text]", "hidden_for_user": False,
        "updated_at": "2000-01-01T00:00:00Z", "url": "[text]",
    }  # fmt: skip
    assert (len(files["body"]), files["items_in_page"], files["link_next"]) == (3, 5, True)
    mine = case("area-submissions")["body"][0]
    assert (mine["workflow_state"], mine["score"], mine["user_id"]) == ("graded", 1, 1)
    # A time is only there; a number other than none is only there.
    assert (mine["cached_due_date"], mine["attempt"], mine["seconds_late"]) == (TIME, 1, 0)
    locked = case("assignment-locked")
    assert locked["body"] == {"id": mine["assignment_id"], "locked_for_user": True}
    # The menu is whole, with its tabs' ids: which areas are open.
    tabs = case("area-navigation")["body"]
    assert [t["id"] for t in tabs] == ["home", "modules", "assignments", "grades", "[text]"]
    assert tabs[0]["label"] == "[text]"
    # A module item keeps its kind, and points at the file by the same number.
    [item] = case("area-modules")["body"][0]["items"]
    file = case("file-in-hidden-area")["body"]
    assert (item["type"], item["content_id"], item["title"]) == ("File", file["id"], "[text]")
    assert (file["content-type"], file["size"]) == ("application/pdf", 1)
    # The request names the course and the item, not their ids or a page's title.
    assert locked["request"]["path"] == "/api/v1/courses/{course}/assignments/{item}"
    assert case("page-in-hidden-area")["request"]["path"] == "/api/v1/courses/{course}/pages/{item}"
    # A file's download is asked where its `url` points, and not followed.
    download = case("file-in-hidden-area-download")
    assert download["request"]["path"] == "[the file's url]"
    assert (download["status"], download["headers"]["location"]) == (302, "other-host/[path]")
    # The course's calendar, not the user's own.
    calendar = case("area-calendar-events")
    assert calendar["status"] == 200
    assert calendar["request"]["params"]["context_codes[]"] == ["course_{course}"]
    assert case("missing-page")["status"] == 404
    assert case("bad-token")["headers"]["www-authenticate"] == "Bearer"
