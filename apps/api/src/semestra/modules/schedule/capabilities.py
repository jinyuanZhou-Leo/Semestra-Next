"""Schedule and calendar capabilities (M04 §4)."""

from semestra.core.agent_output import CHANGED
from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.modules.schedule import service
from semestra.modules.schedule.schemas import (
    ConflictList,
    Deleted,
    EventCreateInput,
    EventListInput,
    EventRef,
    EventType,
    EventTypeCreateInput,
    EventTypeList,
    EventTypeOrderInput,
    EventTypeRef,
    EventTypeUpdateInput,
    EventUpdateInput,
    ExceptionRef,
    ExceptionUpsertInput,
    Feed,
    FeedCreated,
    FeedCreateInput,
    FeedList,
    FeedRef,
    Meeting,
    MeetingCreateInput,
    MeetingCreateManyInput,
    MeetingCreateManyResult,
    MeetingFields,
    MeetingList,
    MeetingListInput,
    MeetingRef,
    MeetingSetEnabledInput,
    MeetingUpdateInput,
    Occurrences,
    OccurrencesInput,
    OneOffEvent,
    OneOffEventList,
    ProgramRef,
    TermRef,
    Today,
)

TAGS = ("schedule",)

# What agents get back (M00 §3.6): no occurrence ids, colors, import keys or timestamps. A
# class's meeting id is its `ref.id`.
_OCCURRENCE_FIELDS = (
    "ref", "kind", "title", "start_at", "end_at", "all_day", "course_id", "type_code",
    "location", "status", "meta.original_date", "meta.original_start_at", "meta.week_number",
    "meta.section_code", "meta.instructor", "meta.note",
)  # fmt: skip
_EXCEPTION_FIELDS = tuple(
    f"exceptions.{f}"
    for f in (
        "original_date", "kind", "new_date", "new_start_time", "new_end_time", "new_location",
        "note",
    )
)  # fmt: skip
_MEETING_FIELDS = (
    "id", "term_id", "section_code", "type_code", "title", "instructor", "location", "weekday",
    "start_time", "end_time", "recurrence", "start_week", "end_week", "skip_breaks", "enabled",
    *_EXCEPTION_FIELDS,
)  # fmt: skip
_EVENT_FIELDS = (
    "id", "term_id", "course_id", "type_code", "title", "start_at", "end_at", "all_day",
    "location", "note",
)  # fmt: skip


def _occurrences(key: str) -> tuple[str, ...]:
    return tuple(f"{key}.{f}" for f in _OCCURRENCE_FIELDS)


# --- calendar -------------------------------------------------------------------------------


@capability(
    name="calendar.today.get",
    summary="Today in a Program: classes and events, deadlines of the next 7 days, due tasks.",
    description="""Prefer this for questions about today ("what do I have today?", "what's due this
week?"). It also says which term week it is. For other days or longer ranges use
calendar.occurrence.list. Times are UTC; read them in the returned `timezone`.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/today"),
    tags=TAGS,
    agent_core=True,
    agent_output_fields=(
        "day",
        "timezone",
        "week",
        *_occurrences("items"),
        *_occurrences("upcoming"),
        *_occurrences("tasks"),
    ),
)
async def calendar_today(ctx: Ctx, inp: ProgramRef) -> Today:
    return await service.today(ctx, inp.program_id)


@capability(
    name="calendar.occurrence.list",
    summary="Everything on the calendar in a date range: classes, events, deadlines, tasks.",
    description="""Use for "when is my class tomorrow?", "what's on next Wednesday?" or a week
overview. Interpret relative days in the Program's time zone and pass dates; `end` is exclusive
and at most 400 days after `start` (120 in the app), so a whole term fits in one call. Cancelled
classes are included with status 'cancelled'.
For today alone prefer calendar.today.get. Each class carries its term week in meta.week_number.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/calendar"),
    tags=TAGS,
    agent_core=True,
    agent_output_fields=("timezone", "start", "end", *_occurrences("items"), "weeks", "breaks"),
)
async def calendar_occurrences(ctx: Ctx, inp: OccurrencesInput) -> Occurrences:
    # The app pages by view; the assistant and MCP clients ask for whole terms.
    wide = ctx.actor in ("agent", "mcp")
    max_days = service.EXPORT_MAX_RANGE_DAYS if wide else service.MAX_RANGE_DAYS
    return await service.occurrences(ctx, inp, max_days=max_days)


