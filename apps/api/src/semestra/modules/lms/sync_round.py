"""What one course sync read (M09 §4.1, §4.2 table 3c): each area's list result, and the items
read on its own, within this round's budget (`rules.CHECKS_PER_RUN`).

Every stage of a course's sync reads the platform through the round (`area`, `judge`,
`read_many`), and the materials, the assignments and the announcements it did not find are judged
by `judge`: the one flow around `rules.presence` (M09 table 3c). The budget is spent in one place
(`_spend`). The round keeps only plain values: each stage has a transaction (and a database
session) of its own, and writes what it read with `save` once it holds the write lock.
"""

from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.lms import service
from semestra.modules.lms.answers import (
    AREA_HIDDEN,
    AREA_OF,
    OFF_NAV,
    STOPPING,
    AreaResult,
    Gone,
    ItemAnswer,
    Present,
    Unavailable,
    nav_closed,
    result_of,
)
from semestra.modules.lms.models import LmsCourseLink, LmsItemCheck
from semestra.modules.lms.rules import CHECKS_PER_RUN, Check, Presence, area_entry, presence
from semestra.modules.lms.service import Bound

Key = tuple[str, str]
_UNREAD = object()
# Of two reads of one area, the one that tells less wins.
_WORSE: dict[AreaResult, int] = {
    "whole": 0,
    "unsupported": 0,
    "partial": 1,
    "hidden": 2,
    "unavailable": 3,
}


@dataclass
class _Read:
    result: str
    reason: str | None
    at: datetime


@dataclass(frozen=True)
class Asked:
    """An item `judge` is asked about: whether it was in one of this round's area lists, whether
    it can be read on its own, and whether it is older than the window its list reads."""

    kind: str
    external_id: str
    listed: bool = False
    readable: bool = True
    before_lookback: bool = False


@dataclass
class Judged:
    """What `judge` made of each item (by `(kind, external id)`), and the answers of the items it
    read on their own this time."""

    verdicts: dict[Key, Presence]
    answers: dict[Key, ItemAnswer]


# Several items of one kind read on their own: each one's data or the error it got.
ReadItems = Callable[[str, list[str]], Awaitable[Sequence[Any]]]


def one_by_one(read: Callable[[str, str], Awaitable[Any]]) -> ReadItems:
    """Reads items one at a time with `read(kind, external_id)`, for kinds without a batch read.
    An item's error is its answer; one about the connection or the platform stops the stage."""

    async def items(kind: str, external_ids: list[str]) -> list[Any]:
        out: list[Any] = []
        for external_id in external_ids:
            try:
                out.append(await read(kind, external_id))
            except AppError as exc:
                if exc.code in STOPPING:
                    raise
                out.append(exc)
        return out

    return items


