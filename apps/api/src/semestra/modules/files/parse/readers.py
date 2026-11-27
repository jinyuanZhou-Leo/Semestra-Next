"""One reader per file type; each returns a list of pages of markdown (M07 §3.1)."""

import csv
import io
import re
import zipfile
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any, cast

from semestra.modules.files.parse.classify import PageKind, classify
from semestra.modules.files.parse.detect import KIND_OF_MIME, Detected, decode_text

MAX_PAGES = 500
LOGICAL_PAGE_CHARS = 3000
TABLE_ROWS_PER_PAGE = 100
MAX_TABLE_ROWS = 20_000
MAX_TABLE_COLUMNS = 100
# Office files are zip archives; the readers inflate whole XML parts, so a small file that
# unpacks to hundreds of megabytes is refused before it is opened.
MAX_OFFICE_UNPACKED_BYTES = 100_000_000
# Each reader's version: raised when the text a reader writes changes. A document read by an
# older version of a reader that needs no model is read again (`outdated`); a document read before
# versions were recorded counts as version 1.
READER_VERSIONS: dict[str, int] = {"html": 2, "pdf": 2}
# Readers whose documents are read again when their version goes up: they never run OCR, so
# reading again costs no model use beyond embedding.
REREAD_KINDS = frozenset({"docx", "pptx", "xlsx", "csv", "text", "markdown", "html"})


def reader_version(kind: str) -> int:
    return READER_VERSIONS.get(kind, 1)


def fingerprint_reader(kind: str) -> str:
    """How a document's `parser_fingerprint` starts: the reader and its version (`pipeline`)."""
    return f"{kind}:{reader_version(kind)}:"


def read_with(fingerprint: str) -> int:
    """The version of the reader a document was read by, from its `parser_fingerprint`."""
    parts = fingerprint.split(":")
    return int(parts[1]) if len(parts) == 3 and parts[1].isdigit() else 1


def _older(kind: str | None, fingerprint: str) -> bool:
    return kind is not None and read_with(fingerprint) < reader_version(kind)


def outdated(mime: str | None, fingerprint: str) -> bool:
    """A document of a file of type `mime` (the item's, once read) was read by an older version
    of a reader that needs no model: it is to be read again. Who reads it again: the user's own
    files `jobs.reread_outdated`, a source's files its sync (`sources.read_again_if_outdated`),
    which reads its platform within its own limits and retries its failures."""
    kind = KIND_OF_MIME.get(mime or "")
    return kind in REREAD_KINDS and _older(kind, fingerprint)


# The readers that may run OCR and so use a model, by the MIME types they read: their documents
# are read again only when the user asks (`files.outdated.reread`), never in the background.
OCR_KIND_OF_MIME = {
    "application/pdf": "pdf", "image/png": "image", "image/jpeg": "image",
    "image/webp": "image", "image/heic": "image",
}  # fmt: skip


def read_again_when_asked(mime: str | None, fingerprint: str) -> bool:
    """A document read by an older version of a reader that may use a model (a PDF's): the user
    can have it read again (`files.outdated.reread`)."""
    return _older(OCR_KIND_OF_MIME.get(mime or ""), fingerprint)


class ParseError(Exception):
    """The file cannot be read; `code` is the error code stored on the item."""

    def __init__(self, code: str, **params: object) -> None:
        super().__init__(code)
        self.code = code
        self.params = params


@dataclass
class ParsedPage:
    markdown: str
    # What OCR does with the page (`classify`): nothing for text and blank pages; an image page
    # is read whole, a mixed page (text with handwriting or drawings) has what its text layer
    # lacks read and added after its text.
    kind: PageKind = "text"
    # A PDF page's visible text and where it is (page points): what a mixed page already has,
    # which OCR leaves out (`markdown` may also hold text an app recognized in handwriting).
    printed: str = ""
    text_rects: tuple[tuple[float, float, float, float], ...] = ()
    # The page writes math as LaTeX between `$` / `$$` and a literal dollar as `\$`; only text
    # written to that rule is, so the app typesets math on these pages only (M07 §6.1).
    latex: bool = False

    @property
    def needs_ocr(self) -> bool:
        return self.kind in ("image", "mixed")


@dataclass
class ParsedDocument:
    pages: list[ParsedPage] = field(default_factory=lambda: [])

    @property
    def char_count(self) -> int:
        return sum(len(p.markdown) for p in self.pages)


