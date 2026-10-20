"""Task capabilities (M05 §4)."""

from semestra.core.agent_output import CHANGED
from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.modules.tasks import service
from semestra.modules.tasks.schemas import (
    ProgramRef,
    Task,
    TaskCandidates,
    TaskClearInput,
    TaskClearResult,
    TaskCompleteInput,
    TaskCounts,
    TaskCountsInput,
    TaskCreateInput,
    TaskCreateManyInput,
    TaskCreateManyResult,
    TaskDeleted,
    TaskFindInput,
    TaskList,
    TaskListCreateInput,
    TaskListDeleteInput,
    TaskListDeleteResult,
    TaskListOrderInput,
    TaskListOut,
    TaskListUpdateInput,
    TaskMoveInput,
    TaskPage,
    TaskQueryInput,
    TaskRef,
    TaskUpdateInput,
)

TAGS = ("tasks",)

# What agents get back (M00 §3.6): no positions, import refs or timestamps.
_TASK_FIELDS = (
    "id", "term_id", "course_id", "list_id", "title", "notes", "due_date", "due_time",
    "priority", "flagged", "completed_at", "overdue", "source_kind",
)  # fmt: skip

# --- lists ----------------------------------------------------------------------------------


@capability(
    name="tasks.list.list",
    summary="List the task lists of a Program (term lists and Program-wide lists).",
    description="""Use to find a list id before creating or moving tasks. Tasks without a list are
in the inbox, which is not a list row.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/task-lists"),
    tags=TAGS,
    agent_output_fields=("items.id", "items.term_id", "items.name"),
)
async def list_list(ctx: Ctx, inp: ProgramRef) -> TaskListOut:
    return await service.list_lists(ctx, inp.program_id)


@capability(
    name="tasks.list.create",
    summary="Create a task list, for one term or for the whole Program.",
    description="""Use when the user wants a named list such as 'Errands'. Names are unique within
a term (or within the Program-wide lists). Do not create a list just to file one task: leave
tasks in the inbox unless the user names a list.""",
    effect="write",
    http=Http("POST", "/programs/{program_id}/task-lists"),
    tags=TAGS,
    agent_output_fields=("id", "name", "term_id"),
)
async def list_create(ctx: Ctx, inp: TaskListCreateInput) -> TaskList:
    return await service.create_list(ctx, inp)


@capability(
    name="tasks.list.update",
    summary="Rename a task list or change its color or icon.",
    description="Partial update: only the fields that are sent change.",
    effect="write",
    http=Http("PATCH", "/task-lists/{list_id}"),
    tags=TAGS,
    agent_output_fields=("id", "name", CHANGED),
)
async def list_update(ctx: Ctx, inp: TaskListUpdateInput) -> TaskList:
    return await service.update_list(ctx, inp)


@capability(
    name="tasks.list.delete",
    summary="Delete a task list; its tasks move to the inbox unless told otherwise.",
    description="""With `delete_tasks` true the list's tasks are deleted for good, so only use
it when the user asked for that. By default the tasks are kept in the inbox.""",
    effect="destructive",
    http=Http("DELETE", "/task-lists/{list_id}"),
    preview=service.preview_list_delete,
    tags=TAGS,
)
async def list_delete(ctx: Ctx, inp: TaskListDeleteInput) -> TaskListDeleteResult:
    return await service.delete_list(ctx, inp.list_id, delete_tasks=inp.delete_tasks)


@capability(
    name="tasks.list.reorder",
    summary="Set the display order of a Program's task lists.",
    description="Lists not named keep their relative order after the named ones.",
    effect="write",
    http=Http("PUT", "/programs/{program_id}/task-list-order"),
    tags=TAGS,
    agent_output_fields=("items.id", "items.name"),
)
async def list_reorder(ctx: Ctx, inp: TaskListOrderInput) -> TaskListOut:
    return await service.reorder_lists(ctx, inp.program_id, inp.list_ids)


# --- tasks ----------------------------------------------------------------------------------


@capability(
    name="tasks.item.query",
    summary="List a Program's tasks by view: today, scheduled, all, completed, inbox, flagged.",
    description="""Use for 'what do I have to do'. `today` includes overdue tasks. For questions
about what is due this week prefer calendar.occurrence.list, which merges tasks with assessment
deadlines and classes. Filter with list_id, term_id, course_id, search and due_from/due_to;
completed tasks are hidden unless the view is `completed` or include_completed is set.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/tasks"),
    tags=TAGS,
    agent_core=True,
    agent_default_fields=(
        "title",
        "due_date",
        "due_time",
        "priority",
        "flagged",
        "list_id",
        "course_id",
        "overdue",
        "completed_at",
    ),
)
async def item_query(ctx: Ctx, inp: TaskQueryInput) -> TaskPage:
    return await service.query_tasks(ctx, inp)


@capability(
    name="tasks.item.get",
    summary="Get one task with its notes, due date, priority and source.",
    description="Use when you need the full details of a task you already know the id of.",
    effect="read",
    http=Http("GET", "/tasks/{task_id}"),
    tags=TAGS,
    agent_output_fields=_TASK_FIELDS,
)
async def item_get(ctx: Ctx, inp: TaskRef) -> Task:
    return await service.item_out(ctx, await service.get_item_row(ctx, inp.task_id))


