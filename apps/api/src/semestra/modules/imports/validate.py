"""Issues of import items (M08 §2, §4.2 step 4), recomputed from the items after every change so
that editing an item clears what it fixed."""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from semestra.modules.grading.engine import weights_add_up
from semestra.modules.imports.build import norm_title
from semestra.modules.imports.dates import TermDates, TermWeekSpan, meeting_weeks, pick_term
from semestra.modules.imports.models import ImportsItem

CATEGORY_TOLERANCE = 0.5


@dataclass
class ValidationContext:
    target_kind: str
    target_term_id: str | None
    # Existing course id → normalised titles of its assessments.
    existing_assessments: dict[str, set[str]] = field(default_factory=lambda: {})
    # Existing course id → weights of its counted assessments (from the gradebook, M03).
    existing_weights: dict[str, list[float]] = field(default_factory=lambda: {})
    # Existing course id → how many terms it has.
    course_term_counts: dict[str, int] = field(default_factory=lambda: {})
    # Weeks of the target term (or wizard dates); None when the target has no single term.
    target_weeks: Sequence[TermWeekSpan] | None = None
    # Existing course id → its term ids.
    course_terms: dict[str, list[str]] = field(default_factory=lambda: {})
    # Dates and weeks of every term a meeting may land in (target, course items' `term_ids`,
    # existing courses' terms).
    terms: Mapping[str, TermDates] = field(default_factory=lambda: {})


def _issue(code: str, **params: Any) -> dict[str, Any]:
    return {"code": code, "params": params}


def _day(value: Any) -> date | None:
    try:
        return date.fromisoformat(value) if isinstance(value, str) and value else None
    except ValueError:
        return None


def _live(item: ImportsItem | None) -> bool:
    return item is not None and item.decision != "reject"


def course_term_ids(
    ref: object, by_id: Mapping[str, ImportsItem], ctx: ValidationContext
) -> list[str] | None:
    """The terms the course a ref points to runs in, as the commit will see them: an existing
    course's terms, or a course item's `term_ids` (the target term when it has none). None for no
    course."""
    if not isinstance(ref, str):
        return None
    if ref.startswith("course:"):
        return ctx.course_terms.get(ref.removeprefix("course:"))
    course = by_id.get(ref.removeprefix("item:")) if ref.startswith("item:") else None
    if course is None:
        return None
    own = [str(t) for t in course.data.get("term_ids") or []]
    if own:
        return own
    return [ctx.target_term_id] if ctx.target_term_id else []


def _meeting_term_weeks(
    item: ImportsItem, by_id: Mapping[str, ImportsItem], ctx: ValidationContext
) -> Sequence[TermWeekSpan] | None:
    """Weeks of the term the commit will put this meeting in; the target's (or the wizard's)
    weeks when no term is known."""
    terms = course_term_ids(item.data.get("course_ref"), by_id, ctx)
    term_id = pick_term(ctx.target_term_id, terms, _day(item.data.get("first_date")), ctx.terms)
    span = ctx.terms.get(term_id) if term_id else None
    return span.weeks if span is not None else ctx.target_weeks


def validate(
    items: Sequence[ImportsItem], ctx: ValidationContext
) -> dict[str, list[dict[str, Any]]]:
    """Sets `issues` on every item; returns the weight totals of each course and category
    (`weights`, `category_weights` of the session summary)."""
    by_id = {i.id: i for i in items}
    issues = {i.id: _item_issues(i, by_id, ctx) for i in items}
    groups: defaultdict[str, list[ImportsItem]] = defaultdict(list)
    for item in items:
        if item.type == "assessment" and item.decision != "reject":
            groups[str(item.data.get("course_ref", ""))].append(item)
    for item in items:
        item.issues = issues[item.id]
    return {
        "weights": weight_totals(groups, ctx),
        "category_weights": category_totals(items, groups),
    }


def _ref_missing(item: ImportsItem, by_id: dict[str, ImportsItem]) -> bool:
    ref = item.data.get("course_ref")
    if not isinstance(ref, str) or not ref.startswith("item:"):
        return False
    return not _live(by_id.get(ref.removeprefix("item:")))


