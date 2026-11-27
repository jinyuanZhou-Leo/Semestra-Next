"""What a PDF page holds besides its text, for deciding what OCR reads (M07 §3.1).

Handwriting exported from OneNote, GoodNotes or an iPad is drawn as vector paths or ink
annotations, not pictures, and a typed slide with notes written on it has plenty of text: asking
"is there a picture and little text" missed both. Instead the page's drawings are sorted by how
they are drawn, with no model involved:

- pen ink: paths made of many tiny segments or curves (a pen's samples; real handwriting has a
  median step under half a point, a typed slide's shapes steps of several points), and ink
  annotations;
- ruled lines and boxes (tables, frames, underlines, backgrounds, callouts with rounded
  corners), which are part of the layout;
- everything else (logos, charts, diagrams), which with the embedded pictures makes figures.

Any pen ink makes a page with text a mixed page; figures do when they are large (a slide that is
mostly a picture or a diagram), not a logo or a small icon.

Only visible text counts as the page's text: apps that recognize handwriting (Apple's Live Text
in GoodNotes, Notability, Preview) lay invisible text over the strokes. Neither does text drawn
in a font without a usable character map (the glyphs show, the characters are others): such a
page is read as a picture.

The thresholds come from real course PDFs (handwritten notes, typed slides, annotated slides);
the fixtures in `tests/test_parse.py` keep each kind on its side of them.
"""

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    import pymupdf

PageKind = Literal["text", "blank", "image", "mixed"]

# Rendering resolution for telling a blank page from a drawn one.
INK_DPI = 20
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
# A path is pen ink when it has this many segments or more and their median extent (points) is
# at most `PEN_STEP`.
PEN_ITEMS = 8
PEN_STEP = 2.0
# Share of the page that pen ink covers (by its strokes' boxes), at or above which a page with
# text has handwriting: a few strokes, not a stray dot. One short note is about 0.001.
PEN_AREA = 0.0002
# Share of the page that figures (pictures and drawings that are neither pen ink nor ruled)
# cover, at or above which a page with text is read for them too: a slide's main figure (on
# typed slides they cover 0.4 to 0.5), not a logo or an icon.
FIGURE_AREA = 0.3
# The largest rounded corner (points) of a box that is still a ruled box, not a drawing.
CORNER = 16
# Figures' cover is counted on a grid of this many cells a side, so overlapping shapes count
# once.
_GRID = 48

_GARBLED = re.compile("[\u0100-\u036f\u03e2-\u03ef\ufffd\x00-\x1f]")
_SPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class PageReading:
    """What the classifier saw on a page: its kind, and its visible text with where it is (page
    points), for OCR to leave out what the page's text already has."""

    kind: PageKind
    printed: str
    text_rects: tuple[tuple[float, float, float, float], ...]
    pen: float
    figures: float


def garbled(text: str) -> bool:
    """Whether text is mostly characters a font without a usable character map gives: it is
    then no text at all."""
    chars = _SPACE.sub("", text)
    return bool(chars) and len(_GARBLED.findall(chars)) / len(chars) >= MAX_GARBLED_SHARE


