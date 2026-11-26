"""What a course's last sync left not updated, and why (M09 表 5c): the one place it is worked
out, from the link's `sync_problems` and `area_reads` and the items' last single reads. The sync
panel (`sync_status`), the status line, the course's settings (`CourseLink.sync_state`), the
assignment's details and the materials' "Remove" all read it, and keep no state of their own.

Two sides, each told once:
- Semestra's own problems (`problems`, rows 2-4): a stage that raised, items it could not
  write, reads a bug in the provider failed. They come back every round.
- What the platform did not give (rows 5-9): a part or an item not read, the platform not
  answering (`passing`), refusing (`refused`) or the area closed (`closed`). Gone by itself once
  it reads back.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import func, select

from semestra.core.context import Ctx
from semestra.modules.files import sources
from semestra.modules.files.models import FilesItem
from semestra.modules.lms import rules, sync
from semestra.modules.lms.answers import AREA_OF
from semestra.modules.lms.assignment_facts import SIDE_PARTS
from semestra.modules.lms.models import (
    LmsAnnouncement,
    LmsAssignment,
    LmsCourseLink,
    LmsImportedRef,
    LmsItemCheck,
    LmsMaterial,
)
from semestra.modules.lms.settings import materials as material_settings

# The parts of a course, in the order they are named (表 5c).
PARTS = (
    "course",
    "assignments",
    "submissions",
    "quizzes",
    "total",
    "announcements",
    "calendar",
    "files",
    "pages",
    "modules",
    "syllabus",
    "front_page",
)
# The parts the sync still reads of a course it no longer visits (its term ended, §4.8).
ENDED_PARTS = ("calendar",)
# The stages whose problems still count for such a course.
ENDED_STAGES = ("course", "calendar")
# Areas a teacher closes whose kept content the panel names (表 5c, row 8). Not the files area
# nor the pages: their items are each read on their own, found from the front page, the modules
# and the pages, and listed one by one when not got (row 9).
CLOSABLE = ("announcements", "assignments", "quizzes", "modules", "syllabus")

State = Literal["ok", "stale", "failed"]


def _at(raw: Any) -> datetime | None:
    return datetime.fromisoformat(raw) if isinstance(raw, str) and raw else None


@dataclass(frozen=True)
class Problem:
    """One stage's problem of Semestra's own (rows 2-4)."""

    stage: str
    code: str
    request_id: str
    ended: bool
    items: list[dict[str, Any]]
    reads: list[str]


@dataclass(frozen=True)
class Parts:
    """Parts of a course not read, for one reason (rows 5-7): `since` is when the earliest of
    them last read back (None: one never did)."""

    parts: list[str]
    code: str
    params: dict[str, Any]
    since: datetime | None

    @property
    def reason(self) -> rules.SyncReason:
        return rules.sync_reason(self.code)


@dataclass(frozen=True)
class Area:
    """An area the teacher closed, read back before (row 8): its content kept as of `since`."""

    area: str
    since: datetime | None
    count: int = 0


@dataclass(frozen=True)
class Item:
    """An item in Semestra whose single read did not get it (row 9)."""

    kind: Literal["material", "assignment"]
    material: LmsMaterial | None
    ref: LmsImportedRef | None
    file: FilesItem | None
    code: str
    params: dict[str, Any]
    since: datetime | None

    @property
    def reason(self) -> rules.SyncReason:
        return rules.sync_reason(self.code)

    @property
    def area(self) -> str:
        kind = self.material.kind if self.material is not None else "assignment"
        return AREA_OF.get(kind, "files")

    @property
    def removable(self) -> bool:
        """A followed material read from the platform (no copy saved in Semestra) the platform
        refuses or hides: it can be removed. One that may read back next round can't."""
        m, row = self.material, self.file
        return (
            m is not None
            and m.state == "synced"
            and row is not None
            and not (row.kind == "file" and bool(row.storage_key))
            and self.reason in ("closed", "refused")
        )


@dataclass
class CourseSync:
    link: LmsCourseLink
    problems: list[Problem] = field(default_factory=lambda: [])
    parts: list[Parts] = field(default_factory=lambda: [])
    areas: list[Area] = field(default_factory=lambda: [])
    items: list[Item] = field(default_factory=lambda: [])

    @property
    def state(self) -> State:
        """`failed` with a problem of Semestra's (rows 2-4), `stale` with something the platform
        did not give (rows 5-7, 9); a closed area (row 8) is how the course is set up."""
        if self.problems:
            return "failed"
        return "stale" if self.parts or self.items else "ok"


