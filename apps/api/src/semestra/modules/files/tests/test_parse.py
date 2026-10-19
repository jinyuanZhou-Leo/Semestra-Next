"""Type detection and the per-format readers (M07 §3.1, §9 snapshot-style checks)."""

import io

import pytest

from semestra.modules.files.parse import ParseError, detect, parse
from semestra.modules.files.parse.readers import guess_language
from semestra.modules.files.tests.conftest import SYLLABUS, make_docx, make_pdf, make_png


def test_detection_uses_the_content_not_the_name():
    assert detect(make_pdf(["x"]), "notes.txt").kind == "pdf"
    assert detect(make_png(), "photo.pdf").mime == "image/png"
    assert detect(make_docx([("Normal", "hi")]), "a.bin").kind == "docx"
    assert detect(b"BEGIN:VCALENDAR\r\nEND:VCALENDAR", "x.ics").kind == "ics"
    assert detect(b"<!doctype html><p>hi</p>", "page").kind == "html"
    assert detect(b"a,b\n1,2", "data.csv").kind == "csv"
    assert detect(b"# Title", "readme.md").mime == "text/markdown"
    assert detect("纯文本".encode("gb18030"), "a.txt").kind == "text"
    assert detect(b"\x00\x01\x02binary", "a.txt").kind == "other"
    assert detect(b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>", "x.svg").mime == (
        "text/plain"
    )


def test_digital_pdf_gives_one_markdown_page_per_page():
    doc = parse(make_pdf(SYLLABUS), detect(make_pdf(SYLLABUS)))
    assert len(doc.pages) == 3
    assert "APS105 Computer Fundamentals" in doc.pages[0].markdown
    assert "30 percent" in doc.pages[1].markdown
    assert "期中考试时间" in doc.pages[2].markdown
    assert not any(p.needs_ocr for p in doc.pages)


def test_scanned_pdf_pages_are_marked_for_ocr():
    data = make_pdf(
        ["typed page with enough words to count as a digital text page", "scan"], scanned={1}
    )
    doc = parse(data, detect(data))
    assert [p.needs_ocr for p in doc.pages] == [False, True]


def test_encrypted_and_oversized_pdfs_are_refused():
    import pymupdf

    source = pymupdf.open(stream=make_pdf(["secret"]), filetype="pdf")
    locked = source.tobytes(
        encryption=pymupdf.PDF_ENCRYPT_AES_256,  # pyright: ignore[reportAttributeAccessIssue]
        user_pw="pw",
        owner_pw="pw",
    )
    with pytest.raises(ParseError) as exc:
        parse(locked, detect(locked))
    assert exc.value.code == "files.encrypted_pdf"

    many = make_pdf(["p"] * 4)
    with pytest.raises(ParseError) as exc:
        parse(many, detect(many), max_pages=3)
    assert exc.value.code == "files.too_many_pages"


def test_docx_headings_and_paragraphs():
    data = make_docx(
        [
            ("Heading 1", "Course outline"),
            ("Normal", "Weekly quizzes."),
            ("Heading 2", "Late policy"),
            ("Normal", "10% per day."),
        ]
    )
    doc = parse(data, detect(data))
    text = doc.pages[0].markdown
    assert "# Course outline" in text
    assert "## Late policy" in text
    assert "10% per day." in text


def test_long_docx_is_split_into_logical_pages():
    data = make_docx([("Normal", "word " * 200) for _ in range(20)])
    assert len(parse(data, detect(data)).pages) >= 3


def test_pptx_has_one_page_per_slide_with_notes():
    from pptx import Presentation

    deck = Presentation()
    for title, body in [("Week 1", "Intro"), ("Week 2", "Pointers")]:
        slide = deck.slides.add_slide(deck.slide_layouts[1])
        slide.shapes.title.text = title  # pyright: ignore[reportOptionalMemberAccess]
        slide.placeholders[1].text = body  # pyright: ignore[reportAttributeAccessIssue]
        slide.notes_slide.notes_text_frame.text = f"say {body}"  # pyright: ignore[reportOptionalMemberAccess]
    out = io.BytesIO()
    deck.save(out)
    doc = parse(out.getvalue(), detect(out.getvalue()))
    assert len(doc.pages) == 2
    assert doc.pages[1].markdown.startswith("# Week 2")
    assert "- Pointers" in doc.pages[1].markdown
    assert "Notes: say Pointers" in doc.pages[1].markdown


def test_spreadsheets_become_markdown_tables():
    import openpyxl

    book = openpyxl.Workbook()
    sheet = book.active
    assert sheet is not None
    sheet.title = "Marks"
    sheet.append(["Item", "Weight"])
    sheet.append(["Midterm", 30])
    out = io.BytesIO()
    book.save(out)
    doc = parse(out.getvalue(), detect(out.getvalue()))
    assert doc.pages[0].markdown == "## Marks\n\n| Item | Weight |\n| --- | --- |\n| Midterm | 30 |"

    csv_doc = parse(b"a;b\n1;2\n", detect(b"a;b\n1;2\n", "x.csv"))
    assert "| 1 | 2 |" in csv_doc.pages[0].markdown


def test_html_keeps_headings_and_drops_scripts():
    data = (
        b"<html><head><title>t</title><script>alert(1)</script></head>"
        b"<body><h2>Rules</h2><p>Be kind</p><ul><li>One</li></ul></body></html>"
    )
    text = parse(data, detect(data)).pages[0].markdown
    assert "## Rules" in text
    assert "Be kind" in text
    assert "- One" in text
    assert "alert" not in text


def test_images_are_one_page_waiting_for_ocr():
    data = make_png()
    doc = parse(data, detect(data))
    assert len(doc.pages) == 1
    assert doc.pages[0].needs_ocr


def test_unreadable_files_raise():
    with pytest.raises(ParseError) as exc:
        parse(b"\x00binary", detect(b"\x00binary"))
    assert exc.value.code == "files.unsupported_type"
    broken = b"%PDF-1.7 broken"
    with pytest.raises(ParseError) as exc:
        parse(broken, detect(broken))
    assert exc.value.code == "files.parse_failed"


def test_language_guess():
    assert guess_language("这门课程的期中考试在十月") == "zh"
    assert guess_language("The midterm exam is in October this year") == "en"
    assert guess_language("123") is None