def _split_long(block: str, size: int) -> list[str]:
    """Cuts a paragraph longer than `size` at line ends, and lines longer than `size` at
    whitespace (or anywhere), so no page grows past `size` (text without blank lines)."""
    if len(block) <= size:
        return [block]
    parts: list[str] = []
    current = ""
    for line in block.split("\n"):
        while len(line) > size:
            cut = line.rfind(" ", size // 2, size)
            cut = size if cut <= 0 else cut
            if current:
                parts.append(current)
                current = ""
            parts.append(line[:cut])
            line = line[cut:].lstrip(" ")
        if current and len(current) + 1 + len(line) > size:
            parts.append(current)
            current = line
        else:
            current = f"{current}\n{line}" if current else line
    if current:
        parts.append(current)
    return parts


def paginate(blocks: Sequence[str], size: int = LOGICAL_PAGE_CHARS) -> list[str]:
    """Groups paragraphs into logical pages of about `size` characters; longer paragraphs are
    cut so a page never exceeds it."""
    pages: list[str] = []
    current: list[str] = []
    length = 0
    for block in (part for b in blocks for part in _split_long(b, size)):
        if current and length + len(block) > size:
            pages.append("\n\n".join(current))
            current, length = [], 0
        current.append(block)
        length += len(block) + 2
    if current:
        pages.append("\n\n".join(current))
    return pages


def _paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text.replace("\r\n", "\n")) if p.strip()]


def _cell(value: object) -> str:
    text = "" if value is None else str(value)
    return text.replace("|", "\\|").replace("\r", "").replace("\n", " ").strip()


def table_markdown(rows: Sequence[Sequence[object]]) -> str:
    cells = [[_cell(c) for c in row] for row in rows]
    if not cells:
        return ""
    width = max(len(r) for r in cells)
    cells = [r + [""] * (width - len(r)) for r in cells]
    lines = ["| " + " | ".join(cells[0]) + " |", "|" + " --- |" * width]
    lines += ["| " + " | ".join(r) + " |" for r in cells[1:]]
    return "\n".join(lines)


def _filled(value: object) -> bool:
    return value is not None and bool(str(value).strip())


def _table_pages(title: str | None, rows: list[list[object]]) -> list[ParsedPage]:
    rows = [r for r in rows if any(_filled(c) for c in r)]
    if not rows:
        return [ParsedPage(f"## {title}" if title else "")] if title else []
    # Sheets formatted far to the right report every one of those empty columns.
    width = max(max((i + 1 for i, c in enumerate(r) if _filled(c)), default=0) for r in rows)
    rows = [r[: min(width, MAX_TABLE_COLUMNS)] for r in rows]
    header, body = rows[0], rows[1:]
    chunks = [body[i : i + TABLE_ROWS_PER_PAGE] for i in range(0, len(body), TABLE_ROWS_PER_PAGE)]
    pages: list[ParsedPage] = []
    for chunk in chunks or [[]]:
        text = table_markdown([header, *chunk])
        pages.append(ParsedPage(f"## {title}\n\n{text}" if title else text))
    return pages


def _text_pages(text: str) -> list[ParsedPage]:
    return [ParsedPage(p) for p in paginate(_paragraphs(text))]


# --- PDF ------------------------------------------------------------------------------------


def _pdf(data: bytes, max_pages: int) -> ParsedDocument:
    # Imported here: PDFs are read in a child process (`isolated`), so the API itself never
    # loads PyMuPDF (about 45 MB); the forkserver preloads it for the children.
    import pymupdf
    import pymupdf4llm

    # pymupdf4llm 2.x defaults to PyMuPDF's layout model (ONNX), which took about twice the time
    # and four times the memory per page, and has no header identification hook. The rule-based
    # reader keeps parsing within the child's memory limit on a small server; our own OCR covers
    # scanned pages. The layout model's dependencies are not even installed (pyproject.toml).
    pymupdf4llm.use_layout(False)
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise ParseError("files.parse_failed") from exc
    with doc:
        if doc.needs_pass:
            raise ParseError("files.encrypted_pdf")
        if doc.page_count > max_pages:
            raise ParseError("files.too_many_pages", max=max_pages)
        try:
            # Before the markdown: pymupdf4llm drops the pages' annotations (ink notes).
            seen = [classify(page) for page in doc]
            headers = pymupdf4llm.IdentifyHeaders(doc)  # pyright: ignore[reportArgumentType]
            pages: list[ParsedPage] = []
            for index in range(doc.page_count):
                result = pymupdf4llm.to_markdown(
                    doc, pages=[index], hdr_info=headers, show_progress=False
                )
                markdown = result.strip() if isinstance(result, str) else ""
                kind, printed, rects = seen[index].kind, seen[index].printed, seen[index].text_rects
                pages.append(ParsedPage(markdown, kind, printed, rects))
        except ParseError:
            raise
        except Exception as exc:
            raise ParseError("files.parse_failed") from exc
    return ParsedDocument(pages)


