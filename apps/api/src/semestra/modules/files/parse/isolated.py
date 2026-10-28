"""Parsing and page previews in a child process (M07 §3.1).

The readers and pdf.js-like renderers run third-party C code over untrusted bytes. In a child
process they get an address-space limit and a deadline, and a stuck or exploding file is killed
instead of tying up a job worker or the API's memory. macOS does not enforce the address-space
limit: there only the deadline applies.

At most `MAX_CHILDREN` children run at once (per event loop), so the file pipeline, imports and
chat attachments together cannot stack up their memory limits.
"""

import asyncio
import multiprocessing
import time
import traceback
import weakref
from collections.abc import AsyncGenerator, Callable, Sequence
from contextlib import aclosing
from dataclasses import dataclass
from multiprocessing.connection import Connection
from multiprocessing.context import ForkServerContext, SpawnContext

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
        forkserver.set_forkserver_preload([__name__])
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


def _ocr_child(conn: Connection, model: str, pngs: Sequence[bytes]) -> None:
    """Local OCR (M06 `local_ocr`) of the given page images. The engine loads here, so its
    memory goes when the child ends and a crash takes only the child down."""
    try:
        from semestra.modules.ai import local_ocr

        for index, png in enumerate(pngs):
            conn.send(Recognized(index, local_ocr.recognize(model, png)))
        conn.send(None)
    except MemoryError:
        conn.send(_Failed("files.too_complex", {}))
    except Exception:
        traceback.print_exc()
        conn.send(_Failed("files.parse_failed", {}))
    finally:
        conn.close()


async def ocr_isolated(
    model: str, pngs: Sequence[bytes], *, time_limit: float
) -> AsyncGenerator[Recognized]:
    """Text of each page image, read by local OCR in a child process, one child at a time
    (each holds a gigabyte or more). Raises `ParseError` when it fails or runs out of time."""
    async with _ocr_limiter(), aclosing(_run(_ocr_child, (model, list(pngs)), time_limit)) as m:
        async for message in m:
            if isinstance(message, Recognized):
                yield message


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
    target: Callable[..., None], args: tuple[object, ...], time_limit: float
) -> AsyncGenerator[object]:
    """Runs `target(conn, *args)` in a child process and yields what it sends until `None`."""
    async with _limiter(), aclosing(_child_messages(target, args, time_limit)) as messages:
        async for message in messages:
            yield message


def _limiter() -> anyio.CapacityLimiter:
    loop = asyncio.get_running_loop()
    if (limiter := _limiters.get(loop)) is None:
        limiter = _limiters[loop] = anyio.CapacityLimiter(MAX_CHILDREN)
    return limiter


async def _child_messages(
    target: Callable[..., None], args: tuple[object, ...], time_limit: float
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
            yield message
    finally:
        receiver.close()
        if process.is_alive():
            process.kill()
        await anyio.to_thread.run_sync(process.join, 5)
