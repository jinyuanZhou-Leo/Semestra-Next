"""File bytes for the fake Canvas: real PDFs, Word documents and a scanned page, so the file
pipeline parses, chunks and searches them like course files."""

import io
from functools import cache

import pymupdf
from PIL import Image, ImageDraw

PARAGRAPHS = (
    "This lecture introduces {topic} and shows where it fits in the course. We start from the "
    "definitions, work through two examples on the board, and finish with the questions that "
    "usually appear on the midterm.",
    "Key idea: {topic} reduces a large problem to a few equations you can solve by hand. Write "
    "down what is known, choose the unknowns carefully, and check the units of every result.",
    "Worked example. A student applies {topic} to the circuit in Figure 3. The first attempt "
    "forgets a sign; the second attempt labels every quantity first and gets the right answer.",
    "Common mistakes with {topic}: mixing up reference directions, dropping a term when "
    "simplifying, and stopping before checking the answer against a limiting case.",
    "Practice problems for {topic} are in the tutorial handout. Solutions are posted after the "
    "tutorial; try every problem before reading them.",
)


def _lines(title: str, topic: str, pages: int) -> list[list[str]]:
    out = []
    for page in range(pages):
        heading = title if page == 0 else f"{title} (continued)"
        body = [PARAGRAPHS[(page + i) % len(PARAGRAPHS)].format(topic=topic) for i in range(3)]
        out.append([heading, *body])
    return out


@cache
def pdf(title: str, topic: str, pages: int = 3) -> bytes:
    doc = pymupdf.open()
    for heading, *body in _lines(title, topic, pages):
        page = doc.new_page()
        page.insert_text((72, 80), heading, fontsize=18)
        page.insert_textbox(pymupdf.Rect(72, 110, 540, 760), "\n\n".join(body), fontsize=11)
    return doc.tobytes()


@cache
def docx(title: str, topic: str) -> bytes:
    import docx as python_docx

    document = python_docx.Document()
    document.add_heading(title, level=1)
    for paragraph in _lines(title, topic, 1)[0][1:]:
        document.add_paragraph(paragraph)
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


@cache
def scanned_pdf(title: str) -> bytes:
    """A page with no text layer, only a picture of text (needs OCR)."""
    image = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(image)
    for i, line in enumerate([title, "", *PARAGRAPHS[0].format(topic="the exam").split(". ")]):
        draw.text((100, 120 + i * 40), line, fill="black", font_size=28)
    png = io.BytesIO()
    image.save(png, format="PNG")
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_image(page.rect, stream=png.getvalue())
    return doc.tobytes()


def text(title: str, topic: str) -> bytes:
    return "\n\n".join(_lines(title, topic, 1)[0]).encode()