# --- Office ---------------------------------------------------------------------------------


def _docx(data: bytes) -> ParsedDocument:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    document = docx.Document(io.BytesIO(data))
    pages: list[list[str]] = [[]]
    length = 0

    def new_page() -> None:
        nonlocal length
        if pages[-1]:
            pages.append([])
        length = 0

    for element in document.element.body.iterchildren():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "tbl":
            rows = [[c.text for c in row.cells] for row in Table(element, document).rows]  # pyright: ignore[reportArgumentType]
            block = table_markdown(rows)
        elif tag == "p":
            paragraph = Paragraph(element, document)  # pyright: ignore[reportArgumentType]
            if element.xpath(".//w:lastRenderedPageBreak"):  # pyright: ignore[reportAttributeAccessIssue]
                new_page()
            text = paragraph.text.strip()
            style = (paragraph.style.name if paragraph.style is not None else "") or ""
            block = ""
            if text:
                heading = re.fullmatch(r"Heading (\d)", style)
                if heading:
                    block = f"{'#' * min(int(heading[1]), 6)} {text}"
                elif style == "Title":
                    block = f"# {text}"
                elif style.startswith("List"):
                    block = f"- {text}"
                else:
                    block = text
        else:
            continue
        if block:
            if length and length + len(block) > LOGICAL_PAGE_CHARS:
                new_page()
            pages[-1].append(block)
            length += len(block)
        if tag == "p" and element.xpath('.//w:br[@w:type="page"]'):  # pyright: ignore[reportAttributeAccessIssue]
            new_page()
    return ParsedDocument([ParsedPage("\n\n".join(p)) for p in pages if p])


def _pptx(data: bytes) -> ParsedDocument:
    from pptx import Presentation

    pages: list[ParsedPage] = []
    for slide in Presentation(io.BytesIO(data)).slides:
        title_shape = slide.shapes.title
        title = title_shape.text_frame.text.strip() if title_shape is not None else ""
        blocks = [f"# {title}"] if title else []
        for shape in cast("Iterable[Any]", slide.shapes):
            if shape is title_shape:
                continue
            if shape.has_text_frame:
                lines = [
                    f"{'  ' * paragraph.level}- {paragraph.text.strip()}"
                    for paragraph in shape.text_frame.paragraphs
                    if paragraph.text.strip()
                ]
                if lines:
                    blocks.append("\n".join(lines))
            elif shape.has_table:
                blocks.append(
                    table_markdown([[c.text for c in row.cells] for row in shape.table.rows])
                )
        if slide.has_notes_slide:
            notes = slide.notes_slide.notes_text_frame
            if notes is not None and notes.text.strip():
                blocks.append(f"Notes: {notes.text.strip()}")
        pages.append(ParsedPage("\n\n".join(blocks)))
    return ParsedDocument(pages)


def _xlsx(data: bytes) -> ParsedDocument:
    import openpyxl

    workbook = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    pages: list[ParsedPage] = []
    try:
        for sheet in workbook.worksheets:
            rows: list[list[object]] = []
            for row in sheet.iter_rows(values_only=True, max_col=MAX_TABLE_COLUMNS):
                if not any(_filled(c) for c in row):  # styled but empty rows
                    continue
                rows.append(list(row))
                if len(rows) >= MAX_TABLE_ROWS:
                    break
            pages += _table_pages(sheet.title, rows)
    finally:
        workbook.close()
    return ParsedDocument(pages)


def _csv(data: bytes) -> ParsedDocument:
    """CSV and TSV: the delimiter is sniffed from the start of the file."""
    text = decode_text(data) or ""
    try:
        delimiter = csv.Sniffer().sniff(text[:4096], delimiters=",;\t").delimiter
    except csv.Error:
        delimiter = ","
    rows: list[list[object]] = []
    for row in csv.reader(io.StringIO(text), delimiter=delimiter):
        rows.append(list(row))
        if len(rows) >= MAX_TABLE_ROWS:
            break
    return ParsedDocument(_table_pages(None, rows))


