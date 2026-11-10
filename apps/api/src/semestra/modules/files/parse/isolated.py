"""Parsing and page previews in a child process (M07 §3.1).

The readers and pdf.js-like renderers run third-party C code over untrusted bytes. In a child
process they get an address-space limit and a deadline, and a stuck or exploding file is killed
instead of tying up a job worker or the API's memory. macOS does not enforce the address-space
limit: there only the deadline applies.

At most `MAX_CHILDREN` children run at once (per event loop), so the file pipeline, imports and
chat attachments together cannot stack up their memory limits.
"""

import asyncio
import contextlib
import multiprocessing
import time
import traceback
import weakref
from collections.abc import AsyncGenerator, Callable, Sequence
from contextlib import aclosing, asynccontextmanager
from dataclasses import dataclass
from multiprocessing.connection import Connection
from multiprocessing.context import ForkServerContext, SpawnContext
from multiprocessing.process import BaseProcess

import anyio
import anyio.to_thread

from semestra.modules.files.parse.detect import Detected
from semestra.modules.files.parse.readers import ParsedDocument, ParseError, parse
from semestra.modules.files.parse.render import PageRenderer

_POLL_SECONDS = 0.25
MAX_CHILDREN = 3
_limiters: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, anyio.CapacityLimiter] = (
    weakref.WeakKeyDictionary()
)
_ocr_limiters: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, anyio.CapacityLimiter] = (
    weakref.WeakKeyDictionary()
)


@dataclass(frozen=True)
class Parsed:
    document: ParsedDocument


@dataclass(frozen=True)
class Thumbnail:
    index: int
    total: int
    png: bytes


@dataclass(frozen=True)
class Rendered:
    index: int
    png: bytes


@dataclass(frozen=True)
class Recognized:
    index: int
    text: str


@dataclass(frozen=True)
class _Failed:  # ParseError itself does not survive pickling with its params
    code: str
    params: dict[str, object]


def _context() -> ForkServerContext | SpawnContext:
    # The forkserver forks children from a clean process that has these modules imported, so a
    # child starts quickly and inherits none of the API's threads or open connections.
    if "forkserver" in multiprocessing.get_all_start_methods():
        forkserver = multiprocessing.get_context("forkserver")
        # PyMuPDF is imported only where it is used, so the API process never loads it; the
        # forkserver loads it once for all children.
        forkserver.set_forkserver_preload([__name__, "pymupdf", "pymupdf4llm"])
        return forkserver
    return multiprocessing.get_context("spawn")


def _limit_memory(limit: int) -> None:
    if limit <= 0:
        return
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    except ImportError, ValueError, OSError:  # not enforceable on this platform
        pass


def _child(
    conn: Connection,
    data: bytes,
    detected: Detected,
    max_pages: int,
    thumbnail_pages: int,
    memory_limit: int,
) -> None:
    _limit_memory(memory_limit)
    try:
        document = parse(data, detected, max_pages=max_pages)
        conn.send(Parsed(document))
        if thumbnail_pages and detected.kind in ("pdf", "image"):
            renderer = PageRenderer(data, pdf=detected.kind == "pdf")
            total = min(len(document.pages), thumbnail_pages)
            for index in range(total):
                conn.send(Thumbnail(index, total, renderer.thumbnail(index)))
            renderer.close()
        conn.send(None)
    except ParseError as exc:
        conn.send(_Failed(exc.code, exc.params))
    except MemoryError:
        conn.send(_Failed("files.too_complex", {}))
    except Exception:
        traceback.print_exc()  # the child's stderr, for whoever runs the API
        conn.send(_Failed("files.parse_failed", {}))
    finally:
        conn.close()


