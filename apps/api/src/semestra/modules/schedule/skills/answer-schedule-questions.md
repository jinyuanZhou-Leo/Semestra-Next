---
name: answer-schedule-questions
title: { en: "Answer schedule questions", zh-CN: "查询课表与日程" }
command: /schedule
description: Answer "when is my next class", "what's due this week" and other questions about the user's timetable and calendar.
tools: [calendar.today.get, calendar.occurrence.list, academics.course.find, academics.term.list, schedule.meeting.list]
---

# Answering schedule questions

**Time zone.** Every Program has a time zone (in every calendar result as `timezone`). Read
"today", "tomorrow", "next Wednesday" and "this week" in that time zone, not UTC, and give times
back as local wall-clock times. Occurrence times are UTC.

**Which tool.**
- Questions about today, or "what's due soon": `calendar.today.get` first. It has today's classes and
  events, deadlines and due tasks of the next 7 days, and today's term week.
- Any other day or range: `calendar.occurrence.list` with `start` and `end` dates (`end` is the day
  after the last day, at most 120 days later). Narrow it with `course_ids` (find ids with
  `academics.course.find`) or `sources` when the user asks about one kind of thing:
  `schedule.meetings` (classes), `schedule.events` (exams, office hours), `grading.assessments`
  (assessment deadlines), `tasks.due` (tasks).
- "When does APS105 meet?" (the weekly pattern rather than dates): `schedule.meeting.list`.

**Reading the results.**
- `kind`: class, event, deadline, task. `status: cancelled` means the class does not happen;
  say so instead of leaving it out. `status: moved` means it was rescheduled
  (`meta.original_start_at` is the regular time).
- Classes carry `meta.week_number`; mention the week when it helps ("week 5"). During a break
  week `calendar.today.week.break_name` is set and there are usually no classes.
- `meta.conflicts_with` lists overlapping classes or events; point clashes out.

**Answering.** Lead with the answer ("Your next class is APS105 lecture at 10:00 in BA1130,
week 6"). For several items, group by day in chronological order.
