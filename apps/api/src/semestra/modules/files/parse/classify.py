"""What a PDF page holds besides its text layer, for deciding what OCR reads (M07 §3.1).

Handwriting exported from OneNote, GoodNotes or an iPad is drawn as vector paths or ink
annotations, not pictures, and a typed slide with notes written on it has plenty of text: asking
"is there a picture and little text" missed both. Instead the page is rendered small and its
ink is measured where nothing explains it: outside the visible text, the embedded pictures (a
slide's figures, a scan behind its own text layer) and ruled lines and boxes (tables, frames,
backgrounds). What is left is drawn by hand. No model is involved.

Only visible text counts as the page's text: apps that recognize handwriting (Apple's Live Text
in GoodNotes, Notability, Preview) lay invisible text over the strokes, which would otherwise
hide them. Neither does text drawn in a font without a usable character map (the glyphs show,
the characters are others): such a page is read as a picture.

The thresholds come from real course PDFs (handwritten notes, typed slides, annotated slides,
scans); the fixtures in `tests/test_parse.py` keep each kind on its side of them.
"""

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    import pymupdf

PageKind = Literal["text", "blank", "image", "mixed"]

# Rendering resolution for measuring ink: enough to see a pen stroke, small enough to take tens
# of milliseconds on a small server.
INK_DPI = 40
_ZOOM = INK_DPI / 72
# A pixel this far (0-255) from the page's background is ink; anti-aliased edges are not.
INK_CONTRAST = 40
# A page with less text than this is read as a picture (a heading and a page number are not
# the page's content).
MIN_TEXT_CHARS = 50
# Text whose characters are mostly ones text in a Latin, Greek or CJK script hardly has (a font
# without a character map gives Latin Extended, IPA and Coptic letters, or U+FFFD) is no text.
MAX_GARBLED_SHARE = 0.3
# Share of the page covered by ink at all, below which a page without text is blank, unless
# pictures cover `SCAN_AREA` of it (a scan of a faint page is still a scan).
BLANK_INK = 0.003
SCAN_AREA = 0.1
# Share of the page covered by ink outside the text, pictures and ruled lines, at or above
# which a page with text also has handwriting (or drawings) to read. Typed slides measure 0;
# a short note written on a slide about 0.001.
FREEHAND_INK = 0.0003
# The largest rounded corner (points) of a box that is still a ruled box, not a drawing.
CORNER = 16

_GARBLED = re.compile("[\u0100-\u036f\u03e2-\u03ef\ufffd\x00-\x1f]")
_SPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class PageReading:
    """What the classifier saw on a page: its kind, and its visible text with where it is (page
    points), for OCR to leave out what the page's text already has."""

    kind: PageKind
    printed: str
    text_rects: tuple[tuple[float, float, float, float], ...]
    ink: float
    freehand: float


def garbled(text: str) -> bool:
    """Whether text is mostly characters a font without a usable character map gives: it is
    then no text at all."""
    chars = _SPACE.sub("", text)
    return bool(chars) and len(_GARBLED.findall(chars)) / len(chars) >= MAX_GARBLED_SHARE


def classify(page: pymupdf.Page) -> PageReading:
    """The page's kind from its visible text and its ink.

    - No text (or unreadable): an image page if it has ink or a picture, else blank.
    - Text and handwriting or drawings: a mixed page, or an image page when the text is a
      heading or a page number (fewer than `MIN_TEXT_CHARS`) on handwritten notes.
    - Little text on a large picture (a scan with a stray text layer): an image page.
    - Otherwise a text page, however short."""
    import pymupdf

    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(_ZOOM, _ZOOM), colorspace=pymupdf.csGRAY)
    samples = pixmap.samples
    total = max(len(samples), 1)
    background = max(range(256), key=samples.count)
    is_ink = bytes(1 if abs(v - background) > INK_CONTRAST else 0 for v in range(256))
    ink = samples.translate(is_ink).count(1) / total

    spans = _visible(page)
    printed = _lines(spans)
    chars = len(_SPACE.sub("", printed))
    has_text = chars > 0 and not garbled(printed)
    rects = tuple(rect for rect, _, _ in spans) if has_text else ()
    for rect in rects:
        _blank(pixmap, pymupdf.Rect(rect), background)
    pictures = 0.0
    for info in page.get_image_info():
        box = pymupdf.Rect(info["bbox"]) & page.rect
        pictures += box.get_area()
        _blank(pixmap, box, background)
    pictures /= max(page.rect.get_area(), 1)
    freehand = pixmap.samples.translate(is_ink).count(1) / total
    if freehand > 0:  # ruled lines may explain it
        for path in page.get_cdrawings() or ():
            for rect in _ruled(path, background):
                _blank(pixmap, pymupdf.Rect(rect), background)
        freehand = pixmap.samples.translate(is_ink).count(1) / total

    short = chars < MIN_TEXT_CHARS
    kind: PageKind
    if not has_text:
        kind = "image" if ink >= BLANK_INK or pictures >= SCAN_AREA else "blank"
    elif freehand >= FREEHAND_INK:
        kind = "image" if short else "mixed"
    elif short and pictures >= SCAN_AREA:
        kind = "image"
    else:
        kind = "text"
    return PageReading(kind, printed if has_text else "", rects, ink, freehand)


