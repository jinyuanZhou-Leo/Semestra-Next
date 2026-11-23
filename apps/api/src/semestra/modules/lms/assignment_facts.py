"""The facts of a course's assignments and the user's submissions (M09 §3.1, §4.5): where they
come from, before anything is worked out of them.

The mirror (`LmsAssignment`) stands in for the platform. Only where it can't is the platform read
live, and what it says is not stored (reads write nothing): a course not syncing (the mirror is no
longer kept) or whose assignments list was never read back, an assignment the mirror lacks
(published since the last sync, opened from a link), and a caller asking for `refresh`. Either way
the facts come out the same (`Facts`), with where they came from and as of when (`Source`), so
one assembly (`assignment.py`) serves the details, the gradebook, the lists and Sem.

The platform reads are shared with the sync's assignments stage, which stores them: the
assignments list, and three reads that add to it (the course's submissions, its quizzes when an
assignment is one, the course total). One of those three failing leaves the assignments as read;
`Side.errors` names what failed.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.lms import reads, service
from semestra.modules.lms.answers import AREA_HIDDEN, STOPPING
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.models import LmsAssignment, LmsCourseLink
from semestra.modules.lms.schemas.dto import SubmissionDetail
from semestra.modules.lms.service import Bound

AREA = "assignments"

SourceKind = Literal["mirror", "live"]


@dataclass(frozen=True)
class Source:
    """Where facts came from: the mirror, as of the course's last list read (a held row: its own
    time), or the platform just now."""

    kind: SourceKind
    as_of: datetime | None = None


@dataclass
class Facts:
    """One assignment: the provider's `Assignment` (without the list's submission summary), the
    user's `SubmissionDetail` (None: never read), and `QuizFacts` for a quiz."""

    assignment: dict[str, Any]
    submission: dict[str, Any] | None
    quiz: dict[str, Any] | None
    provider: str
    source: Source
    # The mirror row (or held row) it was read from.
    row_id: str | None = None
    # A held row: the object it is held for, `(kind, id)`.
    held_for: tuple[str, str] | None = None

    @property
    def external_id(self) -> str:
        return str(self.assignment["external_id"])


@dataclass
class Side:
    """What the reads that add to the assignments list got: None for a read not made or failed
    (`errors` names the failures)."""

    submissions: dict[str, dict[str, Any]] | None = None
    submissions_cut: bool = False
    quizzes: dict[str, dict[str, Any]] | None = None
    total: dict[str, Any] | None = None
    total_read: bool = False
    errors: list[str] = field(default_factory=lambda: [])


@dataclass
class CourseFacts:
    items: list[Facts]
    source: Source
    truncated: bool
    total: dict[str, Any] | None


# --- reading the platform ----------------------------------------------------------------------


async def read_list(
    ctx: Ctx, link: LmsCourseLink, b: Bound, *, refresh: bool
) -> tuple[list[dict[str, Any]], bool]:
    """The course's assignments list (cleaned), and whether it was cut short. A refused list
    of a closed area is `lms.area_hidden`."""
    return await reads.raw_assignments(ctx, link.course_id, refresh, linked=(link, b))


async def _side_read(side: Side, run: Callable[[], Awaitable[Any]]) -> tuple[bool, Any]:
    """`(read, value)`: one read that adds to the list; a failure not about the account or the
    connection (`STOPPING`) is noted in `side.errors` and leaves it unread. An area the
    instructor closed (the quizzes) is how the course is set up, not a failure: left unread,
    each item keeps what was last read of it."""
    try:
        return True, await run()
    except AppError as exc:
        if exc.code in STOPPING:
            raise
        if exc.code != AREA_HIDDEN:
            side.errors.append(exc.code)
        return False, None


