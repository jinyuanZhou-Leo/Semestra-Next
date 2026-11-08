"""Refs: how the assistant names an LMS item (M09 §8). `<kind>:<id>`, the id being what the
provider reads it by (Canvas: a page's url slug, the number of everything else); `syllabus` has
none. The tools hand them out and take them back as they are, so the model never picks an id
field or a tool per kind. The Markdown of LMS texts links items as `lms:<ref>` (`markdown.py`)."""

from typing import Literal, cast, get_args

from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.schemas.dto import InternalRef

RefKind = Literal["page", "announcement", "assignment", "quiz", "discussion", "file", "syllabus"]
KINDS: frozenset[str] = frozenset(get_args(RefKind))
SYLLABUS = "syllabus"


def make(kind: RefKind, item_id: str) -> str:
    return SYLLABUS if kind == "syllabus" else f"{kind}:{item_id}"


def parse(ref: str) -> tuple[RefKind, str]:
    ref = ref.strip().removeprefix("lms:")
    if ref == SYLLABUS:
        return "syllabus", ""
    kind, sep, item_id = ref.partition(":")
    if not sep or kind not in KINDS or not item_id.strip():
        raise lms_error("lms.invalid_ref", ref=ref[:100])
    return cast(RefKind, kind), item_id.strip()


def from_internal(target: InternalRef | dict[str, str] | None) -> str | None:
    """The ref of an item a platform link or a module item points at (None: not readable)."""
    if target is None:
        return None
    kind, item_id = (
        (target.kind, target.ref)
        if isinstance(target, InternalRef)
        else (target["kind"], target["ref"])
    )
    return f"{kind}:{item_id}" if kind in KINDS else None
