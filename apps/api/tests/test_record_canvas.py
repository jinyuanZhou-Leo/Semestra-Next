"""The Canvas recording (devtools/record_canvas.py) only reads, and keeps no token, person or
school address in what it saves."""

import json
from pathlib import Path

import httpx

from devtools.record_canvas import Item, record

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
                    "workflow_state": "graded",
                    "score": 87.5,
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
    if path == "/api/v1/calendar_events":
        assert request.url.params.get_list("context_codes[]") == ["course_12"]
        return httpx.Response(200, json=[])
    if path.endswith("/files/678"):
        return httpx.Response(401, json={"status": "unauthorized"})
    if path.endswith("/files/678/download"):
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
        [Item.parse("file:678:unpublished")],
        tmp_path,
        transport=httpx.MockTransport(_canvas),
        say=lambda _: None,
    )
    saved = "".join(p.read_text() for p in written)
    for secret in (
        TOKEN, "Ada Lovelace", "Grace Hopper", "4242", "31337", "31338", "Prof X", "87.5",
        "school.instructure.com", "verifier", "token-in-path", "notes0.pdf",
    ):  # fmt: skip
        assert secret not in saved

    def case(name: str) -> dict:
        return json.loads((tmp_path / f"{name}.json").read_text())

    files = case("area-files")
    # The shape, flags and dates stay; what people wrote does not. A list keeps its first items.
    assert files["body"][0] == {
        "id": 0, "display_name": "[text]", "hidden_for_user": False,
        "updated_at": "2026-02-01T10:00:00Z", "url": "[text]",
    }  # fmt: skip
    assert (len(files["body"]), files["items_in_page"], files["link_next"]) == (3, 5, True)
    mine = case("area-submissions")["body"][0]
    assert (mine["workflow_state"], mine["score"], mine["user_id"]) == ("graded", 1, 1)
    assert case("file-unpublished")["status"] == 401
    assert "www-authenticate" not in case("file-unpublished")["headers"]
    download = case("file-unpublished-download")
    assert (download["status"], download["headers"]["location"]) == (302, "other-host/[path]")
    # The course's calendar, not the user's own.
    assert case("area-calendar-events")["status"] == 200
    assert case("missing-page")["status"] == 404
    assert case("bad-token")["headers"]["www-authenticate"] == "Bearer"