def _item_issues(
    item: ImportsItem, by_id: dict[str, ImportsItem], ctx: ValidationContext
) -> list[dict[str, Any]]:
    """The problems of one item on its own (category totals look at several)."""
    data = item.data
    found: list[dict[str, Any]] = []
    if item.type == "course" and data.get("existing_course_id"):
        found.append(_issue("import.duplicate_course", course_id=data["existing_course_id"]))
    if item.type in ("meeting", "event", "assessment", "category", "task") and _ref_missing(
        item, by_id
    ):
        found.append(_issue("import.course_ref_missing"))
    if item.type == "assessment":
        if data.get("due_text") and not data.get("due_date"):
            found.append(_issue("import.date_unresolved", text=data["due_text"]))
        ref = str(data.get("course_ref", ""))
        if ref.startswith("course:"):
            titles = ctx.existing_assessments.get(ref.removeprefix("course:"), set())
            if norm_title(str(data.get("title", ""))) in titles:
                found.append(_issue("import.duplicate_assessment"))
    if item.type == "task" and data.get("due_text") and not data.get("due_date"):
        found.append(_issue("import.date_unresolved", text=data["due_text"]))
    if item.type == "event" and not data.get("date"):
        found.append(_issue("import.date_unresolved", text=data.get("date_text") or ""))
    if item.type == "meeting" and not data.get("term_ref"):
        found.extend(_meeting_issues(item, by_id, ctx))
    return found


def _meeting_issues(
    item: ImportsItem, by_id: dict[str, ImportsItem], ctx: ValidationContext
) -> list[dict[str, Any]]:
    """A meeting without a term: whether its term can be told, and whether its weeks fit."""
    data = item.data
    found: list[dict[str, Any]] = []
    if ctx.target_kind == "course" and ctx.target_term_id is None:
        ref = str(data.get("course_ref", ""))
        course_id = ref.removeprefix("course:") if ref.startswith("course:") else None
        many = course_id is None or ctx.course_term_counts.get(course_id, 0) > 1
        if many and not data.get("first_date"):
            found.append(_issue("import.term_unresolved"))
    weeks = _meeting_term_weeks(item, by_id, ctx)
    if weeks:
        # The same check the commit makes, so the review shows it before confirming.
        *_, problem = meeting_weeks(
            _day(data.get("first_date")),
            _day(data.get("last_date")),
            data.get("start_week"),
            data.get("end_week"),
            weeks,
        )
        if problem:
            found.append(_issue(problem))
    return found


def weight_totals(
    groups: Mapping[str, Sequence[ImportsItem]], ctx: ValidationContext
) -> list[dict[str, Any]]:
    """What each course's weights add up to once the import is in: the gradebook's counted
    assessments plus the accepted ones here (M03 adds them up). Shown on the course in the
    review, not as an issue: an import often brings only part of a course's assessments."""
    out: list[dict[str, Any]] = []
    for ref, members in groups.items():
        course_id = ref.removeprefix("course:") if ref.startswith("course:") else None
        existing = ctx.existing_weights.get(course_id, []) if course_id else []
        total, ok = weights_add_up(
            [*existing, *(float(m.data.get("weight") or 0) for m in members)]
        )
        out.append(
            {"course_ref": ref, "total": round(total, 2), "existing": len(existing), "ok": ok}
        )
    return out


def category_totals(
    items: Sequence[ImportsItem], groups: Mapping[str, Sequence[ImportsItem]]
) -> list[dict[str, Any]]:
    """What the assessments of each new category add up to, next to the total the category
    states. Shown on the category, not as an issue: Canvas splits a group's weight over all its
    assignments, so importing some of them leaves the rest for later. `groups` holds the
    assessments that are not rejected, by course ref."""
    out: list[dict[str, Any]] = []
    for item in items:
        if item.type != "category" or item.data.get("weight_total") is None:
            continue
        own = f"item:{item.id}"
        key = f"key:{item.data.get('key')}"
        total = round(
            sum(
                float(m.data.get("weight") or 0)
                for m in groups.get(str(item.data.get("course_ref")), [])
                if m.data.get("category_ref") in (own, key)
            ),
            2,
        )
        if not total:
            continue
        expected = float(item.data["weight_total"])
        out.append(
            {
                "item_id": item.id,
                "expected": expected,
                "total": total,
                "ok": abs(total - expected) <= CATEGORY_TOLERANCE,
            }
        )
    return out


def summarize(items: Sequence[ImportsItem]) -> dict[str, Any]:
    counts: defaultdict[str, int] = defaultdict(int)
    accepted: defaultdict[str, int] = defaultdict(int)
    open_issues: defaultdict[str, int] = defaultdict(int)
    created = updated = failed = 0
    for item in items:
        counts[item.type] += 1
        if item.decision == "accept":
            accepted[item.type] += 1
            for issue in item.issues:
                open_issues[issue["code"]] += 1
        result = item.result or {}
        if result.get("error_code"):
            failed += 1
        elif result.get("created_id") and not result.get("reused"):
            created += 1
        elif result.get("updated_id") or result.get("reused"):
            updated += 1
    return {
        "counts": dict(counts),
        "accepted": dict(accepted),
        "issues": dict(open_issues),
        "created": created,
        "updated": updated,
        "failed": failed,
    }
