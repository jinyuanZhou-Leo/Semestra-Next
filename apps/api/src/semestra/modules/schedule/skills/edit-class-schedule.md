---
name: edit-class-schedule
title: { en: "Edit the timetable", zh-CN: "编辑课表" }
command: /timetable
description: Add, change, cancel or move classes, sections and one-off events in the user's timetable.
tools: [academics.course.find, schedule.meeting.list, schedule.meeting.create, schedule.meeting.update, schedule.meeting.set_enabled, schedule.exception.upsert, schedule.exception.delete, schedule.event.create, schedule.event.update, schedule.event_type.list, schedule.conflict.list]
---

# Editing the class schedule

**Model.** A course has weekly *meetings* (sections such as LEC0101, TUT0203) in each of its
terms: weekday, start and end time (local wall-clock time of the Program), weekly or biweekly,
and a week range. Single dates of a meeting can be cancelled or moved (*exceptions*). Exams,
office hours and make-up classes are one-off *events*.

**One date only.** "Friday's lecture is cancelled", "Tuesday's tutorial moves to 3 pm":
`schedule.exception.upsert` with the meeting id and the class's regular date (`original_date`),
kind `cancelled` or `moved`. Never delete the meeting for this. `schedule.exception.delete` undoes
it.

**Every week.** "My lecture moved to room BA1130 for the rest of term": `schedule.meeting.update`.

**New sections.** `schedule.meeting.create` with the term (a year-long course has a term per
half), type code (see `schedule.event_type.list`; LEC, PRA, TUT are built in) and times. Before
creating, run `schedule.conflict.list` for the term (and again after) and tell the user about any
overlap.

**Sections the user does not attend.** Courses often list every tutorial section. Hide the ones
the user is not in with `schedule.meeting.set_enabled` (enabled: false) rather than deleting them.

**One-off events.** `schedule.event.create` with the course when it belongs to one. Times without
an offset are read in the Program's time zone; use `all_day` for whole days.