# --- event types ----------------------------------------------------------------------------


@capability(
    name="schedule.event_type.list",
    summary="List the class and event types of a Program (LEC, PRA, TUT, ...).",
    description="Use to find valid type codes before creating meetings or events.",
    effect="read",
    http=Http("GET", "/programs/{program_id}/event-types"),
    tags=TAGS,
    agent_output_fields=("items.id", "items.code", "items.name", "items.builtin"),
)
async def event_type_list(ctx: Ctx, inp: ProgramRef) -> EventTypeList:
    return EventTypeList(items=await service.list_event_types(ctx, inp.program_id))


@capability(
    name="schedule.event_type.create",
    summary="Add a class or event type to a Program, e.g. LAB for laboratories.",
    description="Use when a schedule needs a type the Program does not have yet.",
    effect="write",
    http=Http("POST", "/programs/{program_id}/event-types"),
    tags=TAGS,
    agent_output_fields=("id", "code", "name"),
)
async def event_type_create(ctx: Ctx, inp: EventTypeCreateInput) -> EventType:
    return await service.create_event_type(ctx, inp)


@capability(
    name="schedule.event_type.update",
    summary="Rename a custom type, or change the color or icon of any type.",
    description="Built-in types (LEC, PRA, TUT) keep their name; their color and icon can change.",
    effect="write",
    http=Http("PATCH", "/event-types/{event_type_id}"),
    tags=TAGS,
    agent_output_fields=("id", "code", "name", CHANGED),
)
async def event_type_update(ctx: Ctx, inp: EventTypeUpdateInput) -> EventType:
    return await service.update_event_type(ctx, inp)


@capability(
    name="schedule.event_type.delete",
    summary="Delete a custom type that no meeting or event uses.",
    description="Fails with schedule.event_type_in_use while anything uses the type.",
    effect="destructive",
    http=Http("DELETE", "/event-types/{event_type_id}"),
    preview=service.preview_event_type_delete,
    tags=TAGS,
)
async def event_type_delete(ctx: Ctx, inp: EventTypeRef) -> Deleted:
    await service.delete_event_type(ctx, inp.event_type_id)
    return Deleted()


@capability(
    name="schedule.event_type.reorder",
    summary="Set the display order of a Program's types.",
    description="Types not listed keep their relative order after the listed ones.",
    effect="write",
    http=Http("PUT", "/programs/{program_id}/event-types:order"),
    tags=TAGS,
    agent_output_fields=("items.id", "items.code"),
)
async def event_type_reorder(ctx: Ctx, inp: EventTypeOrderInput) -> EventTypeList:
    return EventTypeList(
        items=await service.reorder_event_types(ctx, inp.program_id, inp.event_type_ids)
    )


# --- meetings -------------------------------------------------------------------------------


@capability(
    name="schedule.meeting.list",
    summary="List a course's weekly class sections, with their cancelled or moved dates.",
    description="""Use to see when a course meets each week, or to find the meeting id before
changing or cancelling one class. Optionally only one term of a year-long course.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/meetings"),
    tags=TAGS,
    agent_output_fields=tuple(f"items.{f}" for f in _MEETING_FIELDS),
)
async def meeting_list(ctx: Ctx, inp: MeetingListInput) -> MeetingList:
    return MeetingList(items=await service.list_meetings(ctx, inp.course_id, inp.term_id))


@capability(
    name="schedule.meeting.create",
    summary="Add a weekly (or biweekly) class section to a course in one of its terms.",
    description="""Times are wall-clock times in the Program's time zone. Check
schedule.conflict.list afterwards and mention any overlap. For a single extra session (exam, make-up
class) use schedule.event.create instead.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/meetings"),
    tags=TAGS,
    agent_output_fields=("id", "section_code", "type_code", "weekday", "start_time", "end_time"),
)
async def meeting_create(ctx: Ctx, inp: MeetingCreateInput) -> Meeting:
    return await service.create_meeting(
        ctx, inp.course_id, MeetingFields.model_validate(inp.model_dump(exclude={"course_id"}))
    )


