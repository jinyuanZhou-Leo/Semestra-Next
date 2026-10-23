"""Splitting document pages into chunks for search (M07 §3.1 step 3). Pure functions.

Chunks follow the heading structure and paragraphs, aim for `TARGET_TOKENS` with `OVERLAP_TOKENS`
carried over when a section is split, and never reach across more than `MAX_PAGE_SPAN` pages.
"""

import hashlib
import math
import re
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field

CHUNKER_VERSION = "1"
TARGET_TOKENS = 600
OVERLAP_TOKENS = 80
MAX_PAGE_SPAN = 3
# A new heading starts a new chunk only when the current one is at least this big.
MIN_SECTION_TOKENS = 120

_CJK = re.compile(r"[぀-ヿ㐀-鿿가-힯]")
_WORD = re.compile(r"[^\W_]+")
# A markdown heading line (also how documents.py builds the outline).
HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_SENTENCE_END = re.compile(r"(?<=[.!?。！？；;])\s*")  # noqa: RUF001


def estimate_tokens(text: str) -> int:
    """Rough token count without a tokenizer: one per CJK character, ~1.3 per other word."""
    cjk = len(_CJK.findall(text))
    words = len(_WORD.findall(_CJK.sub(" ", text)))
    return cjk + math.ceil(words * 1.3)


@dataclass(frozen=True)
class Chunk:
    chunk_no: int
    page_from: int
    page_to: int
    heading_path: list[str]
    text: str
    token_count: int
    content_hash: str


@dataclass(frozen=True)
class _Heading:
    level: int
    title: str


def _events(markdown: str) -> Iterator[_Heading | str]:
    """Headings and blocks (paragraphs, lists, tables, code fences) of one page."""
    lines = markdown.replace("\r\n", "\n").split("\n")
    buffer: list[str] = []
    fence = False

    def flush() -> Iterator[str]:
        if buffer:
            yield "\n".join(buffer).strip()
            buffer.clear()

    for line in lines:
        if line.lstrip().startswith("```"):
            if not fence:
                yield from flush()
            buffer.append(line)
            if fence:
                yield from flush()
            fence = not fence
            continue
        if fence:
            buffer.append(line)
            continue
        heading = HEADING.match(line)
        if heading:
            yield from flush()
            yield _Heading(len(heading[1]), heading[2])
        elif not line.strip():
            yield from flush()
        else:
            buffer.append(line)
    yield from flush()


def _hard_split(text: str, limit: int) -> list[str]:
    """Cuts text with no sentence boundaries into pieces of about `limit` tokens."""
    pieces: list[str] = []
    current = ""
    for part in re.split(r"(\s+)", text):
        if current and estimate_tokens(current + part) > limit:
            pieces.append(current.strip())
            current = ""
        current += part
        while estimate_tokens(current) > limit:  # a single huge word or unbroken CJK text
            cut = max(1, len(current) * limit // max(estimate_tokens(current), 1))
            pieces.append(current[:cut].strip())
            current = current[cut:]
    if current.strip():
        pieces.append(current.strip())
    return pieces


def split_block(text: str, limit: int = TARGET_TOKENS) -> list[str]:
    """A block that is bigger than a chunk is cut at line and sentence boundaries."""
    if estimate_tokens(text) <= limit:
        return [text]
    units: list[str] = []
    for line in text.split("\n"):
        units += [s for s in _SENTENCE_END.split(line) if s.strip()] if len(line) > 200 else [line]
    pieces: list[str] = []
    current: list[str] = []
    size = 0
    for unit in units:
        tokens = estimate_tokens(unit)
        if tokens > limit:
            if current:
                pieces.append("\n".join(current))
                current, size = [], 0
            pieces += _hard_split(unit, limit)
            continue
        if size + tokens > limit and current:
            pieces.append("\n".join(current))
            current, size = [], 0
        current.append(unit)
        size += tokens
    if current:
        pieces.append("\n".join(current))
    return pieces


def _tail(text: str, tokens: int) -> str:
    """The end of `text`, about `tokens` tokens long, starting at a word boundary."""
    taken = 0
    start = len(text)
    for index in range(len(text) - 1, -1, -1):
        char = text[index]
        taken += 1 if _CJK.match(char) else (0.33 if char.isalnum() else 0.1)
        if taken > tokens:
            break
        start = index
    rest = text[start:]
    if start > 0 and not _CJK.match(text[start - 1]) and not text[start - 1].isspace():
        space = re.search(r"\s", rest)
        rest = rest[space.end() :] if space else rest
    return rest.strip()


@dataclass
class _Builder:
    blocks: list[tuple[int, str]] = field(default_factory=lambda: [])  # (page, text)
    tokens: int = 0
    path: list[str] = field(default_factory=lambda: [])
    new_blocks: int = 0  # blocks added since the chunk was started (not carried overlap)
    has_body: bool = False  # the path is fixed by the first block that is not a heading

    def add(self, page: int, text: str, path: list[str], *, heading: bool = False) -> None:
        if not self.has_body:
            self.path = list(path)
            self.has_body = not heading
        self.blocks.append((page, text))
        self.tokens += estimate_tokens(text)
        self.new_blocks += 1


def chunk_pages(pages: Sequence[tuple[int, str]]) -> list[Chunk]:
    """`pages` are `(page_no, markdown)` in order; returns the chunks in order."""
    chunks: list[Chunk] = []
    stack: list[_Heading] = []
    current = _Builder()

    def path() -> list[str]:
        return [h.title for h in stack]

    def emit(carry_overlap: bool) -> None:
        nonlocal current
        if current.new_blocks == 0 or not current.blocks:
            current = _Builder()
            return
        text = "\n\n".join(t for _, t in current.blocks)
        chunks.append(
            Chunk(
                chunk_no=len(chunks),
                page_from=current.blocks[0][0],
                page_to=current.blocks[-1][0],
                heading_path=current.path,
                text=text,
                token_count=estimate_tokens(text),
                content_hash=hashlib.sha256(text.encode()).hexdigest()[:16],
            )
        )
        last_page, last_text = current.blocks[-1]
        current = _Builder()
        if carry_overlap:
            tail = _tail(last_text, OVERLAP_TOKENS)
            if tail:
                current.blocks.append((last_page, tail))
                current.tokens = estimate_tokens(tail)
                current.path = chunks[-1].heading_path
                current.has_body = True

    for page_no, markdown in pages:
        for event in _events(markdown):
            if isinstance(event, _Heading):
                while stack and stack[-1].level >= event.level:
                    stack.pop()
                stack.append(event)
                if current.tokens >= MIN_SECTION_TOKENS:
                    emit(carry_overlap=False)
                current.add(page_no, f"{'#' * event.level} {event.title}", path(), heading=True)
                continue
            for piece in split_block(event):
                tokens = estimate_tokens(piece)
                if current.new_blocks and current.tokens + tokens > TARGET_TOKENS:
                    emit(carry_overlap=True)
                elif current.blocks and page_no - current.blocks[0][0] >= MAX_PAGE_SPAN:
                    emit(carry_overlap=False)
                current.add(page_no, piece, path())
    emit(carry_overlap=False)
    return chunks
