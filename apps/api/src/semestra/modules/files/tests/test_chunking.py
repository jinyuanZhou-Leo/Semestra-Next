"""Splitting pages into chunks (M07 §3.1 step 3)."""

import itertools
import re

from semestra.modules.files.chunking import (
    MAX_PAGE_SPAN,
    OVERLAP_TOKENS,
    TARGET_TOKENS,
    chunk_pages,
    estimate_tokens,
    split_block,
)


def words(n: int, prefix: str = "w") -> str:
    return " ".join(f"{prefix}{i}" for i in range(n))


def test_token_estimate_counts_chinese_characters_and_english_words():
    assert estimate_tokens("你好世界") == 4
    assert estimate_tokens("hello world") == 3
    assert estimate_tokens("") == 0


def test_headings_become_the_path_of_the_chunk():
    pages = [(1, f"# Course\n\n## Grading\n\n{words(150)}\n\n## Schedule\n\n{words(150, 's')}")]
    chunks = chunk_pages(pages)
    assert [c.heading_path for c in chunks] == [["Course", "Grading"], ["Course", "Schedule"]]
    assert "## Grading" in chunks[0].text
    assert chunks[1].text.startswith("## Schedule")
    assert chunks[0].chunk_no == 0
    assert chunks[1].chunk_no == 1


def test_small_sections_are_kept_together():
    chunks = chunk_pages([(1, "# A\n\nshort\n\n# B\n\nalso short")])
    assert len(chunks) == 1
    assert "also short" in chunks[0].text


def test_long_text_is_split_near_the_target_with_overlap():
    paragraphs = "\n\n".join(words(100, f"p{i}x") for i in range(30))
    chunks = chunk_pages([(1, paragraphs)])
    assert len(chunks) > 3
    for chunk in chunks:
        assert chunk.token_count <= TARGET_TOKENS + 140  # a paragraph past the target plus overlap
    # The start of each chunk repeats the end of the one before it.
    for before, after in itertools.pairwise(chunks):
        tail_words = before.text.split()[-5:]
        assert all(w in after.text for w in tail_words)
    assert estimate_tokens(chunks[1].text.split("\n\n")[0]) <= OVERLAP_TOKENS + 5


def test_a_chunk_never_spans_more_than_three_pages():
    pages = [(n, f"page {n} " + words(40, f"q{n}x")) for n in range(1, 11)]
    chunks = chunk_pages(pages)
    assert len(chunks) >= 3
    assert all(c.page_to - c.page_from < MAX_PAGE_SPAN for c in chunks)
    assert chunks[0].page_from == 1
    assert chunks[-1].page_to == 10


def test_chinese_text_is_split_and_keeps_page_numbers():
    text = "\n\n".join("这是一段关于课程安排的文字。" * 20 for _ in range(8))
    chunks = chunk_pages([(3, text)])
    assert len(chunks) >= 2
    assert all(c.page_from == 3 and c.page_to == 3 for c in chunks)


def test_a_block_larger_than_a_chunk_is_cut_at_sentences():
    block = " ".join(f"Sentence number {i} says something useful." for i in range(300))
    pieces = split_block(block)
    assert len(pieces) > 1
    assert all(estimate_tokens(p) <= TARGET_TOKENS for p in pieces)
    assert re.sub(r"\s", "", "".join(pieces)) == re.sub(r"\s", "", block)


def test_unbroken_text_is_still_split():
    pieces = split_block("字" * 2000)
    assert len(pieces) >= 3
    assert sum(len(p) for p in pieces) == 2000


def test_code_fences_and_tables_stay_whole():
    table = "| a | b |\n| --- | --- |\n| 1 | 2 |"
    code = "```\nline 1\n\nline 3 after a blank line\n```"
    chunks = chunk_pages([(1, f"{table}\n\n{code}")])
    assert len(chunks) == 1
    assert table in chunks[0].text
    assert code in chunks[0].text


def test_no_pages_no_chunks():
    assert chunk_pages([]) == []
    assert chunk_pages([(1, "   \n\n  ")]) == []