@capability(
    name="schedule.meeting.create_many",
    summary="Add several class sections to a course at once (imports).",
    description="""Used by importers. An item with the same source_kind and source_ref as an
existing meeting of the course updates it instead of adding a duplicate.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/meetings:batch"),
    tags=TAGS,
    agent_output_fields=(
        "created_ids",
        "updated_ids",
        "items.id",
        "items.section_code",
        "items.weekday",
        "items.start_time",
    ),
)
async def meeting_create_many(ctx: Ctx, inp: MeetingCreateManyInput) -> MeetingCreateManyResult:
    return await service.create_meetings(ctx, inp.course_id, inp.meetings)


@capability(
    name="schedule.meeting.update",
    summary="Change a class section for the whole term (time, room, weeks, ...).",
    description="""Changes every week. To change or cancel a single date use
schedule.exception.upsert instead.""",
    effect="write",
    http=Http("PATCH", "/meetings/{meeting_id}"),
    tags=TAGS,
    agent_output_fields=("id", "section_code", CHANGED),
)
async def meeting_update(ctx: Ctx, inp: MeetingUpdateInput) -> Meeting:
    return await service.update_meeting(ctx, inp)


@capability(
    name="schedule.meeting.delete",
    summary="Delete a class section with all its dates.",
    description="""Removes the section entirely. To cancel one class use
schedule.exception.upsert with kind 'cancelled'; to hide a section the user does not attend use
schedule.meeting.set_enabled.""",
    effect="destructive",
    http=Http("DELETE", "/meetings/{meeting_id}"),
    preview=service.preview_meeting_delete,
    tags=TAGS,
)
async def meeting_delete(ctx: Ctx, inp: MeetingRef) -> Deleted:
    await service.delete_meeting(ctx, inp.meeting_id)
    return Deleted()


@capability(
    name="schedule.meeting.set_enabled",
    summary="Show or hide class sections of a course, e.g. keep only the user's tutorial.",
    description="Disabled sections stay in the course but are left out of the calendar.",
    effect="write",
    http=Http("PUT", "/courses/{course_id}/meetings:enabled"),
    tags=TAGS,
    agent_output_fields=("items.id", "items.section_code", "items.enabled"),
)
async def meeting_set_enabled(ctx: Ctx, inp: MeetingSetEnabledInput) -> MeetingList:
    return MeetingList(
        items=await service.set_enabled(ctx, inp.course_id, inp.meeting_ids, inp.enabled)
    )


@capability(
    name="schedule.exception.upsert",
    summary="Cancel or move one class of a section (one date only).",
    description="""Use for "class is cancelled on Friday" or "Tuesday's lecture moves to room X".
`original_date` must be a date the section normally meets. Prefer this over deleting the
meeting.""",
    effect="write",
    http=Http("PUT", "/meetings/{meeting_id}/exceptions/{original_date}"),
    tags=TAGS,
    agent_output_fields=("id", "section_code", *_EXCEPTION_FIELDS),
)
async def exception_upsert(ctx: Ctx, inp: ExceptionUpsertInput) -> Meeting:
    return await service.upsert_exception(ctx, inp)


@capability(
    name="schedule.exception.delete",
    summary="Undo the cancellation or move of one class.",
    description="The class happens again as regularly scheduled.",
    effect="write",
    http=Http("DELETE", "/meetings/{meeting_id}/exceptions/{original_date}"),
    tags=TAGS,
    agent_output_fields=("id", "section_code", *_EXCEPTION_FIELDS),
)
async def exception_delete(ctx: Ctx, inp: ExceptionRef) -> Meeting:
    return await service.delete_exception(ctx, inp.meeting_id, inp.original_date)


@capability(
    name="schedule.conflict.list",
    summary="Class sections of a term that overlap each other.",
    description="""Use before or after adding meetings to warn about clashes. Only enabled sections
that share at least one date count.""",
    effect="read",
    http=Http("GET", "/terms/{term_id}/schedule-conflicts"),
    tags=TAGS,
)
async def schedule_conflicts(ctx: Ctx, inp: TermRef) -> ConflictList:
    return ConflictList(items=await service.conflicts(ctx, inp.term_id))


# --- one-off events -------------------------------------------------------------------------


@capability(
    name="schedule.event.list",
    summary="List one-off events (exams, office hours, make-up classes) of a Program.",
    description="""Optionally only one course's or one term's. For a date range use
calendar.occurrence.list.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/events"),
    tags=TAGS,
    agent_output_fields=tuple(f"items.{f}" for f in _EVENT_FIELDS),
)
async def event_list(ctx: Ctx, inp: EventListInput) -> OneOffEventList:
    return OneOffEventList(items=await service.list_events(ctx, inp))


