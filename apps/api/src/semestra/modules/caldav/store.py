"""A Program's to-do lists as CalDAV calendars of VTODOs (M05 §11).

Collections: the inbox (tasks without a list) and every list of the current term or of no term.
Each holds its open tasks and those finished in the last 30 days, the way a reminders app shows
them; inbox and Program-wide lists leave out tasks of other terms, as the app does.

Changes from a device go through the tasks service like any other edit, so events, the calendar
and auto tasks follow. A device cannot represent everything a task has, so:
- a task made from an assessment takes its title and course from it: a new title is ignored and
  a new due date moves the assessment's deadline (clearing it is ignored);
- a new task gets the course its title names (a code of a course this term), as typed tasks do;
- fields Semestra has and the device lacks (course, flag) are kept, and what the device has and
  Semestra lacks is kept in `CaldavItem.ical`.
A write answers without an ETag, so the device reads the task back and shows what was stored.
"""

import hashlib
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import rules as academic_rules
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.academics.schemas import Course, CourseListInput
from semestra.modules.caldav import vtodo
from semestra.modules.caldav.models import CaldavItem
from semestra.modules.grading.schemas import AssessmentUpdateInput
from semestra.modules.grading.service import assessments as grading
from semestra.modules.tasks import service as tasks
from semestra.modules.tasks.models import TasksItem, TasksList
from semestra.modules.tasks.schemas import TaskFields, TaskUpdateInput

INBOX = "inbox"
INBOX_NAMES = {"en": "Inbox", "zh-CN": "未归类"}
FINISHED_KEPT = timedelta(days=30)


class PreconditionFailed(Exception):
    pass


class Forbidden(Exception):
    pass


@dataclass(frozen=True)
class Collection:
    key: str
    name: str
    list_id: str | None
    color: str | None
    order: int


@dataclass(frozen=True)
class Item:
    name: str
    task: TasksItem
    body: bytes

    @property
    def etag(self) -> str:
        return f'"{hashlib.sha256(self.body).hexdigest()[:32]}"'


def ctag(collection: Collection, items: list[Item]) -> str:
    """Changes whenever a member is added, removed or changed (CalendarServer `getctag`)."""
    digest = hashlib.sha256(f"{collection.name}\0{collection.color}".encode())
    for item in sorted(items, key=lambda i: i.name):
        digest.update(f"\0{item.name}\0{item.etag}".encode())
    return digest.hexdigest()[:32]


