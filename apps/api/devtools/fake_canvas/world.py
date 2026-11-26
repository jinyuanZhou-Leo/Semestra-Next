"""The fake Canvas's data, kept in Canvas's own JSON shapes (what `/api/v1` returns), built from
the demo term in `devtools/catalog.py`, and changed at run time like a teacher would."""

import itertools
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from devtools import catalog
from devtools.fake_canvas import content

Json = dict[str, Any]
Blob = Callable[[], tuple[bytes, str]]

PDF = "application/pdf"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
USER_ID = 1


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def days(n: float, hour: int = 12) -> str:
    base = datetime.now(UTC).replace(hour=hour, minute=0, second=0, microsecond=0)
    return iso(base + timedelta(days=n))


@dataclass
class Course:
    id: int
    code: str
    name: str
    hidden: frozenset[str] = frozenset()
    workflow_state: str = "available"
    term: Json = field(default_factory=dict)
    tabs: list[Json] = field(default_factory=list)
    groups: list[Json] = field(default_factory=list)
    assignments: list[Json] = field(default_factory=list)
    submissions: dict[int, Json] = field(default_factory=dict)
    folders: list[Json] = field(default_factory=list)
    files: list[Json] = field(default_factory=list)
    pages: list[Json] = field(default_factory=list)
    modules: list[Json] = field(default_factory=list)
    discussions: list[Json] = field(default_factory=list)
    quizzes: list[Json] = field(default_factory=list)
    syllabus: str = ""
    score: float | None = None
    grade: str | None = None

    def summary(self) -> Json:
        return {
            "id": self.id,
            "name": self.name,
            "course_code": self.code,
            "term": self.term,
            "workflow_state": self.workflow_state,
            "default_view": "modules",
            "apply_assignment_group_weights": True,
            "start_at": self.term.get("start_at"),
            "end_at": self.term.get("end_at"),
        }


@dataclass
class World:
    base: str
    page_size: int = 100
    courses: dict[int, Course] = field(default_factory=dict)
    announcements: list[Json] = field(default_factory=list)
    events: list[Json] = field(default_factory=list)
    blobs: dict[int, Blob] = field(default_factory=dict)
    read: set[int] = field(default_factory=set)
    ids: itertools.count[int] = field(default_factory=lambda: itertools.count(1000))

    def next_id(self) -> int:
        return next(self.ids)

    def course(self, ref: str | int) -> Course:
        """A course by id or by its code ("ECE201H1")."""
        for c in self.courses.values():
            if str(c.id) == str(ref) or c.code.lower() == str(ref).lower():
                return c
        raise KeyError(f"no course {ref}")

    def find_assignment(self, ref: str | int) -> tuple[Course, Json]:
        for c in self.courses.values():
            for a in c.assignments:
                if str(a["id"]) == str(ref):
                    return c, a
        raise KeyError(f"no assignment {ref}")

    def find_file(self, ref: str | int) -> tuple[Course, Json]:
        for c in self.courses.values():
            for f in c.files:
                if str(f["id"]) == str(ref):
                    return c, f
        raise KeyError(f"no file {ref}")

    # --- building blocks -----------------------------------------------------------------

    def url(self, path: str) -> str:
        return f"{self.base}{path}"

    def add_folder(self, course: Course, name: str, parent: Json | None, **extra: Any) -> Json:
        folder = {
            "id": self.next_id(),
            "name": name,
            "full_name": f"{parent['full_name']}/{name}" if parent else name,
            "parent_folder_id": parent["id"] if parent else None,
            "files_count": 0,
            "folders_count": 0,
            "hidden_for_user": False,
            "locked_for_user": False,
            **extra,
        }
        if parent:
            parent["folders_count"] += 1
        course.folders.append(folder)
        return folder

    def add_file(
        self,
        course: Course,
        folder: Json,
        name: str,
        blob: Blob,
        *,
        updated: float = -20,
        **extra: Any,
    ) -> Json:
        fid = self.next_id()
        data, mime = blob()
        file = {
            "id": fid,
            "display_name": name,
            "filename": name.replace(" ", "_"),
            "content-type": mime,
            "size": len(data),
            "folder_id": folder["id"],
            "created_at": days(updated - 1),
            "updated_at": days(updated),
            "modified_at": days(updated),
            "url": self.url(f"/files/{fid}/download?download_frd=1&verifier=v{fid}"),
            "hidden_for_user": False,
            "locked_for_user": False,
            **extra,
        }
        folder["files_count"] += 1
        course.files.append(file)
        self.blobs[fid] = blob
        return file

    def add_assignment(
        self, course: Course, group: Json, name: str, due: float, points: float, **extra: Any
    ) -> Json:
        aid = self.next_id()
        assignment = {
            "id": aid,
            "name": name,
            "assignment_group_id": group["id"],
            "html_url": self.url(f"/courses/{course.id}/assignments/{aid}"),
            "description": f"<p>Instructions for <strong>{name}</strong>. Submit a single PDF. "
            f"Late work loses 10% per day.</p>",
            "due_at": days(due, 23),
            "unlock_at": days(due - 14, 9),
            "lock_at": None,
            "points_possible": points,
            "submission_types": ["online_upload"],
            "allowed_extensions": ["pdf"],
            "allowed_attempts": -1,
            "published": True,
            "updated_at": days(min(due, 0) - 10),
            "locked_for_user": False,
            "rubric": None,
            **extra,
        }
        course.assignments.append(assignment)
        course.submissions[aid] = {
            "id": self.next_id(),
            "assignment_id": aid,
            "user_id": USER_ID,
            "workflow_state": "unsubmitted",
            "submission_comments": [],
        }
        return assignment

    def announce(self, course: Course, title: str, html: str, posted: float, **extra: Any) -> Json:
        aid = self.next_id()
        row = {
            "id": aid,
            "title": title,
            "message": html,
            "posted_at": days(posted, 14),
            "created_at": days(posted, 14),
            "context_code": f"course_{course.id}",
            "html_url": self.url(f"/courses/{course.id}/discussion_topics/{aid}"),
            "author": {"display_name": "Course staff"},
            "read_state": "unread",
            "is_announcement": True,
            "discussion_subentry_count": 0,
            "attachments": [],
            **extra,
        }
        self.announcements.append(row)
        return row


