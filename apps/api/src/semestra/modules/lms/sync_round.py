"""What one course sync read (M09 §4.1, §4.2 table 3c): each area's list result, and the items
read on its own, within this round's budget (`rules.CHECKS_PER_RUN`).

Every stage of a course's sync reads the platform through the round (`area`, `read`) and asks
`rules.presence` whether an item it did not find is gone, so the materials, the assignments and
the announcements are judged by the same rule. The round keeps only plain values: each stage has
a transaction (and a database session) of its own, and writes what it read with `save` once it
holds the write lock.
"""

from collections.abc import Awaitable, Callable, Iterable
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
    STOPPING,
    AreaResult,
    Gone,
    ItemAnswer,
    Present,
    Unavailable,
    result_of,
)
from semestra.modules.lms.models import LmsCourseLink, LmsItemCheck
from semestra.modules.lms.rules import CHECKS_PER_RUN, Check
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
    # Items a list showed this round: a check of theirs that said otherwise is out of date.
    _listed: set[Key] = field(default_factory=lambda: set[Key]())

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
                except AppError:
                    self._nav = None
        if not self._nav:
            return None
        return not any(t.kind == area and not t.hidden for t in self._nav)

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
                closed = await self._nav_closed(ctx, link, b, area)
                result = b.provider.area_answer(exc, nav_closed=closed)
        else:
            result = "partial" if truncated(got) else "whole"
        before = self.areas.get(area)
        if part and before is not None and _WORSE[before] > _WORSE[result]:
            result = before
        self.areas[area] = result
        return got

    def listed(self, kind: str, external_ids: Iterable[str]) -> None:
        """These items were in one of this round's lists (table 3c, row 3): a single read of
        theirs that could not tell (their area closed) no longer stands (`save`)."""
        self._listed.update((kind, e) for e in external_ids)

    def unsupported(self, area: str) -> None:
        """The provider does not offer the area: it is no place an item can be listed in."""
        self.areas[area] = "unsupported"

    def results(self, areas: Iterable[str]) -> list[AreaResult]:
        """This round's results of these areas (one not read this round is not known)."""
        return [self.areas.get(a, "unavailable") for a in areas]

    def all_whole(self, areas: Iterable[str]) -> bool:
        results = [r for r in self.results(areas) if r != "unsupported"]
        return bool(results) and all(r == "whole" for r in results)

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

    async def read[T](
        self,
        ctx: Ctx,
        b: Bound,
        kind: str,
        external_id: str,
        read: Callable[[], Awaitable[T]],
        *,
        budgeted: bool = True,
    ) -> ItemAnswer | None:
        """Reads one item on its own within the budget, and records what it got; None when the
        budget is spent. Throttling, the platform down or the token failing is raised (the
        stage stops; the next round reads it again). Not `budgeted`: the contents of an item a
        list showed changed (a page), read whatever the budget."""
        if budgeted:
            if self.budget <= 0:
                self.out_of_budget = True
                return None
            self.budget -= 1
        try:
            answer: ItemAnswer = Present(await read())
        except AppError as exc:
            if exc.code in STOPPING:
                raise
            hidden = self.areas.get(AREA_OF.get(kind, "")) == "hidden"
            answer = b.provider.item_answer(exc, area_hidden=hidden)
        reason = answer.reason if isinstance(answer, Unavailable) else None
        self._new[(kind, external_id)] = _Read(result_of(answer), reason, ctx.now)
        return answer

    # --- writing --------------------------------------------------------------------------

    async def save(self, ctx: Ctx, link: LmsCourseLink, kinds: Iterable[str] | None = None) -> None:
        """Writes the single reads of these kinds (all when None) and the areas read so far:
        under the stage's write lock (`sync.hold`)."""
        wanted = set(kinds) if kinds is not None else None
        todo = {k: r for k, r in self._new.items() if wanted is None or k[0] in wanted}
        checks = await self._load(ctx, link)
        for key in self._listed:
            last = checks.get(key)
            stale = last is not None and last.result != "present"
            if stale and (wanted is None or key[0] in wanted) and key not in todo:
                todo[key] = _Read("present", None, ctx.now)
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
            at = ctx.now.isoformat()
            merged: dict[str, Any] = dict(link.area_reads or {})
            for a, r in self.areas.items():
                # Since when what it holds is as the platform last showed it whole.
                whole_at = at if r == "whole" else (merged.get(a) or {}).get("whole_at")
                merged[a] = {"result": r, "at": at, "whole_at": whole_at}
            if merged != link.area_reads:
                link.area_reads = merged
