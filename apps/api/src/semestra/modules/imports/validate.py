"""Issues of import items (M08 §2, §4.2 step 4), recomputed from the items after every change so
that editing an item clears what it fixed."""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from semestra.modules.imports.build import norm_title
from semestra.modules.imports.dates import TermDates, TermWeekSpan, meeting_weeks, pick_term
from semestra.modules.imports.models import ImportsItem

WEIGHT_TOLERANCE = 0.01
CATEGORY_TOLERANCE = 0.5


@dataclass
class ValidationContext:
    target_kind: str
    target_term_id: str | None
    # Existing course id → normalised titles of its assessments.
    existing_assessments: dict[str, set[str]] = field(default_factory=lambda: {})
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


def validate(items: Sequence[ImportsItem], ctx: ValidationContext) -> None:
    """Sets `issues` on every item."""
    by_id = {i.id: i for i in items}
    issues: dict[str, list[dict[str, Any]]] = {i.id: [] for i in items}

    def ref_missing(item: ImportsItem) -> bool:
        ref = item.data.get("course_ref")
        if not isinstance(ref, str) or not ref.startswith("item:"):
            return False
        return not _live(by_id.get(ref.removeprefix("item:")))

    groups: defaultdict[str, list[ImportsItem]] = defaultdict(list)
    for item in items:
        data = item.data
        found = issues[item.id]
        if item.type == "course" and data.get("existing_course_id"):
            found.append(_issue("import.duplicate_course", course_id=data["existing_course_id"]))
        if item.type in ("meeting", "event", "assessment", "category", "task") and ref_missing(
            item
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
            if item.decision != "reject":
                groups[ref].append(item)
        if item.type == "task" and data.get("due_text") and not data.get("due_date"):
            found.append(_issue("import.date_unresolved", text=data["due_text"]))
        if item.type == "event" and not data.get("date"):
            found.append(_issue("import.date_unresolved", text=data.get("date_text") or ""))
        if (
            item.type == "meeting"
            and not data.get("term_ref")
            and ctx.target_kind == "course"
            and ctx.target_term_id is None
        ):
            ref = str(data.get("course_ref", ""))
            course_id = ref.removeprefix("course:") if ref.startswith("course:") else None
            many = course_id is None or ctx.course_term_counts.get(course_id, 0) > 1
            if many and not data.get("first_date"):
                found.append(_issue("import.term_unresolved"))
        if item.type == "meeting" and not data.get("term_ref"):
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

    # Weights of a course's assessments should add up to 100; categories to their stated total.
    for ref, members in groups.items():
        total = round(sum(float(m.data.get("weight") or 0) for m in members), 2)
        if round(abs(total - 100), 2) <= WEIGHT_TOLERANCE:
            continue
        owner = by_id.get(ref.removeprefix("item:")) if ref.startswith("item:") else None
        holder = owner if owner is not None else members[0]
        issues[holder.id].append(_issue("import.weights_not_100", total=total))
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
        expected = float(item.data["weight_total"])
        if total and abs(total - expected) > CATEGORY_TOLERANCE:
            issues[item.id].append(
                _issue("import.category_weight_mismatch", expected=expected, total=total)
            )
    for item in items:
        item.issues = issues[item.id]


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
