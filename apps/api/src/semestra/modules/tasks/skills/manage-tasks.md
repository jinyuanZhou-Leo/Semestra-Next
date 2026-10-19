---
name: manage-tasks
title: { en: "Manage tasks", zh-CN: "管理待办" }
command: /task
description: Create, find, complete and organise the student's tasks (to-dos), and answer "what is due" questions.
tools: [tasks.item.find, tasks.item.query, tasks.item.create, tasks.item.create_many, tasks.item.update, tasks.item.complete, tasks.item.move, tasks.item.delete, tasks.item.clear_completed, tasks.list.list, tasks.list.create, tasks.counts, calendar.occurrences, academics.course.find]
---

# Managing tasks

**Creating.** Give every task a course and a due date when you can. Take them from the
conversation or the current scope (a course page means that course); if neither tells you, ask
once instead of guessing. Dates are `YYYY-MM-DD` in the Program's time zone; `due_time` needs a
`due_date`. Resolve the course with `academics.course.find` and pass its id; the term is filled in
from the course and the due date. For several tasks at once (a syllabus, a list the user pasted)
use `tasks.item.create_many`, not a loop of single creates.

**Finding.** The user says "the lab report", not an id. Call `tasks.item.find` with their words,
then act on the best candidate; if two are close, name both and ask.

**"What is due this week?"** Use `calendar.occurrences` for the range: it merges tasks
(`tasks.due`) with assessments and events, and tasks that came from an assessment do not show twice.
Use `tasks.item.query` only for questions about the task list itself ("what is flagged", "what is in
my inbox"). `tasks.counts` answers "how many" cheaply.

**Changing.** Complete with `tasks.item.complete`; to undo, call it with `completed: false`.
`tasks.item.move` changes the list or the position. Tasks made from an assessment follow its due
date: change the assessment's date, not the task's. Completing such a task never changes a grade.

**Deleting.** `tasks.item.delete` and `tasks.item.clear_completed` cannot be undone. Only do them
when the user asked, and name how many tasks `clear_completed` will remove (see `tasks.counts`).
Deleting a list moves its tasks to the inbox unless the user asked to delete them too.