RUBRIC = [
    {
        "id": "c1",
        "description": "Correctness",
        "points": 6,
        "long_description": "Results match the expected values for every part.",
        "ratings": [
            {"id": "r1", "description": "All correct", "points": 6},
            {"id": "r2", "description": "Mostly correct", "points": 4},
            {"id": "r3", "description": "Major errors", "points": 1},
        ],
    },
    {
        "id": "c2",
        "description": "Presentation",
        "points": 4,
        "long_description": "Labelled figures, units and a short discussion.",
        "ratings": [
            {"id": "r4", "description": "Clear", "points": 4},
            {"id": "r5", "description": "Hard to follow", "points": 2},
        ],
    },
]
TABS = (
    ("home", "Home"),
    ("announcements", "Announcements"),
    ("syllabus", "Syllabus"),
    ("modules", "Modules"),
    ("assignments", "Assignments"),
    ("quizzes", "Quizzes"),
    ("discussions", "Discussions"),
    ("grades", "Grades"),
    ("files", "Files"),
    ("pages", "Pages"),
)


def _letter(score: float) -> str:
    for cut, letter in ((85, "A"), (80, "A-"), (77, "B+"), (73, "B"), (70, "B-"), (60, "C")):
        if score >= cut:
            return letter
    return "F"


def _term(name: str, start: datetime, end: datetime) -> Json:
    return {
        "id": 1 if name == catalog.TERM_NAME else 2,
        "name": name,
        "start_at": iso(start),
        "end_at": iso(end),
    }


