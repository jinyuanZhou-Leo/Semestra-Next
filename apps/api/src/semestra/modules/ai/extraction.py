"""Structured extraction with evidence (M06 §5 `extract`).

Callers describe what they want as a Pydantic schema whose leaf fields are `Evidenced[T]`; this
module wraps the document as untrusted data, splits it when it does not fit the model's context,
asks for page-and-quote evidence, checks every quote against the page text, and merges the parts.
What the result means (dates, weights, matching courses) stays with the caller (M08, M02, ...).

The model never sees `Evidenced` itself but a "wire" copy of the schema in which every field is
required (`wire_schema`): strict structured output (Claude's JSON mode) compiles the schema to a
grammar, and optional or nullable fields make that grammar grow fast enough to be refused. A large
schema is read in `parts` (groups of its top-level fields), one request each, side by side.
"""

import asyncio
import functools
import json
import re
import unicodedata
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, get_args, get_origin

from pydantic import BaseModel, Field, create_model, field_validator
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
# output and slack for the token estimate. The reserve is taken off the segment on top of that;
# the answer may use more than it (the provider's own output cap applies), which the other half
# of the window leaves room for.
SEGMENT_SHARE = 0.5
OUTPUT_RESERVE_TOKENS = 8_000
MIN_SEGMENT_TOKENS = 2_000
IMAGES_PER_SEGMENT = 8
IMAGE_TOKENS = 1_600
MAX_SPLITS = 6
MAX_CUT_SPLITS = 2  # of those, after an answer cut off at the output limit


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


# --- wire schema ----------------------------------------------------------------------------


def _leaf_type(leaf: type[BaseModel]) -> Any:
    """`T` of an `Evidenced[T]` class (its `value` is `T | None`)."""
    value = leaf.model_fields["value"].annotation
    return next(a for a in get_args(value) if a is not type(None))


@functools.cache
def _wire_leaf(value_type: Any) -> type[BaseModel]:
    # Text that is not stated is "", so only other values need a null (a union in the grammar).
    value = str if value_type is str else value_type | None
    name = re.sub(r"\W+", "_", getattr(value_type, "__name__", repr(value_type))).strip("_")
    return create_model(
        f"Evidenced_{name}"[:64],
        value=(value, Field(description='The value; null (or "" for text) when not stated.')),
        quote=(str, Field(description='Short verbatim quote stating it, or "".')),
        page=(int, Field(description="Number of the [page N] marker the quote is under, or 0.")),
        confidence=(float, Field(description="0 to 1: how certain the value is.")),
    )


def _wire_type(annotation: Any) -> Any:
    if isinstance(annotation, type) and issubclass(annotation, Evidenced):
        return _wire_leaf(_leaf_type(annotation))
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return wire_schema(annotation)
    if get_origin(annotation) is list:
        return list[_wire_type(get_args(annotation)[0])]
    return annotation


@functools.cache
def wire_schema(schema: type[BaseModel], fields: tuple[str, ...] | None = None) -> type[BaseModel]:
    """What the model is asked to fill in for `schema` (or only its `fields`): the same shape with
    every field required and each `Evidenced` leaf flattened to value, quote, page, confidence."""
    names = fields or tuple(schema.model_fields)
    suffix = "_".join(fields) if fields else ""
    definitions: dict[str, Any] = {
        name: (
            _wire_type(schema.model_fields[name].annotation),
            Field(description=schema.model_fields[name].description),
        )
        for name in names
    }
    name = f"{schema.__name__}_{suffix}" if suffix else schema.__name__
    return create_model(name[:64], __doc__=schema.__doc__, **definitions)


def _from_wire(node: Any) -> Any:
    """A wire answer as data for the caller's schema."""
    if isinstance(node, BaseModel):
        data = {k: _from_wire(getattr(node, k)) for k in type(node).model_fields}
        if set(data) == {"value", "quote", "page", "confidence"}:
            value = data["value"]
            quote = str(data["quote"]).strip()
            return {
                "value": None if value == "" else value,
                "evidence": {"page": data["page"] or None, "quote": quote} if quote else None,
                "confidence": data["confidence"],
            }
        return data
    if isinstance(node, list):
        return [_from_wire(v) for v in node]  # pyright: ignore[reportUnknownVariableType]
    return node


def _empty(annotation: Any) -> Any:
    """Data for a field a part does not ask for: nothing stated."""
    if isinstance(annotation, type) and issubclass(annotation, Evidenced):
        return {}
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return {k: _empty(f.annotation) for k, f in annotation.model_fields.items()}
    if get_origin(annotation) is list:
        return []
    return None