def problems_of(link: LmsCourseLink, visited: bool = True) -> list[Problem]:
    """The link's problems of Semestra's own; of a course the sync no longer visits, those of
    the stages it still runs."""
    out: list[Problem] = []
    for stage, p in (link.sync_problems or {}).items():
        if not visited and stage not in ENDED_STAGES:
            continue
        out.append(
            Problem(
                stage=stage,
                code=str(p.get("code") or "common.internal"),
                request_id=str(p.get("request_id") or ""),
                ended=bool(p.get("ended")),
                items=list(p.get("items") or []),
                reads=list(p.get("reads") or []),
            )
        )
    return sorted(out, key=lambda p: (not p.ended, p.stage))


def parts_of(link: LmsCourseLink, visited: bool = True) -> list[Parts]:
    """The parts not read for the platform's sake (rows 5-7), grouped by reason. The course
    itself refused is the one row of the course (row 5)."""
    reads: dict[str, Any] = dict(link.area_reads or {})
    groups: dict[tuple[str, tuple[tuple[str, Any], ...]], list[str]] = {}
    for part in PARTS if visited else ENDED_PARTS:
        entry = reads.get(part) or {}
        if entry.get("result") != "unavailable":
            continue
        if rules.area_closed(reads, part) or (
            part in SIDE_PARTS and rules.area_closed(reads, "assignments")
        ):
            continue  # still closed, as far as anyone can tell: the closed area's row (row 8)
        code = str(entry.get("reason") or "common.internal")
        reason = rules.sync_reason(code)
        if reason not in ("passing", "refused"):
            continue
        params: dict[str, Any] = dict(entry.get("params") or {})
        if part == "course" and reason == "refused":
            return [Parts(["course"], code, params, _at(entry.get("read_at")))]
        groups.setdefault((code, tuple(sorted(params.items()))), []).append(part)
    out: list[Parts] = []
    for (code, kept), parts in groups.items():
        read = [_at((reads.get(p) or {}).get("read_at")) for p in parts]
        since = None if None in read else min(r for r in read if r is not None)
        out.append(Parts(parts, code, dict(kept), since))
    return out


def areas_of(link: LmsCourseLink) -> list[str]:
    """The areas closed now that were read back before (row 8; never read: row 10, none)."""
    reads = link.area_reads or {}
    return [
        a
        for a in CLOSABLE
        if rules.area_closed(reads, a) and (reads.get(a) or {}).get("read_at") is not None
    ]


def _area(link: LmsCourseLink, area: str, count: int = 0) -> Area:
    entry = (link.area_reads or {}).get(area) or {}
    return Area(area, _at(entry.get("whole_at")) or _at(entry.get("read_at")), count)


async def items_of(ctx: Ctx, links: Sequence[LmsCourseLink]) -> list[Item]:
    """The items in Semestra whose last single read did not get them, for the platform's sake
    (row 9): the materials in a course's files (where its materials sync) and the imported
    assignments. One of a closed area stays while the area does (3c, note)."""
    if not links:
        return []
    by_id = {li.id: li for li in links}
    checks = {
        (c.link_id, c.kind, c.external_id): c
        for c in await ctx.db.scalars(
            select(LmsItemCheck).where(
                LmsItemCheck.user_id == ctx.user_id,
                LmsItemCheck.link_id.in_(list(by_id)),
                LmsItemCheck.result == "unavailable",
            )
        )
        if rules.sync_reason(c.reason or "common.internal") in ("closed", "passing", "refused")
    }
    if not checks:
        return []

    def still(check: LmsItemCheck, area: str) -> bool:
        if rules.sync_reason(check.reason or "") != "closed":
            return True
        return rules.area_closed(by_id[check.link_id].area_reads, area)

    out: list[Item] = []
    syncing = [li.id for li in links if (await material_settings(ctx, li.course_id)).sync]
    mats = [
        m
        for m in await ctx.db.scalars(
            select(LmsMaterial)
            .where(
                LmsMaterial.user_id == ctx.user_id,
                LmsMaterial.link_id.in_(syncing),
                (LmsMaterial.state == "synced")
                | ((LmsMaterial.state == "absent") & LmsMaterial.quiet),
            )
            .execution_options(populate_existing=True)
        )
        if (c := checks.get((m.link_id, m.kind, m.external_id))) is not None
        and still(c, AREA_OF.get(m.kind, "files"))
    ]
    files = {r.id: r for r in await sources.find_items(ctx, [m.item_id for m in mats if m.item_id])}
    for m in mats:
        c = checks[(m.link_id, m.kind, m.external_id)]
        out.append(
            Item(
                "material",
                m,
                None,
                files.get(m.item_id or ""),
                c.reason or "",
                dict(c.reason_params or {}),
                c.unavailable_since,
            )
        )
    for ref in await ctx.db.scalars(
        select(LmsImportedRef).where(
            LmsImportedRef.user_id == ctx.user_id,
            LmsImportedRef.link_id.in_(list(by_id)),
            LmsImportedRef.target_id.is_not(None),
            LmsImportedRef.removed_at.is_(None),
        )
    ):
        c = checks.get((ref.link_id, "assignment", ref.external_id))
        if c is None or not still(c, AREA_OF["assignment"]):
            continue
        out.append(
            Item(
                "assignment",
                None,
                ref,
                None,
                c.reason or "",
                dict(c.reason_params or {}),
                c.unavailable_since,
            )
        )
    return out