def _demo_course(world: World, spec: catalog.Course, term: Json) -> Course:
    course = Course(
        id=world.next_id(), code=spec.code, name=spec.title, hidden=spec.hidden, term=term
    )
    world.courses[course.id] = course
    cid = course.id
    position = itertools.count(1)
    course.tabs = [
        {
            "id": tab,
            "label": label,
            "type": "internal",
            "position": next(position),
            "html_url": f"/courses/{cid}" + ("" if tab == "home" else f"/{tab}"),
        }
        for tab, label in TABS
        if tab not in spec.hidden
    ] + [
        {
            "id": f"context_external_tool_{n}",
            "label": label,
            "type": "external",
            "position": next(position),
            "html_url": f"/courses/{cid}/external_tools/{n}",
        }
        for n, label in ((11, "Piazza"), (12, "Gradescope"))
    ]

    # Files: lectures, tutorials, labs, past exams, a hidden folder and a locked file.
    root = world.add_folder(course, "course files", None)
    lectures = world.add_folder(course, "Lectures", root)
    tutorials = world.add_folder(course, "Tutorials", root)
    labs = world.add_folder(course, "Labs", root)
    exams = world.add_folder(course, "Past exams", root)
    hidden = world.add_folder(course, "Instructor only", root, hidden_for_user=True)
    lecture_files = []
    for n, topic in enumerate(spec.topics, 1):
        title = f"Lecture {n:02d} - {topic}"
        lecture_files.append(
            world.add_file(
                course,
                lectures,
                f"{title}.pdf",
                lambda t=title, p=topic: (content.pdf(t, p), PDF),
                updated=-63 + n * 7,
            )
        )
    for n in range(1, 5):
        title = f"Tutorial {n} problems"
        world.add_file(
            course,
            tutorials,
            f"{title}.pdf",
            lambda t=title: (content.pdf(t, spec.topics[0], 2), PDF),
            updated=-60 + n * 14,
        )
    lab_specs = [a for a in spec.assessments if a.category in ("Labs", "Project")]
    for n, lab in enumerate(lab_specs):
        name = f"{lab.title} handout"
        if n == 0:
            world.add_file(
                course, labs, f"{name}.docx", lambda t=name: (content.docx(t, spec.topics[1]), DOCX)
            )
        else:
            world.add_file(
                course, labs, f"{name}.pdf", lambda t=name: (content.pdf(t, spec.topics[2]), PDF)
            )
    world.add_file(
        course,
        exams,
        "Midterm 2025.pdf",
        lambda: (content.pdf("Midterm 2025", spec.topics[3], 4), PDF),
        updated=-30,
    )
    world.add_file(
        course,
        exams,
        "Midterm 2025 solutions (scanned).pdf",
        lambda: (content.scanned_pdf(f"{spec.code} Midterm 2025 solutions"), PDF),
        updated=-30,
    )
    world.add_file(
        course,
        exams,
        "Final exam solutions.pdf",
        lambda: (content.pdf("Final exam solutions", spec.topics[4]), PDF),
        locked_for_user=True,
    )
    world.add_file(
        course, hidden, "Answer key.pdf", lambda: (content.pdf("Answer key", spec.topics[0]), PDF)
    )
    syllabus_file = world.add_file(
        course,
        root,
        "Course syllabus.pdf",
        lambda: (content.pdf(f"{spec.code} syllabus", spec.title, 2), PDF),
        updated=-65,
    )

    # Assignments by category, with submissions, comments and rubric scores.
    weights: dict[str, float] = {}
    for a in spec.assessments:
        weights[a.category] = weights.get(a.category, 0) + a.weight
    groups = {
        name: {"id": world.next_id(), "name": name, "group_weight": weight, "position": i}
        for i, (name, weight) in enumerate(weights.items(), 1)
    }
    course.groups = list(groups.values())
    earned = possible = 0.0
    for n, a in enumerate(spec.assessments):
        points = 100.0 if a.category in ("Exams", "Project") else 10.0
        quiz = a.category == "Quizzes"
        extra: Json = {"rubric": RUBRIC} if a.category == "Labs" else {}
        if quiz:
            extra |= {"is_quiz_assignment": True, "submission_types": ["online_quiz"]}
        if spec.code == "ECE231H1" and a.title == "Quiz 1":
            extra["description"] = None  # some teachers leave the details empty
        assignment = world.add_assignment(
            course, groups[a.category], a.title, a.due_in_days, points, **extra
        )
        sub = course.submissions[assignment["id"]]
        if a.score is not None:
            score = round(points * a.score / 100, 1)
            earned += a.score * a.weight
            possible += a.weight
            sub.update(
                workflow_state="graded",
                score=score,
                grade=str(score),
                attempt=1,
                submitted_at=days(a.due_in_days - 1, 20),
                graded_at=days(a.due_in_days + 4, 10),
                submission_type="online_upload",
                seconds_late=0,
                late=False,
                attachments=[
                    {
                        "id": syllabus_file["id"],
                        "display_name": f"{a.title}.pdf",
                        "content-type": PDF,
                        "size": 1200,
                        "url": syllabus_file["url"],
                    }
                ],
            )
            if n % 2 == 0:
                sub["submission_comments"] = [
                    {
                        "id": world.next_id(),
                        "author_id": 99,
                        "author_name": "TA Jordan",
                        "comment": f"Good work on {a.title}. Check the signs in part (b).",
                        "created_at": days(a.due_in_days + 4, 10),
                    },
                    {
                        "id": world.next_id(),
                        "author_id": USER_ID,
                        "author_name": "You",
                        "comment": "Thanks, I'll fix that next time.",
                        "created_at": days(a.due_in_days + 5, 9),
                    },
                ]
            if a.category == "Labs":
                sub["rubric_assessment"] = {
                    "c1": {
                        "points": 5 if a.score >= 90 else 4,
                        "rating_id": "r2",
                        "comments": "Part (c) is off by a factor of 2.",
                    },
                    "c2": {"points": 4, "rating_id": "r4"},
                }
            if quiz and n == 1:
                sub.update(late=True, seconds_late=3 * 3600, points_deducted=0.5)
            assignment["score_statistics"] = {
                "mean": round(points * 0.78, 1),
                "min": round(points * 0.35, 1),
                "max": points,
            }
        elif a.due_in_days in range(0, 4):
            sub.update(
                workflow_state="submitted",
                submitted_at=days(-1, 22),
                attempt=1,
                submission_type="online_upload",
            )
        if quiz:
            qid = world.next_id()
            assignment["quiz_id"] = qid
            course.quizzes.append(
                {
                    "id": qid,
                    "title": a.title,
                    "quiz_type": "assignment",
                    "assignment_id": assignment["id"],
                    "html_url": world.url(f"/courses/{cid}/quizzes/{qid}"),
                    "due_at": assignment["due_at"],
                    "points_possible": points,
                    "question_count": 8,
                    "time_limit": 30,
                    "allowed_attempts": 1,
                    "description": f"<p>{a.title} covers the first lectures.</p>",
                }
            )
    practice = world.next_id()
    course.quizzes.append(
        {
            "id": practice,
            "title": "Practice quiz",
            "quiz_type": "practice_quiz",
            "html_url": world.url(f"/courses/{cid}/quizzes/{practice}"),
            "question_count": 5,
            "allowed_attempts": -1,
        }
    )
    if possible:
        course.score = round(earned / possible, 1)
        course.grade = _letter(course.score)

    # Pages (unless the course turned them off).
    if "pages" not in spec.hidden:
        first_lab = next(
            (x for x in course.assignments if x["name"].startswith("Lab")), course.assignments[0]
        )
        bodies = {
            "course-home": (
                "Course home",
                f"<h2>Welcome to {spec.code}</h2><p>Start with the "
                f'<a href="{world.url(f"/courses/{cid}/assignments/syllabus")}">syllabus</a>.</p>',
            ),
            "course-policies": (
                "Course policies",
                "<h2>Late policy</h2><p>Late work loses 10% per "
                "day, up to three days. Each student has two grace days.</p><h2>Academic "
                "integrity</h2><p>Discuss ideas freely, but write up your own work.</p>",
            ),
            "weekly-schedule": (
                "Weekly schedule",
                "<ul>"
                + "".join(
                    f'<li>Week {n}: <a href="{world.url(f"/courses/{cid}/files/{f['id']}")}">'
                    f"{f['display_name']}</a></li>"
                    for n, f in enumerate(lecture_files[:4], 1)
                )
                + f'<li><a href="{first_lab["html_url"]}">{first_lab["name"]}</a></li>'
                + '<li><a href="https://www.youtube.com/watch?v=aqz-KE-bpKQ">Recording: week 1</a>'
                "</li></ul>",
            ),
            "office-hours": (
                "Office hours",
                f"<p>{spec.instructor}: Tuesdays 2–4 pm. TAs: Thursdays 10–12.</p>",
            ),
        }
        for url, (title, body) in bodies.items():
            pid = world.next_id()
            course.pages.append(
                {
                    "page_id": pid,
                    "url": url,
                    "title": title,
                    "body": body,
                    "html_url": world.url(f"/courses/{cid}/pages/{url}"),
                    "updated_at": days(-50),
                    "front_page": url == "course-home",
                }
            )

    # Modules: one per week up to next week, the following one still locked.
    this_week = 10
    for week in range(1, min(len(spec.topics), this_week + 2) + 1):
        items: list[Json] = [{"type": "SubHeader", "title": "Lecture"}]
        lecture = lecture_files[week - 1]
        items.append(
            {
                "type": "File",
                "title": lecture["display_name"],
                "content_id": lecture["id"],
                "completion_requirement": {"type": "must_view", "completed": week < this_week},
            }
        )
        items.append(
            {
                "type": "ExternalUrl",
                "title": f"Lecture {week} recording",
                "external_url": f"https://play.library.utoronto.ca/watch/{spec.code.lower()}-l{week:02d}",
            }
        )
        if week == 1 and course.pages:
            items.append(
                {
                    "type": "Page",
                    "title": course.pages[1]["title"],
                    "page_url": course.pages[1]["url"],
                }
            )
        for a in course.assignments:
            due = datetime.fromisoformat(a["due_at"].replace("Z", "+00:00"))
            if (due - datetime.now(UTC)).days // 7 + this_week == week:
                kind = "Quiz" if a.get("quiz_id") else "Assignment"
                items.append(
                    {
                        "type": kind,
                        "title": a["name"],
                        "content_id": a.get("quiz_id") or a["id"],
                        "content_details": {
                            "due_at": a["due_at"],
                            "points_possible": a["points_possible"],
                        },
                    }
                )
        mid = world.next_id()
        for i, item in enumerate(items, 1):
            item_id = world.next_id()
            item |= {
                "id": item_id,
                "position": i,
                "indent": 0 if item["type"] == "SubHeader" else 1,
                "html_url": world.url(f"/courses/{cid}/modules/items/{item_id}"),
            }
        locked = week > this_week + 1
        course.modules.append(
            {
                "id": mid,
                "name": f"Week {week}: {spec.topics[week - 1]}",
                "position": week,
                "items_count": len(items),
                "items": items,
                "state": "locked" if locked else ("completed" if week < this_week else "unlocked"),
                "unlock_at": days(7, 8) if locked else None,
            }
        )

    # Discussions, the syllabus, announcements and calendar events.
    intro = world.next_id()
    course.discussions.append(
        {
            "id": intro,
            "title": "Introduce yourself",
            "message": "<p>Say hi and tell us your program.</p>",
            "posted_at": days(-62),
            "discussion_subentry_count": 3,
            "author": {"display_name": spec.instructor},
            "html_url": world.url(f"/courses/{cid}/discussion_topics/{intro}"),
            "view": [
                {
                    "id": 1,
                    "user_id": 21,
                    "message": "<p>Hi, I'm in ECE.</p>",
                    "created_at": days(-61),
                    "replies": [
                        {
                            "id": 2,
                            "user_id": 22,
                            "message": "<p>Me too!</p>",
                            "created_at": days(-61),
                        }
                    ],
                },
                {
                    "id": 3,
                    "user_id": 23,
                    "message": "<p>Hello from EngSci.</p>",
                    "created_at": days(-60),
                },
            ],
            "participants": [
                {"id": 21, "display_name": "Alex P."},
                {"id": 22, "display_name": "Sam L."},
                {"id": 23, "display_name": "Riya K."},
            ],
        }
    )
    upcoming = next((a for a in spec.assessments if a.score is None), spec.assessments[-1])
    qa = world.next_id()
    course.discussions.append(
        {
            "id": qa,
            "title": f"Questions about {upcoming.title}",
            "message": "<p>Ask here.</p>",
            "posted_at": days(-5),
            "discussion_subentry_count": 1,
            "author": {"display_name": "TA Jordan"},
            "html_url": world.url(f"/courses/{cid}/discussion_topics/{qa}"),
            "last_reply_at": days(-1),
            "view": [
                {
                    "id": 4,
                    "user_id": 24,
                    "message": "<p>Is the formula sheet allowed?</p>",
                    "created_at": days(-1),
                }
            ],
            "participants": [{"id": 24, "display_name": "Chris T."}],
        }
    )
    rows = "".join(
        f"<tr><td>{name}</td><td>{weight:g}%</td></tr>\n" for name, weight in weights.items()
    )
    course.syllabus = (
        f"<h2>{spec.code}: {spec.title}</h2>\n<p>Instructor: {spec.instructor}</p>"
        f"\n<h3>Grading</h3>\n<table><tr><th>Component</th><th>Weight</th></tr>\n{rows}</table>"
        "\n<h3>Schedule</h3>\n<ul>"
        + "".join(f"<li>{a.title}: due {days(a.due_in_days)[:10]}</li>\n" for a in spec.assessments)
        + "</ul>"
    )
    world.announce(
        course,
        f"Welcome to {spec.code}",
        f"<p>Welcome! Read the syllabus and join Piazza. "
        f'The <a href="{syllabus_file["url"]}">syllabus PDF</a> is under Files.</p>',
        -62,
        read_state="read",
        author={"display_name": spec.instructor},
    )
    upcoming_assignment = next(x for x in course.assignments if x["name"] == upcoming.title)
    world.announce(
        course,
        f"{upcoming.title} details",
        f'<p><a href="{upcoming_assignment["html_url"]}">{upcoming.title}</a> is due '
        f"{upcoming_assignment['due_at'][:10]}. Office hours are extended this week.</p>",
        -3,
        attachments=[
            {
                "id": lecture_files[-1]["id"],
                "display_name": lecture_files[-1]["display_name"],
                "content-type": PDF,
                "size": lecture_files[-1]["size"],
                "url": lecture_files[-1]["url"],
                "updated_at": lecture_files[-1].get("updated_at"),
                "modified_at": lecture_files[-1].get("modified_at"),
            }
        ],
    )
    world.announce(
        course,
        "Room change for Thursday",
        "<p>Thursday's lecture moves to <strong>EX 100</strong>.</p>",
        -0.3,
        author={"display_name": spec.instructor},
    )
    for a in spec.assessments:
        if a.category == "Exams" and a.due_in_days >= -14:
            world.events.append(
                {
                    "id": world.next_id(),
                    "title": f"{spec.code} {a.title}",
                    "context_code": f"course_{cid}",
                    "start_at": days(a.due_in_days, 18),
                    "end_at": days(a.due_in_days, 20),
                    "location_name": "EX 100",
                    "description": f"<p>{a.title}. Bring your TCard.</p>",
                    "html_url": world.url(f"/calendar?event_id={a.title}"),
                }
            )
    for day in range(1, 15, 7):
        world.events.append(
            {
                "id": world.next_id(),
                "title": f"{spec.code} office hours",
                "context_code": f"course_{cid}",
                "start_at": days(day, 19),
                "end_at": days(day, 21),
                "location_name": "BA 3008",
            }
        )
    return course