@capability(
    name="schedule.event.create",
    summary="Add a one-off event: an exam, office hour, make-up class or appointment.",
    description="""Times without an offset are read in the Program's time zone. For something
that repeats weekly use schedule.meeting.create.""",
    effect="write",
    http=Http("POST", "/programs/{program_id}/events"),
    tags=TAGS,
    agent_output_fields=("id", "title", "start_at", "end_at"),
)
async def event_create(ctx: Ctx, inp: EventCreateInput) -> OneOffEvent:
    return await service.create_event(ctx, inp)


@capability(
    name="schedule.event.update",
    summary="Change a one-off event.",
    description="Moving only `start_at` keeps the event's duration.",
    effect="write",
    http=Http("PATCH", "/events/{event_id}"),
    tags=TAGS,
    agent_output_fields=("id", "title", CHANGED),
)
async def event_update(ctx: Ctx, inp: EventUpdateInput) -> OneOffEvent:
    return await service.update_event(ctx, inp)


@capability(
    name="schedule.event.delete",
    summary="Delete a one-off event.",
    description="Irreversible.",
    effect="destructive",
    http=Http("DELETE", "/events/{event_id}"),
    preview=service.preview_event_delete,
    tags=TAGS,
)
async def event_delete(ctx: Ctx, inp: EventRef) -> Deleted:
    await service.delete_event(ctx, inp.event_id)
    return Deleted()


# --- feeds ----------------------------------------------------------------------------------


@capability(
    name="schedule.feed.list",
    summary="List the calendar subscription links of a Program.",
    description="The links themselves are only shown when created.",
    effect="read",
    http=Http("GET", "/programs/{program_id}/calendar-feeds"),
    expose=("http",),
    tags=TAGS,
)
async def feed_list(ctx: Ctx, inp: ProgramRef) -> FeedList:
    return FeedList(items=await service.list_feeds(ctx, inp.program_id))


@capability(
    name="schedule.feed.create",
    summary="Create a read-only calendar subscription link (ICS) for Apple or Google Calendar.",
    description="Anyone with the link can read the calendar; it is returned only once.",
    effect="write",
    http=Http("POST", "/programs/{program_id}/calendar-feeds"),
    expose=("http",),
    tags=TAGS,
)
async def feed_create(ctx: Ctx, inp: FeedCreateInput) -> FeedCreated:
    return await service.create_feed(ctx, inp)


@capability(
    name="schedule.feed.revoke",
    summary="Turn off a calendar subscription link.",
    description="Calendars subscribed to it stop updating.",
    effect="write",
    http=Http("DELETE", "/calendar-feeds/{feed_id}"),
    expose=("http",),
    tags=TAGS,
)
async def feed_revoke(ctx: Ctx, inp: FeedRef) -> Feed:
    return await service.revoke_feed(ctx, inp.feed_id)
