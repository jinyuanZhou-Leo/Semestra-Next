"""How many requests one connection has on the platform at once (M09 §2.4, "并发上限").

Every read of a connection (the sync, file downloads, the pages the user opens) goes through
its gate: at most `WIDE` requests in flight. A platform that tells how much of its rate limit is
left (Canvas: `X-Rate-Limit-Remaining`, a bucket that refills continuously) narrows it to one at
a time while that is under `LOW`, and widens it again once it is back, so reading side by side
never empties the bucket. Throttling that happens anyway is an answer like any other
(`lms.rate_limited`): the round stops and the next one reads again.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

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
        self._changed = asyncio.Condition()

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        async with self._changed:
            await self._changed.wait_for(lambda: self.busy < self.limit)
            self.busy += 1
        try:
            yield
        finally:
            async with self._changed:
                self.busy -= 1
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