def _bare_course(
    world: World, code: str, name: str, term: Json, state: str = "available"
) -> Course:
    course = Course(id=world.next_id(), code=code, name=name, term=term, workflow_state=state)
    course.tabs = [
        {
            "id": "home",
            "label": "Home",
            "type": "internal",
            "position": 1,
            "html_url": f"/courses/{course.id}",
        }
    ]
    world.courses[course.id] = course
    root = world.add_folder(course, "course files", None)
    world.add_file(
        course, root, "Orientation guide.pdf", lambda: (content.pdf("Orientation guide", name), PDF)
    )
    return course


def build(base: str, scenario: str) -> World:
    """`default`: the demo term; `large`: plus a course with 300 nested files and 120 assignments,
    served 25 to a page."""
    world = World(base=base.rstrip("/"))
    start = datetime.combine(catalog.term_start(), datetime.min.time(), UTC)
    end = datetime.combine(catalog.term_end(), datetime.min.time(), UTC)
    term = _term(catalog.TERM_NAME, start, end)
    for spec in catalog.COURSES:
        _demo_course(world, spec, term)
    _bare_course(world, "APS100H1", "Orientation to Engineering", term)
    past = _term(catalog.PAST_TERM_NAME, start - timedelta(weeks=36), start - timedelta(weeks=20))
    code, name, score = catalog.PAST_COURSES[0]
    _bare_course(world, code, name, past, state="completed").score = score
    if scenario == "large":
        world.page_size = 25
        _large_course(world, term)
    return world


