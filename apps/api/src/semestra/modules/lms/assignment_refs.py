"""Where a platform assignment stands with Semestra (M09 table 4b): the one place that changes an
`LmsImportedRef`'s state.

States: no row; ignored (no object, `dismissed_at`); imported (an object); removed from the
platform (an object, `removed_at`, the user asked to keep or delete it). New assignments are
not a state (table 3e): they are worked out from the mirror.

An object that stops following its assignment but stays (unbound, the course unlinked, kept
after the platform deleted the assignment) gets the assignment's content as it was last read:
the mirror row is copied into a row held for the object (`hold`, §3.2), which explains its
grade from then on.
"""

from datetime import datetime
from typing import Literal

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.modules.lms.models import LmsAssignment, LmsCourseLink, LmsImportedRef

RefState = Literal["ignored", "imported", "removed"]
RefEvent = Literal[
    "import",  # imported or bound
    "move",  # a to-do it was imported as went into the gradebook: the assessment takes over
    "ignore",  # the user ignored a new assignment
    "remind",  # the user asked to be reminded of it again
    "gone",  # gone from the platform (table 3c)
    "back",  # back on the platform
    "keep",  # the user answered a removed one: keep the object
    "delete",  # the user answered a removed one: delete the object (the caller deletes it)
    "detach",  # the object deleted or unbound (`hold` keeps the content for an object that stays)
    "unlink",  # the course unlinked
]

# What each event does in each state (table 4b): the state it moves to (None: the row goes), or
# KEEP for no change. A pair left out cannot happen: `enter` refuses it.
KEEP = "keep"
NEXT: dict[tuple[RefState | None, RefEvent], RefState | Literal["keep"] | None] = {
    (None, "import"): "imported",
    (None, "ignore"): "ignored",
    ("ignored", "import"): "imported",
    ("ignored", "remind"): None,
    ("ignored", "gone"): None,
    ("ignored", "back"): KEEP,
    ("ignored", "unlink"): None,
    ("imported", "move"): "imported",
    ("imported", "gone"): "removed",
    ("imported", "back"): KEEP,
    ("imported", "detach"): None,
    ("imported", "unlink"): None,
    ("removed", "gone"): KEEP,
    ("removed", "back"): "imported",
    ("removed", "keep"): None,
    ("removed", "delete"): None,
    ("removed", "detach"): None,
    ("removed", "unlink"): None,
}


def state_of(ref: LmsImportedRef | None) -> RefState | None:
    if ref is None:
        return None
    if ref.target_id is None:
        return "ignored"
    return "removed" if ref.removed_at is not None else "imported"


class Impossible(RuntimeError):
    """An event table 4b says cannot happen in the ref's state."""


async def enter(
    ctx: Ctx,
    ref: LmsImportedRef | None,
    event: RefEvent,
    *,
    link: LmsCourseLink,
    external_id: str,
    target: tuple[str, str] | None = None,
    snapshot: dict[str, object] | None = None,
    hold: bool = False,
) -> LmsImportedRef | None:
    """Applies one event of table 4b to the assignment's ref (None: it has no row) and returns
    the ref after it (None: no row). `target` and `snapshot` are the object an import or bind
    makes it follow; `hold` keeps the content for an object that stays (unbound, kept, the
    course unlinked)."""
    state = state_of(ref)
    if (state, event) not in NEXT:
        raise Impossible(f"lms assignment {external_id}: {state} on {event}")
    after = NEXT[state, event]
    if after == KEEP:
        return ref
    if after is None:
        if ref is not None:
            if hold and ref.target_id is not None and ref.target_kind is not None:
                await hold_for(ctx, link.id, external_id, ref.target_kind, ref.target_id)
            await ctx.db.delete(ref)
            await ctx.db.flush()
        return None
    if ref is None:
        ref = LmsImportedRef(user_id=ctx.user_id, link_id=link.id, external_id=external_id)
        ctx.db.add(ref)
    match after:
        case "ignored":
            ref.dismissed_at = ctx.now
        case "imported" if event in ("import", "move"):
            assert target is not None
            _track(ref, target, snapshot or {}, ctx.now)
            await release(ctx, *target)
        case "imported":
            ref.removed_at = None
        case "removed":
            ref.removed_at = ctx.now
    await ctx.db.flush()
    return ref


def _track(
    ref: LmsImportedRef, target: tuple[str, str], snap: dict[str, object], now: datetime
) -> None:
    """The ref now follows this object: whatever it was waiting for (ignored, a conflict of an
    earlier object) is over."""
    ref.target_kind, ref.target_id = target
    ref.snapshot = dict(snap)
    ref.imported_at = now
    ref.dismissed_at = ref.removed_at = None
    ref.conflicts = {}


async def hold_for(ctx: Ctx, link_id: str, external_id: str, kind: str, target_id: str) -> None:
    """Copies the assignment's mirror row into a row held for the object (§3.2), replacing what
    was held for it before. Nothing to copy when the sync never read the assignment."""
    row = await ctx.db.scalar(
        select(LmsAssignment).where(
            LmsAssignment.link_id == link_id, LmsAssignment.external_id == external_id
        )
    )
    await release(ctx, kind, target_id)
    if row is None:
        return
    link = await ctx.db.get(LmsCourseLink, link_id)
    read_at = ((link.area_reads if link else {}).get("assignments") or {}).get("read_at")
    ctx.db.add(
        LmsAssignment(
            user_id=row.user_id,
            held_for_kind=kind,
            held_for_id=target_id,
            course_id=row.course_id,
            provider=row.provider,
            external_id=row.external_id,
            assignment=row.assignment,
            submission=row.submission,
            quiz=row.quiz,
            # The course's last list read; before any since the upgrade, when the row was read.
            seen_at=datetime.fromisoformat(read_at) if read_at else row.seen_at,
        )
    )
    await ctx.db.flush()


async def release(ctx: Ctx, kind: str, target_id: str) -> None:
    """Drops what is held for an object: it follows an assignment again, or it is gone."""
    held = await ctx.db.scalar(
        select(LmsAssignment).where(
            LmsAssignment.user_id == ctx.user_id,
            LmsAssignment.held_for_kind == kind,
            LmsAssignment.held_for_id == target_id,
        )
    )
    if held is not None:
        await ctx.db.delete(held)
        await ctx.db.flush()


async def ref_of(ctx: Ctx, link_id: str, external_id: str) -> LmsImportedRef | None:
    return await ctx.db.scalar(
        select(LmsImportedRef).where(
            LmsImportedRef.link_id == link_id, LmsImportedRef.external_id == external_id
        )
    )
