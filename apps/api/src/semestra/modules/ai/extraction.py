"""Structured extraction with evidence (M06 §5 `extract`).

Callers describe what they want as a Pydantic schema whose leaf fields are `Evidenced[T]`; this
module wraps the document as untrusted data, splits it when it does not fit the model's context,
asks for page-and-quote evidence, checks every quote against the page text, and merges the parts.
What the result means (dates, weights, matching courses) stays with the caller (M08, M02, ...).
"""

import json
import re
import unicodedata
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator
from pydantic.json_schema import SkipJsonSchema

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.ai import catalog
from semestra.modules.ai.calls import UNTRUSTED_NOTICE, structured_with, wrap_untrusted
from semestra.modules.ai.llm import Image, Message, PageText, Part, Purpose, Text, Usage
from semestra.modules.ai.resolve import resolve_provider

# A quote that cannot be found in the text caps the confidence at this ("low").
LOW_CONFIDENCE = 0.3
_WORDS = {"high": 0.9, "medium": 0.6, "low": LOW_CONFIDENCE}
# Share of the model's context window one segment may use; the rest is instructions, schema,
# output and slack for the token estimate.
SEGMENT_SHARE = 0.5
OUTPUT_RESERVE_TOKENS = 8_000
MIN_SEGMENT_TOKENS = 2_000
IMAGES_PER_SEGMENT = 8
IMAGE_TOKENS = 1_600
MAX_SPLITS = 6


class Evidence(BaseModel):
    page: int | None = Field(
        default=None, description="Page number from the [page N] marker the quote is on."
    )
    quote: str = Field(description="Short verbatim quote from the document (at most ~200 chars).")


class Evidenced[T](BaseModel):
    """One extracted value with where it came from and how sure the model is."""

    value: T | None = Field(
        default=None, description="The value, or null when the document does not state it."
    )
    evidence: Evidence | None = Field(default=None, description="Where the value is stated.")
    confidence: float = Field(default=0.5, description="0 to 1: how certain the value is.")
    # Set by the server when document parts disagree; not part of what the model fills in.
    conflict: SkipJsonSchema[bool] = False

    @field_validator("confidence", mode="before")
    @classmethod
    def _confidence(cls, v: object) -> object:
        if isinstance(v, str) and v.strip().lower() in _WORDS:
            return _WORDS[v.strip().lower()]
        if isinstance(v, int | float) and not isinstance(v, bool):
            return min(1.0, max(0.0, float(v)))
        return v


@dataclass(frozen=True)
class ExtractionWarning:
    code: Literal["evidence_not_found", "conflict"]
    path: str  # e.g. "assessments[2].weight"


@dataclass
class Extraction[T: BaseModel]:
    value: T
    warnings: list[ExtractionWarning] = field(default_factory=lambda: [])
    usage: Usage = field(default_factory=Usage)
    segments: int = 1


# --- segmentation ---------------------------------------------------------------------------


def estimate_tokens(text: str) -> int:
    """Rough and on the safe side: ~4 characters per token for Latin text, 1 per CJK character."""
    ascii_chars = sum(1 for c in text if ord(c) < 128)
    return ascii_chars // 4 + (len(text) - ascii_chars) + 1


@dataclass
class _Segment:
    pages: list[PageText] = field(default_factory=lambda: [])
    images: list[tuple[int, Image]] = field(default_factory=lambda: [])

    def tokens(self) -> int:
        return sum(estimate_tokens(p.text) for p in self.pages) + IMAGE_TOKENS * len(self.images)


def _split_text(page: PageText, budget: int) -> list[PageText]:
    """Pieces of one over-long page, cut at paragraph or line breaks where possible."""
    pieces: list[PageText] = []
    rest = page.text
    while estimate_tokens(rest) > budget:
        # Characters per token of this page, to turn the budget into a length.
        ratio = len(rest) / estimate_tokens(rest)
        cut = int(budget * ratio)
        window = rest[:cut]
        boundary = max(window.rfind("\n\n"), window.rfind("\n"))
        if boundary > cut // 2:
            cut = boundary
        pieces.append(PageText(page.page, rest[:cut]))
        rest = rest[cut:]
    pieces.append(PageText(page.page, rest))
    return pieces


def _segments(texts: Sequence[PageText], images: Sequence[Image], budget: int) -> list[_Segment]:
    segments: list[_Segment] = []
    current = _Segment()
    for page in texts:
        for piece in _split_text(page, budget) if estimate_tokens(page.text) > budget else [page]:
            if current.pages and current.tokens() + estimate_tokens(piece.text) > budget:
                segments.append(current)
                current = _Segment()
            current.pages.append(piece)
    for index, image in enumerate(images, start=1):
        if current.images and (
            len(current.images) >= IMAGES_PER_SEGMENT or current.tokens() + IMAGE_TOKENS > budget
        ):
            segments.append(current)
            current = _Segment()
        current.images.append((index, image))
    if current.pages or current.images:
        segments.append(current)
    return segments