@capability(
    name="tasks.item.create",
    agent_core=True,
    summary="Create a task, optionally with a due date, course, list and priority.",
    description="""Always pass the course and due date when the user's words or the current scope
give them. Dates are in the Program's time zone; a time needs a date. The term is inferred from
the course and due date. Omit list_id to put the task in the inbox. Use tasks.item.create_many
for several tasks.""",
    effect="write",
    http=Http("POST", "/programs/{program_id}/tasks"),
    tags=TAGS,
    agent_output_fields=("id", "title", "due_date", "list_id", "course_id"),
)
async def item_create(ctx: Ctx, inp: TaskCreateInput) -> Task:
    return await service.create_task(ctx, inp.program_id, inp)


@capability(
    name="tasks.item.create_many",
    summary="Create several tasks at once; items with an already known source are skipped.",
    description="""Use for imports and for lists the user dictates. Set source_kind and source_ref
on imported items so that running the import again does not duplicate them; skipped items are
returned with the id of the task that already exists.""",
    effect="write",
    http=Http("POST", "/programs/{program_id}/tasks:batch"),
    tags=TAGS,
    agent_output_fields=("created.id", "created.title", "created.due_date", "skipped"),
)
async def item_create_many(ctx: Ctx, inp: TaskCreateManyInput) -> TaskCreateManyResult:
    return await service.create_tasks(ctx, inp.program_id, inp.items)


@capability(
    name="tasks.item.update",
    agent_core=True,
    summary="Change a task's title, notes, due date and time, priority, flag, list or course.",
    description="""Partial update: only the fields that are sent change; null clears the nullable
ones (due_date, due_time, course_id, list_id, term_id). Use tasks.item.complete to finish a task
and tasks.item.move to reorder it.""",
    effect="write",
    http=Http("PATCH", "/tasks/{task_id}"),
    tags=TAGS,
    agent_output_fields=("id", "title", CHANGED),
)
async def item_update(ctx: Ctx, inp: TaskUpdateInput) -> Task:
    return await service.update_task(ctx, inp)


@capability(
    name="tasks.item.complete",
    agent_core=True,
    summary="Mark a task done, or reopen it with completed=false.",
    description="Completing a task never changes grades, even if it came from an assessment.",
    effect="write",
    http=Http("POST", "/tasks/{task_id}:complete"),
    tags=TAGS,
    agent_output_fields=("id", "title", "completed_at"),
)
async def item_complete(ctx: Ctx, inp: TaskCompleteInput) -> Task:
    return await service.set_completed(ctx, inp.task_id, inp.completed)


@capability(
    name="tasks.item.move",
    summary="Move a task to another list (or the inbox) and/or to a place within the list.",
    description="""Send list_id (null = inbox) to change list; leave it out to reorder inside the
current one. before_task_id places the task right before that task, otherwise it goes last.""",
    effect="write",
    http=Http("POST", "/tasks/{task_id}:move"),
    tags=TAGS,
    agent_output_fields=("id", "title", "term_id", "course_id", "list_id"),
)
async def item_move(ctx: Ctx, inp: TaskMoveInput) -> Task:
    return await service.move_task(ctx, inp)


@capability(
    name="tasks.item.delete",
    summary="Delete a task for good.",
    description="""Irreversible. To finish a task use tasks.item.complete instead; delete only when
the user asks to remove it.""",
    effect="destructive",
    http=Http("DELETE", "/tasks/{task_id}"),
    preview=service.preview_item_delete,
    tags=TAGS,
)
async def item_delete(ctx: Ctx, inp: TaskRef) -> TaskDeleted:
    await service.delete_task(ctx, inp.task_id)
    return TaskDeleted()


@capability(
    name="tasks.item.clear_completed",
    summary="Delete the completed tasks of a Program, optionally of one list, term or course.",
    description="""Irreversible; returns how many were deleted. Use only when the user asks to clear
or clean up completed tasks.""",
    effect="destructive",
    http=Http("POST", "/programs/{program_id}/tasks:clear-completed"),
    tags=TAGS,
)
async def item_clear_completed(ctx: Ctx, inp: TaskClearInput) -> TaskClearResult:
    return await service.clear_completed(ctx, inp)


@capability(
    name="tasks.item.find",
    agent_core=True,
    summary="Find tasks by words of their title ('that lab report').",
    description="""Use whenever the user refers to a task in words and you need its id. If the two
best candidates score similarly, ask which one is meant.""",
    effect="read",
    expose=("agent", "mcp"),
    tags=TAGS,
)
async def item_find(ctx: Ctx, inp: TaskFindInput) -> TaskCandidates:
    return await service.find_tasks(ctx, inp)


@capability(
    name="tasks.item.count",
    summary="Counts of unfinished tasks per smart list, list and course (sidebar badges).",
    description="Cheap overview: today, overdue, scheduled, all, inbox, flagged and completed.",
    effect="read",
    http=Http("GET", "/programs/{program_id}/task-counts"),
    tags=TAGS,
)
async def counts(ctx: Ctx, inp: TaskCountsInput) -> TaskCounts:
    return await service.counts(ctx, inp.program_id, inp.term_id, inp.course_id)
