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
                    "submission_comments": [
                        {"author_id": 99, "author_name": "Ada Lovelace", "comment": "Good",
                         "author": {"id": 99, "display_name": "Ada Lovelace"}}
                    ],
                }
            ],
        )  # fmt: skip
    if path.endswith("/files/678"):
        return httpx.Response(401, json={"status": "unauthorized"})
    if path.endswith("/files/678/download"):
        return httpx.Response(
            302, headers={"Location": "https://school.instructure.com/f?verifier=abc"}
        )
    if path.endswith("/files"):
        return httpx.Response(
            200,
            json=[
                {"id": i, "display_name": f"notes{i}.pdf",
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
    for secret in (TOKEN, "Ada Lovelace", "4242", "school.instructure.com", "verifier=v"):
        assert secret not in saved

    def case(name: str) -> dict:
        return json.loads((tmp_path / f"{name}.json").read_text())

    files = case("area-files")
    # File names stay (they tell the situations apart); a page of a list keeps its first items.
    assert [f["display_name"] for f in files["body"]] == ["notes0.pdf", "notes1.pdf", "notes2.pdf"]
    assert (files["items_in_page"], files["link_next"]) == (5, True)
    assert case("file-unpublished")["status"] == 401
    assert "www-authenticate" not in case("file-unpublished")["headers"]
    assert case("file-unpublished-download")["status"] == 302
    assert case("missing-page")["status"] == 404
    assert case("bad-token")["headers"]["www-authenticate"] == "Bearer"