def _halve(segment: _Segment) -> list[_Segment] | None:
    """Two smaller segments for a retry after `ai.context_too_long`, or None if it is atomic."""
    if len(segment.pages) + len(segment.images) > 1:
        mid_p, mid_i = len(segment.pages) // 2, len(segment.images) // 2
        if segment.pages and segment.images:
            return [_Segment(segment.pages, []), _Segment([], segment.images)]
        return [
            _Segment(segment.pages[:mid_p], segment.images[:mid_i]),
            _Segment(segment.pages[mid_p:], segment.images[mid_i:]),
        ]
    if len(segment.pages) == 1 and len(segment.pages[0].text) > 200:
        page = segment.pages[0]
        half = max(1, estimate_tokens(page.text) // 2)
        return [_Segment([piece]) for piece in _split_text(page, half)]
    return None


# --- prompts --------------------------------------------------------------------------------

_SYSTEM = """You extract structured data from documents.
{notice}
Only use information the documents state. When a value is not stated, leave it null; do not guess.
Fields shaped like {{"value", "evidence", "confidence"}}: put the value in `value`, copy a short \
verbatim quote that states it (at most about 200 characters, exactly as written) into \
`evidence.quote`, set `evidence.page` to the number of the [page N] (or [image N]) marker it is \
under, and set `confidence` between 0 and 1.

Task:
{instructions}"""


def _messages(
    segment: _Segment, instructions: str, label: str, index: int, total: int
) -> list[Message]:
    system = _SYSTEM.format(notice=UNTRUSTED_NOTICE, instructions=instructions.strip())
    if total > 1:
        system += (
            f"\n\nThe document is split into {total} parts; this is part {index}. Extract what "
            "this part contains and leave everything else null."
        )
    parts: list[Part] = []
    if segment.pages:
        body = "\n\n".join(f"[page {p.page}]\n{p.text}" for p in segment.pages)
        parts.append(Text(wrap_untrusted(body, label)))
    for number, image in segment.images:
        parts.append(Text(f"[image {number}]"))
        parts.append(image)
    return [Message.system(system), Message("user", parts)]


# --- evidence check -------------------------------------------------------------------------

_QUOTES = str.maketrans(
    {"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-"}
)


def _norm(text: str) -> str:
    """Comparison form: Unicode-normalised, case-folded, without any whitespace."""
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text).translate(_QUOTES)).casefold()


def _walk(node: object, path: str) -> list[tuple[str, Evidenced[Any]]]:
    if isinstance(node, Evidenced):
        return [(path, node)]  # pyright: ignore[reportUnknownVariableType]
    if isinstance(node, BaseModel):
        return [
            leaf
            for name in type(node).model_fields
            for leaf in _walk(getattr(node, name), f"{path}.{name}" if path else name)
        ]
    if isinstance(node, list | tuple):
        return [leaf for i, item in enumerate(node) for leaf in _walk(item, f"{path}[{i}]")]  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]
    if isinstance(node, dict):
        return [leaf for k, v in node.items() for leaf in _walk(v, f"{path}.{k}")]  # pyright: ignore[reportUnknownVariableType]
    return []


def verify_evidence(
    value: BaseModel, pages: Sequence[PageText], *, has_images: bool = False
) -> list[ExtractionWarning]:
    """Keeps only quotes that occur in the page text (ignoring whitespace), fixing the page
    number when the quote is on another page; otherwise drops the evidence and lowers the
    confidence. Evidence pointing at an image cannot be checked and is kept as it is."""
    by_page: dict[int, str] = {}
    for p in pages:
        by_page[p.page] = by_page.get(p.page, "") + _norm(p.text)
    warnings: list[ExtractionWarning] = []
    for path, leaf in _walk(value, ""):
        if leaf.value is None:
            leaf.evidence = None
            continue
        ev = leaf.evidence
        if ev is None:
            continue
        quote = _norm(ev.quote)
        if quote and ev.page is not None and quote in by_page.get(ev.page, ""):
            continue
        found = next((n for n, text in by_page.items() if quote and quote in text), None)
        if found is not None:
            ev.page = found
            continue
        if has_images and (ev.page is None or ev.page not in by_page):
            continue  # most likely quoted from an image: there is no text to check it against
        leaf.evidence = None
        leaf.confidence = min(leaf.confidence, LOW_CONFIDENCE)
        warnings.append(ExtractionWarning("evidence_not_found", path))
    return warnings


