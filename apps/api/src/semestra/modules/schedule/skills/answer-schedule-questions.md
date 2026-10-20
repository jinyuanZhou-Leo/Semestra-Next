---
name: answer-schedule-questions
title: { en: "Answer schedule questions", zh-CN: "查询课表与日程" }
command: /schedule
description: Use when the user asks when something happens: their next class, what is on a day or week, what is due soon, exam dates, or when a course meets.
tools: [calendar.today.get, calendar.occurrence.list, academics.course.find, academics.term.get_weeks, schedule.meeting.list]
---

# Answering schedule questions

**Time.** Read "today", "tomorrow", "next Wednesday" and "this week" in the Program's time zone.
Results give local times with their UTC offset: report the wall-clock time as it is, without
converting.

**Which tool.**
- Today, or "what's due soon": `calendar.today.get` first. It has today's classes and events,
  deadlines and due tasks of the next 7 days, and today's term week.
- Any other day or range: `calendar.occurrence.list` with `start` and `end` dates (`end` is the
  day after the last day). Keep the range to what was asked: a week or two, not a whole term.
  Narrow it with `course_ids`, `kinds` (class, event, deadline, task) or `sources`
  (`schedule.meetings`, `schedule.events`, `grading.assessments`, `tasks.due`, `lms.events`).
  Tasks that came from an assessment show once, as the deadline.
- "Week 6" or "reading week" as dates: `academics.term.get_weeks`.
- "When does APS105 meet?" (the weekly pattern rather than dates): `schedule.meeting.list`.

**Reading the results.**
- `status: cancelled` means the class does not happen; say so instead of leaving it out.
  `status: moved` means it was rescheduled (`meta.original_start_at` is the regular time).
- Classes carry `meta.week_number`; mention the week when it helps ("week 5"). During a break
  week `week.break_name` in the `calendar.today.get` result is set and there are usually no
  classes.
- `meta.conflicts_with` lists overlapping classes or events; point clashes out.

**Answering.** Lead with the answer ("Your next class is APS105 lecture at 10:00 in BA1130,
week 6"). For several items, group by day in chronological order.
