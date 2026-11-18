"""Which type of course material a file is (M07 §8): the rules."""

import pytest

from semestra.modules.files.sorting import Clues, MaterialType, classify

CASES: list[tuple[Clues, MaterialType]] = [
    # The item's own title first.
    (Clues("Lecture 21 - Sequential circuits.pdf"), "lectures"),
    (Clues("Lec_03-intro.pptx"), "lectures"),
    (Clues("Lecture 3 notes.pdf"), "lectures"),
    (Clues("Lab 5 handout"), "tutorials"),
    (Clues("Final exam 2023.pdf"), "exams"),
    (Clues("Past papers"), "exams"),  # not readings: a phrase wins over its word
    (Clues("Midterm 2024 solutions.pdf"), "exams"),
    (Clues("Lecture recordings (Week 11)"), "recordings"),
    (Clues("Final project report template.docx"), "general"),
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
    # A title that names two types, or only says "final", is left to the model, whatever the
    # module or folder around it says.
    (Clues("week5_notes_final_v2.pdf"), "general"),
    (Clues("Tutorial 10 - Problems.pdf"), "general"),
    (Clues("Final review.pdf", module="Exams"), "general"),
]


@pytest.mark.parametrize(("clues", "expected"), CASES)
def test_classify(clues: Clues, expected: MaterialType):
    assert classify(clues) == expected
