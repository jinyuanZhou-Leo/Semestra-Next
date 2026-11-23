"""Records how a real Canvas answers, read-only, for the platform answer table (M09 §4.1, table 2).

    CANVAS_TOKEN=... uv run python -m devtools record-canvas \\
        --base-url https://school.instructure.com --course 12345 \\
        [--item file:678:unpublished --item page:week-1:hidden ...] [--out DIR]

Only GET requests. The token is read from the `CANVAS_TOKEN` environment variable, never from the
command line, and is not written anywhere. Each response is saved as one JSON file: the status, the
headers table 2 depends on, and the body cut to its first items. What is kept from a body: its
shape, numbers and flags (ids of items, `locked_for_user`, `hidden_for_user`, `published`, …), and,
in the keys of `KEEP_STRINGS`, the platform's kinds, states, dates and file types; the course menu
is kept whole with its tabs' ids (which areas are open). Every other string
(names, titles, HTML, comments, slugs, addresses) becomes "[text]", ids of people, my scores and
grades and file sizes become 1 (only whether they are there is kept), every other id is renumbered
(the same id gets the same number in every file of one recording, so references between them still
match), the recorded request names the course and item as `{course}` and `{item}`, and a redirect
keeps only whether it goes to the school's Canvas or to another host. Look the files over before
committing them: the repository is public.

What it records:
- the course itself, its navigation (which areas are hidden), and the first page of every area list
  (files, folders, pages, modules, assignments, quizzes, announcements, discussions, my
  submissions, and the course's calendar events);
- an id that does not exist in each kind (a deleted item), and one request with a wrong token (an
  expired token's 401);
- each `--item KIND:ID:LABEL` (KIND is file, page, assignment, quiz, discussion, module or folder;
  LABEL names the situation). A file is also asked for its download (the address in its `url`),
  without following it. Table 2
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
        "quiz_type",
        "discussion_type",
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
# Besides those, any key that names a time keeps a date (`cached_due_date`, …).
DATE_KEY = re.compile(r"(_at|_date)$")
# The platform's words: `online_upload`, `File`, `ExternalUrl`, a menu tab's id (`files`)...
ENUM = re.compile(r"^[A-Za-z][A-Za-z_]{0,39}$")
MIME = re.compile(r"^[a-z]+/[a-z0-9.+-]{1,60}$")
STAMP = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)?$")
# My result on an assignment: only whether it is there is kept.
GRADES = frozenset(("score", "entered_score", "grade", "entered_grade", "points_deducted"))
# A file's exact size would match one file: only whether it is there is kept.
SIZES = frozenset(("size", "size_bytes"))
# Ids that point to a person (in these keys, and every id inside these objects).
PEOPLE_IDS = frozenset(("user_id", "author_id", "grader_id", "submitter_id"))
PEOPLE = frozenset(
    ("author", "user", "teachers", "participants", "grader", "assessor", "last_edited_by", "editor")
)
# Any object with one of these keys is a person, whatever key it sits under.
PERSON_KEYS = frozenset(("avatar_image_url", "avatar_url", "sortable_name", "pronouns"))
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
        self.ids: dict[str, int] = {}

    def renumber(self, raw: object) -> int:
        """The id's number in this recording: the same id is the same number in every file."""
        return self.ids.setdefault(str(raw), 1001 + len(self.ids))

    def _id(self, value: Any, key: str) -> Any:
        if isinstance(value, bool) or not isinstance(value, int | str):
            return value
        if isinstance(value, str) and not value.isdigit():
            # A menu tab's own id is the platform's word (`files`); any other id that is not a
            # number can be someone's (`sis_user_id`: a login name).
            word = key == "id" and ENUM.match(value) and value.islower()
            return value if not value or word else "[text]"
        n = self.renumber(value)
        return n if isinstance(value, int) else str(n)

    def header(self, name: str, value: str) -> str:
        if name == "location":
            # A redirect keeps only where it goes (the school's Canvas or another host, such as a
            # file CDN); its path and query can hold a download credential.
            host = urlsplit(value).netloc
            return "canvas.example/[path]" if host in ("", self.host) else "other-host/[path]"
        return value.replace(self.token, "[token]") if self.token else value

    def body(
        self, value: Any, key: str = "", *, person: bool = False, items: int | None = LIST_ITEMS
    ) -> Any:
        if isinstance(value, dict):
            person = person or bool(PERSON_KEYS & value.keys())
            return {
                k: self.body(v, k, person=person or k in PEOPLE, items=items)
                for k, v in value.items()
            }
        if isinstance(value, list):
            return [self.body(v, key, person=person, items=items) for v in value[:items]]
        if value is None or isinstance(value, bool):
            return value
        if key in GRADES or (key in SIZES and isinstance(value, int)):
            return 1
        if key in PEOPLE_IDS or (person and key == "id"):
            return 1
        if key == "id" or key.endswith(("_id", "_ids")):
            return self._id(value, key)
        if isinstance(value, str):
            if value == "":
                return ""
            kept = key in KEEP_STRINGS or DATE_KEY.search(key)
            if kept and (ENUM.match(value) or STAMP.match(value) or MIME.match(value)):
                return value
            return "[text]"
        return value


