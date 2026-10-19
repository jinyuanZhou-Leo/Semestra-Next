"""File type detection by content (magic bytes), not by what the client claims."""

import io
import zipfile
from dataclasses import dataclass
from typing import Literal

Kind = Literal[
    "pdf", "docx", "pptx", "xlsx", "csv", "text", "markdown", "html", "image", "ics", "other"
]

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
# Served inline by the content route; everything else is offered as a download.
INLINE_SAFE = frozenset(
    {
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "text/plain",
        "text/markdown",
        "text/csv",
    }
)
_IMAGES = {"image/png", "image/jpeg", "image/webp", "image/heic"}
_HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1", b"heim", b"heis"}
_OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


@dataclass(frozen=True)
class Detected:
    kind: Kind
    mime: str
    # Why the pipeline cannot read it (kind "other"), for logs; the UI only shows "unsupported".
    text: str | None = None


def decode_text(data: bytes) -> str | None:
    """Text of a plain-text file, or None for binary content."""
    if b"\x00" in data[:8192]:
        return None
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _office(data: bytes) -> Detected | None:
    try:
        names = zipfile.ZipFile(io.BytesIO(data)).namelist()
    except zipfile.BadZipFile:
        return None
    if any(n.startswith("word/") for n in names):
        return Detected("docx", DOCX)
    if any(n.startswith("ppt/") for n in names):
        return Detected("pptx", PPTX)
    if any(n.startswith("xl/") for n in names):
        return Detected("xlsx", XLSX)
    return None


def detect(data: bytes, filename: str | None = None) -> Detected:
    ext = (filename or "").rsplit(".", 1)[-1].lower() if filename and "." in filename else ""
    head = data[:16]
    if data.startswith(b"%PDF-") or b"%PDF-" in data[:1024]:
        return Detected("pdf", "application/pdf")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return Detected("image", "image/png")
    if data.startswith(b"\xff\xd8\xff"):
        return Detected("image", "image/jpeg")
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return Detected("image", "image/webp")
    if head[4:8] == b"ftyp" and data[8:12] in _HEIF_BRANDS:
        return Detected("image", "image/heic")
    if data.startswith((b"GIF87a", b"GIF89a")):
        return Detected("other", "image/gif")
    if data.startswith(b"PK\x03\x04"):
        return _office(data) or Detected("other", "application/zip")
    if data.startswith(_OLE):
        return Detected("other", "application/x-ole-storage", "legacy office")
    text = decode_text(data)
    if text is None:
        return Detected("other", "application/octet-stream")
    stripped = text.lstrip().lower()
    if stripped.startswith("begin:vcalendar"):
        return Detected("ics", "text/calendar")
    if ext in ("html", "htm") or stripped.startswith(("<!doctype html", "<html")):
        return Detected("html", "text/html")
    if ext in ("csv", "tsv"):
        return Detected("csv", "text/csv")
    if ext in ("md", "markdown"):
        return Detected("markdown", "text/markdown")
    return Detected("text", "text/plain")


def is_image_mime(mime: str) -> bool:
    return mime in _IMAGES
