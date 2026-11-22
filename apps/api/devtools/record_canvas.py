"""Records how a real Canvas answers, read-only, for the platform answer table (M09 §4.1, table 2).

    CANVAS_TOKEN=... uv run python -m devtools record-canvas \\
        --base-url https://school.instructure.com --course 12345 \\
        [--item file:678:unpublished --item page:week-1:hidden ...] [--out DIR]

Only GET requests. The token is read from the `CANVAS_TOKEN` environment variable, never from the
command line, and is not written anywhere. Each response is saved as one JSON file: the status, the
headers table 2 depends on, and the body cut to its first items. What is kept from a body: its
shape, numbers and flags (ids of items, `locked_for_user`, `hidden_for_user`, `published`, …), and,
in the keys of `KEEP_STRINGS`, the platform's kinds, states and dates. Every other string
(names, titles, HTML, comments, slugs, addresses) becomes "[text]", ids of people and my scores and
grades become 1 (only whether they are there is kept), and a redirect keeps only whether it goes to
the school's Canvas or to another host. Look the files over before committing them: the repository
is public.

What it records:
- the course itself, its navigation (which areas are hidden), and the first page of every area list
  (files, folders, pages, modules, assignments, quizzes, announcements, discussions, my
  submissions, and the course's calendar events);
- an id that does not exist in each kind (a deleted item), and one request with a wrong token (an
  expired token's 401);
- each `--item KIND:ID:LABEL` (KIND is file, page, assignment, quiz, discussion, module or folder;
  LABEL names the situation). A file is also asked for its download, without following it. Table 2
  needs these situations, as many as the course has:
    an unpublished file, page and assignment (`unpublished`);
    a file shown only by link (`link-only`) and a file in a hidden folder (`hidden-folder`);
    a locked file and page (`locked`);
    a file, page or assignment whose area the teacher hid from the course menu, e.g. a file
    linked from a module while Files is hidden (`in-hidden-area`), both one that is published and
    one that is not (`in-hidden-area-unpublished`).
Rate limiting is not provoked.
"""

import json
import os
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

LIST_ITEMS = 3
HEADERS = ("www-authenticate", "x-rate-limit-remaining", "retry-after", "content-type", "location")
# Strings kept as they are: the platform's own words for kinds and states (an enum, never free
# text). Every other string becomes "[text]" (names, titles, HTML, comments, slugs, addresses), so
# nothing a teacher or student wrote, and no address with a person's id, reaches the file.
KEEP_STRINGS = frozenset(
    (
        "workflow_state",
        "state",
        "type",
        "submission_types",
        "grading_type",
        "visibility",
        "context_type",
        "mime_class",
        "content-type",
        "submission_type",
        "lock_at",
        "unlock_at",
        "due_at",
        "created_at",
        "updated_at",
        "modified_at",
        "posted_at",
        "submitted_at",
        "graded_at",
        "start_at",
        "end_at",
        "delayed_post_at",
        "completed_at",
    )
)
ENUM = re.compile(r"^[a-z][a-z_]{0,39}$")
STAMP = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)?$")
# My result on an assignment: only whether it is there is kept.
GRADES = frozenset(("score", "entered_score", "grade", "entered_grade", "points_deducted"))
# Ids that point to a person (in these keys, and every id inside these objects).
PEOPLE_IDS = frozenset(("user_id", "author_id", "grader_id", "submitter_id"))
PEOPLE = frozenset(("author", "user", "teachers", "participants", "grader", "assessor"))
AREAS = {
    "course": ("", {"include[]": ["term"]}),
    "navigation": ("/tabs", {}),
    "files": ("/files", {"per_page": "10"}),
    "folders": ("/folders", {"per_page": "10"}),
    "pages": ("/pages", {"per_page": "10"}),
    "modules": ("/modules", {"per_page": "10", "include[]": ["items"]}),
    "assignments": ("/assignments", {"per_page": "10"}),
    "quizzes": ("/quizzes", {"per_page": "10"}),
    "announcements": ("/discussion_topics", {"per_page": "10", "only_announcements": "true"}),
    "discussions": ("/discussion_topics", {"per_page": "10"}),
    "submissions": (
        "/students/submissions",
        {"per_page": "10", "include[]": ["submission_comments", "rubric_assessment"]},
    ),
}
# Areas not under /courses/:id.
OTHER_AREAS = {
    "calendar-events": (
        "/api/v1/calendar_events",
        {"type": "event", "all_events": "true", "per_page": "10"},
    ),
}
ITEMS = {
    "file": "/files/{id}",
    "folder": "/folders/{id}",
    "page": "/pages/{id}",
    "assignment": "/assignments/{id}",
    "quiz": "/quizzes/{id}",
    "discussion": "/discussion_topics/{id}",
    "module": "/modules/{id}",
}
MISSING_ID = "999999999"


