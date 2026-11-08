+++
name = "edit-class-schedule"
title = { en = "Edit the timetable", zh-CN = "编辑课表" }
command = "/timetable"
description = "Use when the user wants to add, change, cancel, move or hide classes, change a room, keep only their own tutorial, or add, change or delete one-off events such as exams and office hours."
tools = [
  "academics.course.find",
  "calendar.occurrence.list",
  "schedule.section.list",
  "schedule.section.create_many",
  "schedule.section.update",
  "schedule.section.delete",
  "schedule.meeting.create",
  "schedule.meeting.update",
  "schedule.meeting.delete",
  "schedule.meeting.set_enabled",
  "schedule.exception.upsert",
  "schedule.exception.delete",
  "schedule.event.list",
  "schedule.event.create_many",
  "schedule.event.update",
  "schedule.event.delete",
  "schedule.event_type.list",
  "schedule.event_type.create",
  "schedule.event_type.update",
  "schedule.conflict.list",
]
+++

# Editing the class schedule

**Model.** A course has *sections* in each of its terms (LEC0101, TUT0203): type, code,
instructor, and the weeks they run (weekly or biweekly, a week range). A section has one or more
weekly *meetings*, one per weekday: start and end time (wall-clock time of the Program) and room.
All meetings of a section run in the section's weeks. Single dates of a meeting can be cancelled
or moved (*exceptions*). Exams, office hours and make-up classes are one-off *events*.

**Finding what to change.** For one class on a date, find it with `calendar.occurrence.list`
(`course_ids`, `kinds: ["class"]`, a short range): its `ref.id` is the meeting id and
`meta.original_date` its regular date. For the weekly pattern, use `schedule.section.list`. For
an event, `ref.id` of its occurrence or `schedule.event.list`.

**One date only.** "Friday's lecture is cancelled", "Tuesday's tutorial moves to 3 pm":
`schedule.exception.upsert` with the meeting id and `original_date`, kind `cancelled` or
`moved`. Never delete the meeting for this. `schedule.exception.delete` undoes it.

**Every week.** "My lecture is in BA1130 now": `schedule.meeting.update` changes one meeting's
day, hours or room for every week of the term, past weeks included. The weeks, code, type and
instructor belong to the section: `schedule.section.update`. When a room or time change starts
partway through the term ("from week 6 on"), move each remaining date with
`schedule.exception.upsert` instead.

**New classes.** `schedule.section.create_many` with the term (a year-long course has a term per
half), type code (see `schedule.event_type.list`; LEC, PRA, TUT are built in, add others with
`schedule.event_type.create`), section code, weeks and its meetings. A section code the course
already has in that term adds the meetings to it when the weeks match (or are left out); with
other weeks they become a section of their own, titled with the code, and the existing section
keeps its weeks; `schedule.meeting.create` adds a meeting to a
section by its id. Afterwards run `schedule.conflict.list` for the term and tell the user about
any overlap.

**Sections the user does not attend.** Courses often list every tutorial section. Hide the ones
the user is not in with `schedule.meeting.set_enabled` (`enabled: false`), passing every meeting
of those sections, rather than deleting them.

**One-off events.** `schedule.event.create_many` with the course when it belongs to one. Times without
an offset are read in the Program's time zone; use `all_day` for whole days.
`schedule.event.update` and `schedule.event.delete` take the event id.