@dataclass
class SyncRound:
    """One course's sync round. `started` is when its first stage began (`begin`)."""

    started: datetime | None = None
    areas: dict[str, AreaResult] = field(default_factory=lambda: {})
    budget: int = CHECKS_PER_RUN
    # A single read was wanted but the budget was spent: what it would have told is not judged
    # this round, and a first sync of the course is not over (materials keep coming in quietly).
    out_of_budget: bool = False
    _nav: Any = _UNREAD
    _checks: dict[Key, Check] | None = None
    _new: dict[Key, _Read] = field(default_factory=lambda: {})
    # Why an area was unavailable this round (an error code).
    _reasons: dict[str, str] = field(default_factory=lambda: {})

    def begin(self, now: datetime) -> None:
        if self.started is None:
            self.started = now

    # --- areas ----------------------------------------------------------------------------

    async def _nav_closed(self, ctx: Ctx, link: LmsCourseLink, b: Bound, area: str) -> bool | None:
        """Whether this round's navigation of the course leaves `area` out or hides it; None
        when it could not be read (or the provider has none)."""
        if self._nav is _UNREAD:
            self._nav = None
            if "navigation" in b.provider.features:
                ext = link.external_course_id
                try:
                    self._nav, _ = await service.call(
                        ctx, b, lambda i: b.provider.navigation(i, b.cfg, b.creds, ext)
                    )
                except AppError as exc:
                    if exc.code in STOPPING:
                        raise  # about the connection: the stage stops and changes nothing
                    self._nav = None
        return nav_closed(self._nav, area)

    async def area[T](
        self,
        ctx: Ctx,
        link: LmsCourseLink,
        b: Bound,
        area: str,
        read: Callable[[], Awaitable[T]],
        truncated: Callable[[T], bool] = lambda got: bool(getattr(got, "truncated", False)),
        *,
        part: bool = False,
    ) -> T | None:
        """Reads one area's list and records its result (table 2): None when it gave nothing
        (closed, refused, not offered). An answer about the connection or the platform as a whole
        (throttled, down, the token) is raised: the stage stops and changes nothing. `part`: one
        more read of the same area (a module's items): the area is whole only if every part is."""
        result: AreaResult
        got: T | None = None
        try:
            got = await read()
        except AppError as exc:
            if exc.code in STOPPING:
                raise
            if exc.code == "lms.feature_unsupported":
                result = "unsupported"
            elif exc.code == AREA_HIDDEN:  # told apart by the read itself (`reads._read`)
                result = "hidden"
            else:
                closed = None if area in OFF_NAV else await self._nav_closed(ctx, link, b, area)
                result = b.provider.area_answer(exc, nav_closed=closed)
                if result == "unavailable":
                    self._reasons[area] = exc.code
        else:
            result = "partial" if truncated(got) else "whole"
        before = self.areas.get(area)
        if part and before is not None and _WORSE[before] > _WORSE[result]:
            result = before
        self.areas[area] = result
        return got

    def unsupported(self, area: str) -> None:
        """The provider does not offer the area: it is no place an item can be listed in."""
        self.areas[area] = "unsupported"

    def results(self, areas: Iterable[str]) -> list[AreaResult]:
        """This round's results of these areas (one not read this round is not known)."""
        return [self.areas.get(a, "unavailable") for a in areas]

    # --- single reads ---------------------------------------------------------------------

    async def _load(self, ctx: Ctx, link: LmsCourseLink) -> dict[Key, Check]:
        if self._checks is None:
            self._checks = {
                (c.kind, c.external_id): Check(c.result, c.at, c.reason)  # type: ignore[arg-type]
                for c in await ctx.db.scalars(
                    select(LmsItemCheck).where(LmsItemCheck.link_id == link.id)
                )
            }
        return self._checks

    async def last(
        self, ctx: Ctx, link: LmsCourseLink, kind: str, external_id: str
    ) -> Check | None:
        """The item's last single read: this round's, else the one before."""
        key = (kind, external_id)
        if (mine := self._new.get(key)) is not None:
            return Check(mine.result, mine.at, mine.reason)  # type: ignore[arg-type]
        return (await self._load(ctx, link)).get(key)

    async def oldest_first(self, ctx: Ctx, link: LmsCourseLink, keys: Iterable[Key]) -> list[Key]:
        """`keys` in the order the budget goes: never read on their own first, then by the time
        of their last single read."""
        checks = await self._load(ctx, link)
        floor = datetime.min.replace(tzinfo=None)

        def when(key: Key) -> tuple[int, datetime]:
            c = checks.get(key)
            return (0, floor) if c is None else (1, c.at.replace(tzinfo=None))

        return sorted(dict.fromkeys(keys), key=when)

    def read_this_round(self, kind: str, external_id: str) -> ItemAnswer | None:
        """This round's single read of the item, if any (as an answer without its data)."""
        r = self._new.get((kind, external_id))
        if r is None:
            return None
        if r.result == "present":
            return Present()
        if r.result == "gone":
            return Gone()
        return Unavailable(r.reason or "")

    async def read_many[T](
        self,
        ctx: Ctx,
        b: Bound,
        kind: str,
        external_ids: Sequence[str],
        read: Callable[[list[str]], Awaitable[Sequence[T | AppError]]],
        *,
        budgeted: bool = True,
    ) -> dict[str, ItemAnswer]:
        """Reads items of one kind on their own, side by side (`reads.files_many`,
        `reads.pages_many`), and records what each got: those the budget allows, in the order
        given (`oldest_first`); the answer of each one read. `read` gives each one's data or the
        error it got; throttling, the platform down or the token failing is raised (the stage
        stops; the next round reads it again). Not `budgeted`: the contents of items a list
        showed changed (pages), read whatever the budget."""
        wanted = self._spend(list(external_ids)) if budgeted else list(external_ids)
        if not wanted:
            return {}
        got = await read(wanted)
        return {e: self._record(ctx, b, kind, e, one) for e, one in zip(wanted, got, strict=True)}

    def _spend[K](self, wanted: list[K]) -> list[K]:
        """The round's budget rule, the one place it is applied: the first of `wanted` (in the
        order the budget goes) up to what is left, spent before reading; the rest wait for a
        later round (`out_of_budget`)."""
        if len(wanted) > self.budget:
            self.out_of_budget = True
            wanted = wanted[: max(self.budget, 0)]
        self.budget -= len(wanted)
        return wanted

    def _record(self, ctx: Ctx, b: Bound, kind: str, external_id: str, got: object) -> ItemAnswer:
        if isinstance(got, AppError):
            area = self.areas.get(AREA_OF.get(kind, ""))
            answer: ItemAnswer = b.provider.item_answer(got, area=area)
        else:
            answer = Present(got)
        reason = answer.reason if isinstance(answer, Unavailable) else None
        self._new[(kind, external_id)] = _Read(result_of(answer), reason, ctx.now)
        return answer

    async def judge(
        self,
        ctx: Ctx,
        link: LmsCourseLink,
        b: Bound,
        items: Iterable[Asked],
        *,
        areas: Iterable[str],
        read: ReadItems,
    ) -> Judged:
        """Whether each item is still on the platform (M09 table 3c), the same steps for every
        kind: judge each one by `rules.presence`; of those that need a read of their own (row 10)
        and can have one, take the oldest first up to the round's budget (spent before reading);
        read them, a kind at a time, with `read`; judge those again on what they answered. One
        not read this round is not judged (`unknown`). `areas`: the areas these items may be
        listed in."""
        results = self.results(areas)
        verdicts: dict[Key, Presence] = {}
        wanted: list[Key] = []
        for item in items:
            key = (item.kind, item.external_id)
            verdict = presence(
                listed=item.listed,
                areas=results,
                now=ctx.now,
                read=self.read_this_round(*key),
                last=await self.last(ctx, link, *key),
                before_lookback=item.before_lookback,
            )
            if verdict == "check":
                if item.readable:
                    wanted.append(key)
                verdict = "unknown"
            verdicts[key] = verdict
        ordered = self._spend(await self.oldest_first(ctx, link, wanted))
        answers: dict[Key, ItemAnswer] = {}
        for kind in dict.fromkeys(k for k, _ in ordered):
            ids = [e for k, e in ordered if k == kind]
            got = await self.read_many(
                ctx, b, kind, ids, lambda wanted, kind=kind: read(kind, wanted), budgeted=False
            )
            for external_id, answer in got.items():
                key = (kind, external_id)
                answers[key] = answer
                verdicts[key] = presence(listed=False, areas=results, now=ctx.now, read=answer)
        return Judged(verdicts, answers)

    # --- writing --------------------------------------------------------------------------

    async def save(self, ctx: Ctx, link: LmsCourseLink, kinds: Iterable[str] | None = None) -> None:
        """Writes the single reads of these kinds (all when None) and the areas read so far:
        under the stage's write lock (`sync.hold`)."""
        wanted = set(kinds) if kinds is not None else None
        todo = {k: r for k, r in self._new.items() if wanted is None or k[0] in wanted}
        if todo:
            rows = {
                (c.kind, c.external_id): c
                for c in await ctx.db.scalars(
                    select(LmsItemCheck).where(LmsItemCheck.link_id == link.id)
                )
            }
            for (kind, external_id), r in todo.items():
                row = rows.get((kind, external_id))
                if row is None:
                    row = LmsItemCheck(
                        user_id=ctx.user_id, link_id=link.id, kind=kind, external_id=external_id
                    )
                    ctx.db.add(row)
                if r.result == "unavailable":
                    if row.result != "unavailable" or row.unavailable_since is None:
                        row.unavailable_since = r.at
                else:
                    row.unavailable_since = None
                row.result, row.reason, row.at = r.result, r.reason, r.at
        if self.areas:
            merged: dict[str, Any] = dict(link.area_reads or {})
            for a, r in self.areas.items():
                merged[a] = area_entry(merged.get(a), r, ctx.now, self._reasons.get(a))
            if merged != link.area_reads:
                link.area_reads = merged
