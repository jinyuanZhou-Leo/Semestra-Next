"""M13 export/import adapter: task lists and tasks.

Version 2 links a task to its assessment by `assessment_id` (grading is imported first, so the
reference resolves). Version 1 (up to 1.15) linked them through `source_kind='assessment'` and
`source_ref`, and assessment tasks were optional; `_v1_to_v2` converts such a backup the way
migration 0033 converted the tables.
"""

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from semestra.core.db import new_id
from semestra.modules.portability import Table, table_adapter
from semestra.modules.portability.registry import OlderArchive
from semestra.modules.tasks import rules
from semestra.modules.tasks.models import TasksItem, TasksList


def _rows(payload: dict[str, Any] | None, key: str) -> list[dict[str, Any]]:
    return [r for r in (payload or {}).get(key) or [] if isinstance(r, dict)]  # pyright: ignore[reportUnknownVariableType]


def _v1_to_v2(payload: dict[str, Any], archive: OlderArchive) -> dict[str, Any]:
    """Links move to `assessment_id` (links to assessments the backup lacks are dropped), a task
    of an assessment without a due date goes, and every dated assessment without a task gets one:
    finished, as of the due date, when it is graded, dropped or already past due."""
    assessments = {a["id"]: a for a in _rows(archive.payload("grading"), "assessments")}
    items: list[dict[str, Any]] = []
    for item in _rows(payload, "items"):
        if item.get("source_kind") == "assessment":
            linked = assessments.get(item.get("source_ref"))
            item = {**item, "source_kind": "manual", "source_ref": None}
            if linked is not None:
                if linked.get("due_at") is None:
                    continue
                item["assessment_id"] = linked["id"]
        items.append(item)
    has_task = {i.get("assessment_id") for i in items}
    missing = [a for a in assessments.values() if a.get("due_at") and a["id"] not in has_task]
    missing.sort(key=lambda a: datetime.fromisoformat(a["due_at"]))
    items += _assessment_tasks(missing, items, archive)
    return {**payload, "items": items}


def _assessment_tasks(
    assessments: list[dict[str, Any]], items: list[dict[str, Any]], archive: OlderArchive
) -> list[dict[str, Any]]:
    academics = archive.payload("academics")
    programs = {p["id"]: p for p in _rows(academics, "programs")}
    courses = {c["id"]: c for c in _rows(academics, "courses")}
    terms = {t["id"]: t for t in _rows(academics, "terms")}
    course_terms: dict[str, list[dict[str, Any]]] = {}
    for link in _rows(academics, "course_terms"):
        if (term := terms.get(link.get("term_id"))) is not None:
            course_terms.setdefault(link.get("course_id") or "", []).append(term)

    def term_of(course_id: str, due: date) -> str | None:
        """The course's term that contains the due date, else its earliest (as the app infers)."""
        options = sorted(course_terms.get(course_id, []), key=lambda t: t["start_date"])
        for t in options:
            if date.fromisoformat(t["start_date"]) <= due <= date.fromisoformat(t["end_date"]):
                return t["id"]
        return options[0]["id"] if options else None

    tops: dict[str, float] = {}
    created: list[dict[str, Any]] = []
    now = archive.now
    for a in assessments:
        course = courses.get(a.get("course_id"))
        program = programs.get(course.get("program_id")) if course else None
        if course is None or program is None:
            continue
        if program["id"] not in tops:
            tops[program["id"]] = max(
                (
                    float(i.get("position") or 0.0)
                    for i in items
                    if i.get("program_id") == program["id"] and i.get("list_id") is None
                ),
                default=0.0,
            )
        tops[program["id"]] += 1.0
        due_at = datetime.fromisoformat(a["due_at"])
        local = due_at.astimezone(ZoneInfo(program["timezone"]))
        done = a.get("score_percentage") is not None or bool(a.get("dropped")) or due_at <= now
        code = course.get("code") or course.get("alias") or course.get("title")
        created.append(
            {
                "id": new_id(),
                "program_id": program["id"],
                "term_id": term_of(course["id"], local.date()),
                "course_id": course["id"],
                "list_id": None,
                "title": rules.auto_title(code, a.get("title") or ""),
                "notes": "",
                "due_date": local.date().isoformat(),
                "due_time": local.time().replace(tzinfo=None).isoformat()
                if a.get("due_has_time")
                else None,
                "priority": "medium",
                "flagged": False,
                "completed_at": min(due_at, now).isoformat() if done else None,
                "position": tops[program["id"]],
                "source_kind": "manual",
                "source_ref": None,
                "assessment_id": a["id"],
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
            }
        )
    return created


ADAPTER = table_adapter(
    module="tasks",
    schema_version=2,
    upgrades={1: _v1_to_v2},
    depends_on=("academics", "grading"),
    tables=(
        Table(TasksList, "lists", refs={"program_id": "required", "term_id": "optional"}),
        Table(
            TasksItem,
            "items",
            refs={
                "program_id": "required",
                "term_id": "optional",
                "course_id": "optional",
                "list_id": "optional",
                # When the assessment was not imported the task stays, as a plain one.
                "assessment_id": "optional",
            },
        ),
    ),
)