# --- merging parts --------------------------------------------------------------------------


def _values_only(node: Any) -> Any:
    """What two items are compared by when de-duplicating list entries across parts."""
    if isinstance(node, Evidenced):
        return _values_only(node.value)  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]
    if isinstance(node, BaseModel):
        return {k: _values_only(getattr(node, k)) for k in type(node).model_fields}
    if isinstance(node, list | tuple):
        return [_values_only(v) for v in node]  # pyright: ignore[reportUnknownVariableType]
    if isinstance(node, dict):
        return {k: _values_only(v) for k, v in node.items()}  # pyright: ignore[reportUnknownVariableType]
    if isinstance(node, str):
        return " ".join(node.split()).casefold()
    return node


def _signature(node: Any) -> str:
    return json.dumps(_values_only(node), sort_keys=True, default=str)


def _merge(a: Any, b: Any, path: str, warnings: list[ExtractionWarning]) -> Any:
    if a is None:
        return b
    if b is None:
        return a
    if isinstance(a, Evidenced) and isinstance(b, Evidenced):
        return _merge_leaf(a, b, path, warnings)  # pyright: ignore[reportUnknownArgumentType]
    if isinstance(a, BaseModel) and isinstance(b, BaseModel) and type(a) is type(b):
        merged = {
            name: _merge(
                getattr(a, name), getattr(b, name), f"{path}.{name}" if path else name, warnings
            )
            for name in type(a).model_fields
        }
        return a.model_copy(update=merged)
    if isinstance(a, list) and isinstance(b, list):
        seen = {_signature(x) for x in a}  # pyright: ignore[reportUnknownVariableType]
        return [*a, *(x for x in b if _signature(x) not in seen)]  # pyright: ignore[reportUnknownVariableType]
    return a


def _merge_leaf(
    a: Evidenced[Any], b: Evidenced[Any], path: str, warnings: list[ExtractionWarning]
) -> Evidenced[Any]:
    if a.value is None:
        return b
    if b.value is None:
        return a
    first, second = (a, b) if a.confidence >= b.confidence else (b, a)
    if _signature(a.value) == _signature(b.value):
        if first.evidence is None and second.evidence is not None:
            return first.model_copy(update={"evidence": second.evidence})
        return first
    warnings.append(ExtractionWarning("conflict", path))
    return first.model_copy(update={"conflict": True})


# --- entry point ----------------------------------------------------------------------------

OnSegment = Callable[[int, int], Awaitable[None]]


async def extract[T: BaseModel](
    ctx: Ctx,
    purpose: Purpose,
    schema: type[T],
    *,
    texts: Sequence[PageText] | None = None,
    images: Sequence[Image] | None = None,
    instructions: str,
    source_module: str,
    source_ref: str | None = None,
    label: str = "document",
    on_segment: OnSegment | None = None,
) -> Extraction[T]:
    """Extracts `schema` from page texts and/or images. `on_segment(done, total)` is called after
    each part, so a job can report `ctx.stage(..., current=done, total=total)`."""
    texts = [p for p in texts or [] if p.text.strip()]
    images = list(images or [])
    if not texts and not images:
        raise AppError("common.validation", 422, errors=[{"loc": ["texts"], "code": "missing"}])
    resolved = await resolve_provider(ctx, purpose)
    window = catalog.context_window(resolved.model)
    overhead = estimate_tokens(instructions) + estimate_tokens(
        json.dumps(schema.model_json_schema())
    )
    budget = max(MIN_SEGMENT_TOKENS, int(window * SEGMENT_SHARE) - overhead - OUTPUT_RESERVE_TOKENS)

    pending = _segments(texts, images, budget)
    results: list[T] = []
    warnings: list[ExtractionWarning] = []
    usage = Usage()
    total = len(pending)
    done = 0
    splits = 0
    while pending:
        segment = pending.pop(0)
        index = done + 1
        try:
            value, used = await structured_with(
                ctx,
                resolved,
                _messages(segment, instructions, label, index, max(total, index)),
                schema,
                source_module=source_module,
                source_ref=source_ref,
            )
        except AppError as exc:
            halves = _halve(segment) if exc.code == "ai.context_too_long" else None
            if halves is None or splits >= MAX_SPLITS:
                raise
            splits += 1
            pending = [*halves, *pending]
            total += 1
            continue
        usage.add(used)
        warnings += verify_evidence(value, segment.pages, has_images=bool(segment.images))
        results.append(value)
        done += 1
        if on_segment is not None:
            await on_segment(done, total)

    merged = results[0]
    for other in results[1:]:
        merged = _merge(merged, other, "", warnings)
    return Extraction(value=merged, warnings=warnings, usage=usage, segments=len(results))
