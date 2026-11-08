"""M13 export/import adapter: class types, sections with their meetings and the meetings'
exceptions, one-off events.

Subscription links are not exported: their token is a credential. They go with the account.

Version 1 (up to 1.15) had no sections: each meeting carried its section's type, code,
instructor and weeks. `_v1_to_v2` groups them into sections the way migration 0037 does.
"""

from typing import Any

from semestra.core.db import new_id
from semestra.modules.portability import Table, table_adapter
from semestra.modules.portability.registry import OlderArchive
from semestra.modules.schedule.models import (
    ScheduleEvent,
    ScheduleEventType,
    ScheduleFeed,
    ScheduleMeeting,
    ScheduleMeetingException,
    ScheduleSection,
)

# What a version 1 meeting held for its section.
_SECTION = (
    "course_id", "term_id", "type_code", "section_code", "instructor", "recurrence",
    "anchor_week", "start_week", "end_week", "skip_breaks",
)  # fmt: skip


def _weeks(m: dict[str, Any]) -> tuple[Any, ...]:
    biweekly = m.get("recurrence") == "biweekly"
    return (
        m.get("recurrence"),
        m.get("anchor_week") if biweekly else None,
        m.get("start_week"),
        m.get("end_week"),
        bool(m.get("skip_breaks")),
    )


def _v1_to_v2(payload: dict[str, Any], archive: OlderArchive) -> dict[str, Any]:
    """No class moves: meetings with a code that run in the same weeks become one section per
    course, term, type, code and weeks. When a code's times run in different weeks, the weeks
    with the most times keep the code (on a tie, those of the first time by weekday and start);
    the others become sections without one, their times titled with the code. A meeting without
    a code is a section of its own. A section takes the first instructor any of its times had.
    Meeting ids stay, so their exceptions still point at them."""
    del archive
    old = [m for m in payload.get("meetings") or [] if isinstance(m, dict)]
    old.sort(key=lambda m: (m.get("weekday") or 0, m.get("start_time") or "", m.get("id") or ""))
    groups: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
    for m in old:
        code = m.get("section_code") or ""
        named = (m.get("course_id"), m.get("term_id"), m.get("type_code"), code)
        groups.setdefault((*named, _weeks(m)) if code else (m.get("id"),), []).append(m)
    # A code -> the weeks that keep it: the largest group, the first one on a tie.
    keeper: dict[tuple[Any, ...], tuple[Any, ...]] = {}
    best: dict[tuple[Any, ...], int] = {}
    for key, times in groups.items():
        if len(key) == 5 and len(times) > best.get(key[:4], 0):
            best[key[:4]] = len(times)
            keeper[key[:4]] = key[4]
    sections: list[dict[str, Any]] = []
    meetings: list[dict[str, Any]] = []
    for key, times in groups.items():
        first = times[0]
        code = first.get("section_code") or ""
        keeps_code = bool(code) and keeper.get(key[:4]) == key[4]
        section = {
            "id": new_id(),
            **{name: first.get(name) for name in _SECTION},
            "section_code": code if keeps_code else "",
            "instructor": next((m["instructor"] for m in times if m.get("instructor")), None),
            "created_at": min(m.get("created_at") or "" for m in times),
            "updated_at": max(m.get("updated_at") or "" for m in times),
        }
        sections.append(section)
        for m in times:
            meeting = {k: v for k, v in m.items() if k not in _SECTION}
            if code and not keeps_code:
                meeting["title"] = m.get("title") or code
            meetings.append({**meeting, "section_id": section["id"]})
    return {**payload, "sections": sections, "meetings": meetings}


ADAPTER = table_adapter(
    module="schedule",
    schema_version=2,
    upgrades={1: _v1_to_v2},
    depends_on=("academics",),
    tables=(
        Table(ScheduleEventType, "event_types", refs={"program_id": "required"}),
        Table(ScheduleSection, "sections", refs={"course_id": "required", "term_id": "required"}),
        Table(ScheduleMeeting, "meetings", refs={"section_id": "required"}),
        Table(ScheduleMeetingException, "meeting_exceptions", refs={"meeting_id": "required"}),
        Table(
            ScheduleEvent,
            "events",
            refs={"program_id": "required", "term_id": "optional", "course_id": "optional"},
        ),
        Table(ScheduleFeed, "feeds", exported=False),
    ),
)