def _render_child(
    conn: Connection, data: bytes, pdf: bool, pages: Sequence[int] | int, memory_limit: int
) -> None:
    """Page images for a vision model: the given pages, or the first `pages` of them."""
    _limit_memory(memory_limit)
    try:
        renderer = PageRenderer(data, pdf=pdf)
        indexes = range(min(renderer.page_count, pages)) if isinstance(pages, int) else pages
        for index in indexes:
            conn.send(Rendered(index, renderer.ocr_image(index)))
        renderer.close()
        conn.send(None)
    except MemoryError:
        conn.send(_Failed("files.too_complex", {}))
    except Exception:
        traceback.print_exc()
        conn.send(_Failed("files.parse_failed", {}))
    finally:
        conn.close()


def _ocr_child(conn: Connection, model: str, data: bytes, pdf: bool) -> None:
    """Local OCR (M06 `local_ocr`) of the document's pages it is sent, a list of indexes at a
    time, until `None`; each page is rendered and read here, answered as it is done, and each
    list is closed with `None`. A page that does not render is left out. The engine loads once
    here, so its memory goes when the child ends and a crash takes only the child down. There is
    no address-space limit (the engine needs gigabytes); the per-page deadline still applies."""
    renderer: PageRenderer | None = None
    try:
        from semestra.modules.ai import local_ocr

        renderer = PageRenderer(data, pdf=pdf)
        while (pages := conn.recv()) is not None:
            for index, page in enumerate(pages):
                try:
                    png = renderer.ocr_image(page)
                except Exception:
                    traceback.print_exc()
                    continue
                conn.send(Recognized(index, local_ocr.recognize(model, png)))
            conn.send(None)
    except EOFError:
        pass  # the parent went away
    except MemoryError:
        conn.send(_Failed("files.too_complex", {}))
    except Exception:
        traceback.print_exc()
        conn.send(_Failed("files.parse_failed", {}))
    finally:
        if renderer is not None:
            renderer.close()
        conn.close()


class OcrSession:
    """One local OCR child for a whole document (`ocr_session`): it renders the pages itself
    and loads the engine once; the parent asks for pages in batches."""

    def __init__(self, conn: Connection, process: BaseProcess, load_limit: float) -> None:
        self._conn = conn
        self._process = process
        self._first_limit = load_limit  # what the first page may take on top of `page_limit`

    async def read(self, pages: Sequence[int], *, page_limit: float) -> AsyncGenerator[Recognized]:
        """Text of the pages, in order; `Recognized.index` is the position in `pages`, and a
        page that did not render is missing. Raises `ParseError` when the child fails or a page
        runs out of time (the session cannot be used after that)."""
        await anyio.to_thread.run_sync(self._conn.send, list(pages))
        deadline = time.monotonic() + self._first_limit + page_limit
        self._first_limit = 0
        while True:
            ready = await anyio.to_thread.run_sync(self._conn.poll, _POLL_SECONDS)
            if time.monotonic() > deadline:
                raise ParseError("files.too_complex")
            if not ready:
                continue
            try:
                message = await anyio.to_thread.run_sync(self._conn.recv)
            except EOFError, OSError:  # the child died
                await anyio.to_thread.run_sync(self._process.join, 5)
                code = "files.too_complex" if (self._process.exitcode or 0) < 0 else None
                raise ParseError(code or "files.parse_failed") from None
            if message is None:
                return
            if isinstance(message, _Failed):
                raise ParseError(message.code, **message.params)
            deadline = time.monotonic() + page_limit
            if isinstance(message, Recognized):
                yield message


@asynccontextmanager
async def ocr_session(
    model: str, data: bytes, *, pdf: bool, load_limit: float
) -> AsyncGenerator[OcrSession]:
    """A local OCR child for one document (a PDF, or an image when not `pdf`); one at a time on
    the server (each holds a gigabyte or more), and it counts as one of the `MAX_CHILDREN`. The
    first page gets `load_limit` more to load the model."""
    async with _ocr_limiter(), _limiter():
        ours, theirs = multiprocessing.Pipe()
        args = (theirs, model, data, pdf)
        process = _context().Process(target=_ocr_child, args=args, daemon=True)
        await anyio.to_thread.run_sync(process.start)
        theirs.close()
        try:
            yield OcrSession(ours, process, load_limit)
        finally:
            with contextlib.suppress(OSError, ValueError):
                ours.send(None)
            ours.close()
            await anyio.to_thread.run_sync(process.join, 2)
            if process.is_alive():
                process.kill()
                await anyio.to_thread.run_sync(process.join, 5)


