"""Pure parts of `files.search`: query terms, fusion, snippets."""

from semestra.modules.files.search import make_snippet, query_terms, reciprocal_rank_fusion


def test_query_terms_split_by_length_and_script():
    terms = query_terms("APS105 midterm 期中考试 of 课")
    assert "APS105" in terms.fts
    assert "midterm" in terms.fts
    assert {"期中考", "中考试"} <= set(terms.fts)
    assert terms.short == ["of", "课"]
    assert query_terms("“exam?”").fts == ["exam"]


def test_rrf_rewards_items_found_by_both_rankings():
    scores = reciprocal_rank_fusion([["a", "b", "c"], ["c", "a"]])
    assert max(scores, key=lambda k: scores[k]) == "a"
    assert scores["c"] > scores["b"]


def test_snippet_marks_matches_and_trims():
    text = "x " * 300 + "The midterm exam is worth 30 percent." + " y" * 300
    snippet = make_snippet(text, ["midterm", "exam"])
    assert "<mark>midterm</mark> <mark>exam</mark>" in snippet
    assert snippet.startswith("…")
    assert snippet.endswith("…")
    assert len(snippet) < 300
    assert make_snippet("考试时间", ["考试时", "试时间"]) == "<mark>考试时间</mark>"
    assert "<mark>" not in make_snippet("a <mark>fake</mark> tag", [])
