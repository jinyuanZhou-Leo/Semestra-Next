"""Where a course's materials go (M09 §4.2): the type rules and what counts as a list page."""

import pytest

from semestra.modules.lms.materials import Clues, MaterialType, classify, page_shape

CASES: list[tuple[Clues, MaterialType]] = [
    # The item's own title first, in the order of the rules.
    (Clues("Lecture 21 - Sequential circuits.pdf"), "lectures"),
    (Clues("Lec_03-intro.pptx"), "lectures"),
    (Clues("Tutorial 10 - Problems.pdf"), "problems"),
    (Clues("Tutorial 10 - Solutions.pdf"), "problems"),
    (Clues("Lab 5 handout"), "tutorials"),
    (Clues("Midterm 2024 solutions.pdf"), "exams"),
    (Clues("Final project report template.docx"), "general"),
    (Clues("Lecture recordings (Week 11)"), "recordings"),
    (Clues("第三章 讲义.pdf"), "lectures"),
    (Clues("期中考试 2023.pdf"), "exams"),
    (Clues("Syllabus - ECE241 Fall 2026"), "info"),
    (Clues("Example circuits.pdf"), "general"),  # "example" is not an exam
    # What the file is, or where a link goes.
    (Clues("week11.mp4", mime="video/mp4"), "recordings"),
    (Clues("Week 11", url="https://utoronto.zoom.us/rec/share/abc"), "recordings"),
    (Clues("Watch", url="https://www.youtube.com/watch?v=1"), "recordings"),
    # Then where the instructor put it: subheader, module, folder (deepest first), list page.
    (Clues("W3.pdf", subheader="Tutorial", module="Week 3"), "tutorials"),
    (Clues("W3.pdf", module="Lecture slides"), "lectures"),
    (Clues("W3.pdf", folder_path="Exams/Old"), "exams"),
    (Clues("W3.pdf", folder_path="Lectures/Readings"), "readings"),
    (Clues("Set 1.pdf", listed_by=["Problem sets"]), "problems"),
    # Only an item's own title makes it the syllabus.
    (Clues("Grading.pdf", module="Course information"), "general"),
]


@pytest.mark.parametrize(("clues", "expected"), CASES)
def test_classify(clues: Clues, expected: MaterialType):
    assert classify(clues) == expected


def test_list_pages_are_told_from_documents():
    links = "".join(f'<li><a href="https://x/files/{n}">Lecture {n}</a></li>' for n in range(9))
    assert page_shape(f"<h2>Slides</h2><ul>{links}</ul>").is_list
    assert page_shape("").is_list
    office_hours = "<p>Office hours: Mondays 3-4 pm in BA1200.</p>"
    assert not page_shape(office_hours).is_list  # short, but its own text
    long_text = "<p>" + "The lab covers flip-flops and timing. " * 6 + "</p>"
    assert not page_shape(long_text + '<a href="https://x/files/1">handout</a>').is_list
    assert page_shape(long_text + links).links[0] == "https://x/files/0"