@dataclass
class Item:
    kind: str
    id: str
    label: str

    @classmethod
    def parse(cls, raw: str) -> Item:
        kind, _, rest = raw.partition(":")
        ref, _, label = rest.rpartition(":")
        if kind not in ITEMS or not ref or not label:
            raise SystemExit(f"--item {raw}: write KIND:ID:LABEL, KIND one of {', '.join(ITEMS)}")
        return cls(kind, ref, re.sub(r"[^a-z0-9-]+", "-", label.lower()).strip("-"))


class Redactor:
    """Keeps the shape of a response and the platform's kinds, states, dates and flags; replaces
    everything written by people or pointing at them, the school's address and the token."""

    def __init__(self, base_url: str, token: str) -> None:
        self.host = urlsplit(base_url).netloc
        self.token = token

    def header(self, name: str, value: str) -> str:
        if name == "location":
            # A redirect keeps only where it goes (the school's Canvas or another host, such as a
            # file CDN); its path and query can hold a download credential.
            host = urlsplit(value).netloc
            return "canvas.example/[path]" if host in ("", self.host) else "other-host/[path]"
        return value.replace(self.token, "[token]") if self.token else value

    def body(self, value: Any, key: str = "", *, person: bool = False) -> Any:
        if isinstance(value, dict):
            return {k: self.body(v, k, person=person or k in PEOPLE) for k, v in value.items()}
        if isinstance(value, list):
            return [self.body(v, key, person=person) for v in value[:LIST_ITEMS]]
        if value is None or isinstance(value, bool):
            return value
        if key in GRADES:
            return 1
        if key in PEOPLE_IDS or (person and key == "id"):
            return 1
        if isinstance(value, str):
            if value == "":
                return ""
            if key in KEEP_STRINGS and (ENUM.match(value) or STAMP.match(value)):
                return value
            return "[text]"
        return value


def _record(
    client: httpx.Client,
    redact: Redactor,
    case: str,
    path: str,
    params: dict[str, Any],
    *,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    response = client.get(path, params=params, headers=headers or {})
    try:
        body: Any = response.json()
    except ValueError:
        body = response.text[:500]
    total = len(body) if isinstance(body, list) else None
    return {
        "case": case,
        "request": {"method": "GET", "path": path, "params": params},
        "status": response.status_code,
        "headers": {
            h: redact.header(h, response.headers[h]) for h in HEADERS if h in response.headers
        },
        "link_next": 'rel="next"' in response.headers.get("link", ""),
        "items_in_page": total,
        "body": redact.body(body),
    }


def cases(course: str, items: Iterable[Item]) -> list[tuple[str, str, dict[str, Any]]]:
    root = f"/api/v1/courses/{course}"
    out = [(f"area-{name}", root + path, params) for name, (path, params) in AREAS.items()]
    out += [
        (f"area-{name}", path, {**params, "context_codes[]": [f"course_{course}"]})
        for name, (path, params) in OTHER_AREAS.items()
    ]
    out += [
        (f"missing-{kind}", root + path.format(id=MISSING_ID), {}) for kind, path in ITEMS.items()
    ]
    for item in items:
        path = root + ITEMS[item.kind].format(id=item.id)
        out.append((f"{item.kind}-{item.label}", path, {}))
        if item.kind == "file":
            out.append((f"{item.kind}-{item.label}-download", f"{path}/download", {}))
    return out


def record(
    base_url: str,
    token: str,
    course: str,
    items: Iterable[Item],
    out: Path,
    *,
    transport: httpx.BaseTransport | None = None,
    say: Callable[[str], None] = print,
) -> list[Path]:
    redact = Redactor(base_url, token)
    out.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    auth = {"Authorization": f"Bearer {token}"}
    with httpx.Client(
        base_url=base_url, headers=auth, transport=transport, timeout=30, follow_redirects=False
    ) as client:
        todo: list[tuple[str, str, dict[str, Any], dict[str, str] | None]] = [
            (case, path, params, None) for case, path, params in cases(course, items)
        ]
        todo.append(
            ("bad-token", f"/api/v1/courses/{course}", {}, {"Authorization": "Bearer invalid-0000"})
        )
        for case, path, params, headers in todo:
            got = _record(client, redact, case, path, params, headers=headers)
            target = out / f"{case}.json"
            target.write_text(json.dumps(got, indent=2, ensure_ascii=False) + "\n")
            written.append(target)
            say(f"{got['status']}  {case}")
    return written


def main(base_url: str, course: str, items: list[str], out: Path) -> None:
    token = os.environ.get("CANVAS_TOKEN", "")
    if not token:
        raise SystemExit("set CANVAS_TOKEN to an access token (Canvas → Account → Settings)")
    record(base_url.rstrip("/"), token, course, [Item.parse(i) for i in items], out)
    print(f"saved in {out}; look the files over before committing them")
