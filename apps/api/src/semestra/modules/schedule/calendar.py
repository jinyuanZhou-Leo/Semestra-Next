"""Calendar aggregation (M04 §3): modules register sources, the backend merges them.

```python
from semestra.modules.schedule.calendar import calendar_source, Occurrence, OccurrenceQuery

@calendar_source("grading.assessments")
async def assessments(ctx: Ctx, q: OccurrenceQuery) -> list[Occurrence]: ...
```
A source returns the occurrences of its Program that start in `[range_start, range_end)` (and,
with `include_overdue`, unfinished overdue items before the range: tasks). It publishes
`calendar.changed` with `{program_id}` whenever its data changes.
"""

from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from semestra.core.context import Ctx
from semestra.modules.schedule.rules import overlaps

OccurrenceKind = Literal["class", "event", "deadline", "task"]
OccurrenceStatus = Literal["cancelled", "moved", "done", "overdue"]


class OccurrenceRef(BaseModel):
    entity: str = Field(description="What the occurrence comes from, e.g. 'schedule.meeting'")
    id: str


class OccurrenceMeta(BaseModel):
    """Optional details; sources fill in what applies to them."""

    conflicts_with: list[str] = Field(
        default_factory=list, description="Ids of overlapping classes or events"
    )
    term_id: str | None = None
    meeting_id: str | None = None
    original_date: date | None = Field(
        default=None, description="For a class: its regular date (also when moved)"
    )
    original_start_at: datetime | None = Field(
        default=None, description="For a moved class: when it would have been"
    )
    week_number: int | None = Field(default=None, description="Term week of a class")
    section_code: str | None = None
    instructor: str | None = None
    note: str | None = None
    url: str | None = Field(default=None, description="Link to the item elsewhere (e.g. the LMS)")


class Occurrence(BaseModel):
    id: str = Field(description="Stable: '<source>:<ref>[:<date>]'")
    source: str = Field(description="Registered source, e.g. 'schedule.meetings'")
    kind: OccurrenceKind
    title: str
    start_at: datetime = Field(description="UTC; local midnight of the day when all_day")
    end_at: datetime | None = Field(description="UTC, exclusive; null for a point in time")
    all_day: bool = False
    course_id: str | None = None
    type_code: str | None = None
    location: str | None = None
    color_ref: str | None = Field(
        default=None, description="'subject-<1..12>' or '#rrggbb', usually the course color"
    )
    status: OccurrenceStatus | None = None
    ref: OccurrenceRef
    meta: OccurrenceMeta = Field(default_factory=OccurrenceMeta)


@dataclass(frozen=True)
class OccurrenceQuery:
    program_id: str
    range_start: datetime
    range_end: datetime
    term_id: str | None = None
    course_ids: frozenset[str] | None = None
    include_overdue: bool = False

    def wants_course(self, course_id: str | None) -> bool:
        return self.course_ids is None or (course_id is not None and course_id in self.course_ids)


Source = Callable[[Ctx, OccurrenceQuery], Awaitable[list[Occurrence]]]


class SourceRegistry:
    def __init__(self) -> None:
        self._items: dict[str, Source] = {}

    def register(self, name: str, fn: Source) -> None:
        if name in self._items:
            raise ValueError(f"duplicate calendar source {name!r}")
        self._items[name] = fn

    def names(self) -> list[str]:
        return sorted(self._items)

    def get(self, name: str) -> Source | None:
        return self._items.get(name)


sources = SourceRegistry()


def calendar_source(name: str) -> Callable[[Source], Source]:
    def decorate(fn: Source) -> Source:
        sources.register(name, fn)
        return fn

    return decorate


_KIND_ORDER = {"class": 0, "event": 1, "deadline": 2, "task": 3}


def _sort_key(o: Occurrence) -> tuple[datetime, int, int, str]:
    return (o.start_at, 0 if o.all_day else 1, _KIND_ORDER[o.kind], o.title)


def mark_conflicts(items: Sequence[Occurrence]) -> None:
    """A class that overlaps another class or a timed event: both get each other's id."""
    timed = [
        o
        for o in items
        if o.kind in ("class", "event")
        and not o.all_day
        and o.end_at is not None
        and o.status != "cancelled"
    ]
    timed.sort(key=lambda o: o.start_at)
    for i, a in enumerate(timed):
        assert a.end_at is not None
        for b in timed[i + 1 :]:
            assert b.end_at is not None
            if b.start_at >= a.end_at:
                break
            if "class" not in (a.kind, b.kind):
                continue
            if overlaps(a.start_at, a.end_at, b.start_at, b.end_at):
                a.meta.conflicts_with.append(b.id)
                b.meta.conflicts_with.append(a.id)


async def collect(
    ctx: Ctx, q: OccurrenceQuery, wanted: Iterable[str] | None = None
) -> list[Occurrence]:
    """Occurrences of the wanted sources (all registered ones by default), sorted, with
    conflicts marked. Sources that are not registered (e.g. a module that is not built yet) are
    skipped."""
    names = sources.names() if wanted is None else [n for n in dict.fromkeys(wanted)]
    items: list[Occurrence] = []
    for name in names:
        fn = sources.get(name)
        if fn is not None:
            items.extend(await fn(ctx, q))
    items.sort(key=_sort_key)
    mark_conflicts(items)
    return items