def _large_course(world: World, term: Json) -> None:
    course = _bare_course(world, "APS360H1", "Applied Fundamentals of Deep Learning", term)
    course.tabs += [
        {
            "id": t,
            "label": label,
            "type": "internal",
            "position": i + 2,
            "html_url": f"/courses/{course.id}/{t}",
        }
        for i, (t, label) in enumerate(TABS[1:])
    ]
    root = course.folders[0]
    for week in range(1, 13):
        level = world.add_folder(course, f"Week {week:02d}", root)
        for depth in ("Lecture", "Slides", "Annotated", "Extra"):
            level = world.add_folder(course, depth, level)
            for n in range(1, 7 if depth != "Extra" else 8):
                title = f"W{week:02d} {depth} part {n}"
                world.add_file(
                    course,
                    level,
                    f"{title}.pdf",
                    lambda t=title: (content.pdf(t, "neural networks", 1), PDF),
                    updated=-80 + week * 6,
                )
    group = {"id": world.next_id(), "name": "Weekly exercises", "group_weight": 100, "position": 1}
    course.groups = [group]
    for n in range(1, 121):
        world.add_assignment(course, group, f"Exercise {n:03d}", -60 + n, 5)
    for n in range(1, 61):
        world.announce(
            course,
            f"Update {n}",
            f"<p>Weekly update number {n}.</p>",
            -120 + n * 2,
            read_state="read" if n < 55 else "unread",
        )