def _ocr_limiter() -> anyio.CapacityLimiter:
    loop = asyncio.get_running_loop()
    if (limiter := _ocr_limiters.get(loop)) is None:
        limiter = _ocr_limiters[loop] = anyio.CapacityLimiter(1)
    return limiter


async def render_isolated(
    data: bytes,
    *,
    pdf: bool,
    pages: Sequence[int] | int,
    time_limit: float,
    memory_limit: int,
) -> list[bytes]:
    """PNGs of the pages (`ocr_image`), rendered in a child process like `parse_isolated`."""
    wanted = pages if isinstance(pages, int) else list(pages)
    async with aclosing(_run(_render_child, (data, pdf, wanted, memory_limit), time_limit)) as m:
        return [r.png async for r in m if isinstance(r, Rendered)]


async def parse_isolated(
    data: bytes,
    detected: Detected,
    *,
    max_pages: int,
    thumbnail_pages: int,
    time_limit: float,
    memory_limit: int,
) -> AsyncGenerator[Parsed | Thumbnail]:
    """Yields the parsed document, then a preview per page (PDFs and images). Raises
    `ParseError("files.too_complex")` when the child runs out of time or memory while parsing;
    once the document is out, previews are best effort: a failure or the deadline only ends
    them."""
    args = (data, detected, max_pages, thumbnail_pages, memory_limit)
    parsed = False
    # Closed with this generator, so a caller that stops early still ends the child.
    async with aclosing(_run(_child, args, time_limit)) as messages:
        try:
            async for message in messages:
                if isinstance(message, Parsed | Thumbnail):
                    parsed = parsed or isinstance(message, Parsed)
                    yield message
        except ParseError:
            if not parsed:
                raise


async def _run(
    target: Callable[..., None],
    args: tuple[object, ...],
    time_limit: float,
    *,
    step_limit: float | None = None,
) -> AsyncGenerator[object]:
    """Runs `target(conn, *args)` in a child process and yields what it sends until `None`.
    With `step_limit`, each message moves the deadline to that long after it."""
    child = _child_messages(target, args, time_limit, step_limit)
    async with _limiter(), aclosing(child) as messages:
        async for message in messages:
            yield message


def _limiter() -> anyio.CapacityLimiter:
    loop = asyncio.get_running_loop()
    if (limiter := _limiters.get(loop)) is None:
        limiter = _limiters[loop] = anyio.CapacityLimiter(MAX_CHILDREN)
    return limiter


async def _child_messages(
    target: Callable[..., None],
    args: tuple[object, ...],
    time_limit: float,
    step_limit: float | None = None,
) -> AsyncGenerator[object]:
    receiver, sender = multiprocessing.Pipe(duplex=False)
    process = _context().Process(target=target, args=(sender, *args), daemon=True)
    await anyio.to_thread.run_sync(process.start)
    sender.close()
    deadline = time.monotonic() + time_limit
    try:
        while True:
            ready = await anyio.to_thread.run_sync(receiver.poll, _POLL_SECONDS)
            if time.monotonic() > deadline:
                raise ParseError("files.too_complex")
            if not ready:
                continue
            try:
                message = await anyio.to_thread.run_sync(receiver.recv)
            except EOFError:
                # Killed without a word: the memory limit, or a crash in C code.
                await anyio.to_thread.run_sync(process.join, 5)
                raise ParseError(
                    "files.too_complex" if (process.exitcode or 0) < 0 else "files.parse_failed"
                ) from None
            if message is None:
                return
            if isinstance(message, _Failed):
                raise ParseError(message.code, **message.params)
            if step_limit is not None:
                deadline = time.monotonic() + step_limit
            yield message
    finally:
        receiver.close()
        if process.is_alive():
            process.kill()
        await anyio.to_thread.run_sync(process.join, 5)