# --- text, markdown, HTML, images -----------------------------------------------------------


_HTML_SKIP = ("script", "style", "noscript", "template", "head", "svg", "iframe", "form")


_TEX = "application/x-tex"


def _html(data: bytes) -> ParsedDocument:
    """HTML as markdown (headings, lists, links, tables) with markdownify, minus what a reader
    never sees. MathML carrying its TeX source (`<annotation encoding="application/x-tex">`, as
    KaTeX and MathJax output and M09's LMS pages have) is written as LaTeX; the pages of such a
    document are `latex` and escape every other dollar sign."""
    from bs4 import BeautifulSoup
    from markdownify import MarkdownConverter

    soup = BeautifulSoup(decode_text(data) or "", "html.parser")
    for tag in soup(_HTML_SKIP):
        tag.decompose()
    latex = False
    for math in soup.find_all("math"):
        if _tex(math) is None:
            continue
        latex = True
        # KaTeX's output keeps the formula twice: the MathML, and a drawing of it in text
        # hidden from screen readers (`.katex-html`), which would be read as a second, garbled
        # copy.
        katex = math.find_parent(class_="katex")
        for drawn in katex.select('[aria-hidden="true"]') if katex is not None else []:
            drawn.decompose()

    class Converter(MarkdownConverter):
        def convert_math(self, el: Any, text: str, parent_tags: set[str]) -> str:
            tex = _tex(el)
            if tex is None:
                return text
            if el.get("display") == "block":
                return f"\n\n$$\n{tex}\n$$\n\n"
            return f"${tex}$"

        def escape(self, text: str, parent_tags: set[str]) -> str:
            escaped = super().escape(text, parent_tags)  # pyright: ignore[reportAttributeAccessIssue]
            return escaped.replace("$", r"\$") if latex else escaped

    text = Converter(heading_style="ATX", bullets="-").convert_soup(soup)
    pages = _text_pages(re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n\n", text))
    for page in pages:
        page.latex = latex
    return ParsedDocument(pages)


def _tex(math: Any) -> str | None:
    annotation = math.find("annotation", attrs={"encoding": _TEX})
    tex = annotation.get_text().strip() if annotation is not None else ""
    return tex or None


def parse(data: bytes, detected: Detected, *, max_pages: int = MAX_PAGES) -> ParsedDocument:
    """Reads the file. Raises `ParseError` for files that cannot be read."""
    try:
        result = _dispatch(data, detected, max_pages)
    except ParseError:
        raise
    except Exception as exc:
        raise ParseError("files.parse_failed") from exc
    if len(result.pages) > max_pages:
        if detected.kind not in ("xlsx", "csv"):
            raise ParseError("files.too_many_pages", max=max_pages)
        # A long table is still useful from the top: keep what fits.
        result.pages = result.pages[:max_pages]
    return result


def _check_unpacked_size(data: bytes) -> None:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if sum(info.file_size for info in archive.infolist()) > MAX_OFFICE_UNPACKED_BYTES:
            raise ParseError("files.too_complex")


def _dispatch(data: bytes, detected: Detected, max_pages: int) -> ParsedDocument:
    if detected.kind in ("docx", "pptx", "xlsx"):
        _check_unpacked_size(data)
    match detected.kind:
        case "pdf":
            return _pdf(data, max_pages)
        case "docx":
            return _docx(data)
        case "pptx":
            return _pptx(data)
        case "xlsx":
            return _xlsx(data)
        case "csv":
            return _csv(data)
        case "html":
            return _html(data)
        case "text" | "markdown":
            return ParsedDocument(_text_pages(decode_text(data) or ""))
        case "image":
            return ParsedDocument([ParsedPage("", kind="image")])
        case _:
            raise ParseError("files.unsupported_type")


def guess_language(text: str) -> str | None:
    """ "zh" when the text is mostly CJK, "en" when it is mostly Latin letters."""
    sample = text[:20_000]
    cjk = len(re.findall(r"[\u3400-\u9fff]", sample))
    latin = len(re.findall(r"[A-Za-z]", sample))
    if cjk < 6 and latin < 20:
        return None
    return "zh" if cjk > latin * 0.3 else "en"