class Store:
    def __init__(self, ctx: Ctx, program: AcademicsProgram) -> None:
        self.ctx = ctx
        self.program = program
        self.zone = ZoneInfo(program.timezone)
        self._term_id: str | None = None
        self._term_loaded = False

    async def term_id(self) -> str | None:
        if not self._term_loaded:
            terms = await academics.program_terms(self.ctx, self.program.id)
            term = academic_rules.current_term(
                terms, academics.program_today(self.ctx, self.program)
            )
            self._term_id = term.id if term else None
            self._term_loaded = True
        return self._term_id

    # --- collections ----------------------------------------------------------------------

    async def collections(self) -> list[Collection]:
        term_id = await self.term_id()
        inbox = Collection(INBOX, INBOX_NAMES.get(self.ctx.locale, "Inbox"), None, None, 0)
        rows = await self.ctx.db.scalars(
            select(TasksList)
            .where(
                TasksList.user_id == self.ctx.user_id,
                TasksList.program_id == self.program.id,
                or_(TasksList.term_id.is_(None), TasksList.term_id == term_id),
            )
            .order_by(TasksList.term_id.is_(None), TasksList.position, TasksList.created_at)
        )
        lists = [
            Collection(r.id, r.name, r.id, _hex(r.color), n) for n, r in enumerate(rows, start=1)
        ]
        return [inbox, *lists]

    async def collection(self, key: str) -> Collection | None:
        return next((c for c in await self.collections() if c.key == key), None)

    # --- items ----------------------------------------------------------------------------

    async def _rows(self, collection: Collection) -> list[TasksItem]:
        stmt = select(TasksItem).where(
            TasksItem.user_id == self.ctx.user_id,
            TasksItem.program_id == self.program.id,
            or_(
                TasksItem.completed_at.is_(None),
                TasksItem.completed_at >= self.ctx.now - FINISHED_KEPT,
            ),
        )
        if collection.list_id is None:
            stmt = stmt.where(TasksItem.list_id.is_(None))
        else:
            stmt = stmt.where(TasksItem.list_id == collection.list_id)
        row = await self.ctx.db.get(TasksList, collection.list_id) if collection.list_id else None
        if row is None or row.term_id is None:
            term_id = await self.term_id()
            stmt = stmt.where(or_(TasksItem.term_id.is_(None), TasksItem.term_id == term_id))
        return list(await self.ctx.db.scalars(stmt.order_by(TasksItem.position)))

    async def _mappings(self, task_ids: list[str]) -> dict[str, CaldavItem]:
        if not task_ids:
            return {}
        rows = await self.ctx.db.scalars(
            select(CaldavItem).where(
                CaldavItem.user_id == self.ctx.user_id, CaldavItem.task_id.in_(task_ids)
            )
        )
        return {r.task_id: r for r in rows}

    def _item(self, task: TasksItem, mapping: CaldavItem | None) -> Item:
        state = vtodo.TaskState(
            title=task.title,
            notes=task.notes,
            due_date=task.due_date,
            due_time=task.due_time,
            priority=task.priority,
            completed_at=task.completed_at,
            updated_at=task.updated_at,
            created_at=task.created_at,
        )
        uid = mapping.uid if mapping else task.id
        body = vtodo.render(state, uid, mapping.ical if mapping else None, self.zone)
        return Item(mapping.name if mapping else f"{task.id}.ics", task, body)

    async def items(self, collection: Collection) -> list[Item]:
        rows = await self._rows(collection)
        mappings = await self._mappings([r.id for r in rows])
        return [self._item(r, mappings.get(r.id)) for r in rows]

    async def item(self, collection: Collection, name: str) -> Item | None:
        return next((i for i in await self.items(collection) if i.name == name), None)

    async def _by_name_or_uid(
        self, name: str, uid: str
    ) -> tuple[TasksItem, CaldavItem | None] | None:
        """The task a write names, wherever it is now (a device moves a task to another list by
        writing it there under the same UID)."""
        mapping = await self.ctx.db.scalar(
            select(CaldavItem).where(
                CaldavItem.user_id == self.ctx.user_id,
                or_(CaldavItem.name == name, CaldavItem.uid == uid),
            )
        )
        # A task the device has not written yet has its id as name and UID.
        candidates = [mapping.task_id] if mapping else [name.removesuffix(".ics"), uid]
        for task_id in candidates:
            task = await self.ctx.db.get(TasksItem, task_id)
            if (
                task is not None
                and task.user_id == self.ctx.user_id
                and task.program_id == self.program.id
            ):
                return task, mapping
        return None

    # --- writes ---------------------------------------------------------------------------

    async def put(
        self,
        collection: Collection,
        name: str,
        body: bytes,
        *,
        if_match: str | None,
        if_none_match: str | None,
    ) -> bool:
        """Stores a device's VTODO; True when it made a new task."""
        fields, kept = vtodo.parse(body, self.zone)
        if not fields.title:
            raise vtodo.InvalidTodo("empty title")
        found = await self._by_name_or_uid(name, fields.uid)
        here = await self.item(collection, name)
        if if_none_match == "*" and here is not None:
            raise PreconditionFailed
        if if_match and if_match != "*" and (here is None or here.etag not in _tags(if_match)):
            raise PreconditionFailed
        if if_match == "*" and here is None:
            raise PreconditionFailed
        if found is None:
            task = await self._create(collection, fields)
            created = True
        else:
            task = found[0]
            await self._update(task, collection, fields)
            created = False
        await self._remember(task.id, fields.uid, name, kept)
        return created

    async def _create(self, collection: Collection, fields: vtodo.TodoFields) -> TasksItem:
        course_id = await self._course_named(fields.title)
        created = await tasks.create_task(
            self.ctx,
            self.program.id,
            TaskFields(
                title=fields.title,
                notes=fields.notes,
                due_date=fields.due_date,
                due_time=fields.due_time,
                priority=fields.priority,  # pyright: ignore[reportArgumentType]
                list_id=collection.list_id,
                course_id=course_id,
            ),
        )
        if fields.completed:
            await tasks.set_completed(self.ctx, created.id, True)
        return await tasks.get_item_row(self.ctx, created.id)

    async def _update(
        self, task: TasksItem, collection: Collection, fields: vtodo.TodoFields
    ) -> None:
        changes: dict[str, object] = {}
        if fields.notes != task.notes:
            changes["notes"] = fields.notes
        priority = vtodo.priority_in(fields.priority, task.priority)
        if priority != task.priority:
            changes["priority"] = priority
        if task.list_id != collection.list_id:
            changes["list_id"] = collection.list_id
        due = (fields.due_date, fields.due_time)
        if task.assessment_id is None:
            if fields.title != task.title:
                changes["title"] = fields.title
            if due != (task.due_date, task.due_time):
                changes["due_date"], changes["due_time"] = due
        elif fields.due_date is not None and due != (task.due_date, task.due_time):
            # The assessment's deadline is the task's due date (auto.py brings the task along).
            await grading.update_assessment(
                self.ctx,
                AssessmentUpdateInput.model_validate(
                    {
                        "assessment_id": task.assessment_id,
                        "due_date": fields.due_date,
                        "due_time": fields.due_time,
                    }
                ),
            )
        if changes:
            await tasks.update_task(
                self.ctx, TaskUpdateInput.model_validate({"task_id": task.id, **changes})
            )
        if fields.completed != (task.completed_at is not None):
            await tasks.set_completed(self.ctx, task.id, fields.completed)

    async def _remember(self, task_id: str, uid: str, name: str, kept: str) -> None:
        """Keeps the device's name, UID and text for the task (another task that had this name
        or UID gave it up: the device replaced it)."""
        stale = await self.ctx.db.scalars(
            select(CaldavItem).where(
                CaldavItem.user_id == self.ctx.user_id,
                CaldavItem.task_id != task_id,
                or_(CaldavItem.name == name, CaldavItem.uid == uid),
            )
        )
        for row in stale:
            await self.ctx.db.delete(row)
        await self.ctx.db.flush()
        row = await self.ctx.db.get(CaldavItem, task_id)
        if row is None:
            row = CaldavItem(task_id=task_id, user_id=self.ctx.user_id, uid=uid, name=name, ical="")
            self.ctx.db.add(row)
        row.uid, row.name, row.ical = uid, name, kept
        await self.ctx.db.flush()

    async def delete(self, collection: Collection, name: str, *, if_match: str | None) -> bool:
        """False when there is no such task here."""
        item = await self.item(collection, name)
        if item is None:
            return False
        if if_match and if_match != "*" and item.etag not in _tags(if_match):
            raise PreconditionFailed
        try:
            await tasks.delete_task(self.ctx, item.task.id)
        except AppError as e:
            # A task made from an assessment goes with the assessment.
            raise Forbidden from e
        return True

    async def _course_named(self, title: str) -> str | None:
        """The course whose code the title names, like a task typed in the app (M05 §5)."""
        settings = await tasks.program_settings(self.ctx, self.program.id)
        term_id = await self.term_id()
        if not settings.smart_parsing or term_id is None:
            return None
        page = await academics.list_courses(
            self.ctx, CourseListInput(program_id=self.program.id, term_id=term_id)
        )
        return course_for_title(title, page.items)


# A course code as typed: letters then digits, maybe a space between and a suffix ("APS105H1",
# "aps 105"), not inside a longer word (the same rule as the app's `parse.ts`).
_CODE = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]{2,}\s?\d{2,}[A-Za-z0-9]*(?![A-Za-z0-9])")


def _key(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum())


def course_for_title(title: str, courses: Sequence[Course]) -> str | None:
    """The first code in the title that is a course's whole code, or the start of exactly one
    course's code ("MAT135" names nothing when there are MAT135H1 and MAT135H5)."""
    coded = [(c.id, _key(c.code)) for c in courses if c.code and _key(c.code)]
    for found in _CODE.finditer(title):
        typed = _key(found.group())
        exact = [i for i, k in coded if k == typed]
        if exact:
            return exact[0]
        started = [i for i, k in coded if k.startswith(typed)]
        if len(started) == 1:
            return started[0]
    return None


_HEX = re.compile(r"#[0-9a-fA-F]{6}")


def _hex(color: str | None) -> str | None:
    return color if color and _HEX.fullmatch(color) else None


def _tags(header: str) -> set[str]:
    return {t.strip().removeprefix("W/") for t in header.split(",")}
