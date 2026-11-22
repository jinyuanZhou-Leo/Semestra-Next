"""Records how a real Canvas answers, read-only, for the platform answer table (M09 §4.1, table 2).

    CANVAS_TOKEN=... uv run python -m devtools record-canvas \\
        --base-url https://school.instructure.com --course 12345 \\
        [--item file:678:unpublished --item page:week-1:hidden ...] [--out DIR]

Only GET requests. The token is read from the `CANVAS_TOKEN` environment variable, never from the
command line, and is not written anywhere. Each response is saved as one JSON file: status, the
headers table 2 depends on, and the body cut to its first items, with names, emails, ids of people,
the school's address and download verifiers replaced. Look the files over before committing them.

What it records:
- the course itself, its navigation (which areas are hidden), and the first page of every area list
  (files, folders, pages, modules, assignments, quizzes, announcements, discussions, calendar
  events, my submissions);
- each `--item KIND:ID:LABEL` the owner picks to show one situation of table 2 (KIND is file, page,
  assignment, quiz, discussion, module or folder; LABEL names the situation, e.g. unpublished,
  locked, hidden, deleted). A file is also asked for its download, without following it;
- an id that does not exist in each kind (a deleted item), and one request with a wrong token (an
  expired token's 401).
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
# Keys whose values name or reach a person: replaced in every body.
PERSONAL = frozenset(
    (
        "sortable_name",
        "email",
        "login_id",
        "avatar_url",
        "avatar_image_url",
        "pronouns",
        "user_name",
        "author_name",
        "sis_user_id",
        "integration_id",
    )
)
PEOPLE_IDS = frozenset(("user_id", "author_id", "grader_id", "submitter_id"))
# Item names stay (they tell the situations apart) unless they are a person's: inside these.
PEOPLE = frozenset(("author", "user", "teachers", "participants", "grader", "assessor"))
IN_PEOPLE = frozenset(("name", "display_name", "short_name", "id", "html_url"))
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
# Query parameters that let anyone download a file.
SECRET_PARAMS = r"([?&](?:verifier|download_frd|access_token|sf_verifier)=)[^&\"#]*"


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
    """Replaces what identifies the school or a person, keeping the shape of the response."""

    def __init__(self, base_url: str, token: str) -> None:
        self.host = urlsplit(base_url).netloc
        self.token = token

    def text(self, value: str) -> str:
        if self.token:
            value = value.replace(self.token, "[token]")
        value = re.sub(SECRET_PARAMS, r"\1x", value)
        return value.replace(self.host, "canvas.example") if self.host else value

    def body(self, value: Any, *, personal: bool = False) -> Any:
        if isinstance(value, dict):
            out: dict[str, Any] = {}
            for key, item in value.items():
                if key in PERSONAL or (personal and key in IN_PEOPLE):
                    out[key] = "[redacted]" if item is not None else None
                elif key in PEOPLE_IDS:
                    out[key] = 1 if item is not None else None
                else:
                    out[key] = self.body(item, personal=personal or key in PEOPLE)
            return out
        if isinstance(value, list):
            return [self.body(v, personal=personal) for v in value[:LIST_ITEMS]]
        if isinstance(value, str):
            return self.text(value)
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
        "request": {"method": "GET", "path": redact.text(path), "params": params},
        "status": response.status_code,
        "headers": {h: redact.text(response.headers[h]) for h in HEADERS if h in response.headers},
        "link_next": 'rel="next"' in response.headers.get("link", ""),
        "items_in_page": total,
        "body": redact.body(body),
    }


def cases(course: str, items: Iterable[Item]) -> list[tuple[str, str, dict[str, Any]]]:
    root = f"/api/v1/courses/{course}"
    out = [(f"area-{name}", root + path, params) for name, (path, params) in AREAS.items()]
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