@dataclass
class Case:
    name: str
    path: str  # what is requested
    shown: str  # what the file says was requested: `{course}` and `{item}` for the real ids
    params: dict[str, Any]
    headers: dict[str, str] | None = None
    whole: bool = False  # every item of the list kept (the course menu: which areas are open)


def _record(client: httpx.Client, redact: Redactor, case: Case) -> tuple[dict[str, Any], Any]:
    """The saved answer, and the body as the platform sent it (for a file's download address)."""
    response = client.get(case.path, params=case.params, headers=case.headers or {})
    try:
        body: Any = response.json()
    except ValueError:
        body = response.text[:500]
    total = len(body) if isinstance(body, list) else None
    params = {
        k: ["course_{course}" if str(v).startswith("course_") else v for v in vs]
        if isinstance(vs, list)
        else vs
        for k, vs in case.params.items()
    }
    saved = {
        "case": case.name,
        "request": {"method": "GET", "path": case.shown, "params": params},
        "status": response.status_code,
        "headers": {
            h: redact.header(h, response.headers[h]) for h in HEADERS if h in response.headers
        },
        "link_next": 'rel="next"' in response.headers.get("link", ""),
        "items_in_page": total,
        "body": redact.body(body, items=None if case.whole else LIST_ITEMS),
    }
    return saved, body


def cases(course: str, items: Iterable[Item]) -> list[Case]:
    root, shown = f"/api/v1/courses/{course}", "/api/v1/courses/{course}"
    out = [
        Case(f"area-{name}", root + path, shown + path, params, whole=name == "navigation")
        for name, (path, params) in AREAS.items()
    ]
    out += [
        Case(f"area-{name}", path, path, {**params, "context_codes[]": [f"course_{course}"]})
        for name, (path, params) in OTHER_AREAS.items()
    ]
    out += [
        Case(
            f"missing-{kind}",
            root + path.format(id=MISSING_ID),
            shown + path.format(id=MISSING_ID),
            {},
        )
        for kind, path in ITEMS.items()
    ]
    out += [
        Case(
            f"{item.kind}-{item.label}",
            root + ITEMS[item.kind].format(id=item.id),
            shown + ITEMS[item.kind].format(id="{item}"),
            {},
        )
        for item in items
    ]
    out.append(Case("bad-token", root, shown, {}, {"Authorization": "Bearer invalid-0000"}))
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

    def save(saved: dict[str, Any]) -> None:
        target = out / f"{saved['case']}.json"
        target.write_text(json.dumps(saved, indent=2, ensure_ascii=False) + "\n")
        written.append(target)
        say(f"{saved['status']}  {saved['case']}")

    with httpx.Client(
        base_url=base_url, headers=auth, transport=transport, timeout=30, follow_redirects=False
    ) as client:
        for case in cases(course, items):
            saved, body = _record(client, redact, case)
            save(saved)
            # A file's download is where its `url` points (as the app follows it), not followed.
            url = body.get("url") if isinstance(body, dict) else None
            if case.name.startswith("file-") and isinstance(url, str) and url:
                download = Case(f"{case.name}-download", url, "[the file's url]", {})
                save(_record(client, redact, download)[0])
    return written


def main(base_url: str, course: str, items: list[str], out: Path) -> None:
    token = os.environ.get("CANVAS_TOKEN", "")
    if not token:
        raise SystemExit("set CANVAS_TOKEN to an access token (Canvas → Account → Settings)")
    record(base_url.rstrip("/"), token, course, [Item.parse(i) for i in items], out)
    print(f"saved in {out}; look the files over before committing them")