async def _counts(ctx: Ctx, areas: list[tuple[LmsCourseLink, str]]) -> dict[tuple[str, str], int]:
    """How much each closed area keeps that the panel counts: a course's announcements, its
    assignments not imported."""
    out: dict[tuple[str, str], int] = {}
    announced = [li.id for li, a in areas if a == "announcements"]
    if announced:
        rows = await ctx.db.execute(
            select(LmsAnnouncement.link_id, func.count())
            .where(LmsAnnouncement.user_id == ctx.user_id, LmsAnnouncement.link_id.in_(announced))
            .group_by(LmsAnnouncement.link_id)
        )
        out |= {(link_id, "announcements"): n for link_id, n in rows}
    assigned = [li.id for li, a in areas if a == "assignments"]
    if assigned:
        imported = {
            (r.link_id, r.external_id)
            for r in await ctx.db.scalars(
                select(LmsImportedRef).where(
                    LmsImportedRef.link_id.in_(assigned), LmsImportedRef.target_id.is_not(None)
                )
            )
        }
        for row in await ctx.db.scalars(
            select(LmsAssignment).where(
                LmsAssignment.user_id == ctx.user_id, LmsAssignment.link_id.in_(assigned)
            )
        ):
            assert row.link_id is not None
            if (row.link_id, row.external_id) not in imported:
                key = (row.link_id, "assignments")
                out[key] = out.get(key, 0) + 1
    return out


async def course_syncs(
    ctx: Ctx, links: Sequence[LmsCourseLink], visited: set[str] | None = None
) -> dict[str, CourseSync]:
    """Each link's `CourseSync`, by link id. `visited`: the links the sync still visits (None:
    those of an active term, `sync.active_course_ids`); of the others only what the sync still
    reads counts (§4.8)."""
    if visited is None:
        active = await sync.active_course_ids(ctx)
        visited = {li.id for li in links if li.course_id in active}
    out = {li.id: CourseSync(li) for li in links}
    whole: list[LmsCourseLink] = []
    for li in links:
        c = out[li.id]
        c.problems = problems_of(li, li.id in visited)
        if any(p.ended for p in c.problems):
            continue  # this round did not get through the course: that is all it says (row 2)
        c.parts = parts_of(li, li.id in visited)
        if c.parts and c.parts[0].parts == ["course"] and c.parts[0].reason == "refused":
            continue  # the course itself can't be read: its one row (row 5)
        if li.id in visited:
            # Areas and items (rows 8, 9) only of a course the sync still reads them of: what
            # its last visit left would otherwise stay listed, never to read back.
            whole.append(li)
    closed = [(li, a) for li in whole for a in areas_of(li)]
    counts = await _counts(ctx, closed)
    for li, a in closed:
        out[li.id].areas.append(_area(li, a, counts.get((li.id, a), 0)))
    for item in await items_of(ctx, whole):
        owner = item.material if item.material is not None else item.ref
        assert owner is not None
        out[owner.link_id].items.append(item)
    return out


async def states(ctx: Ctx, links: Sequence[LmsCourseLink]) -> dict[str, State]:
    """Each link's `CourseSync.state`, by link id (`CourseLink.sync_state`)."""
    return {k: v.state for k, v in (await course_syncs(ctx, links)).items()}


async def assignment_behind(
    ctx: Ctx, link: LmsCourseLink, external_id: str
) -> tuple[bool, datetime | None]:
    """Whether the last sync left one assignment of the course's mirror behind (M09 表 5c, §7.3):
    not written for a problem of Semestra's, its list not read back, or its own read not getting
    it; and as of when its submission is when the course's submissions were not read back."""
    reads = link.area_reads or {}
    problem = (link.sync_problems or {}).get("assignments") or {}
    behind = (
        any(
            i.get("kind") == "assignment" and i.get("external_id") == external_id
            for i in problem.get("items") or []
        )
        or (problem and not problem.get("items") and not problem.get("reads"))
        or (reads.get("assignments") or {}).get("result") == "unavailable"
    )
    if not behind:
        check = await ctx.db.scalar(
            select(LmsItemCheck).where(
                LmsItemCheck.link_id == link.id,
                LmsItemCheck.kind == "assignment",
                LmsItemCheck.external_id == external_id,
            )
        )
        behind = check is not None and check.result == "unavailable"
    submissions = reads.get("submissions") or {}
    as_of = (
        _at(submissions.get("read_at"))
        if submissions.get("result") in ("unavailable", "hidden")
        else None
    )
    return bool(behind), as_of
