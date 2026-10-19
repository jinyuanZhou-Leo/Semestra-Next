"""Turning an uploaded file into per-page markdown (M07 §3.1, stages "detecting" and "parsing")."""

from semestra.modules.files.parse.detect import Detected, detect
from semestra.modules.files.parse.readers import (
    ParsedDocument,
    ParsedPage,
    ParseError,
    parse,
)
from semestra.modules.files.parse.render import PageRenderer

__all__ = [
    "Detected",
    "PageRenderer",
    "ParseError",
    "ParsedDocument",
    "ParsedPage",
    "detect",
    "parse",
]