def schema_complexity(schema: type[BaseModel]) -> tuple[int, int]:
    """(optional, nullable) property counts of a schema with its references inlined: what
    Claude's strict mode limits (24 optional, 16 with a union across a request)."""
    optional = nullable = 0

    def walk(node: Any, defs: dict[str, Any]) -> None:
        nonlocal optional, nullable
        if isinstance(node, dict):
            ref = node.get("$ref")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
            if isinstance(ref, str):
                walk(defs[ref.removeprefix("#/$defs/")], defs)
                return
            props: dict[str, Any] = node.get("properties", {})  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType, reportAssignmentType]
            required = set(node.get("required", []))  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]
            for name, prop in props.items():
                optional += name not in required
                nullable += "anyOf" in prop or isinstance(prop.get("type"), list)
            for key, value in node.items():  # pyright: ignore[reportUnknownVariableType]
                if key != "$defs":
                    walk(value, defs)
        elif isinstance(node, list):
            for value in node:  # pyright: ignore[reportUnknownVariableType]
                walk(value, defs)

    js = schema.model_json_schema()
    walk(js, js.get("$defs", {}))
    return optional, nullable


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
    """Two smaller segments for a retry after `ai.context_too_long` or `ai.output_truncated`, or
    None if it is atomic."""
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
Fields shaped like {{"value", "quote", "page", "confidence"}}: put the value in `value` (null, or \
"" for text, when it is not stated), copy a short verbatim quote that states it (at most about 200 \
characters, exactly as written) into `quote`, set `page` to the number of the [page N] (or \
[image N]) marker it is under, and set `confidence` between 0 and 1. With no value, leave `quote` \
"", `page` 0 and `confidence` 0.

Task:
{instructions}"""


def _messages(
    segment: _Segment,
    instructions: str,
    label: str,
    index: int,
    total: int,
    fields: Sequence[str] | None = None,
) -> list[Message]:
    system = _SYSTEM.format(notice=UNTRUSTED_NOTICE, instructions=instructions.strip())
    if fields:
        system += (
            f"\n\nThis answer covers only: {', '.join(fields)}. The rest of the task is answered "
            "separately."
        )
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

# A part too long to read, or whose answer does not fit the model's output: read it in halves.
_TOO_BIG = ("ai.context_too_long", "ai.output_truncated")

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
    parts: Sequence[Sequence[str]] | None = None,
    on_segment: OnSegment | None = None,
) -> Extraction[T]:
    """Extracts `schema` from page texts and/or images. `parts` groups the top-level fields that
    are asked for together (one request per group and document segment, the groups side by side;
    fields in no group stay empty); without it the whole schema is one request. `on_segment(done,
    total)` is called after each request, so a job can report `ctx.stage(..., current=done,
    total=total)`."""
    texts = [p for p in texts or [] if p.text.strip()]
    images = list(images or [])
    if not texts and not images:
        raise AppError("common.validation", 422, errors=[{"loc": ["texts"], "code": "missing"}])
    resolved = await resolve_provider(ctx, purpose)
    ep = resolved.endpoint
    window = catalog.context_window(resolved.model, ep.kind, ep.base_url)
    groups = [tuple(group) for group in parts] if parts else [None]

    total = 0
    done = 0
    report = asyncio.Lock()

    async def read(group: tuple[str, ...] | None) -> tuple[list[T], Usage]:
        nonlocal total, done
        wire = wire_schema(schema, group)
        overhead = estimate_tokens(instructions) + estimate_tokens(
            json.dumps(wire.model_json_schema())
        )
        budget = max(
            MIN_SEGMENT_TOKENS, int(window * SEGMENT_SHARE) - overhead - OUTPUT_RESERVE_TOKENS
        )
        pending = _segments(texts, images, budget)
        total += len(pending)
        results: list[T] = []
        usage = Usage()
        mine = 0
        splits = 0
        cut_splits = 0
        while pending:
            segment = pending.pop(0)
            index = mine + 1
            parts_now = mine + 1 + len(pending)
            try:
                answer, used = await structured_with(
                    ctx,
                    resolved,
                    _messages(segment, instructions, label, index, parts_now, group),
                    wire,
                    source_module=source_module,
                    source_ref=source_ref,
                )
            except AppError as exc:
                halves = _halve(segment) if exc.code in _TOO_BIG else None
                if halves is None or splits >= MAX_SPLITS:
                    raise
                if exc.code == "ai.output_truncated":
                    # Each cut-off answer is a whole billed output; a model stuck repeating itself
                    # is cut off at any size, so halving stops early.
                    if cut_splits >= MAX_CUT_SPLITS:
                        raise
                    cut_splits += 1
                splits += 1
                pending = [*halves, *pending]
                total += 1
                continue
            usage.add(used)
            data = _from_wire(answer)
            for name, f in schema.model_fields.items():
                data.setdefault(name, _empty(f.annotation))
            value = schema.model_validate(data)
            warnings.extend(verify_evidence(value, segment.pages, has_images=bool(segment.images)))
            results.append(value)
            mine += 1
            async with report:
                done += 1
                if on_segment is not None:
                    await on_segment(done, total)
        return results, usage

    warnings: list[ExtractionWarning] = []
    answers = await asyncio.gather(*(read(group) for group in groups))
    results = [value for values, _ in answers for value in values]
    usage = Usage()
    for _, used in answers:
        usage.add(used)
    merged = results[0]
    for other in results[1:]:
        merged = _merge(merged, other, "", warnings)
    return Extraction(value=merged, warnings=warnings, usage=usage, segments=len(results))
