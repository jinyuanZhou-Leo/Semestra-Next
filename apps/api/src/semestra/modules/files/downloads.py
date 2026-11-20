"""Archives asked for and not fetched yet (M07 §5).

An archive is asked for in two steps: a POST names the files and folders and opens files until
one can be read (so a refusal comes back as an error the page shows), and the browser then GETs a
short address with the id it got, which writes the archive from what the POST found, starting
with the file it already opened. So each file is opened once, and the address does not grow with
the selection.

What the POST found is kept in this process for `TTL_SECONDS` and taken by the first GET. The API
runs as one process (M15), so the GET finds it; one that is never fetched has its opened file
closed when it expires.
"""

import asyncio
import secrets
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime

from starlette.datastructures import State

# Long enough for the browser to start the download it was handed, short enough that an opened
# file (a source's answer, for a file read from there) is not held for long.
TTL_SECONDS = 60.0
# Archives one user may have waiting at once; asking for more closes the oldest.
PER_USER = 4


@dataclass
class Prepared:
    """One archive as the POST left it: its entries in order (a folder has no item id), the
    paths of the files that could not be opened, and the first file that could, opened."""

    user_id: str
    name: str
    members: list[tuple[str, str | None, datetime]]
    missing: list[str]
    first: tuple[int, AsyncIterator[bytes]] | None
    expiry: asyncio.TimerHandle | None = field(default=None, repr=False)


class Pending:
    def __init__(self) -> None:
        self._by_id: dict[str, Prepared] = {}
        self._closing: set[asyncio.Task[None]] = set()

    def put(self, prepared: Prepared) -> str:
        mine = [k for k, p in self._by_id.items() if p.user_id == prepared.user_id]
        for key in mine[: max(0, len(mine) - PER_USER + 1)]:
            self._drop(key)
        key = secrets.token_urlsafe(16)
        self._by_id[key] = prepared
        prepared.expiry = asyncio.get_running_loop().call_later(TTL_SECONDS, self._drop, key)
        return key

    def take(self, key: str, user_id: str) -> Prepared | None:
        """The archive, once: a second GET of the same id (or another user's) finds nothing."""
        prepared = self._by_id.get(key)
        if prepared is None or prepared.user_id != user_id:
            return None
        del self._by_id[key]
        if prepared.expiry is not None:
            prepared.expiry.cancel()
        return prepared

    def _drop(self, key: str) -> None:
        prepared = self._by_id.pop(key, None)
        if prepared is None:
            return
        if prepared.expiry is not None:
            prepared.expiry.cancel()
        if prepared.first is not None:
            close = getattr(prepared.first[1], "aclose", None)
            if close is not None:
                task = asyncio.create_task(close())
                self._closing.add(task)
                task.add_done_callback(self._closing.discard)


def pending(state: State) -> Pending:
    found: Pending | None = getattr(state, "file_downloads", None)
    if found is None:
        found = Pending()
        state.file_downloads = found
    return found
