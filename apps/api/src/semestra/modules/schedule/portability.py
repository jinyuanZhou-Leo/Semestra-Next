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


def _v1_to_v2(payload: dict[str, Any], archive: OlderArchive) -> dict[str, Any]:
    """No class moves: meetings with a code that run in the same weeks become one section per
    course, term, type, code and weeks. When a code's times run in different weeks, the first (by
    weekday and start) keeps the code and the others become sections without one, with the code
    as their title. A meeting without a code is a section of its own. A section takes the first
    instructor any of its times had. Meeting ids stay, so their exceptions still point at them."""
    del archive
    old = [m for m in payload.get("meetings") or [] if isinstance(m, dict)]
    old.sort(key=lambda m: (m.get("weekday") or 0, m.get("start_time") or "", m.get("id") or ""))
    found: dict[tuple[Any, ...], dict[str, Any]] = {}
    coded: dict[tuple[Any, ...], tuple[Any, ...]] = {}  # code -> the weeks that keep it
    sections: list[dict[str, Any]] = []
    meetings: list[dict[str, Any]] = []
    for m in old:
        code = m.get("section_code") or ""
        named = (m.get("course_id"), m.get("term_id"), m.get("type_code"), code)
        weeks = (
            m.get("recurrence"),
            m.get("anchor_week") if m.get("recurrence") == "biweekly" else None,
            m.get("start_week"),
            m.get("end_week"),
            bool(m.get("skip_breaks")),
        )
        key = (*named, weeks) if code else None
        keeps_code = bool(code) and coded.setdefault(named, weeks) == weeks
        meeting = {k: v for k, v in m.items() if k not in _SECTION}
        if code and not keeps_code:
            meeting["title"] = m.get("title") or code
        section = found.get(key) if key else None
        if section is None:
            section = {
                "id": new_id(),
                **{name: m.get(name) for name in _SECTION},
                "section_code": code if keeps_code else "",
                "created_at": m.get("created_at"),
                "updated_at": m.get("updated_at"),
            }
            if key:
                found[key] = section
            sections.append(section)
        else:
            section["instructor"] = section["instructor"] or m.get("instructor")
            section["created_at"] = min(section["created_at"], m.get("created_at") or "")
            section["updated_at"] = max(section["updated_at"], m.get("updated_at") or "")
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
