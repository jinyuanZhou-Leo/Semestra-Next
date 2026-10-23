"""Clean-up when courses, terms or Programs go (M04 §4 subscriptions).

No `calendar.changed` here: the academics event that caused the clean-up already tells the
app to refetch the calendar."""

from collections.abc import Sequence

from sqlalchemy import delete, select, update

from semestra.core.context import Ctx
from semestra.core.events import events
from semestra.modules.schedule.meetings import delete_meetings
from semestra.modules.schedule.models import (
    ScheduleEvent,
    ScheduleEventType,
    ScheduleFeed,
    ScheduleMeeting,
)


async def delete_for_course(ctx: Ctx, course_id: str, program_id: str) -> None:
    meeting_ids = (
        await ctx.db.scalars(
            select(ScheduleMeeting.id).where(
                ScheduleMeeting.user_id == ctx.user_id, ScheduleMeeting.course_id == course_id
            )
        )
    ).all()
    await delete_meetings(ctx, list(meeting_ids))
    await ctx.db.execute(
        delete(ScheduleEvent).where(
            ScheduleEvent.user_id == ctx.user_id, ScheduleEvent.course_id == course_id
        )
    )


async def delete_for_term(ctx: Ctx, term_id: str, program_id: str) -> None:
    meeting_ids = (
        await ctx.db.scalars(
            select(ScheduleMeeting.id).where(
                ScheduleMeeting.user_id == ctx.user_id, ScheduleMeeting.term_id == term_id
            )
        )
    ).all()
    await delete_meetings(ctx, list(meeting_ids))
    # Events of courses that stay (a full-year course) stay on the course, as when a course
    # leaves a term; the deleted courses' events went with them (`delete_for_course`).
    await ctx.db.execute(
        update(ScheduleEvent)
        .where(
            ScheduleEvent.user_id == ctx.user_id,
            ScheduleEvent.term_id == term_id,
            ScheduleEvent.course_id.is_not(None),
        )
        .values(term_id=None, updated_at=ctx.now)
    )
    await ctx.db.execute(
        delete(ScheduleEvent).where(
            ScheduleEvent.user_id == ctx.user_id, ScheduleEvent.term_id == term_id
        )
    )


async def delete_for_program(ctx: Ctx, program_id: str) -> None:
    for model in (ScheduleEvent, ScheduleEventType, ScheduleFeed):
        await ctx.db.execute(
            delete(model).where(model.user_id == ctx.user_id, model.program_id == program_id)
        )


async def unlink_course_terms(
    ctx: Ctx, course_id: str, program_id: str, term_ids: Sequence[str]
) -> None:
    """A course left some terms: their meetings go, and its events there stop naming the term
    (they stay on the course). This runs after the academics commit, so it announces itself for
    clients that already refetched."""
    meeting_ids = (
        await ctx.db.scalars(
            select(ScheduleMeeting.id).where(
                ScheduleMeeting.user_id == ctx.user_id,
                ScheduleMeeting.course_id == course_id,
                ScheduleMeeting.term_id.not_in(list(term_ids)),
            )
        )
    ).all()
    await delete_meetings(ctx, list(meeting_ids))
    event_ids = (
        await ctx.db.scalars(
            select(ScheduleEvent.id).where(
                ScheduleEvent.user_id == ctx.user_id,
                ScheduleEvent.course_id == course_id,
                ScheduleEvent.term_id.is_not(None),
                ScheduleEvent.term_id.not_in(list(term_ids)),
            )
        )
    ).all()
    if event_ids:
        await ctx.db.execute(
            update(ScheduleEvent)
            .where(ScheduleEvent.id.in_(list(event_ids)))
            .values(term_id=None, updated_at=ctx.now)
        )
    for meeting_id in meeting_ids:
        await events.publish(
            ctx,
            "schedule.meeting.deleted",
            {"meeting_id": meeting_id, "course_id": course_id, "program_id": program_id},
        )
    for event_id in event_ids:
        await events.publish(
            ctx,
            "schedule.event.updated",
            {"event_id": event_id, "fields": ["term_id"], "program_id": program_id},
        )
    if meeting_ids or event_ids:
        await events.publish(ctx, "calendar.changed", {"program_id": program_id})