def classify(page: pymupdf.Page) -> PageReading:
    """The page's kind from its visible text and what is drawn on it.

    - No text (or unreadable): an image page if anything is drawn on it, else blank.
    - Text and pen ink or large figures: a mixed page, or an image page when the text is a
      heading or a page number (fewer than `MIN_TEXT_CHARS`).
    - Otherwise a text page, however short."""
    import pymupdf

    spans = _visible(page)
    printed = _lines(spans)
    chars = len(_SPACE.sub("", printed))
    has_text = chars > 0 and not garbled(printed)
    area = max(page.rect.get_area(), 1)

    pictures: list[pymupdf.Rect] = []
    for info in page.get_image_info():
        box = pymupdf.Rect(info["bbox"]) & page.rect
        if not box.is_empty:
            pictures.append(box)
    pen = 0.0
    drawn = list(pictures)
    for path in page.get_cdrawings() or ():
        items = path.get("items", ())
        box = pymupdf.Rect(path.get("rect", (0, 0, 0, 0))) & page.rect
        if _pen(items):
            pen += max(box.width, 1) * max(box.height, 1)
        elif not _ruled(items) and not box.is_empty:
            drawn.append(box)
    for annot in page.annots(types=[pymupdf.PDF_ANNOT_INK]) or ():
        box = annot.rect & page.rect
        pen += box.get_area()
    pen /= area
    figures = _cover(drawn, page.rect)

    short = chars < MIN_TEXT_CHARS
    kind: PageKind
    if not has_text:
        kind = "image" if pictures or pen or _ink(page) >= BLANK_INK else "blank"
    elif pen >= PEN_AREA or figures >= FIGURE_AREA:
        kind = "image" if short else "mixed"
    elif short and sum(p.get_area() for p in pictures) / area >= SCAN_AREA:
        kind = "image"  # a scan with a stray text layer
    else:
        kind = "text"
    rects = tuple(rect for rect, _, _ in spans) if has_text else ()
    return PageReading(kind, printed if has_text else "", rects, pen, figures)


def _ink(page: pymupdf.Page) -> float:
    """Share of the page drawn in anything but its background color."""
    import pymupdf

    samples = page.get_pixmap(
        matrix=pymupdf.Matrix(_ZOOM, _ZOOM), colorspace=pymupdf.csGRAY
    ).samples
    background = max(range(256), key=samples.count)
    is_ink = bytes(1 if abs(v - background) > INK_CONTRAST else 0 for v in range(256))
    return samples.translate(is_ink).count(1) / max(len(samples), 1)


def _cover(boxes: list[pymupdf.Rect], page: pymupdf.Rect) -> float:
    """Share of the page the boxes cover together, counted on a grid."""
    if not boxes:
        return 0.0
    width, height = max(page.width, 1), max(page.height, 1)
    cells: set[tuple[int, int]] = set()
    for box in boxes:
        x0 = int((box.x0 - page.x0) / width * _GRID)
        x1 = min(int((box.x1 - page.x0) / width * _GRID), _GRID - 1)
        y0 = int((box.y0 - page.y0) / height * _GRID)
        y1 = min(int((box.y1 - page.y0) / height * _GRID), _GRID - 1)
        cells.update((x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1))
    return len(cells) / _GRID**2


def _extent(item: tuple[Any, ...]) -> float:
    """How far one segment of a path reaches (points)."""
    op = item[0]
    if op == "re":
        x0, y0, x1, y1 = item[1]
        return max(abs(x1 - x0), abs(y1 - y0))
    points = list(item[1]) if op == "qu" else list(item[1:])
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return max(max(xs) - min(xs), max(ys) - min(ys))


def _pen(items: tuple[Any, ...]) -> bool:
    """Whether a path is drawn like pen ink: many tiny steps."""
    if len(items) < PEN_ITEMS:
        return False
    steps = sorted(_extent(item) for item in items)
    return steps[len(steps) // 2] <= PEN_STEP


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


def _ruled(items: tuple[Any, ...]) -> bool:
    """Whether a path is made of straight horizontal or vertical lines and boxes, rounded
    corners included: a table, a frame, an underline, a background, a callout."""
    if not items or sum(1 for i in items if i[0] == "c") > sum(1 for i in items if i[0] == "l"):
        return False  # a box has a side per corner
    for item in items:
        op = item[0]
        if op == "l":
            (x0, y0), (x1, y1) = item[1], item[2]
            if abs(x0 - x1) > 0.5 and abs(y0 - y1) > 0.5:
                return False
        elif op == "qu":
            xs, ys = {round(x) for x, _ in item[1]}, {round(y) for _, y in item[1]}
            if len(xs) > 2 or len(ys) > 2:
                return False
        elif op == "c":
            if _extent(item) > CORNER:
                return False
        elif op != "re":
            return False
    return True
