"""Fills a running Semestra with a realistic account over its HTTP API, the way the app would.

    python -m devtools seed --origin http://localhost:8000 --outbox data/dev-outbox.jsonl

The account (sign-up through the dev email outbox, so the server must run with
SEMESTRA_ENV=dev and SEMESTRA_EMAIL_BACKEND=console) gets one Program with three terms (last
term's courses finished with final marks, this term's five courses with sections, gradebooks,
exams and tasks, next term planned), all dated relative to today from `devtools/catalog.py`.

`--canvas <url>` also connects the fake Canvas, links this term's courses to its courses of the
same code and starts a sync; `--ai <url>` adds the fake model server as a provider for every
purpose. Prints the account and the ids it made as JSON on the last line.
"""

import json
import re
import time
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx

from devtools import catalog

CATEGORY_COLORS = {
    "Quizzes": "amber",
    "Labs": "emerald",
    "Exams": "rose",
    "Problem sets": "blue",
    "Homework": "blue",
    "Project": "violet",
}
AI_PURPOSES = ("chat", "extraction", "vision", "ocr", "title", "embedding")


@dataclass
class Account:
    email: str = "demo@example.com"
    password: str = "semestra-demo-1"
    name: str = "Demo Student"


class Session:
    """Keeps the session cookies and sends the CSRF header, like the SPA."""

    def __init__(self, origin: str):
        self.http = httpx.Client(base_url=origin, timeout=60)

    def call(self, method: str, path: str, body: Any = None) -> Any:
        headers = {}
        if csrf := self.http.cookies.get("semestra_csrf"):
            headers["x-semestra-csrf"] = csrf
        response = self.http.request(method, path, json=body, headers=headers)
        if response.is_error:
            raise SystemExit(f"{method} {path}: {response.status_code} {response.text[:500]}")
        return None if response.status_code == 204 else response.json()

    def post(self, path: str, body: Any = None) -> Any:
        return self.call("POST", path, body)

    def put(self, path: str, body: Any = None) -> Any:
        return self.call("PUT", path, body)

    def patch(self, path: str, body: Any = None) -> Any:
        return self.call("PATCH", path, body)


def _code(outbox: Path, email: str) -> str | None:
    try:
        lines = outbox.read_text().splitlines()
    except FileNotFoundError:
        return None
    for line in reversed(lines):
        mail = json.loads(line)
        if mail.get("to") == email and (m := re.search(r"\b(\d{6})\b", mail.get("text", ""))):
            return m.group(1)
    return None


def sign_up(s: Session, outbox: Path, account: Account) -> None:
    s.post("/auth/email/start", {"email": account.email})
    for _ in range(50):
        if code := _code(outbox, account.email):
            break
        time.sleep(0.1)
    else:
        raise SystemExit(f"no sign-in code for {account.email} in {outbox}")
    verified = s.post("/auth/email/verify", {"email": account.email, "code": code})
    s.post(
        "/auth/register/complete",
        {
            "registration_token": verified["registration_token"],
            "display_name": account.name,
            "password": account.password,
        },
    )


def _course(s: Session, program: str, term: str, code: str, title: str, slot: int, **extra: Any):
    return s.post(
        f"/programs/{program}/courses",
        {
            "code": code,
            "title": title,
            "term_ids": [term],
            "credits": 0.5,
            "color": {"palette": slot % 12 + 1},
            **extra,
        },
    )


