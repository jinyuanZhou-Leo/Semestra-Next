"""M13 export/import adapter: class types, sections with their meetings and the meetings'
exceptions, one-off events.

Subscription links are not exported: their token is a credential. They go with the account.
"""

from semestra.modules.portability import Table, table_adapter
from semestra.modules.schedule.models import (
    ScheduleEvent,
    ScheduleEventType,
    ScheduleFeed,
    ScheduleMeeting,
    ScheduleMeetingException,
    ScheduleSection,
)

ADAPTER = table_adapter(
    module="schedule",
    schema_version=2,
    oldest_version=2,
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
