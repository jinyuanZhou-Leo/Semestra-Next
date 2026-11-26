"""How many requests one connection has on the platform at once, and who goes first (M09 §2.3,
"并发上限").

Every read of a connection (the sync, file downloads, the pages the user opens) goes through
its gate: at most `WIDE` requests in flight. A platform that tells how much of its rate limit is
left (Canvas: `X-Rate-Limit-Remaining`, a bucket that refills continuously) narrows it to one at
a time while that is under `LOW`, and widens it again once it is back, so reading side by side
never empties the bucket. Throttling that happens anyway is an answer like any other
(`lms.rate_limited`): the round stops and the next one reads again.

Work someone waits for goes first (M00 §3.7, at the level of requests): reads made by a job of
the `background` lane (the sync, the files it brings) wait while any other read waits, and while
the gate is wide they leave one place free for those. Each kind is let in first come, first
served.
"""

import asyncio
import itertools
from collections import deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from semestra.core import jobs

# In flight at once per connection. Canvas charges each request about 50 of its 700 up front
# until it ends: 6 at once hold about 300, half the bucket.
WIDE = 6
# What is left of Canvas's 700 under which requests go one at a time.
LOW = 300.0


class Gate:
    def __init__(self, wide: int = WIDE, low: float = LOW) -> None:
        self.wide = wide
        self.low = low
        self.limit = wide
        self.busy = 0
        self.busy_background = 0
        self._tickets = itertools.count()
        self._waiting: dict[bool, deque[int]] = {False: deque(), True: deque()}
        self._changed = asyncio.Condition()

    def _may_enter(self, ticket: int, background: bool) -> bool:
        if self.busy >= self.limit:
            return False
        if not background:
            return self._waiting[False][0] == ticket
        # Behind every read someone waits for, and one place left for them while wide.
        return (
            not self._waiting[False]
            and self._waiting[True][0] == ticket
            and self.busy_background < max(1, self.limit - 1)
        )

    @asynccontextmanager
    async def slot(self, background: bool | None = None) -> AsyncIterator[None]:
        """A place for one request; `background` defaults to whether a background job asks."""
        if background is None:
            background = jobs.in_background()
        async with self._changed:
            ticket = next(self._tickets)
            queue = self._waiting[background]
            queue.append(ticket)
            try:
                await self._changed.wait_for(lambda: self._may_enter(ticket, background))
            finally:
                queue.remove(ticket)
                # The next in line may enter now (or after a cancelled wait).
                self._changed.notify_all()
            self.busy += 1
            self.busy_background += background
        try:
            yield
        finally:
            async with self._changed:
                self.busy -= 1
                self.busy_background -= background
                self._changed.notify_all()

    async def left(self, remaining: float | None) -> None:
        """What the platform said is left of its limit (None: it didn't say)."""
        if remaining is None:
            return
        limit = 1 if remaining < self.low else self.wide
        if limit == self.limit:
            return
        async with self._changed:
            self.limit = limit
            self._changed.notify_all()