def seed_academics(s: Session) -> dict[str, Any]:
    today = catalog.on_day(0).date()
    start, end = catalog.term_start(), catalog.term_end()
    program = s.post(
        "/programs",
        {
            "name": "Computer Engineering",
            "institution": "Demo University",
            "timezone": "America/Toronto",
            "credit_requirement": 20,
        },
    )
    pid = program["id"]

    def term(name: str, first, last):
        made = s.post(
            f"/programs/{pid}/terms",
            {"name": name, "start_date": first.isoformat(), "end_date": last.isoformat()},
        )
        return made["term"]["id"]

    past = term(catalog.PAST_TERM_NAME, start - timedelta(weeks=36), start - timedelta(weeks=21))
    current = term(catalog.TERM_NAME, start, end)
    following = term("Next term", end + timedelta(weeks=4), end + timedelta(weeks=19))

    slot = 0
    for code, title, mark in catalog.PAST_COURSES:
        made = _course(s, pid, past, code, title, slot)
        slot += 1
        s.patch(
            f"/courses/{made['id']}/grade",
            {"basis": "percentage", "gradebook_enabled": False, "manual_percentage": mark},
        )
    for code, title in catalog.NEXT_COURSES:
        _course(s, pid, following, code, title, slot)
        slot += 1

    courses: dict[str, str] = {}
    for spec in catalog.COURSES:
        made = _course(
            s,
            pid,
            current,
            spec.code,
            spec.title,
            slot,
            instructors=[{"name": spec.instructor, "role": "Lecturer"}],
        )
        slot += 1
        cid = courses[spec.code] = made["id"]
        sections: dict[tuple[str, str], list[catalog.Meeting]] = {}
        for m in spec.meetings:
            sections.setdefault((m.kind, m.section), []).append(m)
        for (kind, section), times in sections.items():
            s.put(
                f"/courses/{cid}/sections",
                {
                    "term_id": current,
                    "type_code": kind,
                    "section_code": section,
                    "times": [
                        {
                            "weekday": m.weekday,
                            "start_time": m.start,
                            "end_time": m.end,
                            "location": m.location,
                        }
                        for m in times
                    ],
                },
            )
        categories: dict[str, str] = {}
        for a in spec.assessments:
            if a.category not in categories:
                made_cat = s.post(
                    f"/courses/{cid}/grading-categories",
                    {"name": a.category, "color": CATEGORY_COLORS.get(a.category, "blue")},
                )
                categories[a.category] = made_cat["id"]
        s.post(
            f"/courses/{cid}/assessments:batch",
            {
                "assessments": [
                    {
                        "title": a.title,
                        "category_id": categories[a.category],
                        "weight": a.weight,
                        "due_date": (today + timedelta(days=a.due_in_days)).isoformat(),
                        "score_percentage": a.score,
                    }
                    for a in spec.assessments
                ]
            },
        )
        s.patch(f"/courses/{cid}/grade", {"target_points": 3.7})
        for a in spec.assessments:
            if a.category == "Exams" and 0 <= a.due_in_days <= 21:
                day = today + timedelta(days=a.due_in_days)
                s.post(
                    f"/programs/{pid}/events",
                    {
                        "title": f"{spec.code} {a.title}",
                        "start_at": f"{day}T18:00:00",
                        "end_at": f"{day}T20:00:00",
                        "course_id": cid,
                        "term_id": current,
                        "location": "EX 100",
                    },
                )

    def due(days: int) -> str:
        return (today + timedelta(days=days)).isoformat()

    prep = s.post(f"/programs/{pid}/task-lists", {"name": "Midterm prep", "term_id": current})
    personal = s.post(f"/programs/{pid}/task-lists", {"name": "Personal"})
    first = courses[catalog.COURSES[0].code]
    for title, extra in (
        (
            "Review Thévenin and Norton equivalents",
            {"course_id": first, "due_date": due(3), "priority": "high", "list_id": prep["id"]},
        ),
        (
            "Redo the 2025 practice midterm",
            {
                "course_id": first,
                "due_date": due(5),
                "priority": "urgent",
                "flagged": True,
                "list_id": prep["id"],
            },
        ),
        (
            "Lab 3 prelab: memory-mapped I/O",
            {
                "course_id": courses["ECE243H1"],
                "due_date": due(2),
                "due_time": "23:59:00",
                "priority": "medium",
            },
        ),
        (
            "Email TA about the Lab 2 regrade",
            {"course_id": courses["ECE231H1"], "due_date": due(1)},
        ),
        (
            "Read Sedra/Smith chapter 4",
            {"course_id": courses["ECE231H1"], "due_date": due(6), "priority": "low"},
        ),
        (
            "Update résumé for the career fair",
            {"list_id": personal["id"], "due_date": due(4), "flagged": True},
        ),
        ("Book flights home", {"list_id": personal["id"], "due_date": due(12)}),
        ("Call the bank", {"due_date": due(0)}),
    ):
        s.post(f"/programs/{pid}/tasks", {"title": title, **extra})
    return {"program_id": pid, "term_id": current, "course_ids": courses}


def connect_canvas(s: Session, made: dict[str, Any], canvas: str, *, sync: bool = True) -> None:
    state = httpx.get(f"{canvas.rstrip('/')}/_fake/state", timeout=10).json()
    by_code = {c["code"]: str(c["id"]) for c in state["courses"]}
    connection = s.post(
        "/lms/connections",
        {
            "provider": "canvas",
            "display_name": "Demo Canvas",
            "config": {"base_url": state["base_url"]},
            "credentials": {"access_token": "7~fake-canvas-demo-token"},
        },
    )
    s.put(f"/programs/{made['program_id']}/lms-binding", {"connection_id": connection["id"]})
    for code, cid in made["course_ids"].items():
        if code in by_code:
            s.put(f"/courses/{cid}/lms-link", {"external_course_id": by_code[code]})
    if sync:
        s.post(f"/programs/{made['program_id']}/lms/sync", {"force": True})


def connect_ai(s: Session, base_url: str) -> None:
    provider = s.post(
        "/ai/providers",
        {
            "kind": "openai_compatible",
            "display_name": "Fake AI",
            "base_url": base_url,
            "api_key": "fake-key",
            "capabilities": ["chat", "tools", "vision", "structured", "embedding"],
        },
    )
    for purpose in AI_PURPOSES:
        model = "fake-embed" if purpose == "embedding" else "fake-chat"
        s.put(
            "/ai/assignments", {"purpose": purpose, "provider_id": provider["id"], "model": model}
        )


def seed(
    origin: str, outbox: Path, account: Account, canvas: str | None = None, ai: str | None = None
) -> dict[str, Any]:
    s = Session(origin)
    sign_up(s, outbox, account)
    made = seed_academics(s)
    if ai:
        connect_ai(s, ai)
    if canvas:
        connect_canvas(s, made, canvas)
    return {
        "email": account.email,
        "password": account.password,
        **made,
        "cookies": dict(s.http.cookies.items()),
    }
