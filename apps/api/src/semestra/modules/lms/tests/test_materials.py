"""Which pages of a course only list other things (M09 §4.2)."""

from semestra.modules.lms.materials import page_shape


def test_list_pages_are_told_from_documents():
    links = "".join(f'<li><a href="https://x/files/{n}">Lecture {n}</a></li>' for n in range(9))
    assert page_shape(f"<h2>Slides</h2><ul>{links}</ul>").is_list
    assert page_shape("").is_list
    office_hours = "<p>Office hours: Mondays 3-4 pm in BA1200.</p>"
    assert not page_shape(office_hours).is_list  # short, but its own text
    long_text = "<p>" + "The lab covers flip-flops and timing. " * 6 + "</p>"
    assert not page_shape(long_text + '<a href="https://x/files/1">handout</a>').is_list
    assert page_shape(long_text + links).links[0] == "https://x/files/0"