async def read_side(
    ctx: Ctx, link: LmsCourseLink, b: Bound, listed: list[dict[str, Any]], *, refresh: bool
) -> Side:
    """The reads that add to the assignments list. One about the account or the connection is
    raised; any other leaves its part unread."""
    side = Side()
    ext = link.external_course_id
    features = b.provider.features
    if "submissions" in features:

        async def subs() -> tuple[list[SubmissionDetail], bool]:
            return await service.call(
                ctx, b, lambda i: b.provider.submissions(i, b.cfg, b.creds, ext)
            )

        ok, got = await _side_read(side, subs)
        if ok:
            found, side.submissions_cut = got
            side.submissions = {}
            for s in found:
                s.body = b.clean(s.body, None, ext)
                side.submissions[s.assignment_id] = s.model_dump(mode="json")
    if "quizzes" in features and any(a.get("quiz_id") for a in listed):

        async def quizzes() -> Any:
            return await reads.quizzes(ctx, link.course_id, refresh)

        ok, found = await _side_read(side, quizzes)
        if ok:
            side.quizzes = {
                q.external_id: {"question_count": q.question_count, "time_limit": q.time_limit}
                for q in found.items
            }
    if "grades" in features:

        async def total() -> Any:
            got, _ = await service.call(
                ctx, b, lambda i: b.provider.course_total(i, b.cfg, b.creds, ext)
            )
            return got

        side.total_read, found = await _side_read(side, total)
        if found is not None:
            side.total = found.model_dump(mode="json")
    return side


def summary_detail(a: dict[str, Any]) -> dict[str, Any] | None:
    """The list's own summary of the user's submission, as a `SubmissionDetail` (no comments):
    what a round knows of an assignment whose submission it could not read."""
    summary = a.get("submission")
    if summary is None:
        return None
    ext = str(a["external_id"])
    return SubmissionDetail.model_validate(
        {**summary, "external_id": ext, "assignment_id": ext}
    ).model_dump(mode="json")


def facts_of(
    a: dict[str, Any],
    side: Side,
    previous: LmsAssignment | None,
    provider: str,
    source: Source,
) -> Facts:
    """One listed assignment's facts this round. What a side read did not give stays as the
    mirror had it (`previous`), else comes from the list's summary; one the course's submissions
    (read whole) don't have is not handed in."""
    ext = str(a["external_id"])
    assignment = {k: v for k, v in a.items() if k != "submission"}
    fresh = side.submissions.get(ext) if side.submissions is not None else None
    unread = side.submissions is None or side.submissions_cut
    if fresh is not None:
        submission = fresh
    elif unread and previous is not None and previous.submission is not None:
        submission = previous.submission
    else:
        submission = summary_detail(a)
        if submission is None and not unread:
            # The course's submissions were read whole and have none for it: not handed in.
            submission = SubmissionDetail(external_id=ext, assignment_id=ext).model_dump(
                mode="json"
            )
    quiz = None
    if quiz_id := a.get("quiz_id"):
        quiz = (side.quizzes or {}).get(str(quiz_id)) or (previous.quiz if previous else None)
    return Facts(assignment, submission, quiz, provider, source)


# --- what a read answers from ------------------------------------------------------------------


def as_of(link: LmsCourseLink) -> datetime | None:
    raw = (link.area_reads.get(AREA) or {}).get("read_at")
    return datetime.fromisoformat(raw) if raw else None


def mirrored(link: LmsCourseLink, refresh: bool) -> bool:
    """Whether the mirror stands in for the platform for this course (§3.1)."""
    return not refresh and link.sync_enabled and as_of(link) is not None


def from_row(row: LmsAssignment, link: LmsCourseLink | None) -> Facts:
    held = (
        (row.held_for_kind, row.held_for_id)
        if row.held_for_kind is not None and row.held_for_id is not None
        else None
    )
    when = row.seen_at if held is not None or link is None else as_of(link)
    return Facts(
        assignment=dict(row.assignment),
        submission=row.submission,
        quiz=row.quiz,
        provider=row.provider,
        source=Source("mirror", when),
        row_id=row.id,
        held_for=held,
    )


async def mirror_rows(ctx: Ctx, link_id: str) -> list[LmsAssignment]:
    return list(await ctx.db.scalars(select(LmsAssignment).where(LmsAssignment.link_id == link_id)))


