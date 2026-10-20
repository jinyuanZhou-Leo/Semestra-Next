---
name: edit-class-schedule
title: { en: "Edit the timetable", zh-CN: "编辑课表" }
command: /timetable
description: Use when the user wants to add, change, cancel, move or hide classes, change a room, keep only their own tutorial, or add, change or delete one-off events such as exams and office hours.
tools: [academics.course.find, calendar.occurrence.list, schedule.meeting.list, schedule.meeting.create, schedule.meeting.update, schedule.meeting.delete, schedule.meeting.set_enabled, schedule.exception.upsert, schedule.exception.delete, schedule.event.list, schedule.event.create, schedule.event.update, schedule.event.delete, schedule.event_type.list, schedule.event_type.create, schedule.event_type.update, schedule.conflict.list]
---

# Editing the class schedule

**Model.** A course has weekly *meetings* in each of its terms: weekday, start and end time
(wall-clock time of the Program), weekly or biweekly, and a week range. A section (LEC0101,
TUT0203) can have several meetings, one per weekday; they share its `section_code`. Single dates
of a meeting can be cancelled or moved (*exceptions*). Exams, office hours and make-up classes
are one-off *events*.

**Finding what to change.** For one class on a date, find it with `calendar.occurrence.list`
(`course_ids`, `kinds: ["class"]`, a short range): its `ref.id` is the meeting id and
`meta.original_date` its regular date. For a weekly pattern, use `schedule.meeting.list`. For an
event, `ref.id` of its occurrence or `schedule.event.list`.

**One date only.** "Friday's lecture is cancelled", "Tuesday's tutorial moves to 3 pm":
`schedule.exception.upsert` with the meeting id and `original_date`, kind `cancelled` or
`moved`. Never delete the meeting for this. `schedule.exception.delete` undoes it.

**Every week.** "My lecture is in BA1130 now": `schedule.meeting.update` changes every week of
the term, past weeks included. When the change starts partway through the term ("from week 6
on"), split the meeting instead: set the old meeting's `end_week` to the week before, and
`schedule.meeting.create` a copy with the change from that week on (`start_week`; same
section, weekday, times and repeat).

**New meetings.** `schedule.meeting.create` with the term (a year-long course has a term per
half), type code (see `schedule.event_type.list`; LEC, PRA, TUT are built in, add others with
`schedule.event_type.create`) and times. Afterwards run `schedule.conflict.list` for the term and
tell the user about any overlap.

**Sections the user does not attend.** Courses often list every tutorial section. Hide the ones
the user is not in with `schedule.meeting.set_enabled` (`enabled: false`), passing every meeting
of those sections (all weekdays), rather than deleting them.

**One-off events.** `schedule.event.create` with the course when it belongs to one. Times without
an offset are read in the Program's time zone; use `all_day` for whole days.
`schedule.event.update` and `schedule.event.delete` take the event id.
