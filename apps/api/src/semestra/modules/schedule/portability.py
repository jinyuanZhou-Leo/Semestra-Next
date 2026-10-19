"""M13 export/import adapter: class types, meetings and their exceptions, one-off events.

Subscription links are not exported: their token is a credential. They go with the account.
"""

from semestra.modules.portability import Table, table_adapter
from semestra.modules.schedule.models import (
    ScheduleEvent,
    ScheduleEventType,
    ScheduleFeed,
    ScheduleMeeting,
    ScheduleMeetingException,
)

ADAPTER = table_adapter(
    module="schedule",
    schema_version=1,
    depends_on=("academics",),
    tables=(
        Table(ScheduleEventType, "event_types", refs={"program_id": "required"}),
        Table(ScheduleMeeting, "meetings", refs={"course_id": "required", "term_id": "required"}),
        Table(ScheduleMeetingException, "meeting_exceptions", refs={"meeting_id": "required"}),
        Table(
            ScheduleEvent,
            "events",
            refs={"program_id": "required", "term_id": "optional", "course_id": "optional"},
        ),
        Table(ScheduleFeed, "feeds", exported=False),
    ),
)
