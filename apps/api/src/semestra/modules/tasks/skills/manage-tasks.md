+++
name = "manage-tasks"
title = { en = "Manage tasks", zh-CN = "管理待办" }
command = "/task"
description = "Use when the user wants to add a to-do or reminder (\"remind me to…\"), or find, finish, change, move or delete tasks and task lists, or asks about the task list itself (flagged, overdue, unsorted)."
tools = [
  "tasks.item.find",
  "tasks.item.get",
  "tasks.item.query",
  "tasks.item.create",
  "tasks.item.create_many",
  "tasks.item.update",
  "tasks.item.complete",
  "tasks.item.move",
  "tasks.item.delete",
  "tasks.item.clear_completed",
  "tasks.item.count",
  "tasks.list.list",
  "tasks.list.create",
  "tasks.list.update",
  "tasks.list.delete",
  "academics.course.find",
  "grading.assessment.update",
  "calendar.occurrence.list",
]
+++

# Managing tasks

**Creating.** Pass the course and a due date when the user's words or the work context give
them; otherwise create the task without them (it goes to the inbox, and the user can edit the
card). Dates are `YYYY-MM-DD` in the Program's time zone; `due_time` needs a `due_date`. The
term is filled in from the course and the due date. For several tasks at once (a list the user
pasted) use `tasks.item.create_many`, not a loop of single creates. Tasks in a document are
imported instead (`import-from-documents`).

**Finding.** The user says "the lab report", not an id. Call `tasks.item.find` with their words,
then act on the best candidate; if two are close, name both and ask.

**The task list itself.** `tasks.item.query` answers "what is flagged", "what is overdue" or
"what is in the inbox" (tasks in no list); `tasks.item.count` answers "how many" cheaply. The
user sees the inbox as "Unsorted" (未归类); call it that, never "inbox". For
"what is due this week" across tasks, deadlines and classes, use `calendar.occurrence.list`.

**Changing.** Complete with `tasks.item.complete`; to undo, call it with `completed: false`.
`tasks.item.move` changes the list or the position. A task made from an assessment takes its
title, due date and course from the assessment: change the assessment
(`grading.assessment.update`), not the task. Completing such a task never changes a grade.

**Deleting.** `tasks.item.delete` and `tasks.item.clear_completed` cannot be undone. Only use
them when the user asked, and say how many tasks `clear_completed` will remove (see
`tasks.item.count`). Deleting a list moves its tasks to the inbox unless the user asked to delete
them too (`delete_tasks`).