async def course(
    ctx: Ctx,
    course_id: str,
    *,
    refresh: bool,
    linked: tuple[LmsCourseLink, Bound] | None = None,
) -> CourseFacts:
    """The course's assignments: the mirror where it stands in, else the platform now."""
    link, b = linked or await service.require_link(ctx, course_id)
    service.require_feature(b, "assignments")
    if mirrored(link, refresh):
        result = (link.area_reads.get(AREA) or {}).get("result")
        total = (
            {"score": link.total_score, "grade": link.total_grade}
            if link.total_score is not None or link.total_grade is not None
            else None
        )
        return CourseFacts(
            items=[from_row(r, link) for r in await mirror_rows(ctx, link.id)],
            source=Source("mirror", as_of(link)),
            truncated=result == "partial",
            total=total,
        )
    listed, truncated = await read_list(ctx, link, b, refresh=refresh)
    side = await read_side(ctx, link, b, listed, refresh=refresh)
    live = Source("live", ctx.now)
    return CourseFacts(
        items=[facts_of(a, side, None, b.row.provider, live) for a in listed],
        source=live,
        truncated=truncated,
        total=side.total,
    )


async def _held(ctx: Ctx, course_id: str, external_id: str) -> LmsAssignment | None:
    return await ctx.db.scalar(
        select(LmsAssignment)
        .where(
            LmsAssignment.user_id == ctx.user_id,
            LmsAssignment.course_id == course_id,
            LmsAssignment.held_for_id.is_not(None),
            LmsAssignment.external_id == external_id,
        )
        .order_by(LmsAssignment.held_for_kind)  # an assessment's before a to-do's
        .limit(1)
    )


async def one(ctx: Ctx, course_id: str, external_id: str, *, refresh: bool) -> Facts:
    """One assignment: its mirror row where the mirror stands in, else what is held for an
    object of this course, else the platform now (an assignment published since the last sync;
    `lms.not_found` only when the platform says it has none)."""
    link = await service.link_row(ctx, course_id)
    if link is not None and mirrored(link, refresh):
        row = await ctx.db.scalar(
            select(LmsAssignment).where(
                LmsAssignment.link_id == link.id, LmsAssignment.external_id == external_id
            )
        )
        if row is not None:
            return from_row(row, link)
    if not refresh or link is None:
        held = await _held(ctx, course_id, external_id)
        if held is not None:
            return from_row(held, link)
    if link is None:
        raise lms_error("lms.course_not_linked")
    return await read_one(ctx, *await service.require_link(ctx, course_id), external_id)


async def read_one(ctx: Ctx, link: LmsCourseLink, b: Bound, external_id: str) -> Facts:
    """One assignment read from the platform now, with the user's submission and, for a quiz,
    its facts (not stored)."""
    service.require_feature(b, "assignments")
    ext = link.external_course_id
    found, _ = await service.call(
        ctx, b, lambda i: b.provider.assignment(i, b.cfg, b.creds, ext, external_id)
    )
    found.html = b.clean(found.html, found.web_url, ext)
    reads.lock_text(found)
    a = found.model_dump(mode="json")
    side = Side()
    if "submissions" in b.provider.features:

        async def submission() -> SubmissionDetail:
            return await reads.submission(ctx, link.course_id, external_id, True)

        ok, got = await _side_read(side, submission)
        if ok:
            side.submissions = {external_id: got.model_dump(mode="json")}
    if a.get("quiz_id") and "quizzes" in b.provider.features:

        async def quizzes() -> Any:
            return await reads.quizzes(ctx, link.course_id, False)

        ok, listed = await _side_read(side, quizzes)
        if ok:
            side.quizzes = {
                q.external_id: {"question_count": q.question_count, "time_limit": q.time_limit}
                for q in listed.items
            }
    return facts_of(a, side, None, b.row.provider, Source("live", ctx.now))


async def by_quiz(ctx: Ctx, course_id: str, quiz_id: str) -> Facts | None:
    """The kept assignment of a quiz (mirror or held), when there is one."""
    rows = await ctx.db.scalars(
        select(LmsAssignment).where(
            LmsAssignment.user_id == ctx.user_id, LmsAssignment.course_id == course_id
        )
    )
    link = await service.link_row(ctx, course_id)
    for row in sorted(rows, key=lambda r: r.link_id is None):
        if str(row.assignment.get("quiz_id") or "") == quiz_id:
            if row.link_id is not None and (link is None or not mirrored(link, False)):
                continue
            return from_row(row, link)
    return None