_Span = tuple[tuple[float, float, float, float], str, float]


def _visible(page: pymupdf.Page) -> list[_Span]:
    """The page's visible text spans in drawing order: where, what and the font size. Text
    drawn invisible (render mode 3: an OCR layer) or fully transparent is left out."""
    spans: list[_Span] = []
    for span in page.get_texttrace():
        if span["type"] == 3 or span["opacity"] == 0:
            continue
        text = "".join(chr(char[0]) for char in span["chars"])
        if text.strip():
            x0, y0, x1, y1 = span["bbox"]
            spans.append(((float(x0), float(y0), float(x1), float(y1)), text, float(span["size"])))
    return spans


def _lines(spans: list[_Span]) -> str:
    """The spans' text, a line per row of text (a span starting lower than the last one's
    middle starts a new line)."""
    out: list[str] = []
    bottom = None
    for (_, y0, _, y1), text, _ in spans:
        if out and bottom is not None and y0 < bottom:
            out[-1] += " " + text.strip()
        else:
            out.append(text.strip())
        bottom = (y0 + y1) / 2
    return "\n".join(out)


def _blank(pixmap: pymupdf.Pixmap, rect: pymupdf.Rect, background: int) -> None:
    """Paints `rect` (page points) in the background color, a pixel wider on each side."""
    import pymupdf

    area = (
        pymupdf.IRect(
            int(rect.x0 * _ZOOM) - 1,
            int(rect.y0 * _ZOOM) - 1,
            int(rect.x1 * _ZOOM) + 2,
            int(rect.y1 * _ZOOM) + 2,
        )
        & pixmap.irect
    )
    if not area.is_empty:
        pixmap.set_rect(area, (background,))


def _ruled(path: dict[str, Any], background: int) -> list[tuple[float, float, float, float]]:
    """Where a drawing made of straight horizontal or vertical lines and boxes (tables, frames,
    underlines, dark bars; rounded corners too) puts ink; nothing for a drawing with a slanted
    line or any other curve, which may be handwriting. A box filled lighter than ink (a slide's
    white page, a pale callout) puts ink only on its edges: what is written inside it is still
    seen. `path` is as `Page.get_cdrawings` gives it."""
    edges: list[tuple[float, float, float, float]] = []
    items = path.get("items", ())
    curves = sum(1 for item in items if item[0] == "c")
    if curves > sum(1 for item in items if item[0] == "l"):  # a box has a side per corner
        return []
    for item in items:
        op = item[0]
        if op == "l":
            (x0, y0), (x1, y1) = item[1], item[2]
            if abs(x0 - x1) > 0.5 and abs(y0 - y1) > 0.5:
                return []
            edges.append((min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)))
        elif op == "re":
            x0, y0, x1, y1 = item[1]
            edges += [(x0, y0, x1, y0), (x0, y1, x1, y1), (x0, y0, x0, y1), (x1, y0, x1, y1)]
        elif op == "qu":
            xs, ys = {round(x) for x, _ in item[1]}, {round(y) for _, y in item[1]}
            if len(xs) > 2 or len(ys) > 2:
                return []
            x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
            edges += [(x0, y0, x1, y0), (x0, y1, x1, y1), (x0, y0, x0, y1), (x1, y0, x1, y1)]
        elif op == "c":  # a rounded corner, if small
            xs, ys = [x for x, _ in item[1:]], [y for _, y in item[1:]]
            if max(xs) - min(xs) > CORNER or max(ys) - min(ys) > CORNER:
                return []
            edges.append((min(xs), min(ys), max(xs), max(ys)))
        else:
            return []
    fill = path.get("fill")
    if edges and fill is not None and abs(_gray(fill) - background) > INK_CONTRAST:
        return [(min(e[0] for e in edges), min(e[1] for e in edges),
                 max(e[2] for e in edges), max(e[3] for e in edges))]  # fmt: skip
    return edges


def _gray(color: tuple[float, ...]) -> float:
    """A fill color (0-1 per component: gray, RGB or CMYK) as the 0-255 gray it renders as."""
    if len(color) == 3:
        r, g, b = color
    elif len(color) == 4:
        c, m, y, k = color
        r, g, b = (1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)
    else:
        r = g = b = color[0] if color else 0.0
    return 255 * (0.299 * r + 0.587 * g + 0.114 * b)
